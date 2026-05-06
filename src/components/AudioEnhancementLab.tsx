import React, { useRef, useState, useEffect } from "react";
import { Upload, Download, Zap, Scissors, Volume2, Activity, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface AudioStats {
  peakDb: number; rmsDb: number; noiseDb: number; snrDb: number;
  duration: number; sampleRate: number; channels: number; clippedSamples: number;
}
interface EnhancementSettings {
  normalize: boolean; targetPeakDb: number;
  trimSilence: boolean; trimThresholdDb: number; trimPadMs: number;
  noiseGate: boolean; noiseGateThresholdDb: number; noiseGateAttackMs: number; noiseGateReleaseMs: number;
  deClick: boolean; deClickThreshold: number;
  highPassFilter: boolean; highPassFreq: number;
  lowPassFilter: boolean; lowPassFreq: number;
}
interface LogEntry { time: string; msg: string; type: "info"|"success"|"warn"|"error"; }

function toDb(v: number): number { return v <= 0 ? -120 : 20 * Math.log10(v); }
function fromDb(db: number): number { return Math.pow(10, db / 20); }

function analyzeBuffer(buffer: AudioBuffer): AudioStats {
  const data = buffer.getChannelData(0);
  let peak = 0, sumSq = 0, clipped = 0;
  const noiseSamples: number[] = [];
  const step = Math.max(1, Math.floor(data.length / 20000));
  for (let i = 0; i < data.length; i += step) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sumSq += v * v;
    if (v >= 0.999) clipped++;
    if (v < 0.005) noiseSamples.push(v * v);
  }
  const count = Math.floor(data.length / step);
  const rms = Math.sqrt(sumSq / count);
  const noiseRms = noiseSamples.length > 10
    ? Math.sqrt(noiseSamples.reduce((a, b) => a + b, 0) / noiseSamples.length) : 0.00001;
  const peakDb = toDb(peak); const rmsDb = toDb(rms); const noiseDb = toDb(noiseRms);
  return { peakDb, rmsDb, noiseDb, snrDb: rmsDb - noiseDb,
    duration: buffer.duration, sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels, clippedSamples: clipped };
}

function applyHighPass(data: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const rc = 1.0 / (2 * Math.PI * cutoff);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(data.length);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) out[i] = alpha * (out[i-1] + data[i] - data[i-1]);
  return out;
}
function applyLowPass(data: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const rc = 1.0 / (2 * Math.PI * cutoff);
  const dt = 1.0 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(data.length);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) out[i] = out[i-1] + alpha * (data[i] - out[i-1]);
  return out;
}
function applyNoiseGate(data: Float32Array, sampleRate: number, thresholdDb: number, attackMs: number, releaseMs: number): Float32Array {
  const threshold = fromDb(thresholdDb);
  const attackS = Math.floor((attackMs/1000)*sampleRate);
  const releaseS = Math.floor((releaseMs/1000)*sampleRate);
  const out = new Float32Array(data.length);
  let gain = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > threshold) gain = Math.min(1, gain + 1/Math.max(1,attackS));
    else gain = Math.max(0, gain - 1/Math.max(1,releaseS));
    out[i] = data[i] * gain;
  }
  return out;
}
function applyDeClick(data: Float32Array, threshold: number): Float32Array {
  const out = new Float32Array(data);
  for (let i = 2; i < data.length-2; i++) {
    if (Math.abs(data[i]-data[i-1]) > threshold)
      out[i] = (data[i-2]+data[i-1]+data[i+1]+data[i+2])/4;
  }
  return out;
}
function trimSilenceFromBuffer(buffer: AudioBuffer, thresholdDb: number, padMs: number): AudioBuffer {
  const threshold = fromDb(thresholdDb);
  const padSamples = Math.floor((padMs/1000)*buffer.sampleRate);
  const data = buffer.getChannelData(0);
  let start = 0; let end = data.length-1;
  while (start < data.length && Math.abs(data[start]) < threshold) start++;
  while (end > start && Math.abs(data[end]) < threshold) end--;
  start = Math.max(0, start-padSamples);
  end = Math.min(data.length-1, end+padSamples);
  const length = end-start+1;
  const ctx = new AudioContext();
  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++)
    out.getChannelData(c).set(buffer.getChannelData(c).slice(start, end+1));
  return out;
}
function normalizeBuffer(buffer: AudioBuffer, targetPeakDb: number): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
  }
  const gainVal = peak > 0 ? fromDb(targetPeakDb)/peak : 1;
  const ctx = new AudioContext();
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const inD = buffer.getChannelData(c); const outD = out.getChannelData(c);
    for (let i = 0; i < inD.length; i++) outD[i] = Math.max(-1, Math.min(1, inD[i]*gainVal));
  }
  return out;
}
function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels; const sr = buffer.sampleRate;
  const len = buffer.length*numCh*4;
  const ab = new ArrayBuffer(44+len); const view = new DataView(ab);
  const s = (o: number, str: string) => { for(let i=0;i<str.length;i++) view.setUint8(o+i,str.charCodeAt(i)); };
  s(0,"RIFF"); view.setUint32(4,36+len,true); s(8,"WAVE"); s(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,3,true); view.setUint16(22,numCh,true);
  view.setUint32(24,sr,true); view.setUint32(28,sr*numCh*4,true);
  view.setUint16(32,numCh*4,true); view.setUint16(34,32,true);
  s(36,"data"); view.setUint32(40,len,true);
  let offset = 44;
  for(let i=0;i<buffer.length;i++) for(let c=0;c<numCh;c++) { view.setFloat32(offset,buffer.getChannelData(c)[i],true); offset+=4; }
  return new Blob([ab],{type:"audio/wav"});
}

