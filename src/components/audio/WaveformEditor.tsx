// @ts-nocheck
/**
 * WaveformEditor.tsx — Adobe-style Waveform Workstation
 * Aivora Platform — Batch A
 */
import React, { useRef, useEffect, useState, useCallback } from "react";
import { renderWaveform, type QCMarker } from "../../lib/audioEditor/waveformRenderer";
import { xToTime, timeToX, snapToZeroCrossing } from "../../lib/audioEditor/regionEditor";
import { mixToMono, formatTime } from "../../lib/audioEditor/audioBufferUtils";
import { computeSpectrogram, drawSpectrogram } from "../../lib/audioQc/spectrogram";

const THEME = {
  bg:        "#040c14",
  wave:      "#22d3ee",
  waveAlt:   "#10b981",
  ruler:     "#050d14",
  rulerText: "#4a8a9a",
  playhead:  "#f59e0b",
  selection: "rgba(34,211,238,0.12)",
  grid:      "rgba(15,42,58,0.8)",
};

interface WaveformEditorProps {
  buffer:     AudioBuffer;
  qcMarkers?: QCMarker[];
  fileName?:  string;
}

export default function WaveformEditor({
  buffer, qcMarkers = [], fileName = "audio"
}: WaveformEditorProps) {
  const waveCanvasRef = useRef(null);
  const specCanvasRef = useRef(null);
  const containerRef  = useRef(null);

  const [zoom,       setZoom]       = useState(100);
  const [panOffset,  setPanOffset]  = useState(0);
  const [playheadSec,setPlayheadSec]= useState(0);
  const [selection,  setSelection]  = useState(null);
  const [playing,    setPlaying]    = useState(false);
  const [playSpeed,  setPlaySpeed]  = useState(1);
  const [view,       setView]       = useState("dual"); // waveform | spectrogram | dual
  const [looping,    setLooping]    = useState(false);
  const [dimensions, setDimensions] = useState({ w: 800, h: 180 });

  const mono       = React.useMemo(() => mixToMono(buffer), [buffer]);
  const duration   = buffer.duration;
  const sampleRate = buffer.sampleRate;

  // Playback refs
  const audioCtxRef  = useRef(null);
  const sourceRef    = useRef(null);
  const startTimeRef = useRef(0);
  const startOffRef  = useRef(0);
  const rafRef       = useRef(0);

  // Drag state
  const dragRef = useRef({ active: false, mode: null, startX: 0, startSel: null });

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        setDimensions({ w: e.contentRect.width, h: 180 });
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Draw waveform
  useEffect(() => {
    if (!waveCanvasRef.current || (view === "spectrogram")) return;
    renderWaveform(waveCanvasRef.current, {
      mono, sampleRate, duration,
      zoom, panOffset, playheadSec,
      selection, qcMarkers,
      width:  dimensions.w,
      height: view === "dual" ? 160 : 220,
      theme:  THEME,
    });
  }, [mono, zoom, panOffset, playheadSec, selection, qcMarkers, dimensions, view]);

  // Draw spectrogram
  useEffect(() => {
    if (!specCanvasRef.current || view === "waveform") return;
    const spec = computeSpectrogram(buffer, { fftSize: 2048, sampleRate });
    drawSpectrogram(specCanvasRef.current, spec);
  }, [buffer, view, dimensions]);

  // Playhead animation
  function startPlayheadAnim() {
    function tick() {
      if (!audioCtxRef.current) return;
      const t = audioCtxRef.current.currentTime - startTimeRef.current + startOffRef.current;
      setPlayheadSec(Math.min(t, duration));
      if (t < duration) rafRef.current = requestAnimationFrame(tick);
      else { setPlaying(false); setPlayheadSec(0); startOffRef.current = 0; }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopPlayback() {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }

  function play(startSec = startOffRef.current, endSec = duration) {
    stopPlayback();
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed")
      audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const src = ctx.createBufferSource();
    src.buffer       = buffer;
    src.playbackRate.value = playSpeed;
    src.connect(ctx.destination);
    if (looping && selection) {
      src.loop      = true;
      src.loopStart = selection.startSec;
      src.loopEnd   = selection.endSec;
    }
    src.start(0, startSec, endSec - startSec);
    src.onended = () => { if (!looping) { setPlaying(false); startOffRef.current = 0; setPlayheadSec(0); } };
    sourceRef.current   = src;
    startTimeRef.current = ctx.currentTime;
    startOffRef.current  = startSec;
    setPlaying(true);
    startPlayheadAnim();
  }

  function togglePlay() {
    if (playing) {
      startOffRef.current = playheadSec;
      stopPlayback();
    } else {
      play(playheadSec);
    }
  }

  function playSelection() {
    if (!selection) return;
    play(selection.startSec, selection.endSec);
  }

  // Zoom
  function zoomIn()  { setZoom(z => Math.min(z * 1.5, 2000)); }
  function zoomOut() { setZoom(z => Math.max(z / 1.5, 10)); }
  function fitScreen() {
    setZoom(dimensions.w / duration);
    setPanOffset(0);
  }
  function zoomToSelection() {
    if (!selection) return;
    const dur = selection.endSec - selection.startSec;
    setZoom(dimensions.w / dur);
    setPanOffset(selection.startSec);
  }

  // Canvas interaction
  const RULER_H = 24;

  function getCanvasX(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return (e.clientX || e.touches?.[0]?.clientX || 0) - rect.left;
  }

  function onMouseDown(e) {
    if (!waveCanvasRef.current) return;
    const x    = getCanvasX(e, waveCanvasRef.current);
    const y    = e.clientY - waveCanvasRef.current.getBoundingClientRect().top;
    if (y < RULER_H) {
      // Click on ruler → set playhead
      const t = Math.max(0, Math.min(duration, xToTime(x, panOffset, zoom)));
      startOffRef.current = t;
      setPlayheadSec(t);
      if (playing) play(t);
      return;
    }
    const time = xToTime(x, panOffset, zoom);
    // Check if clicking near existing selection handles
    if (selection) {
      const sx = timeToX(selection.startSec, panOffset, zoom);
      const ex = timeToX(selection.endSec,   panOffset, zoom);
      if (Math.abs(x - sx) < 8) {
        dragRef.current = { active: true, mode: "resize-left",  startX: x, startSel: {...selection} };
        return;
      }
      if (Math.abs(x - ex) < 8) {
        dragRef.current = { active: true, mode: "resize-right", startX: x, startSel: {...selection} };
        return;
      }
      if (x > sx && x < ex) {
        dragRef.current = { active: true, mode: "move", startX: x, startSel: {...selection} };
        return;
      }
    }
    dragRef.current = { active: true, mode: "create", startX: x, startSel: { startSec: time, endSec: time } };
    setSelection({ startSec: time, endSec: time });
  }

  function onMouseMove(e) {
    if (!dragRef.current.active || !waveCanvasRef.current) return;
    const x    = getCanvasX(e, waveCanvasRef.current);
    const time = xToTime(x, panOffset, zoom);
    const { mode, startX, startSel } = dragRef.current;
    const dt   = (x - startX) / zoom;

    if (mode === "create") {
      const s = xToTime(dragRef.current.startX, panOffset, zoom);
      setSelection({ startSec: Math.min(s, time), endSec: Math.max(s, time) });
    } else if (mode === "resize-left") {
      setSelection({ startSec: Math.max(0, Math.min(time, startSel.endSec - 0.01)), endSec: startSel.endSec });
    } else if (mode === "resize-right") {
      setSelection({ startSec: startSel.startSec, endSec: Math.min(duration, Math.max(time, startSel.startSec + 0.01)) });
    } else if (mode === "move") {
      const dur  = startSel.endSec - startSel.startSec;
      const newS = Math.max(0, Math.min(duration - dur, startSel.startSec + dt));
      setSelection({ startSec: newS, endSec: newS + dur });
    }
  }

  function onMouseUp() {
    dragRef.current.active = false;
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space")  { e.preventDefault(); togglePlay(); }
      if (e.code === "KeyL")   setLooping(l => !l);
      if (e.code === "KeyZ")   zoomToSelection();
      if (e.code === "Escape") setSelection(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, selection, looping]);

  // Pan on wheel
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY > 0 ? 0.8 : 1.25;
      setZoom(z => Math.max(10, Math.min(2000, z * factor)));
    } else {
      setPanOffset(p => Math.max(0, Math.min(duration - dimensions.w / zoom, p + e.deltaX / zoom)));
    }
  }

  const selDur = selection ? selection.endSec - selection.startSec : 0;

  return (
    <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,overflow:"hidden",fontFamily:"monospace"}}>

      {/* Header */}
      <div style={{padding:"10px 14px",borderBottom:"1px solid #0f2a3a",
        display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:9,color:"#22d3ee",fontWeight:700,letterSpacing:1}}>
            ◈ WAVEFORM WORKSTATION
          </span>
          <span style={{fontSize:8,color:"#4a8a9a"}}>{fileName}</span>
        </div>
        {/* View toggle */}
        <div style={{display:"flex",gap:4}}>
          {["waveform","dual","spectrogram"].map(v=>(
            <div key={v} onClick={()=>setView(v)}
              style={{fontSize:8,padding:"3px 8px",borderRadius:4,cursor:"pointer",
                background:view===v?"#22d3ee22":"#050d14",
                border:"1px solid "+(view===v?"#22d3ee44":"#0f2a3a"),
                color:view===v?"#22d3ee":"#4a8a9a",fontWeight:700}}>
              {v.toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} style={{position:"relative",width:"100%",cursor:"crosshair",userSelect:"none"}}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onTouchStart={e=>onMouseDown(e.touches[0])}
        onTouchMove={e=>onMouseMove(e.touches[0])}
        onTouchEnd={onMouseUp}
        onWheel={onWheel}>

        {view !== "spectrogram" && (
          <canvas ref={waveCanvasRef}
            style={{display:"block",width:"100%",height:view==="dual"?"160px":"220px"}}/>
        )}
        {view !== "waveform" && (
          <canvas ref={specCanvasRef} width={dimensions.w} height={120}
            style={{display:"block",width:"100%",height:"120px"}}/>
        )}
      </div>

      {/* Controls */}
      <div style={{padding:"8px 14px",borderTop:"1px solid #0f2a3a",
        display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>

        {/* Transport */}
        <button onClick={togglePlay}
          style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:6,
            padding:"5px 14px",cursor:"pointer",color:"#22d3ee",fontSize:11,fontWeight:700}}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={()=>{stopPlayback();startOffRef.current=0;setPlayheadSec(0);}}
          style={{background:"#0f2a3a",border:"1px solid #1e3a5f",borderRadius:6,
            padding:"5px 10px",cursor:"pointer",color:"#4a8a9a",fontSize:10}}>
          ⏹
        </button>
        {selection&&<button onClick={playSelection}
          style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:6,
            padding:"5px 10px",cursor:"pointer",color:"#10b981",fontSize:10,fontWeight:700}}>
          ▶ Selection
        </button>}
        <div onClick={()=>setLooping(l=>!l)}
          style={{fontSize:9,padding:"4px 8px",borderRadius:4,cursor:"pointer",
            background:looping?"#f59e0b22":"#050d14",
            border:"1px solid "+(looping?"#f59e0b44":"#0f2a3a"),
            color:looping?"#f59e0b":"#4a8a9a",fontWeight:700}}>
          ⟳ Loop
        </div>

        {/* Speed */}
        <select value={playSpeed} onChange={e=>setPlaySpeed(parseFloat(e.target.value))}
          style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:4,
            padding:"3px 6px",color:"#a0c4cc",fontSize:9,fontFamily:"monospace"}}>
          {[0.5,0.75,1,1.25,1.5,2].map(s=>(
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>

        {/* Time display */}
        <span style={{fontSize:10,color:"#22d3ee",fontFamily:"monospace",marginLeft:4}}>
          {formatTime(playheadSec)} / {formatTime(duration)}
        </span>

        {/* Zoom controls */}
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button onClick={zoomOut}  style={btnStyle}>−</button>
          <button onClick={zoomIn}   style={btnStyle}>+</button>
          <button onClick={fitScreen} style={btnStyle}>Fit</button>
          {selection&&<button onClick={zoomToSelection} style={btnStyle}>Zoom Sel</button>}
        </div>
      </div>

      {/* Selection info */}
      {selection&&<div style={{padding:"6px 14px",borderTop:"1px solid #0f2a3a",
        background:"#050d14",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:9,color:"#4a8a9a"}}>SELECTION</span>
        <span style={{fontSize:9,color:"#22d3ee"}}>Start: {formatTime(selection.startSec)}</span>
        <span style={{fontSize:9,color:"#22d3ee"}}>End: {formatTime(selection.endSec)}</span>
        <span style={{fontSize:9,color:"#22d3ee"}}>Dur: {formatTime(selDur)}</span>
        <span style={{fontSize:9,color:"#4a8a9a"}}>
          {Math.round(selection.startSec * sampleRate).toLocaleString()} –{" "}
          {Math.round(selection.endSec * sampleRate).toLocaleString()} samples
        </span>
        <button onClick={()=>setSelection(null)}
          style={{fontSize:8,padding:"2px 8px",borderRadius:4,cursor:"pointer",
            background:"#ef444422",border:"1px solid #ef444444",color:"#ef4444",marginLeft:"auto"}}>
          ✕ Clear
        </button>
      </div>}

      {/* QC Markers legend */}
      {qcMarkers.length>0&&<div style={{padding:"5px 14px",borderTop:"1px solid #0f2a3a",
        display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:8,color:"#4a8a9a"}}>QC MARKERS:</span>
        {qcMarkers.slice(0,5).map((m,i)=>{
          const c = {critical:"#ef4444",high:"#f97316",warning:"#f59e0b",medium:"#f59e0b",low:"#22d3ee"}[m.severity]||"#4a8a9a";
          return <span key={i} style={{fontSize:8,color:c,cursor:"pointer"}}
            onClick={()=>{setPanOffset(Math.max(0,m.timeSec-2));setPlayheadSec(m.timeSec);}}>
            ▸ {m.type} @ {formatTime(m.timeSec)}
          </span>;
        })}
      </div>}

      <style>{`.wave-btn{background:#050d14;border:1px solid #0f2a3a;border-radius:4px;padding:3px 8px;cursor:pointer;color:#4a8a9a;font-size:9px;font-family:monospace}`}</style>
    </div>
  );
}

const btnStyle = {
  background:"#050d14",border:"1px solid #0f2a3a",borderRadius:4,
  padding:"3px 8px",cursor:"pointer",color:"#4a8a9a",
  fontSize:9,fontFamily:"monospace"
};
