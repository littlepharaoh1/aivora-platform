// @ts-nocheck
import React, { useState, useRef } from "react";
import { Upload, Zap, BarChart3, Download, RefreshCw, ArrowRight, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { runUnifiedPipeline, PIPELINE_PRESETS } from "../lib/dsp/aivoraDSPController";

const PROFILES = {
  wakeword:     { label:"Wake Word",    icon:"🎙️", color:"#22d3ee", th:{ pkMin:-6,  pkMax:-1,  rmsMin:-28, rmsMax:-10, noiseMax:-60, snrMin:45, silMax:0.15 } },
  asr:          { label:"ASR",          icon:"🗣️", color:"#10b981", th:{ pkMin:-9,  pkMax:-2,  rmsMin:-32, rmsMax:-12, noiseMax:-55, snrMin:35, silMax:0.30 } },
  tts:          { label:"TTS",          icon:"🔊", color:"#f59e0b", th:{ pkMin:-6,  pkMax:-1,  rmsMin:-24, rmsMax:-8,  noiseMax:-65, snrMin:50, silMax:0.20 } },
  conversation: { label:"Conversation", icon:"💬", color:"#8b5cf6", th:{ pkMin:-12, pkMax:-3,  rmsMin:-35, rmsMax:-15, noiseMax:-50, snrMin:25, silMax:0.40 } },
};

function toDb(v) { return v <= 0 ? -120 : 20 * Math.log10(v); }
function fromDb(db) { return Math.pow(10, db / 20); }
function getStats(data, sr) {
  let peak=0,sq=0,clip=0; const ns=[];
  const step=Math.max(1,Math.floor(data.length/20000));
  for(let i=0;i<data.length;i+=step){const v=Math.abs(data[i]);if(v>peak)peak=v;sq+=v*v;if(v>=0.999)clip++;if(v<0.005)ns.push(v*v);}
  const cnt=Math.floor(data.length/step);
  const rms=Math.sqrt(sq/cnt);
  const nr=ns.length>10?Math.sqrt(ns.reduce((a,b)=>a+b,0)/ns.length):0.000001;
  const pkDb=toDb(peak),rDb=toDb(rms),nDb=toDb(nr);
  return {pkDb,rDb,nDb,snr:rDb-nDb,clip,dur:0};
}

function detectHum(data,sr){
  const p50=Math.round(sr/50),p60=Math.round(sr/60);
  let c50=0,c60=0,tot=0;
  const len=Math.min(2000,data.length-Math.max(p50,p60));
  for(let i=0;i<len;i++){c50+=data[i]*(data[i+p50]||0);c60+=data[i]*(data[i+p60]||0);tot+=data[i]*data[i];}
  const n=tot/len||1,h50=Math.abs(c50/len)/n,h60=Math.abs(c60/len)/n;
  return {detected:h50>0.15||h60>0.15,freq:h50>h60?50:60,strength:Math.max(h50,h60)};
}

function getSilence(data,sr){
  const fs=Math.floor(sr*0.01),frames=Math.floor(data.length/fs);
  let lead=0,trail=0,tot=0,speech=false,gap=0;
  for(let f=0;f<frames;f++){let e=0;for(let i=0;i<fs;i++){const v=data[f*fs+i]||0;e+=v*v;}const sil=Math.sqrt(e/fs)<0.002;if(sil){tot++;gap++;if(!speech)lead++;}else{speech=true;gap=0;}}
  trail=gap;
  return {leadMs:lead*10,trailMs:trail*10,silRatio:tot/frames};
}

function applyHP(data,sr,cutoff){
  const rc=1/(2*Math.PI*cutoff),dt=1/sr,alpha=rc/(rc+dt);
  const out=new Float32Array(data.length);out[0]=data[0];
  for(let i=1;i<data.length;i++)out[i]=alpha*(out[i-1]+data[i]-data[i-1]);
  return out;
}

function applyGate(data,sr,thDb,atkMs,relMs){
  const th=fromDb(thDb),aS=Math.floor(atkMs/1000*sr),rS=Math.floor(relMs/1000*sr);
  const out=new Float32Array(data.length);let g=0;
  for(let i=0;i<data.length;i++){const v=Math.abs(data[i]);if(v>th)g=Math.min(1,g+1/Math.max(1,aS));else g=Math.max(0,g-1/Math.max(1,rS));out[i]=data[i]*g;}
  return out;
}

function trimSil(data,sr,thDb,padMs){
  const th=fromDb(thDb),pad=Math.floor(padMs/1000*sr);
  let s=0,e=data.length-1;
  while(s<data.length&&Math.abs(data[s])<th)s++;
  while(e>s&&Math.abs(data[e])<th)e--;
  return data.slice(Math.max(0,s-pad),Math.min(data.length-1,e+pad)+1);
}

function normAudio(data,targetDb){
  let peak=0;for(let i=0;i<data.length;i++){const v=Math.abs(data[i]);if(v>peak)peak=v;}
  const g=peak>0?fromDb(targetDb)/peak:1;
  const out=new Float32Array(data.length);
  for(let i=0;i<data.length;i++)out[i]=Math.max(-1,Math.min(1,data[i]*g));
  return out;
}

function encWav(chs,sr,len){
  const nc=chs.length,l=len*nc*4,ab=new ArrayBuffer(44+l),v=new DataView(ab);
  const s=(o,str)=>{for(let i=0;i<str.length;i++)v.setUint8(o+i,str.charCodeAt(i));};
  s(0,"RIFF");v.setUint32(4,36+l,true);s(8,"WAVE");s(12,"fmt ");
  v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,nc,true);
  v.setUint32(24,sr,true);v.setUint32(28,sr*nc*4,true);v.setUint16(32,nc*4,true);v.setUint16(34,32,true);
  s(36,"data");v.setUint32(40,l,true);
  let off=44;for(let i=0;i<len;i++)for(let c=0;c<nc;c++){v.setFloat32(off,chs[c][i]||0,true);off+=4;}
  return new Blob([ab],{type:"audio/wav"});
}