function WaveformCanvas({buffer,label,color,playhead}:{buffer:AudioBuffer|null;label:string;color:string;playhead?:number}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if(!canvas) return;
    const ctx = canvas.getContext("2d"); if(!ctx) return;
    const W = canvas.width = canvas.offsetWidth*2;
    const H = canvas.height = canvas.offsetHeight*2;
    ctx.fillStyle="#050d14"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#0f2a3a"; ctx.lineWidth=1;
    for(let i=1;i<4;i++){const y=(H/4)*i;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.strokeStyle="#1a4a5a"; ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
    if(!buffer){ctx.fillStyle="#1a3a4a";ctx.font=`${H*0.1}px monospace`;ctx.textAlign="center";ctx.fillText("No audio",W/2,H/2);return;}
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length/W));
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,color+"33"); grad.addColorStop(0.5,color+"88"); grad.addColorStop(1,color+"33");
    ctx.fillStyle=grad; ctx.beginPath(); ctx.moveTo(0,H/2);
    for(let x=0;x<W;x++){let mx=0;for(let j=0;j<step;j++){const v=Math.abs(data[x*step+j]||0);if(v>mx)mx=v;}ctx.lineTo(x,H/2-mx*(H/2)*0.9);}
    ctx.lineTo(W,H/2);
    for(let x=W-1;x>=0;x--){let mx=0;for(let j=0;j<step;j++){const v=Math.abs(data[x*step+j]||0);if(v>mx)mx=v;}ctx.lineTo(x,H/2+mx*(H/2)*0.9);}
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.beginPath();
    for(let x=0;x<W;x++){let mx=0;for(let j=0;j<step;j++){const v=Math.abs(data[x*step+j]||0);if(v>mx)mx=v;}x===0?ctx.moveTo(x,H/2-mx*(H/2)*0.9):ctx.lineTo(x,H/2-mx*(H/2)*0.9);}
    ctx.stroke();
    if(playhead&&playhead>0){ctx.strokeStyle="#ffffff88";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(playhead*W,0);ctx.lineTo(playhead*W,H);ctx.stroke();}
  },[buffer,color,playhead]);
  return (
    <div style={{position:"relative"}}>
      <div style={{position:"absolute",top:6,left:10,zIndex:2,fontSize:11,fontFamily:"monospace",color:color,background:"#050d14cc",padding:"2px 8px",borderRadius:4,letterSpacing:1}}>{label}</div>
      <canvas ref={canvasRef} style={{width:"100%",height:90,borderRadius:8,border:`1px solid ${color}33`,display:"block"}}/>
    </div>
  );
}

