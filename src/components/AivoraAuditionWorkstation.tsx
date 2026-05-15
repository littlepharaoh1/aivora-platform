// @ts-nocheck
/**
 * AivoraAuditionWorkstation.tsx — Professional Audio Editor Workstation
 * Full editing workflow: Copy → Paste → Protect → QA → Export
 * Aivora Platform
 */
import React, { useState, useRef, useEffect } from "react";
import { exportFloat32Wav, downloadWavBlob } from "../lib/audioForensics/floatWavExporter";
import { analyzeSilenceForensics } from "../lib/audioForensics/silenceForensics";
import { buildReferenceSilenceProfile } from "../lib/audioForensics/referenceSilenceProfile";
import { silenceClipboard, validateForPaste } from "../lib/audioEditor/silenceClipboard";
import { replaceRegionWithClipboard, healRegion } from "../lib/audioEditor/regionReplace";
import { checkSpeechProtection } from "../lib/audioEditor/speechProtection";
import { runRegionQA } from "../lib/audioEditor/regionQa";
import type { ClipboardEntry } from "../lib/audioEditor/silenceClipboard";
import type { RegionQAResult } from "../lib/audioEditor/regionQa";
import type { SpeechProtectionResult } from "../lib/audioEditor/speechProtection";
import type { ReplaceMode } from "../lib/audioEditor/regionReplace";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Region {
  startSample: number; endSample: number;
  startMs: number; endMs: number; durationMs: number;
  type?: "selection"|"repaired"|"contaminated"|"speech";
}

interface EditEntry {
  id: string; action: string; region: Region;
  timestamp: number; qaResult?: RegionQAResult;
}

type Tool = "select"|"zoom"|"pan"|"heal"|"inspect";
type ViewMode = "original"|"edited"|"difference";
type DisplayMode = "waveform"|"spectrogram"|"both";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  if(ms < 1000) return `${ms.toFixed(0)}ms`;
  const s = ms/1000;
  if(s < 60) return `${s.toFixed(3)}s`;
  const m = Math.floor(s/60);
  return `${m}:${(s%60).toFixed(2).padStart(5,"0")}`;
}

function rmsDb(s: Float32Array): number {
  let sum=0; for(let i=0;i<s.length;i++) sum+=s[i]**2;
  const r=Math.sqrt(sum/Math.max(1,s.length)); return r>0?20*Math.log10(r):-120;
}

function toMono(buf: AudioBuffer): Float32Array {
  const m=new Float32Array(buf.length);
  for(let ch=0;ch<buf.numberOfChannels;ch++){const d=buf.getChannelData(ch);for(let i=0;i<buf.length;i++)m[i]+=d[i];}
  if(buf.numberOfChannels>1) for(let i=0;i<m.length;i++) m[i]/=buf.numberOfChannels;
  return m;
}

// ── Mini UI ───────────────────────────────────────────────────────────────────

function StatRow({label,value,color="#a0c4cc"}:{label:string;value:string;color?:string}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",padding:"2px 0",borderBottom:"1px solid #0a1a24"}}>
      <span style={{fontSize:8,color:"#4a8a9a"}}>{label}</span>
      <span style={{fontSize:8,color,fontWeight:700}}>{value}</span>
    </div>
  );
}

function PBar({score,label}:{score:number;label:string}){
  const c=score>0.80?"#10b981":score>0.60?"#f59e0b":"#ef4444";
  return(
    <div style={{marginBottom:4}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
        <span style={{fontSize:8,color:"#a0c4cc"}}>{label}</span>
        <span style={{fontSize:8,color:c,fontWeight:700}}>{(score*100).toFixed(0)}%</span>
      </div>
      <div style={{height:3,background:"#0f2a3a",borderRadius:2}}>
        <div style={{height:"100%",background:c,borderRadius:2,width:`${score*100}%`}}/>
      </div>
    </div>
  );
}

function ToolBtn({icon,label,active,onClick}:{icon:string;label:string;active?:boolean;onClick:()=>void}){
  return(
    <div onClick={onClick} title={label}
      style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,
        padding:"5px 3px",borderRadius:5,cursor:"pointer",minWidth:32,
        background:active?"#22d3ee22":"transparent",
        border:`1px solid ${active?"#22d3ee44":"transparent"}`}}>
      <span style={{fontSize:13}}>{icon}</span>
      <span style={{fontSize:6,color:active?"#22d3ee":"#4a8a9a"}}>{label}</span>
    </div>
  );
}

// ── Waveform Canvas ───────────────────────────────────────────────────────────

