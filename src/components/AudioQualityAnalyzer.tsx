// @ts-nocheck
import React, { useState } from "react";
import { analyzeAudioBuffer, scoreAnalysis } from "../lib/audio/AdvancedAudioAnalyzer";
import { validateStudioCompliance } from "../lib/audio/StudioSpecCompliance";
import { Upload, BarChart3, CheckCircle2, XCircle, AlertTriangle, Download } from "lucide-react";

const PROFILES = {
  wakeword:     { label:"Wake Word",    icon:"🎙️", color:"#22d3ee", th:{ pkMin:-6,  pkMax:-1,  rmsMin:-28, rmsMax:-10, noiseMax:-60, snrMin:45, silMax:0.15 } },
  asr:          { label:"ASR / Speech", icon:"🗣️", color:"#10b981", th:{ pkMin:-9,  pkMax:-2,  rmsMin:-32, rmsMax:-12, noiseMax:-55, snrMin:35, silMax:0.30 } },
  tts:          { label:"TTS Training", icon:"🔊", color:"#f59e0b", th:{ pkMin:-6,  pkMax:-1,  rmsMin:-24, rmsMax:-8,  noiseMax:-65, snrMin:50, silMax:0.20 } },
  conversation: { label:"Conversation", icon:"💬", color:"#8b5cf6", th:{ pkMin:-12, pkMax:-3,  rmsMin:-35, rmsMax:-15, noiseMax:-50, snrMin:25, silMax:0.40 } },
};

function toDb(v) { return v <= 0 ? -120 : 20 * Math.log10(v); }




function analyze(buf, name, pk) {
  // Legacy synchronous wrapper - delegates to advanced DSP engine
  // The actual heavy work happens in analyzeAudioBuffer (async)
  // This wrapper is kept for backward compatibility with existing UI
  return _analyzeWithDSP(buf, name, pk);
}

async function _analyzeWithDSP(buf, name, pk) {
  const profileMap = {
    wakeword: "wakeword_studio",
    asr: "asr_studio",
    tts: "tts_studio",
    conversation: "conversation_studio"
  };

  const p = PROFILES[pk];
  const analysis = await analyzeAudioBuffer(buf);
  const studioProfile = profileMap[pk] || "asr_studio";
  const scored = scoreAnalysis(analysis, pk);
  const compliance = validateStudioCompliance(analysis, studioProfile);

  // Map advanced analysis results back to legacy UI shape
  const edges = {
    silRatio: analysis.silence.silenceRatio,
    leadMs: analysis.silence.leadingMs,
    trailMs: analysis.silence.trailingMs
  };

  const hum = {
    detected: analysis.noise.type === "hum_50" || analysis.noise.type === "hum_60",
    freq: analysis.noise.humFreq || 0,
    strength: analysis.noise.humStrength || 0
  };

  const voice = {
    pct: Math.round(analysis.vad.voiceRatio * 100),
    present: analysis.vad.voiceRatio > 0.1
  };

  return {
    name,
    pk,
    plabel: p.label,
    picon: p.icon,
    pcolor: p.color,
    total: scored.total,
    grade: scored.grade,
    verdict: scored.verdict,
    checks: scored.checks,
    edges,
    hum,
    voice,
    pkDb: analysis.peakDb,
    rDb: analysis.rmsDb,
    nDb: analysis.noise.floorDb,
    snr: analysis.snrDb,
    clip: analysis.clipping.hardClips,
    dur: analysis.duration,
    sr: analysis.sampleRate,
    // Extended fields (new)
    analysis,
    env: analysis.environment,
    silence: analysis.silence,
    lufs: analysis.lufs,
    compliance,
    time: new Date().toLocaleTimeString()
  };
}

function Ring({score,grade,verdict}) {
  const r=50,c=2*Math.PI*r,off=c-(score/100)*c;
  const col=score>=90?"#22d3ee":score>=75?"#10b981":score>=60?"#f59e0b":score>=40?"#f97316":"#ef4444";
  const vc=verdict==="READY"?"#10b981":verdict==="REVIEW"?"#f59e0b":"#ef4444";
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
    <div style={{position:"relative",width:120,height:120}}>
      <svg width={120} height={120} style={{transform:"rotate(-90deg)"}}>
        <circle cx={60} cy={60} r={r} fill="none" stroke="#0f2a3a" strokeWidth={10}/>
        <circle cx={60} cy={60} r={r} fill="none" stroke={col} strokeWidth={10} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{transition:"stroke-dashoffset 1.2s"}}/>
      </svg>
      <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:26,fontWeight:900,color:col,fontFamily:"monospace",lineHeight:1}}>{score}</div>
        <div style={{fontSize:9,color:"#4a8a9a"}}/>
        <div style={{fontSize:16,fontWeight:700,color:col,fontFamily:"monospace"}}>{grade}</div>
      </div>
    </div>
    <div style={{padding:"3px 14px",borderRadius:20,background:vc+"22",border:"1px solid "+vc+"44",color:vc,fontSize:11,fontFamily:"monospace",fontWeight:700,letterSpacing:2}}>{verdict}</div>
  </div>;
}

