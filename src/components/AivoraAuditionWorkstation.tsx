// @ts-nocheck
/**
 * AivoraAuditionWorkstation.tsx — Professional Audio Editor Workstation
 * Aivora Platform — Adobe-style workflow without Adobe branding
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { exportFloat32Wav, downloadWavBlob } from "../lib/audioForensics/floatWavExporter";
import { analyzeSilenceForensics } from "../lib/audioForensics/silenceForensics";
import { buildReferenceSilenceProfile } from "../lib/audioForensics/referenceSilenceProfile";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Region {
  startSample: number;
  endSample:   number;
  startMs:     number;
  endMs:       number;
  durationMs:  number;
  label?:      string;
  type?:       "selection"|"repaired"|"contaminated"|"speech";
}

interface EditHistoryEntry {
  id:          string;
  action:      string;
  region:      Region;
  timestamp:   number;
  seamRisk?:   number;
  status?:     "PASS"|"REVIEW"|"FAIL";
}

type Tool =
  | "select"
  | "zoom"
  | "pan"
  | "heal"
  | "inspect";

type ViewMode = "original"|"edited"|"difference";
type DisplayMode = "waveform"|"spectrogram"|"both";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  if(ms<1000) return `${ms.toFixed(0)}ms`;
  const s=ms/1000;
  if(s<60) return `${s.toFixed(3)}s`;
  const m=Math.floor(s/60);
  return `${m}:${(s%60).toFixed(2).padStart(5,"0")}`;
}

function fmtSample(n: number): string {
  return n.toLocaleString();
}

function rmsDb(samples: Float32Array): number {
  let sum=0;
  for(let i=0;i<samples.length;i++) sum+=samples[i]**2;
  const rms=Math.sqrt(sum/Math.max(1,samples.length));
  return rms>0?20*Math.log10(rms):-120;
}

function peakDb(samples: Float32Array): number {
  let peak=0;
  for(let i=0;i<samples.length;i++){const a=Math.abs(samples[i]);if(a>peak)peak=a;}
  return peak>0?20*Math.log10(peak):-120;
}

// ── Mini Components ───────────────────────────────────────────────────────────

function StatRow({label,value,color="#a0c4cc"}:{label:string;value:string;color?:string}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",padding:"2px 0",
      borderBottom:"1px solid #0a1a24"}}>
      <span style={{fontSize:8,color:"#4a8a9a"}}>{label}</span>
      <span style={{fontSize:8,color,fontWeight:700}}>{value}</span>
    </div>
  );
}

function ToolBtn({icon,label,active,onClick}:{icon:string;label:string;active?:boolean;onClick:()=>void}){
  return(
    <div onClick={onClick} title={label}
      style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,
        padding:"6px 4px",borderRadius:6,cursor:"pointer",minWidth:36,
        background:active?"#22d3ee22":"transparent",
        border:`1px solid ${active?"#22d3ee44":"transparent"}`,
        transition:"all 0.15s"}}>
      <span style={{fontSize:14}}>{icon}</span>
      <span style={{fontSize:6,color:active?"#22d3ee":"#4a8a9a"}}>{label}</span>
    </div>
  );
}

// ── Waveform Canvas ───────────────────────────────────────────────────────────

function WaveformCanvas({
  buffer, startSample, endSample, selection, viewMode,
  onSelect, height=160
}:{
  buffer:AudioBuffer|null;
  startSample:number; endSample:number;
  selection:Region|null;
  viewMode:ViewMode;
  onSelect:(start:number,end:number)=>void;
  height?:number;
}){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const dragRef  =useRef<{start:number;dragging:boolean}>({start:0,dragging:false});

  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas||!buffer) return;
    const ctx=canvas.getContext("2d");
    if(!ctx) return;
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);

    // Background
    ctx.fillStyle="#040c14";
    ctx.fillRect(0,0,W,H);

    // Grid lines
    ctx.strokeStyle="#0a1a24";
    ctx.lineWidth=1;
    for(let y=0;y<H;y+=H/8){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    for(let x=0;x<W;x+=W/16){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}

    // Zero line
    ctx.strokeStyle="#0f2a3a";
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();

    // Waveform
    const mono=new Float32Array(buffer.length);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){
      const d=buffer.getChannelData(ch);
      for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
    }
    if(buffer.numberOfChannels>1) for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

    const visLen=endSample-startSample;
    const samplesPerPx=visLen/W;

    ctx.strokeStyle=viewMode==="difference"?"#f97316":"#22d3ee";
    ctx.lineWidth=1;
    ctx.beginPath();

    for(let px=0;px<W;px++){
      const s=Math.floor(startSample+px*samplesPerPx);
      const e=Math.min(Math.floor(s+samplesPerPx),buffer.length);
      let min=0,max=0;
      for(let i=s;i<e;i++){const v=mono[i]??0;if(v>max)max=v;if(v<min)min=v;}
      const y1=H/2*(1-max);
      const y2=H/2*(1-min)+H/2;
      if(px===0) ctx.moveTo(px,y1); else ctx.lineTo(px,y1);
      ctx.lineTo(px,y2);
    }
    ctx.stroke();

    // Selection overlay
    if(selection){
      const selStart=(selection.startSample-startSample)/visLen*W;
      const selEnd  =(selection.endSample-startSample)/visLen*W;
      ctx.fillStyle="rgba(34,211,238,0.15)";
      ctx.fillRect(selStart,0,selEnd-selStart,H);
      ctx.strokeStyle="#22d3ee";
      ctx.lineWidth=1;
      ctx.strokeRect(selStart,0,selEnd-selStart,H);
    }

    // dB scale
    ctx.fillStyle="#4a8a9a";
    ctx.font="8px monospace";
    [-1,-0.5,0,0.5,1].forEach(v=>{
      const y=H/2*(1-v);
      const db=v!==0?`${(20*Math.log10(Math.abs(v))).toFixed(0)} dB`:"0";
      ctx.fillText(db,2,y+3);
    });
  },[buffer,startSample,endSample,selection,viewMode]);

  function getClickSample(e:React.MouseEvent<HTMLCanvasElement>):number{
    const rect=canvasRef.current!.getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width;
    return Math.round(startSample+(endSample-startSample)*x);
  }

  return(
    <canvas ref={canvasRef}
      width={800} height={height}
      style={{width:"100%",height,cursor:"crosshair",display:"block"}}
      onMouseDown={e=>{
        dragRef.current={start:getClickSample(e),dragging:true};
      }}
      onMouseMove={e=>{
        if(!dragRef.current.dragging) return;
        const cur=getClickSample(e);
        const s=Math.min(dragRef.current.start,cur);
        const en=Math.max(dragRef.current.start,cur);
        onSelect(s,en);
      }}
      onMouseUp={e=>{
        dragRef.current.dragging=false;
        const cur=getClickSample(e);
        const s=Math.min(dragRef.current.start,cur);
        const en=Math.max(dragRef.current.start,cur);
        onSelect(s,en);
      }}
    />
  );
}

// ── Spectrogram Canvas ────────────────────────────────────────────────────────

function SpectrogramCanvas({
  buffer, startSample, endSample, height=160
}:{
  buffer:AudioBuffer|null;
  startSample:number; endSample:number;
  height?:number;
}){
  const canvasRef=useRef<HTMLCanvasElement>(null);

  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas||!buffer) return;
    const ctx=canvas.getContext("2d");
    if(!ctx) return;
    const W=canvas.width, H=canvas.height;
    ctx.fillStyle="#020810";
    ctx.fillRect(0,0,W,H);

    const mono=new Float32Array(buffer.length);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){
      const d=buffer.getChannelData(ch);
      for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
    }
    if(buffer.numberOfChannels>1) for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

    const FFT=512;
    const hop=Math.max(1,Math.floor((endSample-startSample)/W));
    const re=new Float64Array(FFT);
    const im=new Float64Array(FFT);

    function fft(){
      const n=re.length;
      for(let i=1,j=0;i<n;i++){
        let bit=n>>1;
        for(;j&bit;bit>>=1)j^=bit;
        j^=bit;
        if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
      }
      for(let len=2;len<=n;len<<=1){
        const ang=(-2*Math.PI)/len,wRe=Math.cos(ang),wIm=Math.sin(ang);
        for(let i=0;i<n;i+=len){
          let cRe=1,cIm=0;
          for(let j=0;j<len>>1;j++){
            const uRe=re[i+j],uIm=im[i+j];
            const vRe=re[i+j+len/2]*cRe-im[i+j+len/2]*cIm;
            const vIm=re[i+j+len/2]*cIm+im[i+j+len/2]*cRe;
            re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;
            re[i+j+len/2]=uRe-vRe;im[i+j+len/2]=uIm-vIm;
            const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;
          }
        }
      }
    }

    for(let px=0;px<W;px++){
      const offset=startSample+px*hop;
      if(offset+FFT>mono.length) break;
      re.fill(0); im.fill(0);
      for(let i=0;i<FFT;i++)
        re[i]=(mono[offset+i]??0)*0.5*(1-Math.cos(2*Math.PI*i/(FFT-1)));
      fft();

      for(let bin=0;bin<FFT/2;bin++){
        const mag=Math.sqrt(re[bin]**2+im[bin]**2);
        const db=mag>0?Math.max(-120,20*Math.log10(mag)):-120;
        const norm=Math.max(0,Math.min(1,(db+120)/120));
        const py=H-Math.round(bin/FFT*2*H)-1;
        const r=Math.round(norm*255);
        const g=Math.round(norm*180);
        const b=Math.round(norm*50);
        ctx.fillStyle=`rgb(${r},${g},${b})`;
        ctx.fillRect(px,Math.max(0,py),1,2);
      }
    }

    // Freq labels
    ctx.fillStyle="#4a8a9a";
    ctx.font="7px monospace";
    const freqs=[100,500,1000,4000,8000,16000];
    const nyq=buffer.sampleRate/2;
    freqs.forEach(f=>{
      if(f>nyq) return;
      const y=H*(1-f/nyq);
      ctx.fillText(`${f>=1000?f/1000+"k":f}Hz`,2,y);
    });
  },[buffer,startSample,endSample]);

  return(
    <canvas ref={canvasRef}
      width={800} height={height}
      style={{width:"100%",height,display:"block"}}
    />
  );
}

// ── Time Ruler ────────────────────────────────────────────────────────────────

function TimeRuler({startMs,endMs,width=800}:{startMs:number;endMs:number;width?:number}){
  const dur=endMs-startMs;
  const step=dur>10000?1000:dur>2000?200:dur>500?50:10;
  const ticks=[];
  const first=Math.ceil(startMs/step)*step;
  for(let t=first;t<=endMs;t+=step){
    const x=((t-startMs)/dur)*100;
    ticks.push({x,label:fmtTime(t)});
  }
  return(
    <div style={{position:"relative",height:20,background:"#050d14",
      borderBottom:"1px solid #0f2a3a",overflow:"hidden"}}>
      {ticks.map((t,i)=>(
        <div key={i} style={{position:"absolute",left:`${t.x}%`,top:0,
          fontSize:7,color:"#4a8a9a",borderLeft:"1px solid #0f2a3a",
          paddingLeft:2,height:"100%",display:"flex",alignItems:"flex-end",paddingBottom:2}}>
          {t.label}
        </div>
      ))}
    </div>
  );
}

// ── Main Workstation ──────────────────────────────────────────────────────────

export default function AivoraAuditionWorkstation(){
  const [targetBuffer,  setTargetBuffer]  = useState<AudioBuffer|null>(null);
  const [targetName,    setTargetName]    = useState("");
  const [refBuffer,     setRefBuffer]     = useState<AudioBuffer|null>(null);
  const [refName,       setRefName]       = useState("");
  const [editedBuffer,  setEditedBuffer]  = useState<AudioBuffer|null>(null);

  const [selection,     setSelection]     = useState<Region|null>(null);
  const [activeTool,    setActiveTool]    = useState<Tool>("select");
  const [viewMode,      setViewMode]      = useState<ViewMode>("edited");
  const [displayMode,   setDisplayMode]   = useState<DisplayMode>("both");

  const [zoomStart,     setZoomStart]     = useState(0);
  const [zoomEnd,       setZoomEnd]       = useState(1);   // 0-1 fraction
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [currentMs,     setCurrentMs]     = useState(0);
  const [forensics,     setForensics]     = useState<any>(null);
  const [refProfile,    setRefProfile]    = useState<any>(null);
  const [editHistory,   setEditHistory]   = useState<EditHistoryEntry[]>([]);
  const [status,        setStatus]        = useState("");
  const [exportReady,   setExportReady]   = useState(false);
  const [loading,       setLoading]       = useState("");

  const audioCtxRef=useRef<AudioContext|null>(null);
  const sourceRef  =useRef<AudioBufferSourceNode|null>(null);
  const targetRef  =useRef<HTMLInputElement>(null);
  const refInputRef=useRef<HTMLInputElement>(null);
  const playStartRef=useRef<number>(0);

  // Active buffer for display
  const activeBuffer=viewMode==="original"?targetBuffer:editedBuffer??targetBuffer;
  const sr=activeBuffer?.sampleRate??44100;
  const totalSamples=activeBuffer?.length??0;
  const totalMs=(totalSamples/sr)*1000;

  // Zoom in samples
  const visStart=Math.floor(totalSamples*zoomStart);
  const visEnd  =Math.floor(totalSamples*zoomEnd);
  const visStartMs=(visStart/sr)*1000;
  const visEndMs  =(visEnd/sr)*1000;

  // ── Load Audio ─────────────────────────────────────────────────────────────

  async function loadAudio(file:File):Promise<AudioBuffer>{
    const ctx=new AudioContext();
    audioCtxRef.current=ctx;
    const ab=await file.arrayBuffer();
    return ctx.decodeAudioData(ab);
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function handleSelect(startSample:number, endSample:number){
    if(!activeBuffer||startSample===endSample) return;
    const s=Math.max(0,Math.min(startSample,totalSamples));
    const e=Math.max(0,Math.min(endSample,totalSamples));
    setSelection({
      startSample:s, endSample:e,
      startMs:(s/sr)*1000, endMs:(e/sr)*1000,
      durationMs:((e-s)/sr)*1000,
      type:"selection",
    });
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  function zoomIn(){
    const mid=(zoomStart+zoomEnd)/2;
    const half=(zoomEnd-zoomStart)/4;
    setZoomStart(Math.max(0,mid-half));
    setZoomEnd(Math.min(1,mid+half));
  }
  function zoomOut(){
    const mid=(zoomStart+zoomEnd)/2;
    const half=(zoomEnd-zoomStart);
    setZoomStart(Math.max(0,mid-half));
    setZoomEnd(Math.min(1,mid+half));
  }
  function zoomFit(){setZoomStart(0);setZoomEnd(1);}
  function zoomToSelection(){
    if(!selection||!totalSamples) return;
    const pad=0.05;
    setZoomStart(Math.max(0,selection.startSample/totalSamples-pad));
    setZoomEnd(Math.min(1,selection.endSample/totalSamples+pad));
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  function handlePlay(){
    if(!activeBuffer) return;
    if(isPlaying){sourceRef.current?.stop();setIsPlaying(false);return;}
    const ctx=new AudioContext();
    const src=ctx.createBufferSource();
    src.buffer=activeBuffer;
    src.connect(ctx.destination);
    const offset=selection?(selection.startSample/sr):0;
    src.start(0,offset);
    src.onended=()=>setIsPlaying(false);
    sourceRef.current=src;
    playStartRef.current=ctx.currentTime-offset;
    setIsPlaying(true);
  }

  // ── Analyze ────────────────────────────────────────────────────────────────

  async function handleAnalyze(){
    if(!activeBuffer) return;
    setLoading("Analyzing silence...");
    await new Promise(r=>setTimeout(r,0));
    setForensics(analyzeSilenceForensics(activeBuffer));
    setLoading("");
    setStatus("Analysis complete");
  }

  async function handleBuildRefProfile(){
    if(!refBuffer) return;
    setLoading("Building reference profile...");
    await new Promise(r=>setTimeout(r,0));
    setRefProfile(buildReferenceSilenceProfile(refBuffer,refName));
    setLoading("");
    setStatus("Reference profile ready");
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  function handleExport(){
    const buf=editedBuffer??targetBuffer;
    if(!buf) return;
    const result=exportFloat32Wav(buf,targetName||"export");
    downloadWavBlob(result.blob,result.filename);
    setStatus(`Exported: ${result.filename}`);
  }

  // ── Region Info ────────────────────────────────────────────────────────────

  const selRms=selection&&activeBuffer?(()=>{
    const mono=new Float32Array(activeBuffer.length);
    for(let ch=0;ch<activeBuffer.numberOfChannels;ch++){
      const d=activeBuffer.getChannelData(ch);
      for(let i=0;i<activeBuffer.length;i++) mono[i]+=d[i];
    }
    if(activeBuffer.numberOfChannels>1) for(let i=0;i<mono.length;i++) mono[i]/=activeBuffer.numberOfChannels;
    return rmsDb(mono.subarray(selection.startSample,selection.endSample));
  })():null;

  const selPeak=selection&&activeBuffer?(()=>{
    const mono=new Float32Array(activeBuffer.length);
    for(let ch=0;ch<activeBuffer.numberOfChannels;ch++){
      const d=activeBuffer.getChannelData(ch);
      for(let i=0;i<activeBuffer.length;i++) mono[i]+=d[i];
    }
    if(activeBuffer.numberOfChannels>1) for(let i=0;i<mono.length;i++) mono[i]/=activeBuffer.numberOfChannels;
    return peakDb(mono.subarray(selection.startSample,selection.endSample));
  })():null;

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────────

  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      if(e.target instanceof HTMLInputElement) return;
      if(e.key===" "){e.preventDefault();handlePlay();}
      if(e.key==="="){zoomIn();}
      if(e.key==="-"){zoomOut();}
      if(e.key==="0"){zoomFit();}
      if(e.key==="s"){setActiveTool("select");}
      if(e.key==="z"){setActiveTool("zoom");}
      if(e.key==="h"){setActiveTool("heal");}
      if(e.key==="i"){setActiveTool("inspect");}
    }
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[activeBuffer,isPlaying,zoomStart,zoomEnd]);

  // ── Layout ─────────────────────────────────────────────────────────────────

  const SIDEBAR_W=200;
  const RIGHT_W  =180;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",
      background:"#020810",fontFamily:"monospace",color:"#a0c4cc",overflow:"hidden"}}>

      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <div style={{height:40,background:"#030c14",borderBottom:"1px solid #0f2a3a",
        display:"flex",alignItems:"center",gap:8,padding:"0 12px",flexShrink:0}}>
        <div style={{fontSize:11,fontWeight:700,color:"#22d3ee",letterSpacing:2}}>
          AIVORA AUDITION WORKSTATION
        </div>
        <div style={{width:1,height:20,background:"#0f2a3a",margin:"0 4px"}}/>

        {/* File loaders */}
        <button onClick={()=>targetRef.current?.click()}
          style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:5,
            padding:"3px 10px",cursor:"pointer",color:"#22d3ee",fontSize:9,fontWeight:700}}>
          📂 Open Target
        </button>
        <input ref={targetRef} type="file" accept=".wav" style={{display:"none"}}
          onChange={async e=>{
            const f=e.target.files?.[0];if(!f)return;
            setTargetName(f.name);
            const buf=await loadAudio(f);
            setTargetBuffer(buf);setEditedBuffer(null);
            setZoomStart(0);setZoomEnd(1);setSelection(null);setForensics(null);
          }}/>

        <button onClick={()=>refInputRef.current?.click()}
          style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:5,
            padding:"3px 10px",cursor:"pointer",color:"#8b5cf6",fontSize:9,fontWeight:700}}>
          📂 Open Reference
        </button>
        <input ref={refInputRef} type="file" accept=".wav" style={{display:"none"}}
          onChange={async e=>{
            const f=e.target.files?.[0];if(!f)return;
            setRefName(f.name);setRefBuffer(await loadAudio(f));
          }}/>

        <div style={{width:1,height:20,background:"#0f2a3a",margin:"0 4px"}}/>

        {/* View mode */}
        {(["original","edited","difference"] as ViewMode[]).map(m=>(
          <div key={m} onClick={()=>setViewMode(m)}
            style={{fontSize:8,padding:"3px 8px",borderRadius:4,cursor:"pointer",
              background:viewMode===m?"#22d3ee22":"transparent",
              border:`1px solid ${viewMode===m?"#22d3ee44":"transparent"}`,
              color:viewMode===m?"#22d3ee":"#4a8a9a"}}>
            {m.toUpperCase()}
          </div>
        ))}

        <div style={{width:1,height:20,background:"#0f2a3a",margin:"0 4px"}}/>

        {/* Display mode */}
        {(["waveform","spectrogram","both"] as DisplayMode[]).map(m=>(
          <div key={m} onClick={()=>setDisplayMode(m)}
            style={{fontSize:8,padding:"3px 8px",borderRadius:4,cursor:"pointer",
              background:displayMode===m?"#8b5cf622":"transparent",
              border:`1px solid ${displayMode===m?"#8b5cf644":"transparent"}`,
              color:displayMode===m?"#8b5cf6":"#4a8a9a"}}>
            {m==="both"?"W+S":m==="waveform"?"WAVE":"SPEC"}
          </div>
        ))}

        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          {loading&&<span style={{fontSize:8,color:"#22d3ee"}}>⟳ {loading}</span>}
          {status&&<span style={{fontSize:8,color:"#10b981"}}>{status}</span>}
          <button onClick={handleExport} disabled={!targetBuffer}
            style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:5,
              padding:"3px 10px",cursor:"pointer",color:"#10b981",fontSize:9,fontWeight:700,
              opacity:!targetBuffer?0.4:1}}>
            ⬇ Export 32-bit Float
          </button>
        </div>
      </div>

      {/* ── MAIN BODY ─────────────────────────────────────────────────────── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div style={{width:SIDEBAR_W,background:"#030c14",borderRight:"1px solid #0f2a3a",
          display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>

          {/* File Info */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4,letterSpacing:1}}>TARGET FILE</div>
            <div style={{fontSize:9,color:"#e0f2f8",wordBreak:"break-all"}}>
              {targetName||"— none —"}
            </div>
            {targetBuffer&&<>
              <StatRow label="Duration" value={fmtTime(totalMs)}/>
              <StatRow label="Sample Rate" value={`${targetBuffer.sampleRate}Hz`}/>
              <StatRow label="Channels" value={`${targetBuffer.numberOfChannels}`}/>
              <StatRow label="Samples" value={fmtSample(totalSamples)}/>
            </>}
          </div>

          {/* Reference */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#8b5cf6",marginBottom:4,letterSpacing:1}}>REFERENCE</div>
            <div style={{fontSize:9,color:refBuffer?"#e0f2f8":"#2a5a6a",wordBreak:"break-all"}}>
              {refName||"— none —"}
            </div>
            {refProfile&&<>
              <StatRow label="Purity" value={`${(refProfile.purityScore*100).toFixed(0)}%`}
                color={refProfile.purityScore>0.7?"#10b981":"#ef4444"}/>
              <StatRow label="Grains" value={`${refProfile.grainLibrary.length}`}/>
              <StatRow label="Noise Floor" value={`${refProfile.noiseFloorDb.toFixed(1)} dB`}/>
            </>}
            {refBuffer&&!refProfile&&(
              <button onClick={handleBuildRefProfile}
                style={{width:"100%",marginTop:4,background:"#8b5cf622",
                  border:"1px solid #8b5cf644",borderRadius:4,padding:"4px",
                  cursor:"pointer",color:"#8b5cf6",fontSize:8}}>
                Build Reference Profile
              </button>
            )}
          </div>

          {/* Forensics */}
          {forensics&&<div style={{padding:"8px 10px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#f59e0b",marginBottom:4,letterSpacing:1}}>FORENSICS</div>
            <StatRow label="Contaminated" value={`${forensics.contaminatedRegions.length}`}
              color={forensics.contaminatedRegions.length===0?"#10b981":"#ef4444"}/>
            <StatRow label="Purity" value={`${(forensics.overallPurityScore*100).toFixed(0)}%`}/>
            <StatRow label="Noise Floor" value={`${forensics.noiseFloorDb.toFixed(1)} dB`}/>
            {forensics.hasHum&&<StatRow label="Hum" value={`${forensics.humFrequencyHz}Hz`} color="#ef4444"/>}
            {forensics.hasDigitalSilence&&<StatRow label="Digital Silence" value="YES" color="#ef4444"/>}
          </div>}

          {/* Edit History */}
          <div style={{flex:1,overflow:"auto",padding:"8px 10px"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4,letterSpacing:1}}>EDIT HISTORY</div>
            {editHistory.length===0&&<div style={{fontSize:8,color:"#2a5a6a"}}>No edits yet</div>}
            {[...editHistory].reverse().map((h,i)=>(
              <div key={h.id} style={{fontSize:8,padding:"3px 0",
                borderBottom:"1px solid #0a1a24",color:"#a0c4cc"}}>
                <div style={{color:h.status==="PASS"?"#10b981":h.status==="FAIL"?"#ef4444":"#f59e0b"}}>
                  {h.action}
                </div>
                <div style={{color:"#4a8a9a"}}>{fmtTime(h.region.startMs)} — {fmtTime(h.region.endMs)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER EDITOR ────────────────────────────────────────────────── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Overview waveform */}
          <div style={{height:32,background:"#020c10",borderBottom:"1px solid #0a1a24",
            position:"relative",flexShrink:0}}>
            {activeBuffer&&<div style={{fontSize:7,color:"#4a8a9a",position:"absolute",
              left:4,top:2}}>OVERVIEW</div>}
            {activeBuffer&&<div style={{
              position:"absolute",top:0,bottom:0,
              left:`${zoomStart*100}%`,
              width:`${(zoomEnd-zoomStart)*100}%`,
              background:"rgba(34,211,238,0.10)",
              border:"1px solid #22d3ee44",pointerEvents:"none",
            }}/>}
            <WaveformCanvas buffer={activeBuffer} startSample={0}
              endSample={totalSamples} selection={null} viewMode={viewMode}
              onSelect={()=>{}} height={32}/>
          </div>

          {/* Time ruler */}
          <TimeRuler startMs={visStartMs} endMs={visEndMs}/>

          {/* Waveform */}
          {(displayMode==="waveform"||displayMode==="both")&&(
            <div style={{flex:displayMode==="both"?1:2,overflow:"hidden",
              borderBottom:"1px solid #0a1a24",position:"relative"}}>
              <div style={{position:"absolute",top:4,left:8,fontSize:7,
                color:"#4a8a9a",zIndex:1,letterSpacing:1}}>WAVEFORM</div>
              <WaveformCanvas buffer={activeBuffer}
                startSample={visStart} endSample={visEnd}
                selection={selection} viewMode={viewMode}
                onSelect={handleSelect} height={displayMode==="both"?160:280}/>
            </div>
          )}

          {/* Spectrogram */}
          {(displayMode==="spectrogram"||displayMode==="both")&&(
            <div style={{flex:displayMode==="both"?1:2,overflow:"hidden",
              position:"relative"}}>
              <div style={{position:"absolute",top:4,left:8,fontSize:7,
                color:"#4a8a9a",zIndex:1,letterSpacing:1}}>SPECTROGRAM</div>
              <SpectrogramCanvas buffer={activeBuffer}
                startSample={visStart} endSample={visEnd}
                height={displayMode==="both"?160:280}/>
            </div>
          )}

          {/* Zoom bar */}
          <div style={{height:24,background:"#030c14",borderTop:"1px solid #0a1a24",
            display:"flex",alignItems:"center",gap:6,padding:"0 8px",flexShrink:0}}>
            {[
              {label:"−",action:zoomOut},
              {label:"Fit",action:zoomFit},
              {label:"Sel",action:zoomToSelection,disabled:!selection},
              {label:"+",action:zoomIn},
            ].map(({label,action,disabled})=>(
              <button key={label} onClick={action} disabled={disabled}
                style={{background:"#0a1a24",border:"1px solid #0f2a3a",borderRadius:3,
                  padding:"2px 8px",cursor:"pointer",color:"#a0c4cc",fontSize:8,
                  opacity:disabled?0.4:1}}>
                {label}
              </button>
            ))}
            <div style={{flex:1,height:4,background:"#0a1a24",borderRadius:2,
              position:"relative",cursor:"pointer"}}
              onClick={e=>{
                const rect=e.currentTarget.getBoundingClientRect();
                const x=(e.clientX-rect.left)/rect.width;
                const w=zoomEnd-zoomStart;
                setZoomStart(Math.max(0,x-w/2));
                setZoomEnd(Math.min(1,x+w/2));
              }}>
              <div style={{position:"absolute",left:`${zoomStart*100}%`,
                width:`${(zoomEnd-zoomStart)*100}%`,height:"100%",
                background:"#22d3ee",borderRadius:2}}/>
            </div>
            <span style={{fontSize:8,color:"#4a8a9a"}}>
              {fmtTime(visStartMs)} — {fmtTime(visEndMs)}
            </span>
          </div>

          {/* Transport */}
          <div style={{height:36,background:"#030c14",borderTop:"1px solid #0a1a24",
            display:"flex",alignItems:"center",gap:8,padding:"0 12px",flexShrink:0}}>
            <button onClick={handlePlay}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",
                borderRadius:6,padding:"4px 16px",cursor:"pointer",
                color:"#22d3ee",fontSize:12,fontWeight:700}}>
              {isPlaying?"⏹":"▶"}
            </button>
            <div style={{fontSize:8,color:"#4a8a9a"}}>
              {fmtTime(currentMs)} / {fmtTime(totalMs)}
            </div>
            <div style={{width:1,height:16,background:"#0f2a3a",margin:"0 4px"}}/>
            <button onClick={handleAnalyze} disabled={!activeBuffer}
              style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:4,
                padding:"3px 10px",cursor:"pointer",color:"#f59e0b",fontSize:8,
                opacity:!activeBuffer?0.4:1}}>
              🔬 Analyze Silence
            </button>
            <div style={{marginLeft:"auto",fontSize:7,color:"#2a5a6a"}}>
              SPACE=Play  S=Select  Z=Zoom  H=Heal  I=Inspect  +=ZoomIn  -=ZoomOut
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
        <div style={{width:RIGHT_W,background:"#030c14",borderLeft:"1px solid #0f2a3a",
          display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>

          {/* Tools */}
          <div style={{padding:"8px 6px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:6,letterSpacing:1}}>TOOLS</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
              <ToolBtn icon="↖" label="Select" active={activeTool==="select"} onClick={()=>setActiveTool("select")}/>
              <ToolBtn icon="🔍" label="Zoom"   active={activeTool==="zoom"}   onClick={()=>setActiveTool("zoom")}/>
              <ToolBtn icon="✋" label="Pan"    active={activeTool==="pan"}    onClick={()=>setActiveTool("pan")}/>
              <ToolBtn icon="🩹" label="Heal"   active={activeTool==="heal"}   onClick={()=>setActiveTool("heal")}/>
              <ToolBtn icon="🔬" label="Inspect" active={activeTool==="inspect"} onClick={()=>setActiveTool("inspect")}/>
            </div>
          </div>

          {/* Selection Info */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#22d3ee",marginBottom:4,letterSpacing:1}}>SELECTION</div>
            {!selection&&<div style={{fontSize:8,color:"#2a5a6a"}}>No selection</div>}
            {selection&&<>
              <StatRow label="Start"    value={fmtTime(selection.startMs)}/>
              <StatRow label="End"      value={fmtTime(selection.endMs)}/>
              <StatRow label="Duration" value={fmtTime(selection.durationMs)}/>
              <StatRow label="Samples"  value={fmtSample(selection.endSample-selection.startSample)}/>
              <StatRow label="Start #"  value={fmtSample(selection.startSample)}/>
              {selRms!==null&&<StatRow label="RMS" value={`${selRms.toFixed(1)} dB`}/>}
              {selPeak!==null&&<StatRow label="Peak" value={`${selPeak.toFixed(1)} dB`}/>}
            </>}
          </div>

          {/* QA Status */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#10b981",marginBottom:4,letterSpacing:1}}>EXPORT STATUS</div>
            <div style={{fontSize:8,color:targetBuffer?"#10b981":"#2a5a6a"}}>
              {targetBuffer?"✓ File loaded":"— no file —"}
            </div>
            <div style={{fontSize:8,color:refProfile?"#10b981":"#2a5a6a"}}>
              {refProfile?"✓ Reference ready":"— no reference —"}
            </div>
            <div style={{fontSize:8,color:"#22d3ee",marginTop:4}}>
              Format: 32-bit Float WAV
            </div>
          </div>

          {/* Keyboard shortcuts */}
          <div style={{padding:"8px 10px",flex:1,overflow:"auto"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4,letterSpacing:1}}>SHORTCUTS</div>
            {[
              ["SPACE","Play/Stop"],["S","Select tool"],["Z","Zoom tool"],
              ["H","Heal tool"],["I","Inspect tool"],
              ["+","Zoom in"],["-","Zoom out"],["0","Fit all"],
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",gap:4,marginBottom:3,alignItems:"center"}}>
                <span style={{fontSize:7,background:"#0a1a24",border:"1px solid #0f2a3a",
                  borderRadius:3,padding:"1px 5px",color:"#22d3ee",minWidth:32,
                  textAlign:"center"}}>{k}</span>
                <span style={{fontSize:7,color:"#4a8a9a"}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