function scoreAudio(buf,pk){
  const data=buf.getChannelData(0),sr=buf.sampleRate,p=PROFILES[pk],th=p.th;
  const st=getStats(data,sr),hum=detectHum(data,sr),edges=getSilence(data,sr);
  const C=[
    {w:15,sc:sr===48000?100:sr===44100?60:20},
    {w:20,sc:st.pkDb>=th.pkMin&&st.pkDb<=th.pkMax&&st.pkDb<-0.3?100:st.pkDb>-0.3?0:50},
    {w:15,sc:st.rDb>=th.rmsMin&&st.rDb<=th.rmsMax?100:50},
    {w:15,sc:st.nDb<=th.noiseMax?100:st.nDb<=th.noiseMax+10?50:15},
    {w:15,sc:st.snr>=th.snrMin?100:st.snr>=th.snrMin-15?50:15},
    {w:10,sc:st.clip===0?100:st.clip<5?40:0},
    {w:10,sc:edges.silRatio<=th.silMax?100:50},
  ];
  const tw=C.reduce((a,c)=>a+c.w,0);
  const total=Math.round(C.reduce((a,c)=>a+c.sc*c.w,0)/tw);
  const grade=total>=90?"A":total>=75?"B":total>=60?"C":total>=40?"D":"F";
  const verdict=total>=75&&st.clip===0?"READY":total>=50?"REVIEW":"REJECT";
  return {total,grade,verdict,...st,hum,edges,sr,dur:buf.duration};
}

