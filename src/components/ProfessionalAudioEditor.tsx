// @ts-nocheck
/**
 * ProfessionalAudioEditor.tsx — Full Screen Adobe Audition Style Editor
 * Aivora Platform
 */
import React, { useRef, useEffect, useState, useCallback } from "react";
import { computeSpectrogramPro, drawSpectrogramPro } from "../lib/audioQc/spectrogramPro";
import { renderWaveform } from "../lib/audioEditor/waveformRenderer";
import { mixToMono } from "../lib/audioEditor/audioBufferUtils";
import { exportFloat32Wav, downloadWavBlob } from "../lib/audioForensics/floatWavExporter";
import { inspectCursor } from "../lib/audioEditor/cursorInspector";
import { drawSampleLevel } from "../lib/audioEditor/zoomEngine";
import { analyzeSilence, drawForensicOverlay } from "../lib/audioEditor/forensicSilenceOverlay";
import { analyzeForensicSilence, drawForensicSilenceOverlay, ForensicSilenceReport } from "../lib/audioEditor/forensicSilenceMode";

// ── File List Item ────────────────────────────────────────────────────────────

function FileListItem({ file, active, onClick }: {
  file: { name:string; duration:string; sr:string; size:string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      padding:"5px 8px", cursor:"pointer",
      background: active ? "#0d2a3a" : "transparent",
      borderLeft: active ? "2px solid #00cc66" : "2px solid transparent",
      borderBottom:"1px solid #0a1520",
    }}>
      <div style={{fontSize:10,color:active?"#00ff88":"#a0c4cc",
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>
        {file.name}
      </div>
      <div style={{display:"flex",gap:8,marginTop:2}}>
        <span style={{fontSize:8,color:"#2a5a6a"}}>{file.duration}</span>
        <span style={{fontSize:8,color:"#2a5a6a"}}>{file.sr}</span>
        <span style={{fontSize:8,color:"#2a5a6a"}}>{file.size}</span>
      </div>
    </div>
  );
}

// ── dB Meter ──────────────────────────────────────────────────────────────────

function DbMeter({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(100, (level + 60) / 60 * 100));
  const color = level > -6 ? "#ef4444" : level > -18 ? "#f59e0b" : "#00cc66";
  return (
    <div style={{width:8,height:"100%",background:"#050a0f",
      border:"1px solid #0a1520",borderRadius:2,overflow:"hidden",
      display:"flex",flexDirection:"column-reverse"}}>
      <div style={{width:"100%",height:`${pct}%`,background:color,
        transition:"height 0.05s"}}/>
    </div>
  );
}

// ── Main Editor ───────────────────────────────────────────────────────────────

class EditorErrorBoundary extends React.Component<{children:React.ReactNode},{error:string|null}> {
  constructor(props:any){super(props);this.state={error:null};}
  static getDerivedStateFromError(e:any){return {error:String(e)};}
  render(){
    if(this.state.error) return (
      <div style={{padding:40,color:"#ef4444",fontFamily:"monospace",background:"#040a10",height:"100%"}}>
        <div style={{fontSize:14,marginBottom:8}}>⚠ Editor Error</div>
        <div style={{fontSize:10,color:"#a0c4cc"}}>{this.state.error}</div>
        <button onClick={()=>this.setState({error:null})}
          style={{marginTop:16,padding:"6px 16px",background:"#0d2030",border:"1px solid #1a3a5a",
            color:"#00cc66",borderRadius:4,cursor:"pointer",fontFamily:"inherit"}}>
          Retry
        </button>
      </div>
    );
    return this.props.children;
  }
}


function ProfessionalAudioEditorInner() {
  const [files,      setFiles]      = useState<File[]>([]);
  const [activeIdx,  setActiveIdx]  = useState(0);
  const [buffer,     setBuffer]     = useState<AudioBuffer|null>(null);
  const [mono,       setMono]       = useState<Float32Array|null>(null);
  const [zoom,       setZoom]       = useState(100);
  const [panOffset,  setPanOffset]  = useState(0);
  const [playhead,   setPlayhead]   = useState(0);
  const [selection,  setSelection]  = useState<{start:number;end:number}|null>(null);
  const [playing,    setPlaying]    = useState(false);
  const [level,      setLevel]      = useState(-60);
  const [fftSize,    setFftSize]    = useState(4096);
  const [colorMap,   setColorMap]   = useState<"aivora"|"plasma"|"inferno">("plasma");
  const [waveH,      setWaveH]      = useState(220);
  const [specH,      setSpecH]      = useState(200);
  const [showLeft,   setShowLeft]   = useState(true);
  const [forensicMode, setForensicMode] = useState(false);
  const [cursorInfo,   setCursorInfo]   = useState<any>(null);
  const [forensicData, setForensicData] = useState<any>(null);
  const [diffMode,       setDiffMode]       = useState(false);
  const [origMono,       setOrigMono]       = useState<Float32Array|null>(null);
  const [silenceReport,  setSilenceReport]  = useState<ForensicSilenceReport|null>(null);
  const [silenceMode,    setSilenceMode]    = useState(false);

  const waveRef    = useRef<HTMLCanvasElement>(null);

  // Fill canvases with dark background on mount
  useEffect(()=>{
    if(waveRef.current){
      const ctx=waveRef.current.getContext("2d");
      if(ctx){ctx.fillStyle="#070d14";ctx.fillRect(0,0,waveRef.current.width||800,waveRef.current.height||220);}
    }
    if(specRef.current){
      const ctx=specRef.current.getContext("2d");
      if(ctx){ctx.fillStyle="#040a10";ctx.fillRect(0,0,specRef.current.width||800,specRef.current.height||200);}
    }
  },[]);
  const specRef    = useRef<HTMLCanvasElement>(null);
  const mainRef    = useRef<HTMLDivElement>(null);
  const dragRef    = useRef({active:false,startX:0,startSel:null as any});
  const sourceRef  = useRef<AudioBufferSourceNode|null>(null);
  const ctxRef     = useRef<AudioContext|null>(null);
  const rafRef     = useRef(0);
  const startTimeRef = useRef(0);
  const startOffRef  = useRef(0);

  const duration = buffer?.duration ?? 0;
  const sr       = buffer?.sampleRate ?? 48000;

  // ── Load files ──────────────────────────────────────────────────────────────

  async function loadFile(file: File) {
    try {
    const ab  = await file.arrayBuffer();
    if(!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const m   = new Float32Array(buf.length);
    for(let ch=0;ch<buf.numberOfChannels;ch++){
      const d=buf.getChannelData(ch);
      for(let i=0;i<buf.length;i++) m[i]+=d[i];
    }
    if(buf.numberOfChannels>1) for(let i=0;i<m.length;i++) m[i]/=buf.numberOfChannels;
    bufferIdRef.current += 1;
    setBuffer(buf);
    setMono(m);
    const fd = analyzeSilence(m, buf.sampleRate);
    setForensicData(fd);
    setOrigMono(prev => prev === null ? m : prev);
    const sr2 = analyzeForensicSilence(m, buf.sampleRate);
    setSilenceReport(sr2);
    setZoom(Math.max(10,mainRef.current?.clientWidth??800/buf.duration));
    setPanOffset(0);
    setPlayhead(0);
    setSelection(null);
    } catch(err) {
      console.error("loadFile error:", err);
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files??[]);
    if(!newFiles.length) return;
    setFiles(prev=>[...prev,...newFiles]);
    await loadFile(newFiles[0]);
    setActiveIdx(prev=>prev+files.length);
  }

  // ── Draw Waveform ───────────────────────────────────────────────────────────

  useEffect(()=>{
    if(!waveRef.current||!mono) return;
    const W=mainRef.current?.clientWidth??800;
    renderWaveform(waveRef.current, {
      mono, sampleRate:sr, duration, zoom, panOffset,
      playheadSec:playhead, selection,
      qcMarkers:[], width:W, height:waveH,
      theme:{
        bg:"#040a10",
        grid:"#0a1520",
        wave:"#00cc66",
        playhead:"#f59e0b",
        selection:"rgba(34,211,238,0.15)",
        ruler:"#030810",
        rulerText:"#2a5a6a",
      },
    });
    // Sample-level overlay at deep zoom
    const sampleLevel = zoom > (sr * 0.05);
    if(sampleLevel && mono) {
      drawSampleLevel(waveRef.current, mono, sr, zoom, panOffset, waveH, playhead);
    }
  },[mono,zoom,panOffset,playhead,selection,waveH]);

  // ── Draw Forensic Overlay ────────────────────────────────────────────────
  useEffect(()=>{
    if(!waveRef.current||!forensicData||!forensicMode) return;
    const W = mainRef.current?.clientWidth ?? 800;
    drawForensicOverlay(waveRef.current, forensicData, {
      zoom, panOffset, height: waveH, width: W, duration,
    });
  },[forensicData,forensicMode,zoom,panOffset,waveH]);

  // ── Draw Forensic Silence Overlay ────────────────────────────────────────
  useEffect(()=>{
    if(!waveRef.current||!silenceReport||!silenceMode) return;
    const W = mainRef.current?.clientWidth ?? 800;
    drawForensicSilenceOverlay(waveRef.current, silenceReport, {
      zoom, panOffset, height: waveH, width: W,
    });
  },[silenceReport,silenceMode,zoom,panOffset,waveH]);

  // ── Difference View ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!waveRef.current||!mono||!origMono||!diffMode) return;
    const W = mainRef.current?.clientWidth ?? 800;
    const canvas = waveRef.current;
    const ctx = canvas.getContext("2d");
    if(!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const RULER_H = 24;
    const WAVE_H  = waveH - RULER_H;
    const centerY = RULER_H + WAVE_H / 2;
    const startSample = Math.floor(panOffset * sr);
    const endSample   = Math.min(mono.length, Math.ceil((panOffset + W/zoom) * sr));
    const samplesPerPixel = Math.max(1,(endSample-startSample)/W);

    for(let px=0;px<W;px++){
      const s0 = Math.floor(startSample + px*samplesPerPixel);
      const s1 = Math.min(Math.floor(s0+samplesPerPixel)+1, mono.length);
      let diffPeak=0, isSpeech=false;
      for(let i=s0;i<s1;i++){
        const d = Math.abs((mono[i]??0)-(origMono[i]??0));
        if(d>diffPeak) diffPeak=d;
        if(Math.abs(mono[i]??0)>0.01) isSpeech=true;
      }
      if(diffPeak>0.001){
        const h = diffPeak*(WAVE_H/2-4)*4;
        ctx.fillStyle = isSpeech
          ? `rgba(239,68,68,${Math.min(0.8,diffPeak*10)})`
          : `rgba(0,255,136,${Math.min(0.8,diffPeak*10)})`;
        ctx.fillRect(px, centerY-h, 1, h*2);
      }
    }
  },[mono,origMono,diffMode,zoom,panOffset,waveH]);

  // ── Draw Spectrogram ─────────────────────────────────────────────────────

  const specCacheRef = useRef<{canvas:HTMLCanvasElement;fftSize:number;colorMap:string;bufferId:number}|null>(null);
  const bufferIdRef  = useRef(0);

  useEffect(()=>{
    if(!specRef.current||!buffer) return;
    const W=mainRef.current?.clientWidth??800;
    specRef.current.width  = W;
    specRef.current.height = specH;
    const ctx=specRef.current.getContext("2d");
    if(!ctx) return;

    // Recompute spectrogram only if buffer/fft/colormap changed
    const bid = bufferIdRef.current;
    if(!specCacheRef.current ||
       specCacheRef.current.fftSize   !== fftSize ||
       specCacheRef.current.colorMap  !== colorMap ||
       specCacheRef.current.bufferId  !== bid) {

      const fullW = Math.max(4096, Math.floor(buffer.duration * zoom * 2));
      const offscreen = document.createElement("canvas");
      offscreen.width  = fullW;
      offscreen.height = specH;
      const spec = computeSpectrogramPro(buffer,{fftSize,minDb:-90,maxDb:-10,gain:1.4,colorMap});
      drawSpectrogramPro(offscreen,spec,{colorMap,gain:1.4,logFreq:true,showGrid:true,showLabels:true});
      specCacheRef.current = {canvas:offscreen, fftSize, colorMap, bufferId:bid};
    }

    const offscreen = specCacheRef.current!.canvas;
    const fullW = offscreen.width;

    // Crop to current viewport
    const startFrac = panOffset / duration;
    const visibleSec = W / zoom;
    const endFrac   = Math.min(1, (panOffset + visibleSec) / duration);
    const srcX = startFrac * fullW;
    const srcW = (endFrac - startFrac) * fullW;

    ctx.clearRect(0,0,W,specH);
    if(srcW > 0) ctx.drawImage(offscreen, srcX, 0, srcW, specH, 0, 0, W, specH);

    // Hz Labels on canvas
    const nyquist = (buffer?.sampleRate ?? 48000) / 2;
    const hzLabels = [16000,8000,4000,2000,1000,500,200,100,50];
    const logMin = Math.log10(20);
    const logMax = Math.log10(nyquist);
    hzLabels.forEach(hz => {
      if(hz > nyquist) return;
      const yPos = specH - ((Math.log10(hz) - logMin) / (logMax - logMin)) * specH;
      ctx.strokeStyle = "rgba(100,160,184,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2,4]);
      ctx.beginPath(); ctx.moveTo(36,yPos); ctx.lineTo(W,yPos); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(100,160,184,0.9)";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      const label = hz >= 1000 ? `${hz/1000}k` : `${hz}`;
      ctx.fillStyle = "rgba(3,8,16,0.7)";
      ctx.fillRect(2, yPos-9, 32, 11);
      ctx.fillStyle = "rgba(100,160,184,0.9)";
      ctx.fillText(label, 3, yPos);
    });

    // Playhead
    const phx=(playhead-panOffset)*zoom;
    if(phx>=0&&phx<=W){
      ctx.strokeStyle="#f59e0b";
      ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(phx,0);ctx.lineTo(phx,specH);ctx.stroke();
    }

    // Selection
    if(selection){
      const sx=(selection.start-panOffset)*zoom;
      const ex=(selection.end-panOffset)*zoom;
      ctx.fillStyle="rgba(34,211,238,0.12)";
      ctx.fillRect(sx,0,ex-sx,specH);
      ctx.strokeStyle="#22d3ee";
      ctx.lineWidth=1;
      ctx.strokeRect(sx,0,ex-sx,specH);
    }
  },[buffer,zoom,panOffset,playhead,selection,fftSize,colorMap,specH]);

  // ── Mouse on Waveform ────────────────────────────────────────────────────────

  function getSec(e: React.MouseEvent): number {
    const rect=waveRef.current!.getBoundingClientRect();
    const x=e.clientX-rect.left;
    return panOffset+x/zoom;
  }

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current={active:true,startX:getSec(e),startSel:null};
  }
  function onMouseMove(e: React.MouseEvent) {
    // Cursor inspector
    if(mono && buffer) {
      const sec = getSec(e);
      if(sec >= 0 && sec <= duration) {
        const info = inspectCursor(mono, buffer.sampleRate, sec, 512);
        setCursorInfo(info);
      }
    }
    if(!dragRef.current.active) return;
    const cur=getSec(e);
    const start=Math.min(dragRef.current.startX,cur);
    const end  =Math.max(dragRef.current.startX,cur);
    setSelection({start,end});
  }
  function onMouseUp() { dragRef.current.active=false; }

  // ── Touch Pan ────────────────────────────────────────────────────────────
  const touchRef = useRef<{x:number; pan:number}|null>(null);

  function onTouchStart(e: React.TouchEvent) {
    touchRef.current = {x: e.touches[0].clientX, pan: panOffset};
  }
  function onTouchMove(e: React.TouchEvent) {
    if(!touchRef.current) return;
    const dx = e.touches[0].clientX - touchRef.current.x;
    const newPan = Math.max(0, Math.min(Math.max(0,duration-1), touchRef.current.pan - dx/zoom));
    setPanOffset(newPan);
  }
  function onTouchEnd() { touchRef.current = null; }

  // ── Scroll zoom ──────────────────────────────────────────────────────────────

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    if(e.ctrlKey||e.metaKey){
      // Zoom centered on cursor
      const rect = waveRef.current?.getBoundingClientRect();
      const cursorX = rect ? e.clientX - rect.left : 0;
      const cursorSec = panOffset + cursorX / zoom;
      const factor = e.deltaY > 0 ? 0.8 : 1.25;
      const newZoom = Math.max(5, Math.min(5000, zoom * factor));
      const newPan  = Math.max(0, cursorSec - cursorX / newZoom);
      setZoom(newZoom);
      setPanOffset(newPan);
    } else {
      const delta = e.deltaY / zoom * 0.8;
      setPanOffset(p=>Math.max(0,Math.min(Math.max(0,duration-1),p+delta)));
    }
  }

  // ── Playback ─────────────────────────────────────────────────────────────────

  function stopPlay() {
    try{sourceRef.current?.stop();}catch{}
    sourceRef.current=null;
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }

  function play(startSec=startOffRef.current) {
    if(!buffer) return;
    stopPlay();
    const actx = new AudioContext();
    const src=actx.createBufferSource();
    src.buffer=buffer;

    // Level meter
    const analyser=actx.createAnalyser();
    analyser.fftSize=256;
    src.connect(analyser);
    analyser.connect(actx.destination);

    const endSec=selection?selection.end:duration;
    src.start(0,startSec,endSec-startSec);
    src.onended=stopPlay;
    sourceRef.current=src;
    startTimeRef.current=actx.currentTime;
    startOffRef.current=startSec;
    setPlaying(true);

    const data=new Float32Array(analyser.frequencyBinCount);
    function tick(){
      if(!actx) return;
      const elapsed=actx.currentTime-startTimeRef.current;
      const pos=startSec+elapsed;
      setPlayhead(Math.min(pos,duration));

      analyser.getFloatTimeDomainData(data);
      let peak=0;
      for(let i=0;i<data.length;i++) if(Math.abs(data[i])>peak) peak=Math.abs(data[i]);
      setLevel(peak>0?20*Math.log10(peak):-60);

      // Auto-scroll
      const W=mainRef.current?.clientWidth??800;
      if(pos>panOffset+W/zoom*0.8)
        setPanOffset(pos-W/zoom*0.2);

      if(pos<duration) rafRef.current=requestAnimationFrame(tick);
    }
    rafRef.current=requestAnimationFrame(tick);
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      if(e.target instanceof HTMLInputElement) return;
      if(e.key===" "){e.preventDefault();playing?stopPlay():play();}
      if(e.key==="="||e.key==="+") setZoom(z=>Math.min(5000,z*1.3));
      if(e.key==="-") setZoom(z=>Math.max(5,z/1.3));
      if(e.key==="0"){setPanOffset(0);setZoom(Math.max(10,(mainRef.current?.clientWidth??800)/Math.max(1,duration)));}
    }
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[playing,duration]);

  // ── Export ───────────────────────────────────────────────────────────────────

  function handleExport() {
    if(!buffer) return;
    const r=exportFloat32Wav(buffer,files[activeIdx]?.name||"export.wav");
    downloadWavBlob(r.blob,r.filename);
  }

  // ── File info ─────────────────────────────────────────────────────────────────

  function fmtDur(s:number){
    const m=Math.floor(s/60);
    return `${m}:${(s%60).toFixed(3).padStart(6,"0")}`;
  }

  const selInfo = selection
    ? `${fmtDur(selection.start)} → ${fmtDur(selection.end)}  |  ${fmtDur(selection.end-selection.start)}`
    : "No selection";

  const LEFT_W = showLeft ? 210 : 0;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",
      background:"#040a10",fontFamily:"'JetBrains Mono',monospace",
      color:"#a0c4cc",overflow:"hidden"}}>

      {/* ── TOP TOOLBAR ─────────────────────────────────────────────────────── */}
      <div style={{height:36,background:"#030810",borderBottom:"1px solid #0a1520",
        display:"flex",alignItems:"center",gap:4,padding:"0 6px",flexShrink:0,
        overflowX:"auto",overflowY:"hidden"}}>

        {/* File input */}
        <label style={{background:"#0d2030",border:"1px solid #1a3a5a",borderRadius:4,
          padding:"3px 10px",cursor:"pointer",fontSize:9,color:"#0EA5E9",fontWeight:600}}>
          + Open WAV
          <input type="file" accept=".wav" multiple style={{display:"none"}}
            onChange={handleFileInput}/>
        </label>

        <div style={{width:1,height:18,background:"#0a1520",margin:"0 4px"}}/>

        {/* Transport */}
        {[
          {icon:"⏮",action:()=>{stopPlay();setPlayhead(0);startOffRef.current=0;}},
          {icon:playing?"⏸":"▶",action:()=>playing?stopPlay():play(selection?.start??playhead)},
          {icon:"⏹",action:stopPlay},
          {icon:"⏭",action:()=>{stopPlay();setPlayhead(duration);startOffRef.current=duration;}},
        ].map(({icon,action})=>(
          <button key={icon} onClick={action}
            style={{background:"#0d2030",border:"1px solid #1a3a5a",borderRadius:4,
              padding:"3px 8px",cursor:"pointer",color:"#00cc66",
              fontSize:13,fontFamily:"inherit"}}>
            {icon}
          </button>
        ))}

        <div style={{width:1,height:18,background:"#0a1520",margin:"0 4px"}}/>

        {/* Zoom */}
        <span style={{fontSize:8,color:"#2a5a6a"}}>ZOOM</span>
        {[["−",()=>setZoom(z=>Math.max(5,z/1.5))],
          ["Fit",()=>setZoom(Math.max(10,(mainRef.current?.clientWidth??800)/Math.max(1,duration)))],
          ["+",()=>setZoom(z=>Math.min(5000,z*1.5))]
        ].map(([l,a])=>(
          <button key={l} onClick={a as ()=>void}
            style={{background:"#0d2030",border:"1px solid #1a3a5a",borderRadius:4,
              padding:"2px 8px",cursor:"pointer",color:"#64A0B8",fontSize:9,fontFamily:"inherit"}}>
            {l}
          </button>
        ))}

        <div style={{width:1,height:18,background:"#0a1520",margin:"0 4px"}}/>

        {/* FFT */}
        <span style={{fontSize:8,color:"#2a5a6a"}}>FFT</span>
        {[1024,2048,4096,8192].map(s=>(
          <div key={s} onClick={()=>setFftSize(s)}
            style={{fontSize:8,padding:"2px 6px",borderRadius:3,cursor:"pointer",
              background:fftSize===s?"#0EA5E922":"transparent",
              color:fftSize===s?"#0EA5E9":"#2a5a6a"}}>
            {s}
          </div>
        ))}

        <div style={{width:1,height:18,background:"#0a1520",margin:"0 4px"}}/>

        {/* Colormap */}
        <span style={{fontSize:8,color:"#2a5a6a"}}>MAP</span>
        {(["plasma","inferno","aivora","forensic"] as const).map(m=>(
          <div key={m} onClick={()=>setColorMap(m)}
            style={{fontSize:8,padding:"2px 6px",borderRadius:3,cursor:"pointer",
              background:colorMap===m?"#8B5CF622":"transparent",
              color:colorMap===m?"#8B5CF6":"#2a5a6a"}}>
            {m}
          </div>
        ))}

        <div style={{flex:1}}/>

        <button onClick={()=>setDiffMode(v=>!v)}
          style={{background:diffMode?"#8B5CF622":"transparent",
            border:`1px solid ${diffMode?"#8B5CF6":"#1a3a5a"}`,borderRadius:4,
            padding:"3px 10px",cursor:"pointer",
            color:diffMode?"#8B5CF6":"#4a6a7a",
            fontSize:9,fontFamily:"inherit"}}>
          ⚡ Diff
        </button>

        <button onClick={()=>setForensicMode(v=>!v)}
          style={{background:forensicMode?"#ef444422":"transparent",
            border:`1px solid ${forensicMode?"#ef4444":"#1a3a5a"}`,borderRadius:4,
            padding:"3px 10px",cursor:"pointer",
            color:forensicMode?"#ef4444":"#4a6a7a",
            fontSize:9,fontFamily:"inherit"}}>
          🔬 Forensic
        </button>

        <button onClick={()=>setSilenceMode(v=>!v)}
          style={{background:silenceMode?"#f59e0b22":"transparent",
            border:`1px solid ${silenceMode?"#f59e0b":"#1a3a5a"}`,borderRadius:4,
            padding:"3px 10px",cursor:"pointer",
            color:silenceMode?"#f59e0b":"#4a6a7a",
            fontSize:9,fontFamily:"inherit"}}>
          🔍 Silence
        </button>

        {silenceReport&&silenceMode&&<div style={{fontSize:8,color:"#4a6a7a",
          display:"flex",gap:8,alignItems:"center"}}>
          <span style={{color:silenceReport.contaminationPct>20?"#ef4444":"#00cc66"}}>
            {silenceReport.contaminationPct.toFixed(0)}% contaminated
          </span>
          <span>floor:{silenceReport.noiseFloorDb.toFixed(0)}dB</span>
          {silenceReport.humBands.length>0&&
            <span style={{color:"#ef4444"}}>⚠ HUM {silenceReport.humBands.join("/")}Hz</span>}
        </div>}

        <button onClick={handleExport} disabled={!buffer}
          style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:4,
            padding:"3px 10px",cursor:"pointer",color:"#10b981",fontSize:9,
            fontFamily:"inherit",opacity:!buffer?0.4:1}}>
          ⬇ Export 32-bit Float
        </button>

        <button onClick={()=>setOrigMono(null)} disabled={!buffer}
          style={{background:"transparent",border:"1px solid #1a3a5a",borderRadius:4,
            padding:"3px 8px",cursor:"pointer",color:"#4a6a7a",fontSize:9,fontFamily:"inherit"}}>
          ↺ Reset
        </button>

        <button onClick={()=>setShowLeft(v=>!v)}
          style={{background:"transparent",border:"1px solid #1a3a5a",borderRadius:4,
            padding:"3px 8px",cursor:"pointer",color:"#4a6a7a",fontSize:9,fontFamily:"inherit"}}>
          {showLeft?"◀ Files":"▶ Files"}
        </button>
      </div>

      {/* ── MAIN AREA ───────────────────────────────────────────────────────── */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* ── LEFT FILE LIST ─────────────────────────────────────────────── */}
        {showLeft&&<div style={{width:LEFT_W,flexShrink:0,
          background:"#030810",borderRight:"1px solid #0a1520",
          display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Header */}
          <div style={{padding:"6px 8px",borderBottom:"1px solid #0a1520",
            fontSize:8,color:"#2a5a6a",letterSpacing:2,display:"flex",
            justifyContent:"space-between",alignItems:"center"}}>
            <span>FILES ({files.length})</span>
            <span style={{color:"#4a6a7a"}}>STATUS · DURATION</span>
          </div>

          {/* File list */}
          <div style={{flex:1,overflowY:"auto"}}>
            {files.length===0&&(
              <div style={{padding:16,textAlign:"center",color:"#1a3a4a",fontSize:10}}>
                Open WAV files to start
              </div>
            )}
            {files.map((f,i)=>(
              <FileListItem key={i}
                file={{
                  name:f.name,
                  duration:buffer&&i===activeIdx?fmtDur(duration):"—",
                  sr:buffer&&i===activeIdx?`${sr}Hz`:"—",
                  size:`${(f.size/1024).toFixed(0)}KB`,
                }}
                active={i===activeIdx}
                onClick={async()=>{setActiveIdx(i);await loadFile(f);}}
              />
            ))}
          </div>

          {/* File properties */}
          {buffer&&<div style={{padding:"8px",borderTop:"1px solid #0a1520",fontSize:8}}>
            <div style={{color:"#2a5a6a",letterSpacing:1,marginBottom:4}}>PROPERTIES</div>
            {[
              ["Duration",  fmtDur(duration)],
              ["Sample Rate",`${sr} Hz`],
              ["Channels",  `${buffer.numberOfChannels}`],
              ["Bit Depth", "32-bit Float"],
              ["Format",    "WAV IEEE Float"],
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",
                marginBottom:2,padding:"1px 0",borderBottom:"1px solid #0a1520"}}>
                <span style={{color:"#2a5a6a"}}>{k}</span>
                <span style={{color:"#64A0B8"}}>{v}</span>
              </div>
            ))}
          </div>}
        </div>}

        {/* ── EDITOR CENTER ──────────────────────────────────────────────── */}
        <div ref={mainRef} style={{flex:1,display:"flex",flexDirection:"column",
          overflow:"hidden",position:"relative"}}>

          {!buffer&&<div style={{flex:1,display:"flex",alignItems:"center",
            justifyContent:"center",flexDirection:"column",gap:12,opacity:0.3}}>
            <div style={{fontSize:40}}>🎵</div>
            <div style={{fontSize:12,color:"#4a6a7a"}}>Open a WAV file to start editing</div>
            <div style={{fontSize:9,color:"#2a5a6a"}}>SPACE = Play  +/- = Zoom  Scroll = Pan</div>
          </div>}

          {buffer&&<>
            {/* Waveform */}
            <div style={{height:waveH,flexShrink:0,position:"relative",
              cursor:"crosshair",userSelect:"none"}}
              onWheel={onWheel}>
              <canvas ref={waveRef}
                style={{display:"block",width:"100%",height:"100%",background:"#070d14"}}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}/>
            </div>

            {/* Divider — resize handle */}
            <div style={{height:4,background:"#0a1520",cursor:"row-resize",
              flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}
              onMouseDown={e=>{
                const startY=e.clientY;
                const startH=waveH;
                const onMove=(ev:MouseEvent)=>{
                  setWaveH(Math.max(80,Math.min(500,startH+ev.clientY-startY)));
                };
                const onUp=()=>{
                  window.removeEventListener("mousemove",onMove);
                  window.removeEventListener("mouseup",onUp);
                };
                window.addEventListener("mousemove",onMove);
                window.addEventListener("mouseup",onUp);
              }}>
              <div style={{width:40,height:2,background:"#1a3a5a",borderRadius:1}}/>
            </div>

            {/* Spectrogram */}
            <div style={{flex:1,position:"relative",overflow:"hidden",
              minHeight:80}}>
              <canvas ref={specRef}
                style={{display:"block",width:"100%",height:"100%",background:"#040a10"}}
                onWheel={onWheel}/>
              {/* Freq label */}
              <div style={{position:"absolute",top:4,right:40,
                fontSize:7,color:"rgba(100,160,184,0.5)",letterSpacing:1}}>
                Hz
              </div>
            </div>
          </>}
        </div>

        {/* ── RIGHT LEVEL METER ──────────────────────────────────────────── */}
        <div style={{width:24,flexShrink:0,background:"#030810",
          borderLeft:"1px solid #0a1520",padding:"4px 4px",
          display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
          <div style={{fontSize:6,color:"#1a3a4a",letterSpacing:1,
            writingMode:"vertical-rl",transform:"rotate(180deg)",
            marginBottom:4}}>LEVEL</div>
          <DbMeter level={level}/>
          <div style={{fontSize:7,color:level>-6?"#ef4444":level>-18?"#f59e0b":"#2a5a6a",
            marginTop:4}}>
            {level.toFixed(0)}
          </div>
        </div>
      </div>

      {/* ── CURSOR INSPECTOR ───────────────────────────────────────────────── */}
      {cursorInfo&&<div style={{height:22,background:"#020609",
        borderTop:"1px solid #0a1520",display:"flex",alignItems:"center",
        padding:"0 12px",gap:16,flexShrink:0,fontSize:8,color:"#4a8a9a"}}>
        <span style={{color:"#00cc66"}}>⏱ {cursorInfo.smpte}</span>
        <span>PEAK: <span style={{color:cursorInfo.peakDb>-6?"#ef4444":cursorInfo.peakDb>-18?"#f59e0b":"#00cc66"}}>{cursorInfo.peakDb.toFixed(1)}dB</span></span>
        <span>RMS: <span style={{color:"#64A0B8"}}>{cursorInfo.rmsDb.toFixed(1)}dB</span></span>
        <span>FREQ: <span style={{color:"#8B5CF6"}}>{cursorInfo.dominantHz.toFixed(0)}Hz</span></span>
        <span>IDX: <span style={{color:"#2a5a6a"}}>{cursorInfo.sampleIndex.toLocaleString()}</span></span>
        {cursorInfo.humPresence&&<span style={{color:"#ef4444"}}>⚠ HUM DETECTED</span>}
      </div>}

      {/* ── BOTTOM STATUS BAR ───────────────────────────────────────────────── */}
      <div style={{height:28,background:"#030810",borderTop:"1px solid #0a1520",
        display:"flex",alignItems:"center",padding:"0 12px",gap:16,flexShrink:0}}>

        {/* Time display */}
        <div style={{fontSize:11,color:"#00cc66",fontWeight:700,letterSpacing:1,
          minWidth:80}}>
          {fmtDur(playhead)}
        </div>

        {/* Selection */}
        <div style={{fontSize:8,color:"#2a5a6a"}}>
          SEL: <span style={{color:"#4a8a9a"}}>{selInfo}</span>
        </div>

        <div style={{flex:1}}/>

        {/* File info */}
        {buffer&&<div style={{display:"flex",gap:12,fontSize:8,color:"#2a5a6a"}}>
          <span>{sr}Hz</span>
          <span>{buffer.numberOfChannels}ch</span>
          <span>32-bit Float (IEEE)</span>
          <span style={{color:zoom>sr*0.05?"#00ff88":"#2a5a6a"}}>
            {zoom>sr*0.05?"⬤ SAMPLE":"●"} Zoom: {zoom.toFixed(0)}px/s
          </span>
        </div>}

        {/* Keyboard hints */}
        <div style={{fontSize:7,color:"#1a3a4a",letterSpacing:1}}>
          SPACE=Play  ±=Zoom  Scroll=Pan  Drag=Select
        </div>
      </div>
    </div>
  );
}

export default function ProfessionalAudioEditor() {
  return <EditorErrorBoundary><ProfessionalAudioEditorInner/></EditorErrorBoundary>;
}