function WaveformCanvas({buffer,startSample,endSample,selection,repairedRegions,viewMode,onSelect,height=160}:{
  buffer:AudioBuffer|null;startSample:number;endSample:number;
  selection:Region|null;repairedRegions:Region[];viewMode:ViewMode;
  onSelect:(s:number,e:number)=>void;height?:number;
}){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const dragRef=useRef<{start:number;dragging:boolean}>({start:0,dragging:false});

  useEffect(()=>{
    const cv=canvasRef.current; if(!cv||!buffer) return;
    const ctx=cv.getContext("2d"); if(!ctx) return;
    const W=cv.width,H=cv.height;
    ctx.fillStyle="#040c14"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#0a1a24"; ctx.lineWidth=1;
    for(let y=0;y<H;y+=H/8){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    for(let x=0;x<W;x+=W/16){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    ctx.strokeStyle="#0f2a3a"; ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();

    const mono=toMono(buffer);
    const visLen=endSample-startSample;
    const spp=visLen/W;
    ctx.strokeStyle=viewMode==="difference"?"#f97316":"#22d3ee";
    ctx.lineWidth=1; ctx.beginPath();
    for(let px=0;px<W;px++){
      const s=Math.floor(startSample+px*spp);
      const e=Math.min(Math.floor(s+spp),buffer.length);
      let min=0,max=0;
      for(let i=s;i<e;i++){const v=mono[i]??0;if(v>max)max=v;if(v<min)min=v;}
      const y1=H/2*(1-max), y2=H/2*(1-min)+H/2;
      if(px===0) ctx.moveTo(px,y1); else ctx.lineTo(px,y1);
      ctx.lineTo(px,y2);
    }
    ctx.stroke();

    // Repaired region overlays
    for(const r of repairedRegions){
      const x1=(r.startSample-startSample)/visLen*W;
      const x2=(r.endSample-startSample)/visLen*W;
      if(x2<0||x1>W) continue;
      ctx.fillStyle="rgba(16,185,129,0.12)";
      ctx.fillRect(x1,0,x2-x1,H);
      ctx.strokeStyle="#10b98144"; ctx.lineWidth=1;
      ctx.strokeRect(x1,0,x2-x1,H);
    }

    // Selection
    if(selection){
      const x1=(selection.startSample-startSample)/visLen*W;
      const x2=(selection.endSample-startSample)/visLen*W;
      ctx.fillStyle="rgba(34,211,238,0.15)";
      ctx.fillRect(x1,0,x2-x1,H);
      ctx.strokeStyle="#22d3ee"; ctx.lineWidth=1;
      ctx.strokeRect(x1,0,x2-x1,H);
      // Handles
      ctx.fillStyle="#22d3ee";
      ctx.fillRect(x1-2,0,4,H);
      ctx.fillRect(x2-2,0,4,H);
    }

    // dB labels
    ctx.fillStyle="#4a8a9a"; ctx.font="8px monospace";
    [-1,-0.5,0,0.5,1].forEach(v=>{
      const y=H/2*(1-v);
      ctx.fillText(v!==0?`${(20*Math.log10(Math.abs(v))).toFixed(0)}dB`:"0",2,y+3);
    });
  },[buffer,startSample,endSample,selection,repairedRegions,viewMode]);

  function getSample(e:React.MouseEvent<HTMLCanvasElement>):number{
    const r=canvasRef.current!.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width;
    return Math.round(startSample+(endSample-startSample)*x);
  }

  return(
    <canvas ref={canvasRef} width={800} height={height}
      style={{width:"100%",height,cursor:"crosshair",display:"block"}}
      onMouseDown={e=>{dragRef.current={start:getSample(e),dragging:true};}}
      onMouseMove={e=>{
        if(!dragRef.current.dragging) return;
        const c=getSample(e);
        onSelect(Math.min(dragRef.current.start,c),Math.max(dragRef.current.start,c));
      }}
      onMouseUp={e=>{
        dragRef.current.dragging=false;
        const c=getSample(e);
        onSelect(Math.min(dragRef.current.start,c),Math.max(dragRef.current.start,c));
      }}
    />
  );
}

// ── Spectrogram Canvas ────────────────────────────────────────────────────────

function SpectrogramCanvas({buffer,startSample,endSample,height=160}:{
  buffer:AudioBuffer|null;startSample:number;endSample:number;height?:number;
}){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const cv=canvasRef.current; if(!cv||!buffer) return;
    const ctx=cv.getContext("2d"); if(!ctx) return;
    const W=cv.width,H=cv.height;
    ctx.fillStyle="#020810"; ctx.fillRect(0,0,W,H);
    const mono=toMono(buffer);
    const FFT=512;
    const hop=Math.max(1,Math.floor((endSample-startSample)/W));
    const re=new Float64Array(FFT), im=new Float64Array(FFT);
    function fft(){
      const n=re.length;
      for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
      for(let len=2;len<=n;len<<=1){const ang=(-2*Math.PI)/len,wRe=Math.cos(ang),wIm=Math.sin(ang);for(let i=0;i<n;i+=len){let cRe=1,cIm=0;for(let j=0;j<len>>1;j++){const uRe=re[i+j],uIm=im[i+j],vRe=re[i+j+len/2]*cRe-im[i+j+len/2]*cIm,vIm=re[i+j+len/2]*cIm+im[i+j+len/2]*cRe;re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;re[i+j+len/2]=uRe-vRe;im[i+j+len/2]=uIm-vIm;const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;}}}
    }
    for(let px=0;px<W;px++){
      const offset=startSample+px*hop;
      if(offset+FFT>mono.length) break;
      re.fill(0); im.fill(0);
      for(let i=0;i<FFT;i++) re[i]=(mono[offset+i]??0)*0.5*(1-Math.cos(2*Math.PI*i/(FFT-1)));
      fft();
      for(let bin=0;bin<FFT/2;bin++){
        const mag=Math.sqrt(re[bin]**2+im[bin]**2);
        const db=mag>0?Math.max(-120,20*Math.log10(mag)):-120;
        const norm=Math.max(0,Math.min(1,(db+120)/120));
        const py=H-Math.round(bin/FFT*2*H)-1;
        ctx.fillStyle=`rgb(${Math.round(norm*255)},${Math.round(norm*140)},${Math.round(norm*30)})`;
        ctx.fillRect(px,Math.max(0,py),1,2);
      }
    }
    ctx.fillStyle="#4a8a9a"; ctx.font="7px monospace";
    const nyq=buffer.sampleRate/2;
    [100,500,1000,4000,8000].forEach(f=>{
      if(f>nyq) return;
      ctx.fillText(`${f>=1000?f/1000+"k":f}Hz`,2,H*(1-f/nyq));
    });
  },[buffer,startSample,endSample]);
  return(<canvas ref={canvasRef} width={800} height={height} style={{width:"100%",height,display:"block"}}/>);
}