function VUMeter({db,label}:{db:number;label:string}) {
  const pct = Math.max(0,Math.min(100,((db+80)/80)*100));
  const color = db>-3?"#ef4444":db>-12?"#f59e0b":"#22d3ee";
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{width:18,height:90,background:"#050d14",borderRadius:4,border:"1px solid #0f2a3a",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:`${pct}%`,background:`linear-gradient(to top,${color},${color}88)`,transition:"height 0.1s",borderRadius:3}}/>
      </div>
      <div style={{fontSize:9,fontFamily:"monospace",color:"#4a8a9a",textAlign:"center"}}>{label}<br/><span style={{color}}>{db>-120?db.toFixed(1):"-inf"}</span></div>
    </div>
  );
}

function Toggle({value,onChange}:{value:boolean;onChange:(v:boolean)=>void}) {
  return <div onClick={()=>onChange(!value)} style={{width:34,height:18,borderRadius:9,background:value?"#22d3ee":"#1a3a4a",position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}>
    <div style={{position:"absolute",top:3,left:value?18:3,width:12,height:12,borderRadius:"50%",background:value?"#050d14":"#4a8a9a",transition:"left 0.2s"}}/>
  </div>;
}

function Slider({label,value,min,max,step=1,unit="",onChange,disabled=false}:{label:string;value:number;min:number;max:number;step?:number;unit?:string;onChange:(v:number)=>void;disabled?:boolean}) {
  const pct=((value-min)/(max-min))*100;
  return <div style={{opacity:disabled?0.4:1}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
      <span style={{fontSize:11,color:"#4a8a9a",fontFamily:"monospace"}}>{label}</span>
      <span style={{fontSize:11,color:"#22d3ee",fontFamily:"monospace",fontWeight:700}}>{value}{unit}</span>
    </div>
    <div style={{position:"relative",height:4,background:"#0f2a3a",borderRadius:2}}>
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${pct}%`,background:"#22d3ee",borderRadius:2}}/>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}
        style={{position:"absolute",top:-6,left:0,width:"100%",opacity:0,cursor:disabled?"not-allowed":"pointer",height:16}}/>
    </div>
  </div>;
}

function Section({title,icon,children,enabled,onToggle,accent="#22d3ee"}:{title:string;icon:React.ReactNode;children:React.ReactNode;enabled?:boolean;onToggle?:(v:boolean)=>void;accent?:string}) {
  const [open,setOpen]=useState(true);
  return <div style={{border:`1px solid ${enabled!==false?accent+"44":"#0f2a3a"}`,borderRadius:10,overflow:"hidden",background:"#060e16"}}>
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",borderBottom:open?"1px solid #0f2a3a":"none",background:"#070f18"}} onClick={()=>setOpen(!open)}>
      <span style={{color:accent,display:"flex"}}>{icon}</span>
      <span style={{flex:1,fontFamily:"monospace",fontSize:12,letterSpacing:1,color:"#a0c4cc"}}>{title}</span>
      {onToggle&&<div onClick={e=>e.stopPropagation()}><Toggle value={enabled??true} onChange={onToggle}/></div>}
      <span style={{color:"#2a5a6a"}}>{open?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</span>
    </div>
    {open&&<div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:12}}>{children}</div>}
  </div>;
}

const DEFAULT_SETTINGS: EnhancementSettings = {
  normalize:true, targetPeakDb:-3,
  trimSilence:true, trimThresholdDb:-50, trimPadMs:50,
  noiseGate:true, noiseGateThresholdDb:-55, noiseGateAttackMs:10, noiseGateReleaseMs:100,
  deClick:true, deClickThreshold:0.3,
  highPassFilter:true, highPassFreq:80,
  lowPassFilter:false, lowPassFreq:16000,
};

export default function AudioEnhancementLab() {
  const [original,setOriginal]=useState<AudioBuffer|null>(null);
  const [processed,setProcessed]=useState<AudioBuffer|null>(null);
  const [fileName,setFileName]=useState("");
  const [settings,setSettings]=useState<EnhancementSettings>(DEFAULT_SETTINGS);
  const [statsIn,setStatsIn]=useState<AudioStats|null>(null);
  const [statsOut,setStatsOut]=useState<AudioStats|null>(null);
  const [log,setLog]=useState<LogEntry[]>([]);
  const [loading,setLoading]=useState(false);
  const [progress,setProgress]=useState(0);
  const [playheadIn,setPlayheadIn]=useState(0);
  const [playheadOut,setPlayheadOut]=useState(0);
  const audioInRef=useRef<HTMLAudioElement>(null);
  const audioOutRef=useRef<HTMLAudioElement>(null);

  function addLog(msg:string,type:LogEntry["type"]="info"){
    const now=new Date();
    const time=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    setLog(prev=>[{time,msg,type},...prev.slice(0,29)]);
  }
  function set<K extends keyof EnhancementSettings>(k:K,v:EnhancementSettings[K]){setSettings(s=>({...s,[k]:v}));}

  async function loadFile(file:File){
    if(!file.name.toLowerCase().endsWith(".wav")){addLog("WAV files only","error");return;}
    setLoading(true);setProgress(10);setProcessed(null);setStatsOut(null);setFileName(file.name);
    addLog(`Loading: ${file.name}`);
    try{
      const ab=await file.arrayBuffer();setProgress(40);
      const ctx=new AudioContext();
      const buf=await ctx.decodeAudioData(ab);setProgress(70);
      setOriginal(buf);
      const stats=analyzeBuffer(buf);setStatsIn(stats);
      if(audioInRef.current) audioInRef.current.src=URL.createObjectURL(file);
      setProgress(100);
      addLog(`Loaded OK — ${stats.duration.toFixed(2)}s | ${stats.sampleRate}Hz | ${stats.channels}ch`,"success");
      addLog(`Peak:${stats.peakDb.toFixed(1)}dBFS | RMS:${stats.rmsDb.toFixed(1)}dBFS | Noise:${stats.noiseDb.toFixed(1)}dBFS`);
      if(stats.clippedSamples>0) addLog(`Clipping: ${stats.clippedSamples} samples`,"warn");
    }catch{addLog("Failed to decode audio","error");}
    setLoading(false); setTimeout(()=>setProgress(0),800);
  }

  async function runEnhancement(){
    if(!original)return;
    setLoading(true);setProgress(5);addLog("--- Enhancement started ---");
    let buf=original;
    if(settings.highPassFilter){
      const ctx=new AudioContext();const ob=ctx.createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
      for(let c=0;c<buf.numberOfChannels;c++) ob.getChannelData(c).set(applyHighPass(buf.getChannelData(c),buf.sampleRate,settings.highPassFreq));
      buf=ob; addLog(`High-pass @ ${settings.highPassFreq}Hz`);
    }
    setProgress(20);
    if(settings.lowPassFilter){
      const ctx=new AudioContext();const ob=ctx.createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
      for(let c=0;c<buf.numberOfChannels;c++) ob.getChannelData(c).set(applyLowPass(buf.getChannelData(c),buf.sampleRate,settings.lowPassFreq));
      buf=ob; addLog(`Low-pass @ ${settings.lowPassFreq}Hz`);
    }
    setProgress(35);
    if(settings.deClick){
      const ctx=new AudioContext();const ob=ctx.createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
      for(let c=0;c<buf.numberOfChannels;c++) ob.getChannelData(c).set(applyDeClick(buf.getChannelData(c),settings.deClickThreshold));
      buf=ob; addLog("De-click applied");
    }
    setProgress(50);
    if(settings.noiseGate){
      const ctx=new AudioContext();const ob=ctx.createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
      for(let c=0;c<buf.numberOfChannels;c++) ob.getChannelData(c).set(applyNoiseGate(buf.getChannelData(c),buf.sampleRate,settings.noiseGateThresholdDb,settings.noiseGateAttackMs,settings.noiseGateReleaseMs));
      buf=ob; addLog(`Noise gate @ ${settings.noiseGateThresholdDb}dBFS`);
    }
    setProgress(65);
    if(settings.trimSilence){const before=buf.duration;buf=trimSilenceFromBuffer(buf,settings.trimThresholdDb,settings.trimPadMs);addLog(`Trim: ${before.toFixed(2)}s -> ${buf.duration.toFixed(2)}s`);}
    setProgress(80);
    if(settings.normalize){buf=normalizeBuffer(buf,settings.targetPeakDb);addLog(`Normalized to ${settings.targetPeakDb}dBFS`);}
    setProgress(95);
    const so=analyzeBuffer(buf);setStatsOut(so);setProcessed(buf);
    if(audioOutRef.current) audioOutRef.current.src=URL.createObjectURL(encodeWav(buf));
    setProgress(100);
    addLog("--- Done ---","success");
    addLog(`Peak:${so.peakDb.toFixed(1)} | RMS:${so.rmsDb.toFixed(1)} | SNR:${so.snrDb.toFixed(1)}dB`,"success");
    setLoading(false); setTimeout(()=>setProgress(0),800);
  }

  function downloadProcessed(){
    if(!processed)return;
    const a=document.createElement("a");
    a.href=URL.createObjectURL(encodeWav(processed));
    a.download=fileName.replace(/\.wav$/i,"_enhanced.wav");
    a.click(); addLog(`Downloaded: ${a.download}`,"success");
  }

  useEffect(()=>{const el=audioInRef.current;if(!el||!original)return;const tick=()=>setPlayheadIn(el.currentTime/original.duration);el.addEventListener("timeupdate",tick);return()=>el.removeEventListener("timeupdate",tick);},[original]);
  useEffect(()=>{const el=audioOutRef.current;if(!el||!processed)return;const tick=()=>setPlayheadOut(el.currentTime/processed.duration);el.addEventListener("timeupdate",tick);return()=>el.removeEventListener("timeupdate",tick);},[processed]);

  const logColor=(t:LogEntry["type"])=>t==="success"?"#22d3ee":t==="warn"?"#f59e0b":t==="error"?"#ef4444":"#4a8a9a";

  return (
    <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>
      <div style={{background:"linear-gradient(135deg,#060e18,#071522)",borderBottom:"1px solid #0f2a3a",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:38,height:38,borderRadius:10,background:"#22d3ee22",border:"1px solid #22d3ee44",display:"flex",alignItems:"center",justifyContent:"center"}}><Activity size={18} color="#22d3ee"/></div>
          <div><div style={{fontSize:14,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>AUDIO ENHANCEMENT LAB</div><div style={{fontSize:10,color:"#4a8a9a",letterSpacing:2}}>V1 · AIVORA · BROWSER DSP</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {loading&&<div style={{width:100,height:4,background:"#0f2a3a",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${progress}%`,background:"#22d3ee",borderRadius:2,transition:"width 0.3s"}}/></div>}
          <button onClick={runEnhancement} disabled={!original||loading} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:8,background:original&&!loading?"#22d3ee":"#0f2a3a",color:original&&!loading?"#050d14":"#2a5a6a",border:"none",cursor:original&&!loading?"pointer":"not-allowed",fontSize:11,fontFamily:"inherit",fontWeight:700}}><Zap size={13}/>{loading?"PROCESSING...":"RUN ENHANCEMENT"}</button>
          <button onClick={downloadProcessed} disabled={!processed} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:8,background:"transparent",color:processed?"#22d3ee":"#2a5a6a",border:`1px solid ${processed?"#22d3ee44":"#0f2a3a"}`,cursor:processed?"pointer":"not-allowed",fontSize:11,fontFamily:"inherit",fontWeight:700}}><Download size={13}/> DOWNLOAD WAV</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"280px 1fr",minHeight:"calc(100vh - 120px)"}}>
        <div style={{borderRight:"1px solid #0f2a3a",padding:14,display:"flex",flexDirection:"column",gap:10,overflowY:"auto"}}>
          <div onClick={()=>document.getElementById("ael-input")?.click()} style={{border:"2px dashed #1a4a5a",borderRadius:10,padding:"24px 12px",textAlign:"center",cursor:"pointer",background:"#050d14"}}>
            <input id="ael-input" type="file" accept=".wav,audio/wav" hidden onChange={e=>{if(e.target.files?.[0])loadFile(e.target.files[0]);}}/>
            <Upload size={20} color="#22d3ee" style={{marginBottom:6}}/>
            <div style={{fontSize:12,color:"#a0c4cc"}}>{fileName||"Drop or click — WAV only"}</div>
          </div>
          <Section title="NORMALIZE" icon={<Volume2 size={13}/>} enabled={settings.normalize} onToggle={v=>set("normalize",v)}>
            <Slider label="Target Peak" value={settings.targetPeakDb} min={-12} max={-1} unit=" dBFS" onChange={v=>set("targetPeakDb",v)} disabled={!settings.normalize}/>
          </Section>
          <Section title="SILENCE TRIM" icon={<Scissors size={13}/>} enabled={settings.trimSilence} onToggle={v=>set("trimSilence",v)}>
            <Slider label="Threshold" value={settings.trimThresholdDb} min={-70} max={-30} unit=" dBFS" onChange={v=>set("trimThresholdDb",v)} disabled={!settings.trimSilence}/>
            <Slider label="Pad ms" value={settings.trimPadMs} min={0} max={200} unit="ms" onChange={v=>set("trimPadMs",v)} disabled={!settings.trimSilence}/>
          </Section>
          <Section title="NOISE GATE" icon={<Activity size={13}/>} enabled={settings.noiseGate} onToggle={v=>set("noiseGate",v)}>
            <Slider label="Threshold" value={settings.noiseGateThresholdDb} min={-80} max={-20} unit=" dBFS" onChange={v=>set("noiseGateThresholdDb",v)} disabled={!settings.noiseGate}/>
            <Slider label="Attack ms" value={settings.noiseGateAttackMs} min={1} max={100} unit="ms" onChange={v=>set("noiseGateAttackMs",v)} disabled={!settings.noiseGate}/>
            <Slider label="Release ms" value={settings.noiseGateReleaseMs} min={10} max={500} unit="ms" onChange={v=>set("noiseGateReleaseMs",v)} disabled={!settings.noiseGate}/>
          </Section>
          <Section title="DE-CLICK" icon={<Zap size={13}/>} enabled={settings.deClick} onToggle={v=>set("deClick",v)}>
            <Slider label="Sensitivity" value={Math.round(settings.deClickThreshold*100)} min={10} max={80} unit="%" onChange={v=>set("deClickThreshold",v/100)} disabled={!settings.deClick}/>
          </Section>
          <Section title="EQ FILTERS" icon={<RefreshCw size={13}/>}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Toggle value={settings.highPassFilter} onChange={v=>set("highPassFilter",v)}/><span style={{fontSize:11}}>High-pass</span></div>
            <Slider label="HP Cutoff" value={settings.highPassFreq} min={20} max={300} unit=" Hz" onChange={v=>set("highPassFreq",v)} disabled={!settings.highPassFilter}/>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Toggle value={settings.lowPassFilter} onChange={v=>set("lowPassFilter",v)}/><span style={{fontSize:11}}>Low-pass</span></div>
            <Slider label="LP Cutoff" value={settings.lowPassFreq} min={4000} max={22000} step={500} unit=" Hz" onChange={v=>set("lowPassFreq",v)} disabled={!settings.lowPassFilter}/>
          </Section>
          <button onClick={()=>setSettings(DEFAULT_SETTINGS)} style={{padding:8,borderRadius:8,border:"1px solid #0f2a3a",background:"transparent",color:"#4a8a9a",fontSize:11,fontFamily:"inherit",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><RefreshCw size={12}/> Reset Defaults</button>
        </div>

        <div style={{padding:14,display:"flex",flexDirection:"column",gap:12}}>
          <WaveformCanvas buffer={original} label="ORIGINAL" color="#22d3ee" playhead={playheadIn}/>
          <WaveformCanvas buffer={processed} label="ENHANCED" color="#10b981" playhead={playheadOut}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:"#050d14",borderRadius:8,padding:10,border:"1px solid #0f2a3a"}}><div style={{fontSize:10,color:"#22d3ee",marginBottom:6}}>ORIGINAL</div><audio ref={audioInRef} controls style={{width:"100%",height:30}}/></div>
            <div style={{background:"#050d14",borderRadius:8,padding:10,border:"1px solid #10b98144"}}><div style={{fontSize:10,color:"#10b981",marginBottom:6}}>ENHANCED</div><audio ref={audioOutRef} controls style={{width:"100%",height:30}}/></div>
          </div>
          {statsIn&&<div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-start"}}>
            <div style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:8,padding:10}}>
              <div style={{fontSize:10,color:"#4a8a9a",marginBottom:8}}>VU METERS</div>
              <div style={{display:"flex",gap:12,alignItems:"flex-end"}}>
                <VUMeter db={statsIn.peakDb} label="PEAK IN"/><VUMeter db={statsIn.rmsDb} label="RMS IN"/>
                {statsOut&&<><VUMeter db={statsOut.peakDb} label="PEAK OUT"/><VUMeter db={statsOut.rmsDb} label="RMS OUT"/></>}
              </div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,flex:1}}>
              {[
                ["DURATION",statsIn.duration.toFixed(2),statsOut?.duration.toFixed(2),"s"],
                ["PEAK",statsIn.peakDb.toFixed(1),statsOut?.peakDb.toFixed(1)," dBFS"],
                ["RMS",statsIn.rmsDb.toFixed(1),statsOut?.rmsDb.toFixed(1)," dBFS"],
                ["NOISE",statsIn.noiseDb.toFixed(1),statsOut?.noiseDb.toFixed(1)," dBFS"],
                ["SNR",statsIn.snrDb.toFixed(1),statsOut?.snrDb.toFixed(1)," dB"],
                ["CLIPPED",String(statsIn.clippedSamples),statsOut?String(statsOut.clippedSamples):undefined,""],
              ].map(([lbl,vi,vo,u])=>(
                <div key={lbl} style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:8,padding:"8px 12px",minWidth:100}}>
                  <div style={{fontSize:10,color:"#4a8a9a",marginBottom:4}}>{lbl}</div>
                  <div style={{fontSize:12,color:"#cbd5e1",fontFamily:"monospace"}}>IN: {vi}{u}</div>
                  {vo&&<div style={{fontSize:12,color:"#22d3ee",fontFamily:"monospace"}}>OUT: {vo}{u}</div>}
                </div>
              ))}
            </div>
          </div>}
          <div style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:8,padding:12}}>
            <div style={{fontSize:10,color:"#4a8a9a",marginBottom:8}}>PROCESSING LOG</div>
            <div style={{fontFamily:"monospace",fontSize:11,maxHeight:120,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
              {log.length===0?<span style={{color:"#2a5a6a"}}>Waiting for file...</span>:log.map((e,i)=>(
                <div key={i} style={{color:logColor(e.type),opacity:i===0?1:0.7}}><span style={{color:"#2a5a6a"}}>[{e.time}] </span>{e.msg}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
