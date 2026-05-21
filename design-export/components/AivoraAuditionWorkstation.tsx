// @ts-nocheck
/**
 * AivoraAuditionWorkstation.tsx — Professional Audio Editor Workstation
 * Full editing workflow: Copy → Paste → Protect → QA → Export
 * Aivora Platform
 *
 * ─── AUDIO ENGINE REFACTOR ────────────────────────────────────────────
 *  BEFORE (broken):
 *    • loadAudio()  → new AudioContext() each call, never closed  (leak)
 *    • handlePlay() → new AudioContext() each call, never closed  (leak)
 *    • No position tracking, no seek, ⏹ was really just "stop from zero"
 *    • Download button buried / not independently accessible
 *
 *  AFTER (fixed):
 *    • One persistent AudioContext per session  (audioCtxRef)
 *    • Real pause/resume: position preserved in playOffsetRef
 *    • RAF loop updates playPositionMs every frame while playing
 *    • Click-to-seek progress bar in transport row
 *    • Session-ID guard on onended prevents stale closure races
 *    • "⬇ Download Enhanced WAV" button added to transport bar
 *    • All cleanup on unmount (RAF + source + AudioContext)
 *    • Playback resets on new file load
 *
 *  UI POLICY: every Tailwind class, inline style, color, and layout
 *  from the original is preserved exactly. Only the audio-engine
 *  wiring, refs, and transport bar JSX are changed.
 * ─────────────────────────────────────────────────────────────────────
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
import { runAdobeGate } from "../lib/audioForensics/adobeGate";
import { simulateAdobeQA } from "../lib/audioForensics/adobeQaSimulator";
import { verifySpeechPreservation } from "../lib/audioForensics/speechPreservation";
import type { GateResult } from "../lib/audioForensics/adobeGate";

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

    for(const r of repairedRegions){
      const x1=(r.startSample-startSample)/visLen*W;
      const x2=(r.endSample-startSample)/visLen*W;
      if(x2<0||x1>W) continue;
      ctx.fillStyle="rgba(16,185,129,0.12)";
      ctx.fillRect(x1,0,x2-x1,H);
      ctx.strokeStyle="#10b98144"; ctx.lineWidth=1;
      ctx.strokeRect(x1,0,x2-x1,H);
    }

    if(selection){
      const x1=(selection.startSample-startSample)/visLen*W;
      const x2=(selection.endSample-startSample)/visLen*W;
      ctx.fillStyle="rgba(34,211,238,0.15)";
      ctx.fillRect(x1,0,x2-x1,H);
      ctx.strokeStyle="#22d3ee"; ctx.lineWidth=1;
      ctx.strokeRect(x1,0,x2-x1,H);
      ctx.fillStyle="#22d3ee";
      ctx.fillRect(x1-2,0,4,H);
      ctx.fillRect(x2-2,0,4,H);
    }

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

  // ── NEW: playback position state (milliseconds) ─────────────────────
  const [playPositionMs,setPlayPositionMs]=useState<number>(0);

  const [forensics,setForensics]=useState<any>(null);
  const [refProfile,setRefProfile]=useState<any>(null);
  const [clipboardEntries,setClipboardEntries]=useState<ClipboardEntry[]>([]);
  const [activeClipboard,setActiveClipboard]=useState<ClipboardEntry|null>(null);
  const [editHistory,setEditHistory]=useState<EditEntry[]>([]);
  const [lastQA,setLastQA]=useState<RegionQAResult|null>(null);
  const [protection,setProtection]=useState<SpeechProtectionResult|null>(null);
  const [loading,setLoading]=useState("");
  const [gateResult,setGateResult]=useState<GateResult|null>(null);
  const [showRoundtrip,setShowRoundtrip]=useState(false);
  const [status,setStatus]=useState("");

  const targetRef=useRef<HTMLInputElement>(null);
  const refRef   =useRef<HTMLInputElement>(null);

  // ── NEW: persistent audio engine refs ──────────────────────────────
  // One AudioContext for the entire session — created on first user
  // gesture (file load or play), never recreated unless closed.
  const audioCtxRef   = useRef<AudioContext|null>(null);
  // The currently playing BufferSourceNode (null when stopped).
  const sourceRef     = useRef<AudioBufferSourceNode|null>(null);
  // audioCtx.currentTime at which the last play() call started.
  const playStartRef  = useRef<number>(0);
  // Seconds into the buffer from which the last play() started.
  // Preserved on pause so resume continues from the right place.
  const playOffsetRef = useRef<number>(0);
  // requestAnimationFrame handle for the position-update loop.
  const rafRef        = useRef<number>(0);
  // Incremented each time startPlayback() is called.
  // The onended + RAF closures compare against this to ignore stale
  // callbacks from a previous playback session (e.g. after seek).
  const playSessionRef= useRef<number>(0);
  // ────────────────────────────────────────────────────────────────────

  const activeBuffer=viewMode==="original"?originalBuffer??targetBuffer:editedBuffer??targetBuffer;
  const sr=activeBuffer?.sampleRate??44100;
  const totalSamples=activeBuffer?.length??0;
  const totalMs=(totalSamples/sr)*1000;
  const visStart=Math.floor(totalSamples*zoomStart);
  const visEnd  =Math.floor(totalSamples*zoomEnd);
  const visStartMs=(visStart/sr)*1000;
  const visEndMs  =(visEnd/sr)*1000;

  // ── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(()=>{
    return ()=>{
      cancelAnimationFrame(rafRef.current);
      try { sourceRef.current?.stop(); } catch {}
      audioCtxRef.current?.close();
    };
  },[]);

  // ── Audio Context Management ─────────────────────────────────────────
  // Returns the single shared AudioContext, creating it on first call.
  // Must be called inside a user-gesture handler so Safari/iOS allows it.
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state==="closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  // ── File Loading ─────────────────────────────────────────────────────
  // Uses the shared AudioContext so decoded buffers are compatible with
  // the playback graph — no cross-context issues.
  async function loadAudio(file:File): Promise<AudioBuffer> {
    const ctx = getAudioCtx();
    if (ctx.state==="suspended") await ctx.resume();
    return ctx.decodeAudioData(await file.arrayBuffer());
  }

  // ── Core Playback Primitives ─────────────────────────────────────────

  /**
   * Internal: start playing `buf` from `offsetSec` seconds.
   * Registers the RAF position loop and the session-guarded onended.
   */
  function startPlayback(buf: AudioBuffer, offsetSec: number): void {
    const ctx = getAudioCtx();
    if (ctx.state==="suspended"||ctx.state==="interrupted") ctx.resume();

    const sessionId = ++playSessionRef.current;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    // Clamp offset to valid range (avoid sub-millisecond overrun crash).
    const safeOffset = Math.max(0, Math.min(offsetSec, buf.duration - 0.001));
    playOffsetRef.current = safeOffset;
    playStartRef.current  = ctx.currentTime;
    src.start(0, safeOffset);

    // Session-guarded onended: fires for both natural end AND stop().
    // We only update state when the session is still current, which
    // prevents the old source's onended racing against new playback
    // that started immediately after a seek.
    src.onended = ()=>{
      if (playSessionRef.current !== sessionId) return; // stale — ignore
      cancelAnimationFrame(rafRef.current);
      // Natural end → reset position to start
      playOffsetRef.current = 0;
      setPlayPositionMs(0);
      setIsPlaying(false);
    };

    sourceRef.current = src;
    setIsPlaying(true);

    // RAF loop: updates playPositionMs every animation frame.
    function tick(){
      if (playSessionRef.current !== sessionId) return; // stale
      const c = audioCtxRef.current;
      if (!c) return;
      const elapsed = c.currentTime - playStartRef.current;
      const posMs = (safeOffset + elapsed) * 1000;
      setPlayPositionMs(Math.min(posMs, buf.duration * 1000));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  /**
   * Internal: stop the current source.
   * `preservePosition=true` → pause (keep offset for resume).
   * `preservePosition=false` → seek-stop (caller will set new offset).
   */
  function stopCurrent(preservePosition: boolean): void {
    // Increment session so onended/RAF from the old source are ignored.
    playSessionRef.current++;
    cancelAnimationFrame(rafRef.current);

    if (preservePosition && audioCtxRef.current) {
      const elapsed = audioCtxRef.current.currentTime - playStartRef.current;
      playOffsetRef.current = playOffsetRef.current + elapsed;
    }

    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    setIsPlaying(false);
  }

  // ── Public: Play / Pause ─────────────────────────────────────────────
  function handlePlay(): void {
    const buf = activeBuffer;
    if (!buf) return;

    if (isPlaying) {
      // Pause: stop and preserve position for resume.
      stopCurrent(true);
      return;
    }

    // Resume from paused position, or start from selection start,
    // or start from the beginning of the file.
    const resumeOffset =
      playOffsetRef.current > 0
        ? playOffsetRef.current
        : selection
          ? selection.startSample / sr
          : 0;

    startPlayback(buf, resumeOffset);
  }

  // ── Public: Seek (click on progress bar) ────────────────────────────
  function seekTo(seconds: number): void {
    const buf = activeBuffer;
    if (!buf) return;

    if (isPlaying) {
      stopCurrent(false); // discard old position
      startPlayback(buf, seconds);
    } else {
      playOffsetRef.current = seconds;
      setPlayPositionMs(seconds * 1000);
    }
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
    const p=checkSpeechProtection(buf,selection.startSample,selection.endSample);
    setProtection(p);
    if(!p.allowed){setStatus(`⛔ Blocked: ${p.blockedReason}`);return;}
    setLoading("Pasting clean silence...");
    await new Promise(r=>setTimeout(r,0));
    const result=replaceRegionWithClipboard(
      buf, selection.startSample, selection.endSample,
      activeClipboard, {mode:replaceMode, crossfadeMs:8, snapZeroCross:true}
    );
    const qa=runRegionQA(
      result.repairedBuffer,
      selection.startSample, selection.endSample,
      originalBuffer??targetBuffer??undefined
    );
    setLastQA(qa);
    setEditedBuffer(result.repairedBuffer);
    setRepairedRegions(prev=>[...prev,{
      startSample:selection.startSample,endSample:selection.endSample,
      startMs:selection.startMs,endMs:selection.endMs,
      durationMs:selection.durationMs,type:"repaired",
    }]);
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

  // ── Validate & Export ─────────────────────────────────────────────────────

  async function handleValidateFile(){
    if(!editedBuffer||!targetBuffer) return;
    setLoading("Validating...");
    await new Promise(r=>setTimeout(r,0));
    const qa=simulateAdobeQA({original:targetBuffer,repaired:editedBuffer,repairedRegionCount:repairedRegions.length,totalRepairedMs:repairedRegions.reduce((s,r)=>s+r.durationMs,0)});
    const sp=verifySpeechPreservation(targetBuffer,editedBuffer);
    const af=analyzeSilenceForensics(editedBuffer);
    const gate=runAdobeGate(qa,sp,af);
    setGateResult(gate);setShowRoundtrip(true);
    setStatus(gate.passed?"✅ Passed":"⚠ "+gate.gateStatus.replace(/_/g," "));
    setLoading("");
  }

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

  // ── Derived display values ─────────────────────────────────────────────────

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

  // Seek-bar progress: 0–1
  const playProgress = totalMs > 0 ? Math.min(playPositionMs / totalMs, 1) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",
      background:"#020810",fontFamily:"monospace",color:"#a0c4cc",overflow:"hidden"}}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
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
            const f=e.target.files?.[0]; if(!f) return;
            setTargetName(f.name);
            const buf=await loadAudio(f);
            // Stop any ongoing playback and reset position for new file.
            if (isPlaying) stopCurrent(false);
            playOffsetRef.current = 0;
            setPlayPositionMs(0);
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
            const f=e.target.files?.[0]; if(!f) return;
            setRefName(f.name); setRefBuffer(await loadAudio(f));
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

      {/* ── MAIN BODY ───────────────────────────────────────────────────── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* LEFT PANEL */}
        <div style={{width:190,background:"#030c14",borderRight:"1px solid #0f2a3a",
          display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>
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
          {forensics&&<div style={{padding:"8px 8px",borderBottom:"1px solid #0a1a24"}}>
            <div style={{fontSize:8,color:"#f59e0b",marginBottom:3,letterSpacing:1}}>FORENSICS</div>
            <StatRow label="Contaminated" value={`${forensics.contaminatedRegions.length}`}
              color={forensics.contaminatedRegions.length===0?"#10b981":"#ef4444"}/>
            <StatRow label="Purity" value={`${(forensics.overallPurityScore*100).toFixed(0)}%`}/>
            <StatRow label="Noise Floor" value={`${forensics.noiseFloorDb.toFixed(1)} dB`}/>
          </div>}
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

          {/* Overview strip */}
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

          {/* ── TRANSPORT BAR ─────────────────────────────────────────────── */}
          {/*  Changes from original:                                          */}
          {/*    1. ▶/⏸  instead of ▶/⏹  (it's now pause, not stop)          */}
          {/*    2. Position/duration display  e.g.  1.234s / 5.000s          */}
          {/*    3. Click-to-seek progress bar between play btn and duration   */}
          {/*    4. "⬇ Download Enhanced WAV" button (calls handleExport)      */}
          <div style={{height:34,background:"#030c14",borderTop:"1px solid #0a1a24",
            display:"flex",alignItems:"center",gap:6,padding:"0 10px",flexShrink:0}}>

            {/* Play / Pause button */}
            <button onClick={handlePlay}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:5,
                padding:"3px 14px",cursor:"pointer",color:"#22d3ee",fontSize:11,
                flexShrink:0}}>
              {isPlaying ? "⏸" : "▶"}
            </button>

            {/* Position / Duration text */}
            <span style={{fontSize:8,color:"#4a8a9a",flexShrink:0,minWidth:90,textAlign:"right"}}>
              {fmtTime(playPositionMs)}
              <span style={{color:"#1a4a5a"}}> / </span>
              {fmtTime(totalMs)}
            </span>

            {/* ── Seek / Progress bar ──────────────────────────────────── */}
            {/*  Click anywhere on the bar to jump to that position.         */}
            {/*  The cyan fill shows how far through the file we are.        */}
            <div
              onClick={e=>{
                if(!activeBuffer) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const fraction = Math.max(0, Math.min(1,
                  (e.clientX - rect.left) / rect.width
                ));
                seekTo(fraction * activeBuffer.duration);
              }}
              style={{flex:1,height:5,background:"#0a1a24",borderRadius:3,
                cursor:activeBuffer?"pointer":"default",position:"relative",overflow:"hidden"}}>
              {/* Filled progress */}
              <div style={{
                position:"absolute",left:0,top:0,bottom:0,
                width:`${playProgress*100}%`,
                background: isPlaying
                  ? "linear-gradient(90deg,#22d3ee,#0ea5e9)"
                  : "#1a4a5a",
                borderRadius:3,
                transition: isPlaying ? "none" : "width 0.1s ease",
              }}/>
              {/* Playhead handle */}
              {activeBuffer && (
                <div style={{
                  position:"absolute",
                  left:`calc(${playProgress*100}% - 3px)`,
                  top:-2, bottom:-2, width:6,
                  background:"#22d3ee",borderRadius:3,
                  boxShadow:"0 0 4px #22d3ee88",
                  pointerEvents:"none",
                }}/>
              )}
            </div>

            <div style={{width:1,height:14,background:"#0f2a3a",margin:"0 2px",flexShrink:0}}/>

            {/* Analyze button */}
            <button onClick={handleAnalyze} disabled={!activeBuffer}
              style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:4,
                padding:"2px 8px",cursor:"pointer",color:"#f59e0b",fontSize:8,
                opacity:!activeBuffer?0.4:1,flexShrink:0}}>
              🔬 Analyze
            </button>

            <button onClick={handleValidateFile} disabled={!editedBuffer||!targetBuffer}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:4,
                padding:"2px 8px",cursor:"pointer",color:"#22d3ee",fontSize:8,
                opacity:(!editedBuffer||!targetBuffer)?0.4:1,flexShrink:0}}>
              ✅ Validate
            </button>

            <button onClick={()=>setShowRoundtrip(v=>!v)} disabled={!gateResult}
              style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:4,
                padding:"2px 8px",cursor:"pointer",color:"#8b5cf6",fontSize:8,
                opacity:!gateResult?0.4:1,flexShrink:0}}>
              🎯 Roundtrip
            </button>

            {/* ── Download Enhanced WAV ─────────────────────────────────── */}
            {/*  Available as soon as any buffer is loaded.                   */}
            {/*  Uses editedBuffer when available, falls back to original.    */}
            <button
              onClick={handleExport}
              disabled={!targetBuffer}
              title={editedBuffer
                ? "Download the restored/edited buffer as 32-bit Float WAV"
                : "Download the original file as 32-bit Float WAV"}
              style={{
                background: editedBuffer ? "#10b98133" : "#10b98116",
                border:`1px solid ${editedBuffer?"#10b98166":"#10b98133"}`,
                borderRadius:5,
                padding:"3px 10px",
                cursor:targetBuffer?"pointer":"not-allowed",
                color: editedBuffer ? "#10b981" : "#4a8a9a",
                fontSize:9,
                fontWeight:700,
                opacity:!targetBuffer?0.35:1,
                flexShrink:0,
                display:"flex",alignItems:"center",gap:4,
                boxShadow: editedBuffer ? "0 0 8px #10b98144" : "none",
                transition:"box-shadow 0.2s",
              }}>
              ⬇ {editedBuffer ? "Download Enhanced WAV" : "Download WAV"}
            </button>

          </div>
          {/* ── END TRANSPORT BAR ─────────────────────────────────────────── */}

        </div>

        {/* RIGHT PANEL */}
        <div style={{width:200,background:"#030c14",borderLeft:"1px solid #0f2a3a",
          display:"flex",flexDirection:"column",overflow:"auto",flexShrink:0}}>
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
          {lastQA&&<div style={{padding:"8px 8px"}}>
            <div style={{fontSize:8,color:qaColor,marginBottom:4,letterSpacing:1}}>REGION QA</div>
            <QABadge result={lastQA}/>
          </div>}
        </div>
      </div>

      {/* ── ROUNDTRIP PANEL ─────────────────────────────────────────────── */}
      {showRoundtrip&&gateResult&&(
        <div style={{position:"fixed",top:40,right:0,bottom:0,width:260,background:"#030c14",
          borderLeft:"1px solid #0f2a3a",zIndex:100,overflow:"auto",padding:12}}>
          <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"#8b5cf6"}}>ROUNDTRIP READINESS</div>
            <button onClick={()=>setShowRoundtrip(false)}
              style={{marginLeft:"auto",background:"transparent",border:"none",color:"#4a8a9a",cursor:"pointer",fontSize:14}}>✕</button>
          </div>
          <div style={{padding:"8px",borderRadius:8,marginBottom:10,
            background:gateResult.passed?"#10b98122":"#ef444422",
            border:"1px solid "+(gateResult.passed?"#10b98144":"#ef444444")}}>
            <div style={{fontSize:11,fontWeight:700,color:gateResult.passed?"#10b981":"#ef4444"}}>
              {gateResult.gateStatus.replace(/_/g," ")}
            </div>
            <div style={{fontSize:7,color:"#4a8a9a"}}>Adobe-style QA — NOT official certification</div>
          </div>
          <PBar score={gateResult.scores.silenceRealism}     label="Silence Realism"/>
          <PBar score={1-gateResult.scores.seamRisk}         label="Seam Invisibility"/>
          <PBar score={gateResult.scores.speechPreservation} label="Speech Preserved"/>
          <PBar score={1-gateResult.scores.reviewerRisk}     label="Reviewer Safety"/>
          <PBar score={gateResult.scores.overallGate}        label="Overall Score"/>
          <div style={{marginTop:6}}>
            {gateResult.blockingReasons.map((r,i)=>(
              <div key={i} style={{fontSize:8,color:"#ef4444",marginBottom:2}}>✗ {r}</div>
            ))}
            {gateResult.warnings.map((w,i)=>(
              <div key={i} style={{fontSize:8,color:"#f59e0b",marginBottom:2}}>⚠ {w}</div>
            ))}
          </div>
          <div style={{marginTop:8,padding:"6px",background:"#040c14",borderRadius:6,border:"1px solid #0f2a3a"}}>
            <div style={{fontSize:8,fontWeight:700,color:gateResult.exportAllowed?"#10b981":"#ef4444"}}>
              {gateResult.exportAllowed?"✅ Export allowed":"⛔ Export blocked"}
            </div>
            {editedBuffer&&(
              <div style={{fontSize:7,color:"#22d3ee",marginTop:2}}>
                32-bit Float · {editedBuffer.sampleRate}Hz
              </div>
            )}
          </div>
          <button onClick={handleExport} disabled={!gateResult.exportAllowed}
            style={{marginTop:8,width:"100%",
              background:gateResult.exportAllowed?"#10b98122":"#0a1a24",
              border:"1px solid "+(gateResult.exportAllowed?"#10b98144":"#0f2a3a"),
              borderRadius:6,padding:"7px",
              cursor:gateResult.exportAllowed?"pointer":"not-allowed",
              color:gateResult.exportAllowed?"#10b981":"#2a5a6a",
              fontSize:10,fontWeight:700}}>
            {gateResult.exportAllowed?"⬇ Export 32-bit Float WAV":"⛔ Export Blocked"}
          </button>
        </div>
      )}

    </div>
  );
}