// ── Time Ruler ────────────────────────────────────────────────────────────────

function TimeRuler({startMs,endMs}:{startMs:number;endMs:number}){
  const dur=endMs-startMs;
  const step=dur>10000?1000:dur>2000?200:dur>500?50:10;
  const ticks=[];
  for(let t=Math.ceil(startMs/step)*step;t<=endMs;t+=step)
    ticks.push({x:((t-startMs)/dur)*100,label:fmtTime(t)});
  return(
    <div style={{position:"relative",height:20,background:"#050d14",borderBottom:"1px solid #0f2a3a",overflow:"hidden"}}>
      {ticks.map((t,i)=>(
        <div key={i} style={{position:"absolute",left:`${t.x}%`,top:0,fontSize:7,color:"#4a8a9a",
          borderLeft:"1px solid #0f2a3a",paddingLeft:2,height:"100%",display:"flex",
          alignItems:"flex-end",paddingBottom:2}}>{t.label}</div>
      ))}
    </div>
  );
}

// ── QA Badge ─────────────────────────────────────────────────────────────────

function QABadge({result}:{result:RegionQAResult}){
  const c=result.status==="PASS"?"#10b981":result.status==="REVIEW"?"#f59e0b":"#ef4444";
  return(
    <div style={{background:c+"22",border:`1px solid ${c}44`,borderRadius:6,padding:"4px 8px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:9,color:c,fontWeight:700}}>REGION QA: {result.status}</span>
        <span style={{fontSize:9,color:c}}>{(result.score*100).toFixed(0)}%</span>
      </div>
      <PBar score={result.silenceRealismScore}     label="Silence Realism"/>
      <PBar score={1-result.seamRisk}              label="Seam Safety"/>
      <PBar score={result.spectralContinuityScore} label="Spectral Continuity"/>
      <PBar score={result.speechPreservationScore} label="Speech Preserved"/>
      {result.blockingReasons.map((r,i)=>(
        <div key={i} style={{fontSize:8,color:"#ef4444",marginTop:2}}>✗ {r}</div>
      ))}
      {result.suggestedFixes.slice(0,2).map((f,i)=>(
        <div key={i} style={{fontSize:8,color:"#f59e0b",marginTop:2}}>→ {f}</div>
      ))}
    </div>
  );
}

// ── Main Workstation ──────────────────────────────────────────────────────────

export default function AivoraAuditionWorkstation(){
  const [targetBuffer,setTargetBuffer]=useState<AudioBuffer|null>(null);
  const [targetName,setTargetName]=useState("");
  const [refBuffer,setRefBuffer]=useState<AudioBuffer|null>(null);
  const [refName,setRefName]=useState("");
  const [editedBuffer,setEditedBuffer]=useState<AudioBuffer|null>(null);
  const [originalBuffer,setOriginalBuffer]=useState<AudioBuffer|null>(null);

  const [selection,setSelection]=useState<Region|null>(null);
  const [repairedRegions,setRepairedRegions]=useState<Region[]>([]);
  const [activeTool,setActiveTool]=useState<Tool>("select");
  const [viewMode,setViewMode]=useState<ViewMode>("edited");
  const [displayMode,setDisplayMode]=useState<DisplayMode>("both");
  const [replaceMode,setReplaceMode]=useState<ReplaceMode>("fill");

  const [zoomStart,setZoomStart]=useState(0);
  const [zoomEnd,setZoomEnd]=useState(1);
  const [isPlaying,setIsPlaying]=useState(false);

  const [forensics,setForensics]=useState<any>(null);
  const [refProfile,setRefProfile]=useState<any>(null);
  const [clipboardEntries,setClipboardEntries]=useState<ClipboardEntry[]>([]);
  const [activeClipboard,setActiveClipboard]=useState<ClipboardEntry|null>(null);
  const [editHistory,setEditHistory]=useState<EditEntry[]>([]);
  const [lastQA,setLastQA]=useState<RegionQAResult|null>(null);
  const [protection,setProtection]=useState<SpeechProtectionResult|null>(null);
  const [loading,setLoading]=useState("");
  const [status,setStatus]=useState("");

  const targetRef=useRef<HTMLInputElement>(null);
  const refRef   =useRef<HTMLInputElement>(null);
  const sourceRef=useRef<AudioBufferSourceNode|null>(null);

  const activeBuffer=viewMode==="original"?originalBuffer??targetBuffer:editedBuffer??targetBuffer;
  const sr=activeBuffer?.sampleRate??44100;
  const totalSamples=activeBuffer?.length??0;
  const totalMs=(totalSamples/sr)*1000;
  const visStart=Math.floor(totalSamples*zoomStart);
  const visEnd  =Math.floor(totalSamples*zoomEnd);
  const visStartMs=(visStart/sr)*1000;
  const visEndMs  =(visEnd/sr)*1000;

  async function loadAudio(file:File):Promise<AudioBuffer>{
    const ctx=new AudioContext();
    return ctx.decodeAudioData(await file.arrayBuffer());
  }

  function handleSelect(s:number,e:number){
    if(!activeBuffer||s===e) return;
    const ss=Math.max(0,Math.min(s,totalSamples));
    const ee=Math.max(0,Math.min(e,totalSamples));
    const reg:Region={
      startSample:ss,endSample:ee,
      startMs:(ss/sr)*1000,endMs:(ee/sr)*1000,
      durationMs:((ee-ss)/sr)*1000,type:"selection",
    };
    setSelection(reg);

    // Auto check speech protection
    const buf=editedBuffer??targetBuffer;
    if(buf){
      const p=checkSpeechProtection(buf,ss,ee);
      setProtection(p);
    }
  }

  // ── Copy to Clipboard ──────────────────────────────────────────────────────

  function handleCopyToClipboard(){
    const buf=editedBuffer??targetBuffer;
    if(!buf||!selection) return;
    const entry=silenceClipboard.save(
      buf, selection.startSample, selection.endSample,
      `Sel ${fmtTime(selection.startMs)}-${fmtTime(selection.endMs)}`
    );
    setClipboardEntries(silenceClipboard.getAll());
    setActiveClipboard(entry);
    setStatus(`✓ Copied ${fmtTime(selection.durationMs)} to clipboard (purity ${(entry.purityScore*100).toFixed(0)}%)`);
  }

  // ── Set Reference as Clipboard ─────────────────────────────────────────────

  function handleRefToClipboard(){
    if(!refBuffer) return;
    const entry=silenceClipboard.saveFromReference(refBuffer,refName);
    setClipboardEntries(silenceClipboard.getAll());
    setActiveClipboard(entry);
    setStatus(`✓ Reference silence saved (purity ${(entry.purityScore*100).toFixed(0)}%)`);
  }

  // ── Paste Clean Silence ────────────────────────────────────────────────────

  async function handlePaste(){
    const buf=editedBuffer??targetBuffer;
    if(!buf||!selection||!activeClipboard) return;

    // Speech protection check
    const p=checkSpeechProtection(buf,selection.startSample,selection.endSample);
    setProtection(p);
    if(!p.allowed){
      setStatus(`⛔ Blocked: ${p.blockedReason}`);
      return;
    }

    setLoading("Pasting clean silence...");
    await new Promise(r=>setTimeout(r,0));

    const result=replaceRegionWithClipboard(
      buf, selection.startSample, selection.endSample,
      activeClipboard, {mode:replaceMode, crossfadeMs:8, snapZeroCross:true}
    );

    // Run region QA
    const qa=runRegionQA(
      result.repairedBuffer,
      selection.startSample, selection.endSample,
      originalBuffer??targetBuffer??undefined
    );
    setLastQA(qa);
    setEditedBuffer(result.repairedBuffer);

    // Update repaired regions
    setRepairedRegions(prev=>[...prev,{
      startSample:selection.startSample,endSample:selection.endSample,
      startMs:selection.startMs,endMs:selection.endMs,
      durationMs:selection.durationMs,type:"repaired",
    }]);

    // Add to history
    const entry:EditEntry={
      id:`edit_${Date.now()}`,
      action:`${replaceMode} silence paste`,
      region:selection,
      timestamp:Date.now(),
      qaResult:qa,
    };
    setEditHistory(prev=>[...prev,entry]);

    const statusMsg=qa.status==="PASS"
      ?`✅ Paste PASS (${(qa.score*100).toFixed(0)}%) — seam safe`
      :qa.status==="REVIEW"
      ?`⚠ Paste REVIEW (${(qa.score*100).toFixed(0)}%) — check warnings`
      :`❌ Paste FAIL — ${qa.blockingReasons[0]??'unknown'}`;
    setStatus(statusMsg);
    setLoading("");
  }

  // ── Heal Region ────────────────────────────────────────────────────────────

  async function handleHeal(){
    const buf=editedBuffer??targetBuffer;
    if(!buf||!selection||!refProfile) return;

    const p=checkSpeechProtection(buf,selection.startSample,selection.endSample);
    setProtection(p);
    if(!p.allowed){setStatus(`⛔ Blocked: ${p.blockedReason}`);return;}

    setLoading("Healing region...");
    await new Promise(r=>setTimeout(r,0));

    const result=healRegion(buf,selection.startSample,selection.endSample,refProfile);
    const qa=runRegionQA(result.repairedBuffer,selection.startSample,selection.endSample,originalBuffer??targetBuffer??undefined);
    setLastQA(qa);
    setEditedBuffer(result.repairedBuffer);
    setRepairedRegions(prev=>[...prev,{...selection,type:"repaired"}]);
    setEditHistory(prev=>[...prev,{
      id:`heal_${Date.now()}`,action:"heal region",region:selection,timestamp:Date.now(),qaResult:qa,
    }]);
    setStatus(`Heal done — QA: ${qa.status} (${(qa.score*100).toFixed(0)}%)`);
    setLoading("");
  }

  // ── Analyze ────────────────────────────────────────────────────────────────

  async function handleAnalyze(){
    const buf=editedBuffer??targetBuffer; if(!buf) return;
    setLoading("Analyzing..."); await new Promise(r=>setTimeout(r,0));
    setForensics(analyzeSilenceForensics(buf));
    setStatus("Analysis complete"); setLoading("");
  }

  async function handleBuildProfile(){
    if(!refBuffer) return;
    setLoading("Building profile..."); await new Promise(r=>setTimeout(r,0));
    setRefProfile(buildReferenceSilenceProfile(refBuffer,refName));
    setStatus("Reference profile ready"); setLoading("");
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  function handlePlay(){
    const buf=activeBuffer; if(!buf) return;
    if(isPlaying){sourceRef.current?.stop();setIsPlaying(false);return;}
    const ctx=new AudioContext();
    const src=ctx.createBufferSource();
    src.buffer=buf; src.connect(ctx.destination);
    const offset=selection?(selection.startSample/sr):0;
    src.start(0,offset); src.onended=()=>setIsPlaying(false);
    sourceRef.current=src; setIsPlaying(true);
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  function zoomIn(){const m=(zoomStart+zoomEnd)/2,h=(zoomEnd-zoomStart)/4;setZoomStart(Math.max(0,m-h));setZoomEnd(Math.min(1,m+h));}
  function zoomOut(){const m=(zoomStart+zoomEnd)/2,h=(zoomEnd-zoomStart);setZoomStart(Math.max(0,m-h));setZoomEnd(Math.min(1,m+h));}
  function zoomFit(){setZoomStart(0);setZoomEnd(1);}
  function zoomSel(){
    if(!selection||!totalSamples) return;
    const pad=0.05;
    setZoomStart(Math.max(0,selection.startSample/totalSamples-pad));
    setZoomEnd(Math.min(1,selection.endSample/totalSamples+pad));
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  function handleExport(){
    const buf=editedBuffer??targetBuffer; if(!buf) return;
    const r=exportFloat32Wav(buf,targetName||"export");
    downloadWavBlob(r.blob,r.filename);
    setStatus(`Exported: ${r.filename}`);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      if(e.target instanceof HTMLInputElement) return;
      if(e.key===" "){e.preventDefault();handlePlay();}
      if(e.key==="="||e.key==="+") zoomIn();
      if(e.key==="-") zoomOut();
      if(e.key==="0") zoomFit();
      if(e.key==="s") setActiveTool("select");
      if(e.key==="z") setActiveTool("zoom");
      if(e.key==="h") setActiveTool("heal");
      if(e.key==="i") setActiveTool("inspect");
      if(e.key==="c"&&e.ctrlKey){e.preventDefault();handleCopyToClipboard();}
      if(e.key==="v"&&e.ctrlKey){e.preventDefault();handlePaste();}
    }
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  });

  // ── Protection color ──────────────────────────────────────────────────────

  const protColor=!protection?"#4a8a9a"
    :protection.riskLevel==="LOW"?"#10b981"
    :protection.riskLevel==="MEDIUM"?"#f59e0b"
    :protection.riskLevel==="HIGH"?"#f97316"
    :"#ef4444";

  const qaColor=!lastQA?"#4a8a9a"
    :lastQA.status==="PASS"?"#10b981"
    :lastQA.status==="REVIEW"?"#f59e0b":"#ef4444";

  const selMono=selection&&activeBuffer?(()=>{
    const m=toMono(activeBuffer);
    return m.subarray(selection.startSample,selection.endSample);
  })():null;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",
      background:"#020810",fontFamily:"monospace",color:"#a0c4cc",overflow:"hidden"}}>

      {/* TOP BAR */}
      <div style={{height:40,background:"#030c14",borderBottom:"1px solid #0f2a3a",
        display:"flex",alignItems:"center",gap:6,padding:"0 10px",flexShrink:0,flexWrap:"wrap"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#22d3ee",letterSpacing:2}}>
          AIVORA AUDITION WORKSTATION
        </div>
        <div style={{width:1,height:20,background:"#0f2a3a",margin:"0 4px"}}/>
        <button onClick={()=>targetRef.current?.click()}
          style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:5,
            padding:"3px 10px",cursor:"pointer",color:"#22d3ee",fontSize:9,fontWeight:700}}>
          📂 Target
        </button>
        <input ref={targetRef} type="file" accept=".wav" style={{display:"none"}}
          onChange={async e=>{
            const f=e.target.files?.[0];if(!f)return;
            setTargetName(f.name);
            const buf=await loadAudio(f);
            setTargetBuffer(buf);setOriginalBuffer(buf);setEditedBuffer(null);
            setZoomStart(0);setZoomEnd(1);setSelection(null);setForensics(null);
            setRepairedRegions([]);setLastQA(null);setEditHistory([]);
          }}/>
        <button onClick={()=>refRef.current?.click()}
          style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:5,
            padding:"3px 10px",cursor:"pointer",color:"#8b5cf6",fontSize:9,fontWeight:700}}>
          📂 Reference
        </button>
        <input ref={refRef} type="file" accept=".wav" style={{display:"none"}}
          onChange={async e=>{
            const f=e.target.files?.[0];if(!f)return;
            setRefName(f.name);setRefBuffer(await loadAudio(f));
          }}/>
        <div style={{width:1,height:20,background:"#0f2a3a",margin:"0 2px"}}/>
        {(["original","edited","difference"] as ViewMode[]).map(m=>(
          <div key={m} onClick={()=>setViewMode(m)}
            style={{fontSize:8,padding:"2px 7px",borderRadius:4,cursor:"pointer",
              background:viewMode===m?"#22d3ee22":"transparent",
              border:`1px solid ${viewMode===m?"#22d3ee44":"transparent"}`,
              color:viewMode===m?"#22d3ee":"#4a8a9a"}}>
            {m.toUpperCase()}
          </div>
        ))}
        <div style={{width:1,height:20,background:"#0f2a3a",margin:"0 2px"}}/>
        {(["waveform","spectrogram","both"] as DisplayMode[]).map(m=>(
          <div key={m} onClick={()=>setDisplayMode(m)}
            style={{fontSize:8,padding:"2px 7px",borderRadius:4,cursor:"pointer",
              background:displayMode===m?"#8b5cf622":"transparent",
              border:`1px solid ${displayMode===m?"#8b5cf644":"transparent"}`,
              color:displayMode===m?"#8b5cf6":"#4a8a9a"}}>
            {m==="both"?"W+S":m==="waveform"?"WAVE":"SPEC"}
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          {loading&&<span style={{fontSize:8,color:"#22d3ee"}}>⟳ {loading}</span>}
          {status&&<span style={{fontSize:8,color:"#10b981",maxWidth:200,overflow:"hidden",
            textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{status}</span>}
          <button onClick={handleExport} disabled={!targetBuffer}
            style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:5,
              padding:"3px 10px",cursor:"pointer",color:"#10b981",fontSize:9,fontWeight:700,
              opacity:!targetBuffer?0.4:1}}>
            ⬇ Export 32-bit
          </button>
        </div>
      </div>

      {/* MAIN BODY */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* LEFT PANEL */}
        <div style={{width:190,background:"#030c14",borderRight:"1px solid #0f2a3a",
          display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>

          {/* File info */}
          <div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:3,letterSpacing:1}}>TARGET</div>
            <div style={{fontSize:8,color:"#e0f2f8",wordBreak:"break-all",marginBottom:4}}>
              {targetName||"— none —"}
            </div>
            {activeBuffer&&<>
              <StatRow label="Duration" value={fmtTime(totalMs)}/>
              <StatRow label="SR" value={`${activeBuffer.sampleRate}Hz`}/>
              <StatRow label="Ch" value={`${activeBuffer.numberOfChannels}`}/>
              <StatRow label="Edits" value={`${editHistory.length}`}/>
            </>}
          </div>

          {/* Reference */}
          <div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#8b5cf6",marginBottom:3,letterSpacing:1}}>REFERENCE</div>
            <div style={{fontSize:8,color:refBuffer?"#e0f2f8":"#2a5a6a",wordBreak:"break-all",marginBottom:4}}>
              {refName||"— none —"}
            </div>
            {refBuffer&&!refProfile&&(
              <button onClick={handleBuildProfile}
                style={{width:"100%",background:"#8b5cf622",border:"1px solid #8b5cf644",
                  borderRadius:4,padding:"3px",cursor:"pointer",color:"#8b5cf6",fontSize:8}}>
                Build Profile
              </button>
            )}
            {refProfile&&<>
              <StatRow label="Purity" value={`${(refProfile.purityScore*100).toFixed(0)}%`}
                color={refProfile.purityScore>0.7?"#10b981":"#ef4444"}/>
              <StatRow label="Grains" value={`${refProfile.grainLibrary.length}`}/>
              <button onClick={handleRefToClipboard}
                style={{width:"100%",marginTop:4,background:"#22d3ee22",border:"1px solid #22d3ee44",
                  borderRadius:4,padding:"3px",cursor:"pointer",color:"#22d3ee",fontSize:8}}>
                → Set as Clipboard
              </button>
            </>}
          </div>

          {/* Forensics */}
          {forensics&&<div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#f59e0b",marginBottom:3,letterSpacing:1}}>FORENSICS</div>
            <StatRow label="Contaminated" value={`${forensics.contaminatedRegions.length}`}
              color={forensics.contaminatedRegions.length===0?"#10b981":"#ef4444"}/>
            <StatRow label="Purity" value={`${(forensics.overallPurityScore*100).toFixed(0)}%`}/>
            <StatRow label="Noise Floor" value={`${forensics.noiseFloorDb.toFixed(1)} dB`}/>
          </div>}

          {/* Edit History */}
          <div style={{flex:1,overflow:"auto",padding:"8px 8px"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4,letterSpacing:1}}>HISTORY</div>
            {editHistory.length===0&&<div style={{fontSize:8,color:"#2a5a6a"}}>No edits</div>}
            {[...editHistory].reverse().slice(0,8).map(h=>(
              <div key={h.id} style={{fontSize:8,padding:"3px 0",borderBottom:"1px solid #0a1a24"}}>
                <div style={{color:h.qaResult?.status==="PASS"?"#10b981":h.qaResult?.status==="FAIL"?"#ef4444":"#f59e0b"}}>
                  {h.action}
                </div>
                <div style={{color:"#4a8a9a",fontSize:7}}>{fmtTime(h.region.startMs)}–{fmtTime(h.region.endMs)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER EDITOR */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Overview */}
          <div style={{height:28,background:"#020c10",borderBottom:"1px solid #0a1a24",
            position:"relative",flexShrink:0}}>
            <div style={{position:"absolute",left:`${zoomStart*100}%`,top:0,bottom:0,
              width:`${(zoomEnd-zoomStart)*100}%`,background:"rgba(34,211,238,0.10)",
              border:"1px solid #22d3ee33",pointerEvents:"none"}}/>
            <WaveformCanvas buffer={activeBuffer} startSample={0} endSample={totalSamples}
              selection={null} repairedRegions={[]} viewMode={viewMode}
              onSelect={()=>{}} height={28}/>
          </div>

          <TimeRuler startMs={visStartMs} endMs={visEndMs}/>

          {/* Waveform */}
          {(displayMode==="waveform"||displayMode==="both")&&(
            <div style={{flex:1,overflow:"hidden",borderBottom:"1px solid #0a1a24",position:"relative",minHeight:120}}>
              <div style={{position:"absolute",top:3,left:8,fontSize:7,color:"#4a8a9a",zIndex:1}}>WAVEFORM</div>
              <WaveformCanvas buffer={activeBuffer} startSample={visStart} endSample={visEnd}
                selection={selection} repairedRegions={repairedRegions.filter(r=>
                  r.endSample>visStart&&r.startSample<visEnd)}
                viewMode={viewMode} onSelect={handleSelect}
                height={displayMode==="both"?150:260}/>
            </div>
          )}

          {/* Spectrogram */}
          {(displayMode==="spectrogram"||displayMode==="both")&&(
            <div style={{flex:1,overflow:"hidden",position:"relative",minHeight:120}}>
              <div style={{position:"absolute",top:3,left:8,fontSize:7,color:"#4a8a9a",zIndex:1}}>SPECTROGRAM</div>
              <SpectrogramCanvas buffer={activeBuffer} startSample={visStart} endSample={visEnd}
                height={displayMode==="both"?150:260}/>
            </div>
          )}

          {/* Zoom bar */}
          <div style={{height:22,background:"#030c14",borderTop:"1px solid #0a1a24",
            display:"flex",alignItems:"center",gap:4,padding:"0 6px",flexShrink:0}}>
            {[["−",zoomOut],["Fit",zoomFit],["Sel",zoomSel,!selection],["+",zoomIn]].map(([l,a,d],i)=>(
              <button key={i} onClick={a as ()=>void} disabled={!!d}
                style={{background:"#0a1a24",border:"1px solid #0f2a3a",borderRadius:3,
                  padding:"1px 7px",cursor:"pointer",color:"#a0c4cc",fontSize:8,opacity:d?0.4:1}}>
                {l}
              </button>
            ))}
            <div style={{flex:1,height:4,background:"#0a1a24",borderRadius:2,cursor:"pointer",position:"relative"}}
              onClick={e=>{
                const r=e.currentTarget.getBoundingClientRect();
                const x=(e.clientX-r.left)/r.width;
                const w=zoomEnd-zoomStart;
                setZoomStart(Math.max(0,x-w/2));setZoomEnd(Math.min(1,x+w/2));
              }}>
              <div style={{position:"absolute",left:`${zoomStart*100}%`,
                width:`${(zoomEnd-zoomStart)*100}%`,height:"100%",
                background:"#22d3ee",borderRadius:2}}/>
            </div>
            <span style={{fontSize:7,color:"#4a8a9a"}}>{fmtTime(visStartMs)}–{fmtTime(visEndMs)}</span>
          </div>

          {/* Transport */}
          <div style={{height:34,background:"#030c14",borderTop:"1px solid #0a1a24",
            display:"flex",alignItems:"center",gap:6,padding:"0 10px",flexShrink:0}}>
            <button onClick={handlePlay}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:5,
                padding:"3px 14px",cursor:"pointer",color:"#22d3ee",fontSize:11}}>
              {isPlaying?"⏹":"▶"}
            </button>
            <span style={{fontSize:8,color:"#4a8a9a"}}>{fmtTime(totalMs)}</span>
            <div style={{width:1,height:14,background:"#0f2a3a",margin:"0 2px"}}/>
            <button onClick={handleAnalyze} disabled={!activeBuffer}
              style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:4,
                padding:"2px 8px",cursor:"pointer",color:"#f59e0b",fontSize:8,opacity:!activeBuffer?0.4:1}}>
              🔬 Analyze
            </button>
            <div style={{marginLeft:"auto",fontSize:7,color:"#2a5a6a"}}>
              SPACE=Play  Ctrl+C=Copy  Ctrl+V=Paste  +=In  -=Out
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{width:200,background:"#030c14",borderLeft:"1px solid #0f2a3a",
          display:"flex",flexDirection:"column",overflow:"auto",flexShrink:0}}>

          {/* Tools */}
          <div style={{padding:"8px 6px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4,letterSpacing:1}}>TOOLS</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
              <ToolBtn icon="↖" label="Select"  active={activeTool==="select"}  onClick={()=>setActiveTool("select")}/>
              <ToolBtn icon="🔍" label="Zoom"   active={activeTool==="zoom"}    onClick={()=>setActiveTool("zoom")}/>
              <ToolBtn icon="✋" label="Pan"    active={activeTool==="pan"}     onClick={()=>setActiveTool("pan")}/>
              <ToolBtn icon="🩹" label="Heal"   active={activeTool==="heal"}   onClick={()=>setActiveTool("heal")}/>
              <ToolBtn icon="🔬" label="Inspect" active={activeTool==="inspect"} onClick={()=>setActiveTool("inspect")}/>
            </div>
          </div>

          {/* Selection Info */}
          <div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#22d3ee",marginBottom:3,letterSpacing:1}}>SELECTION</div>
            {!selection&&<div style={{fontSize:8,color:"#2a5a6a"}}>Drag to select</div>}
            {selection&&<>
              <StatRow label="Start"    value={fmtTime(selection.startMs)}/>
              <StatRow label="End"      value={fmtTime(selection.endMs)}/>
              <StatRow label="Duration" value={fmtTime(selection.durationMs)}/>
              <StatRow label="Samples"  value={`${(selection.endSample-selection.startSample).toLocaleString()}`}/>
              {selMono&&<StatRow label="RMS" value={`${rmsDb(selMono).toFixed(1)} dB`}/>}
            </>}
          </div>

          {/* Speech Protection */}
          {protection&&<div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:protColor,marginBottom:3,letterSpacing:1}}>
              SPEECH PROTECTION: {protection.riskLevel}
            </div>
            {protection.nearestSpeechDistanceMs>=0&&(
              <StatRow label="Nearest speech" value={`${protection.nearestSpeechDistanceMs.toFixed(0)}ms`}
                color={protection.nearestSpeechDistanceMs>80?"#10b981":"#f59e0b"}/>
            )}
            {!protection.allowed&&<div style={{fontSize:8,color:"#ef4444",marginTop:3}}>
              ⛔ {protection.blockedReason}
            </div>}
            {protection.warnings.slice(0,2).map((w,i)=>(
              <div key={i} style={{fontSize:7,color:"#f59e0b",marginTop:2}}>⚠ {w}</div>
            ))}
          </div>}

          {/* Silence Clipboard */}
          <div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#8b5cf6",marginBottom:4,letterSpacing:1}}>SILENCE CLIPBOARD</div>
            <button onClick={handleCopyToClipboard} disabled={!selection||!activeBuffer}
              style={{width:"100%",background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:4,
                padding:"4px",cursor:"pointer",color:"#8b5cf6",fontSize:8,marginBottom:4,
                opacity:!selection||!activeBuffer?0.4:1}}>
              📋 Copy Selection
            </button>
            {clipboardEntries.length===0&&<div style={{fontSize:8,color:"#2a5a6a"}}>No clipboard entries</div>}
            {clipboardEntries.map(e=>(
              <div key={e.id} onClick={()=>setActiveClipboard(e)}
                style={{padding:"3px 6px",marginBottom:2,borderRadius:4,cursor:"pointer",
                  background:activeClipboard?.id===e.id?"#8b5cf622":"#050d14",
                  border:`1px solid ${activeClipboard?.id===e.id?"#8b5cf644":"#0a1a24"}`}}>
                <div style={{fontSize:8,color:"#a0c4cc"}}>{e.label}</div>
                <div style={{fontSize:7,color:e.purityScore>0.7?"#10b981":"#f59e0b"}}>
                  Purity {(e.purityScore*100).toFixed(0)}% · {e.profile.grainLibrary.length} grains
                </div>
              </div>
            ))}
          </div>

          {/* Replace Mode */}
          <div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4,letterSpacing:1}}>REPLACE MODE</div>
            {(["fill","blend","heal","replace","match_tone"] as ReplaceMode[]).map(m=>(
              <div key={m} onClick={()=>setReplaceMode(m)}
                style={{fontSize:8,padding:"2px 6px",marginBottom:2,borderRadius:3,cursor:"pointer",
                  background:replaceMode===m?"#22d3ee22":"transparent",
                  border:`1px solid ${replaceMode===m?"#22d3ee44":"transparent"}`,
                  color:replaceMode===m?"#22d3ee":"#4a8a9a"}}>
                {m.replace(/_/g," ").toUpperCase()}
              </div>
            ))}
          </div>

          {/* Paste Button */}
          <div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <button onClick={handlePaste}
              disabled={!selection||!activeClipboard||!activeBuffer||protection?.riskLevel==="BLOCKED"}
              style={{width:"100%",background:"#10b98122",border:"1px solid #10b98144",borderRadius:6,
                padding:"7px",cursor:"pointer",color:"#10b981",fontSize:10,fontWeight:700,
                opacity:(!selection||!activeClipboard||protection?.riskLevel==="BLOCKED")?0.4:1}}>
              ▶ Paste Clean Silence
            </button>
            <button onClick={handleHeal}
              disabled={!selection||!refProfile||!activeBuffer}
              style={{width:"100%",marginTop:4,background:"#8b5cf622",border:"1px solid #8b5cf644",
                borderRadius:6,padding:"6px",cursor:"pointer",color:"#8b5cf6",fontSize:9,fontWeight:700,
                opacity:(!selection||!refProfile)?0.4:1}}>
              🩹 Heal Region
            </button>
          </div>

          {/* Last Region QA */}
          {lastQA&&<div style={{padding:"8px 8px"}}>
            <div style={{fontSize:8,color:qaColor,marginBottom:4,letterSpacing:1}}>REGION QA</div>
            <QABadge result={lastQA}/>
          </div>}
        </div>
      </div>
    </div>
  );
}