function MiniRing({score,size=70}){
  const r=size*0.4,c=2*Math.PI*r,off=c-(score/100)*c;
  const col=score>=75?"#10b981":score>=50?"#f59e0b":"#ef4444";
  return <div style={{position:"relative",width:size,height:size}}>
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#0f2a3a" strokeWidth={5}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={5} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{transition:"stroke-dashoffset 1s"}}/>
    </svg>
    <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:size*0.22,fontWeight:900,color:col,fontFamily:"monospace",lineHeight:1}}>{score}</div>
      <div style={{fontSize:size*0.14,color:col,fontFamily:"monospace",fontWeight:700}}>{score>=90?"A":score>=75?"B":score>=60?"C":score>=40?"D":"F"}</div>
    </div>
  </div>;
}

function StepDot({n,label,status,color}){
  const done=status==="done",active=status==="active";
  return <div style={{display:"flex",alignItems:"center",gap:8}}>
    <div style={{width:26,height:26,borderRadius:"50%",background:done?color:active?color+"33":"#060e16",border:"2px solid "+(done||active?color+"66":"#0f2a3a"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:done?"#050d14":active?color:"#2a5a6a",fontFamily:"monospace",transition:"all 0.3s"}}>{done?"✓":n}</div>
    <span style={{fontSize:11,color:done?color:active?"#e0f2f8":"#2a5a6a",fontFamily:"monospace",fontWeight:active?700:400}}>{label}</span>
  </div>;
}

export default function AudioPipeline(){
  const [file,setFile]=useState(null);
  const [pk,setPk]=useState("wakeword");
  const [step,setStep]=useState(0);
  const [loading,setLoading]=useState(false);
  const [log,setLog]=useState([]);
  const [origBuf,setOrigBuf]=useState(null);
  const [enhBuf,setEnhBuf]=useState(null);
  const [sOrig,setSOrig]=useState(null);
  const [sEnh,setSEnh]=useState(null);
  const audioO=useRef(null),audioE=useRef(null);
  const prof=PROFILES[pk];

  function addLog(msg,type="info"){const t=new Date().toLocaleTimeString();setLog(p=>[{t,msg,type},...p.slice(0,29)]);}

  function reset(){setFile(null);setStep(0);setLog([]);setOrigBuf(null);setEnhBuf(null);setSOrig(null);setSEnh(null);if(audioO.current)audioO.current.src="";if(audioE.current)audioE.current.src="";}

  async function loadFile(f){
    if(!f.name.toLowerCase().endsWith(".wav"))return;
    setLoading(true);reset();setFile(f);
    addLog("Loading: "+f.name);
    try{
      const ab=await f.arrayBuffer();
      const ctx=new AudioContext();
      const buf=await ctx.decodeAudioData(ab);
      setOrigBuf(buf);
      if(audioO.current)audioO.current.src=URL.createObjectURL(f);
      addLog("Loaded: "+buf.duration.toFixed(2)+"s | "+buf.sampleRate+"Hz","success");
      setStep(1);
    }catch(e){addLog("Failed","error");}
    setLoading(false);
  }

  async function runAnalysis(){
    if(!origBuf)return;
    setLoading(true);
    addLog("Analyzing...");
    const s=scoreAudio(origBuf,pk);
    setSOrig(s);
    addLog("Score: "+s.total+"/100 ("+s.grade+") - "+s.verdict,s.verdict==="READY"?"success":s.verdict==="REVIEW"?"warn":"error");
    if(s.hum.detected)addLog(s.hum.freq+"Hz Hum detected!","warn");
    setStep(2);
    setLoading(false);
  }

  async function runEnhance(){
    if(!origBuf)return;
    setLoading(true);
    addLog("Starting enhancement...");
    const sr=origBuf.sampleRate,nc=origBuf.numberOfChannels;
    const chs=[];
    for(let c=0;c<nc;c++){
      let d=origBuf.getChannelData(c);
      d=applyHP(d,sr,80);addLog("HP filter applied");
      d=applyGate(d,sr,-55,10,100);addLog("Noise gate applied");
      const bl=d.length;
      d=trimSil(d,sr,-50,50);addLog("Silence trimmed: "+(bl/sr).toFixed(2)+"s -> "+(d.length/sr).toFixed(2)+"s");
      d=normAudio(d,-3);addLog("Normalized to -3dBFS");
      chs.push(d);
    }
    const minLen=Math.min(...chs.map(c=>c.length));
    const ctx=new AudioContext();
    const out=ctx.createBuffer(nc,minLen,sr);
    for(let c=0;c<nc;c++)out.getChannelData(c).set(chs[c].slice(0,minLen));
    setEnhBuf(out);
    const blob=encWav(chs.map(c=>c.slice(0,minLen)),sr,minLen);
    if(audioE.current)audioE.current.src=URL.createObjectURL(blob);
    const s=scoreAudio(out,pk);
    setSEnh(s);
    addLog("Enhanced score: "+s.total+"/100 ("+s.grade+") - "+s.verdict,s.verdict==="READY"?"success":"warn");
    setStep(3);
    setLoading(false);
  }

  function download(){
    if(!enhBuf||!file)return;
    const nc=enhBuf.numberOfChannels,chs=[];
    for(let c=0;c<nc;c++)chs.push(enhBuf.getChannelData(c));
    const blob=encWav(chs,enhBuf.sampleRate,enhBuf.length);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=file.name.replace(".wav","_pipeline.wav");
    a.click();
    addLog("Downloaded: "+a.download,"success");
  }

  const vc=sEnh?sEnh.verdict==="READY"?"#10b981":"#f59e0b":sOrig?sOrig.verdict==="READY"?"#10b981":sOrig.verdict==="REVIEW"?"#f59e0b":"#ef4444":"#22d3ee";
  const imp=sOrig&&sEnh?sEnh.total-sOrig.total:null;
  const lc=t=>t==="success"?"#10b981":t==="warn"?"#f59e0b":t==="error"?"#ef4444":"#4a8a9a";

  return <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>
    <div style={{background:"linear-gradient(135deg,#060e18,#071520)",borderBottom:"1px solid #0f2a3a",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,borderRadius:10,background:"#22d3ee22",border:"1px solid #22d3ee33",display:"flex",alignItems:"center",justifyContent:"center"}}><Zap size={16} color="#22d3ee"/></div>
        <div><div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>AUDIO PIPELINE</div><div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>V4 · UPLOAD → ANALYZE → ENHANCE → SCORE</div></div>
      </div>
      <div style={{display:"flex",gap:8}}>
        {step>0&&<button onClick={reset} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #0f2a3a",background:"transparent",color:"#4a8a9a",cursor:"pointer",fontSize:10,fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}><RefreshCw size={11}/> Reset</button>}
        {enhBuf&&<button onClick={download} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #22d3ee44",background:"transparent",color:"#22d3ee",cursor:"pointer",fontSize:10,fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}><Download size={11}/> Download</button>}
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",minHeight:"calc(100vh - 65px)"}}>
      <div style={{borderRight:"1px solid #0f2a3a",padding:14,display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1}}>PIPELINE STEPS</div>
          <StepDot n={1} label="Upload WAV" status={step>=1?"done":step===0?"active":"idle"} color="#22d3ee"/>
          <div style={{width:2,height:10,background:"#0f2a3a",marginLeft:12}}/>
          <StepDot n={2} label="Analyze" status={step>=2?"done":step===1?"active":"idle"} color="#10b981"/>
          <div style={{width:2,height:10,background:"#0f2a3a",marginLeft:12}}/>
          <StepDot n={3} label="Enhance" status={step>=3?"done":step===2?"active":"idle"} color="#f59e0b"/>
          <div style={{width:2,height:10,background:"#0f2a3a",marginLeft:12}}/>
          <StepDot n={4} label="Final Score" status={step>=3?"done":"idle"} color="#8b5cf6"/>
        </div>
        <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1}}>PROFILE</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {Object.entries(PROFILES).map(([id,p])=>(
            <div key={id} onClick={()=>{if(step===0)setPk(id);}} style={{border:"1px solid "+(pk===id?p.color+"66":"#0f2a3a"),borderRadius:8,padding:"8px",cursor:step===0?"pointer":"default",background:pk===id?p.color+"11":"#060e16",opacity:step>0&&pk!==id?0.4:1}}>
              <div style={{fontSize:14}}>{p.icon}</div>
              <div style={{fontSize:10,fontWeight:700,color:pk===id?p.color:"#a0c4cc"}}>{p.label}</div>
            </div>
          ))}
        </div>
        {step===0&&<div onClick={()=>document.getElementById("pipe-i").click()} style={{border:"2px dashed "+prof.color+"44",borderRadius:10,padding:"20px 10px",textAlign:"center",cursor:"pointer",background:"#050d14"}}>
          <input id="pipe-i" type="file" accept=".wav" hidden onChange={e=>{if(e.target.files[0])loadFile(e.target.files[0]);}}/>
          <Upload size={20} color={prof.color} style={{marginBottom:8}}/>
          <div style={{fontSize:12,color:"#a0c4cc"}}>{loading?"Loading...":"Upload WAV"}</div>
        </div>}
        {step===1&&<button onClick={runAnalysis} disabled={loading} style={{padding:"12px",borderRadius:10,border:"none",background:"#10b981",color:"#050d14",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><BarChart3 size={16}/> Analyze</button>}
        {step===2&&<button onClick={runEnhance} disabled={loading} style={{padding:"12px",borderRadius:10,border:"none",background:"#f59e0b",color:"#050d14",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Zap size={16}/> Enhance</button>}
        <div style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:8,padding:10,flex:1}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:6}}>LOG</div>
          <div style={{maxHeight:160,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
            {log.length===0?<span style={{fontSize:10,color:"#2a5a6a"}}>Waiting...</span>:log.map((e,i)=><div key={i} style={{fontSize:10,color:lc(e.type),opacity:i===0?1:0.7}}><span style={{color:"#2a5a6a"}}>[{e.t}] </span>{e.msg}</div>)}
          </div>
        </div>
      </div>
      <div style={{padding:16,display:"flex",flexDirection:"column",gap:14}}>
        {step===0&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,opacity:0.4}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {["📤","📊","⚡","🏆"].map((ic,i)=><React.Fragment key={i}><div style={{textAlign:"center"}}><div style={{fontSize:28,marginBottom:6}}>{ic}</div><div style={{fontSize:9,color:"#2a5a6a"}}>{["Upload","Analyze","Enhance","Score"][i]}</div></div>{i<3&&<ArrowRight size={14} color="#1a4a5a"/>}</React.Fragment>)}
          </div>
          <div style={{fontSize:12,color:"#2a5a6a",textAlign:"center"}}>Select profile and upload WAV to start</div>
        </div>}
        {step>=1&&file&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:10,padding:14}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:6}}>FILE</div>
          <div style={{fontSize:12,color:"#e0f2f8",fontWeight:700,marginBottom:4}}>{file.name}</div>
          <div style={{fontSize:9,color:prof.color,marginBottom:8}}>{prof.icon} {prof.label}</div>
          <audio ref={audioO} controls style={{width:"100%",height:30}}/>
        </div>}
        {sOrig&&<div style={{background:"#060e16",border:"1px solid #10b98133",borderRadius:10,padding:14}}>
          <div style={{fontSize:9,color:"#10b981",marginBottom:10}}>ORIGINAL SCORE</div>
          <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
            <MiniRing score={sOrig.total}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:900,color:sOrig.verdict==="READY"?"#10b981":sOrig.verdict==="REVIEW"?"#f59e0b":"#ef4444",fontFamily:"monospace"}}>{sOrig.grade}</span>
                <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,background:(sOrig.verdict==="READY"?"#10b981":sOrig.verdict==="REVIEW"?"#f59e0b":"#ef4444")+"22",color:sOrig.verdict==="READY"?"#10b981":sOrig.verdict==="REVIEW"?"#f59e0b":"#ef4444",border:"1px solid currentColor",alignSelf:"center"}}>{sOrig.verdict}</span>
                {sOrig.hum.detected&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:"#ef444422",color:"#ef4444",border:"1px solid #ef444444"}}>⚠ {sOrig.hum.freq}Hz HUM</span>}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[["Peak",sOrig.pkDb.toFixed(1)+"dB"],["RMS",sOrig.rDb.toFixed(1)+"dB"],["Noise",sOrig.nDb.toFixed(1)+"dB"],["SNR",sOrig.snr.toFixed(1)+"dB"],["Clipped",String(sOrig.clip)]].map(([l,v])=>(
                  <div key={l} style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,padding:"4px 8px"}}><div style={{fontSize:8,color:"#4a8a9a"}}>{l}</div><div style={{fontSize:11,color:"#cbd5e1",fontWeight:700}}>{v}</div></div>
                ))}
              </div>
            </div>
          </div>
        </div>}
        {sEnh&&enhBuf&&<div style={{background:"#060e16",border:"1px solid #f59e0b33",borderRadius:10,padding:14}}>
          <div style={{fontSize:9,color:"#f59e0b",marginBottom:10}}>ENHANCED SCORE</div>
          <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
            <MiniRing score={sEnh.total}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:900,color:sEnh.verdict==="READY"?"#10b981":"#f59e0b",fontFamily:"monospace"}}>{sEnh.grade}</span>
                <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,background:(sEnh.verdict==="READY"?"#10b981":"#f59e0b")+"22",color:sEnh.verdict==="READY"?"#10b981":"#f59e0b",border:"1px solid currentColor",alignSelf:"center"}}>{sEnh.verdict}</span>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[["Peak",sOrig.pkDb.toFixed(1),sEnh.pkDb.toFixed(1)],["RMS",sOrig.rDb.toFixed(1),sEnh.rDb.toFixed(1)],["Noise",sOrig.nDb.toFixed(1),sEnh.nDb.toFixed(1)],["SNR",sOrig.snr.toFixed(1),sEnh.snr.toFixed(1)]].map(([l,b,a])=>(
                  <div key={l} style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,padding:"4px 8px"}}><div style={{fontSize:8,color:"#4a8a9a"}}>{l}</div><div style={{fontSize:9,color:"#4a5568",textDecoration:"line-through"}}>{b}</div><div style={{fontSize:11,color:"#10b981",fontWeight:700}}>{a}</div></div>
                ))}
              </div>
              <audio ref={audioE} controls style={{width:"100%",height:30,marginTop:10}}/>
            </div>
          </div>
        </div>}
        {imp!==null&&<div style={{background:imp>0?"#10b98111":"#f59e0b11",border:"1px solid "+(imp>0?"#10b98133":"#f59e0b33"),borderRadius:10,padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div><div style={{fontSize:9,color:"#4a8a9a",marginBottom:4}}>IMPROVEMENT</div><div style={{fontSize:24,fontWeight:900,color:imp>0?"#10b981":"#f59e0b",fontFamily:"monospace"}}>{imp>0?"+":""}{imp} pts</div><div style={{fontSize:10,color:"#4a8a9a"}}>{sOrig.total} → {sEnh.total} ({sOrig.grade} → {sEnh.grade})</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:11,color:imp>0?"#10b981":"#f59e0b",fontWeight:700}}>{imp>10?"✓ Major improvement":imp>0?"✓ Minor improvement":"— No change"}</div><div style={{fontSize:10,color:"#4a8a9a",marginTop:4}}>Final: <span style={{color:sEnh.verdict==="READY"?"#10b981":"#f59e0b",fontWeight:700}}>{sEnh.verdict}</span></div></div>
        </div>}
      </div>
    </div>
  </div>;
}