function Row({c}) {
  const [open,setOpen]=useState(false);
  const icon=c.ok&&!c.w?<CheckCircle2 size={13} color="#10b981"/>:c.w?<AlertTriangle size={13} color="#f59e0b"/>:<XCircle size={13} color="#ef4444"/>;
  const bc=(c.score || c.sc)>=80?"#10b981":(c.score || c.sc)>=50?"#f59e0b":"#ef4444";
  return <div onClick={()=>setOpen(!open)} style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:8,padding:"9px 12px",cursor:"pointer"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      {icon}
      <span style={{flex:1,fontSize:11,fontFamily:"monospace",color:"#a0c4cc"}}>{(c.label || c.lb)}{c.bonus&&<span style={{fontSize:9,color:"#2a5a6a",marginLeft:6}}>ADV</span>}</span>
      <span style={{fontSize:11,color:"#4a8a9a",fontFamily:"monospace"}}>{(c.value || c.val)}</span>
      <div style={{width:50,height:3,background:"#0f2a3a",borderRadius:2,marginLeft:8}}><div style={{height:"100%",width:(c.score || c.sc)+"%",background:bc,borderRadius:2}}/></div>
      <span style={{fontSize:10,color:bc,fontFamily:"monospace",minWidth:24,textAlign:"right"}}>{(c.score || c.sc)}</span>
    </div>
    {open&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid #0f2a3a",fontSize:10,color:"#4a8a9a"}}>{(c.label || c.lb)} — Score: {(c.score || c.sc)}{!c.bonus&&" · Weight: "+c.w8+"%"}</div>}
  </div>;
}

export default function AudioQualityAnalyzer() {
  const [rep,setRep]=useState(null);
  const [loading,setLoading]=useState(false);
  const [pk,setPk]=useState("wakeword");
  const [hist,setHist]=useState([]);
  const prof=PROFILES[pk];

  async function go(file) {
    if(!file.name.toLowerCase().endsWith(".wav"))return;
    setLoading(true);setRep(null);
    try{
      const ab=await file.arrayBuffer();
      const ctx=new AudioContext();
      const buf=await ctx.decodeAudioData(ab);
      const r=await analyze(buf,file.name,pk);
      setRep(r);setHist(prev=>[r,...prev.slice(0,9)]);
    }catch(e){console.error(e);}
    setLoading(false);
  }

  const vc=rep?.verdict==="READY"?"#10b981":rep?.verdict==="REVIEW"?"#f59e0b":"#ef4444";

  return <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>
    <div style={{background:"linear-gradient(135deg,#060e18,#071a18)",borderBottom:"1px solid #0f2a3a",padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{width:36,height:36,borderRadius:10,background:prof.color+"22",border:"1px solid "+prof.color+"44",display:"flex",alignItems:"center",justifyContent:"center"}}><BarChart3 size={16} color={prof.color}/></div>
      <div><div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>AUDIO QUALITY ANALYZER</div><div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>V3A · {prof.icon} {prof.label.toUpperCase()}</div></div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"240px 1fr",minHeight:"calc(100vh - 65px)"}}>
      <div style={{borderRight:"1px solid #0f2a3a",padding:12,display:"flex",flexDirection:"column",gap:10,overflowY:"auto"}}>
        <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1}}>PROFILE</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {Object.entries(PROFILES).map(([id,p])=>(
            <div key={id} onClick={()=>setPk(id)} style={{border:"1px solid "+(pk===id?p.color+"66":"#0f2a3a"),borderRadius:10,padding:"10px 8px",cursor:"pointer",background:pk===id?p.color+"11":"#060e16"}}>
              <div style={{fontSize:16}}>{p.icon}</div>
              <div style={{fontSize:10,fontWeight:700,color:pk===id?p.color:"#a0c4cc"}}>{p.label}</div>
            </div>
          ))}
        </div>
        <div onClick={()=>document.getElementById("aqa-i").click()} style={{border:"2px dashed "+prof.color+"44",borderRadius:10,padding:"18px 10px",textAlign:"center",cursor:"pointer",background:"#050d14"}}>
          <input id="aqa-i" type="file" accept=".wav" hidden onChange={e=>{if(e.target.files[0])go(e.target.files[0]);}}/>
          <Upload size={18} color={prof.color} style={{marginBottom:6}}/>
          <div style={{fontSize:11,color:"#a0c4cc"}}>{loading?"Analyzing...":"Upload WAV"}</div>
        </div>
        <div style={{fontSize:9,color:"#4a8a9a"}}>HISTORY</div>
        {hist.map((r,i)=>{
          const c=r.verdict==="READY"?"#10b981":r.verdict==="REVIEW"?"#f59e0b":"#ef4444";
          return <div key={i} onClick={()=>setRep(r)} style={{background:"#060e16",border:"1px solid "+c+"33",borderRadius:7,padding:"8px 10px",cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:c}}>{PROFILES[r.pk]?.icon} {r.grade}</span><span style={{fontSize:9,color:"#4a8a9a"}}>{r.total}/100</span></div>
            <div style={{fontSize:10,color:"#a0c4cc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
            <div style={{height:2,background:"#0f2a3a",borderRadius:2,marginTop:4}}><div style={{height:"100%",width:r.total+"%",background:c,borderRadius:2}}/></div>
          </div>;
        })}
      </div>
      <div style={{padding:14,display:"flex",flexDirection:"column",gap:12}}>
        {!rep&&!loading&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,opacity:0.4}}><BarChart3 size={52} color="#1a4a5a"/><div style={{fontSize:13,color:"#2a5a6a",textAlign:"center"}}>Select profile and upload WAV</div></div>}
        {rep&&<>
          <div style={{background:"#060e16",border:"1px solid "+vc+"33",borderRadius:12,padding:16,display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
            <Ring score={rep.total} grade={rep.grade} verdict={rep.verdict}/>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:"#e0f2f8",fontWeight:700,marginBottom:4}}>{rep.name}</div>
              <div style={{fontSize:9,color:rep.pcolor,marginBottom:10}}>{rep.picon} {rep.plabel} · {rep.time}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[["Dur",rep.dur.toFixed(2)+"s"],["Rate",rep.sr+"Hz"],["Peak",rep.pkDb.toFixed(1)+"dBFS"],["RMS",rep.rDb.toFixed(1)+"dBFS"],["Noise",rep.nDb.toFixed(1)+"dBFS"],["SNR",rep.snr.toFixed(1)+"dB"],["Voice",rep.voice.pct+"%"],["Hum",rep.hum.detected?rep.hum.freq+"Hz":"None"]].map(([l,v])=>(
                  <div key={l} style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,padding:"4px 8px"}}><div style={{fontSize:8,color:"#4a8a9a"}}>{l}</div><div style={{fontSize:11,color:"#cbd5e1",fontWeight:700}}>{v}</div></div>
                ))}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[["HUM",rep.hum.detected?"DETECTED":"CLEAN",rep.hum.detected?"#ef4444":"#10b981"],["VOICE",rep.voice.present?"PRESENT":"WEAK",rep.voice.present?"#10b981":"#f59e0b"]].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:9,color:"#4a8a9a",minWidth:40}}>{l}</span><span style={{fontSize:9,color:c,background:c+"22",padding:"2px 8px",borderRadius:4,fontWeight:700}}>{v}</span></div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            <div style={{fontSize:9,color:"#4a8a9a",marginBottom:2}}>WEIGHTED CHECKS</div>
            {rep.checks.filter(c=>!c.bonus).map(c=><Row key={c.label || c.id} c={c}/>)}
            <div style={{fontSize:9,color:"#4a8a9a",marginTop:6,marginBottom:2}}>ADVANCED</div>
            {rep.checks.filter(c=>c.bonus).map(c=><Row key={c.label || c.id} c={c}/>)}
            <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:8,padding:10,marginTop:4}}>
              <div style={{fontSize:9,color:"#4a8a9a",marginBottom:6}}>SILENCE EDGES</div>
              {[["Leading",rep.edges.leadMs+"ms"],["Trailing",rep.edges.trailMs+"ms"],["Ratio",(rep.edges.silRatio*100).toFixed(1)+"%"]].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:"#4a8a9a"}}>{l}</span><span style={{fontSize:10,color:"#cbd5e1",fontWeight:700}}>{v}</span></div>
              ))}
            </div>
          </div>
        </>
        }
      </div>
    </div>
  </div>;
}


// AIVORA_DSP_ENGINE_V2
// Advanced DSP engine connected successfully
