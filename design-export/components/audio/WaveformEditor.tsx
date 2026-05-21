// @ts-nocheck
/**
 * WaveformEditor.tsx — Adobe-style Waveform Workstation
 * Aivora Platform — Batch A+B
 */
import React, { useRef, useEffect, useState, useCallback } from "react";
import { renderWaveform, type QCMarker } from "../../lib/audioEditor/waveformRenderer";
import { xToTime, timeToX } from "../../lib/audioEditor/regionEditor";
import { mixToMono, formatTime } from "../../lib/audioEditor/audioBufferUtils";
import { computeSpectrogram, drawSpectrogram, drawGapMarkers } from "../../lib/audioQc/spectrogram";
import { computeSpectrogramPro, drawSpectrogramPro } from "../../lib/audioQc/spectrogramPro";
import { stretchRegion, validateStretchRatio } from "../../lib/audioEditor/timeStretch";
import { exportToWav, downloadWav } from "../../lib/audioQc/repair/wavExporter";

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

export default function WaveformEditor({ buffer, qcMarkers = [], fileName = "audio" }: WaveformEditorProps) {
  const waveCanvasRef = useRef(null);
  const specCanvasRef = useRef(null);
  const containerRef  = useRef(null);

  const [zoom,        setZoom]        = useState(100);
  const [panOffset,   setPanOffset]   = useState(0);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [selection,   setSelection]   = useState(null);
  const [playing,     setPlaying]     = useState(false);
  const [playSpeed,   setPlaySpeed]   = useState(1);
  const [view,        setView]        = useState("dual");
  const [looping,     setLooping]     = useState(false);
  const [dimensions,  setDimensions]  = useState({ w: 800, h: 180 });
  const [hoveredMarker, setHoveredMarker] = useState(null);
  const [markerTooltip,  setMarkerTooltip]  = useState(null);
  const [editHistory,    setEditHistory]    = useState([]);
  const [historyIndex,   setHistoryIndex]   = useState(-1);
  const [workingBuffer,  setWorkingBuffer]  = useState(buffer);
  const [targetDuration, setTargetDuration] = useState("");
  const [stretchRatio,   setStretchRatio]   = useState(1.0);
  const [stretchWarning, setStretchWarning] = useState("");
  const [stretching,     setStretching]     = useState(false);
  const [showStretch,    setShowStretch]    = useState(false);
  const [fftSize,       setFftSize]       = useState(4096);
  const [colorMap,      setColorMap]      = useState<"aivora"|"plasma"|"viridis"|"inferno">("aivora");
  const [specGain,      setSpecGain]      = useState(1.2);

  const mono       = React.useMemo(() => mixToMono(buffer), [buffer]);
  const duration   = buffer.duration;
  const sampleRate = buffer.sampleRate;

  // Playback refs
  const audioCtxRef   = useRef(null);
  const sourceRef     = useRef(null);
  const startTimeRef  = useRef(0);
  const startOffRef   = useRef(0);
  const rafRef        = useRef(0);
  const dragRef       = useRef({ active: false, mode: null, startX: 0, startSel: null });

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setDimensions({ w: Math.floor(e.contentRect.width), h: 180 });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Draw waveform
  useEffect(() => {
    if (!waveCanvasRef.current || view === "spectrogram") return;
    renderWaveform(waveCanvasRef.current, {
      mono, sampleRate, duration,
      zoom, panOffset, playheadSec,
      selection, qcMarkers,
      width:  dimensions.w,
      height: view === "dual" ? 160 : 240,
      theme:  THEME,
    });
  }, [mono, zoom, panOffset, playheadSec, selection, qcMarkers, dimensions, view]);

  // Draw spectrogram — sync zoom/pan
  useEffect(() => {
    if (!specCanvasRef.current || view === "waveform") return;
    const canvas = specCanvasRef.current;
    const spec = computeSpectrogramPro(buffer, { fftSize, minDb:-90, maxDb:-10, gain: specGain, colorMap });

    // Create a clipped view matching zoom/pan
    canvas.width  = dimensions.w;
    canvas.height = 180;
    const offscreen = document.createElement("canvas");
    offscreen.width  = dimensions.w;
    offscreen.height = 180;
    drawSpectrogramPro(offscreen, spec, { colorMap, gain: specGain, logFreq: true, showGrid: true });

    // Draw zoomed portion
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dimensions.w, 120);
    const startFrac = panOffset / duration;
    const endFrac   = Math.min(1, (panOffset + dimensions.w / zoom) / duration);
    const srcX      = startFrac * offscreen.width;
    const srcW      = (endFrac - startFrac) * offscreen.width;
    ctx.drawImage(offscreen, srcX, 0, srcW, 120, 0, 0, dimensions.w, 120);

    // Draw synchronized playhead on spectrogram
    const px = (playheadSec - panOffset) * zoom;
    if (px >= 0 && px <= dimensions.w) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, 180);
      ctx.stroke();
    }

    // Draw synchronized selection on spectrogram
    if (selection) {
      const sx = (selection.startSec - panOffset) * zoom;
      const ex = (selection.endSec   - panOffset) * zoom;
      ctx.fillStyle = "rgba(34,211,238,0.15)";
      ctx.fillRect(sx, 0, ex - sx, 120);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, 0, ex - sx, 120);
    }
  }, [buffer, view, dimensions, zoom, panOffset, playheadSec, selection]);

  // Playback
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
    src.buffer = buffer;
    src.playbackRate.value = playSpeed;
    src.connect(ctx.destination);

    if (looping && selection) {
      src.loop      = true;
      src.loopStart = selection.startSec;
      src.loopEnd   = selection.endSec;
      src.start(0, startSec);
    } else {
      src.start(0, startSec, Math.max(0.01, endSec - startSec));
      src.onended = () => {
        setPlaying(false);
        startOffRef.current = 0;
        setPlayheadSec(0);
      };
    }

    sourceRef.current    = src;
    startTimeRef.current = ctx.currentTime;
    startOffRef.current  = startSec;
    setPlaying(true);

    function tick() {
      if (!audioCtxRef.current) return;
      const t = (audioCtxRef.current.currentTime - startTimeRef.current) * playSpeed + startOffRef.current;
      const clamped = looping && selection
        ? selection.startSec + ((t - selection.startSec) % (selection.endSec - selection.startSec))
        : Math.min(t, endSec);
      setPlayheadSec(clamped);
      // Auto-pan to follow playhead
      if (clamped > panOffset + dimensions.w / zoom - 1) {
        setPanOffset(Math.max(0, clamped - 1));
      }
      if (t <= endSec || looping) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (playing) { startOffRef.current = playheadSec; stopPlayback(); }
    else play(playheadSec);
  }

  function playSelection() {
    if (!selection) return;
    play(selection.startSec, selection.endSec);
  }

  function loopSelection() {
    if (!selection) return;
    setLooping(true);
    play(selection.startSec, selection.endSec);
  }

  // Zoom/Pan
  function zoomIn()  { setZoom(z => Math.min(z * 1.5, 3000)); }
  function zoomOut() { setZoom(z => Math.max(z / 1.5, 5));    }
  function fitScreen() { setZoom(dimensions.w / duration); setPanOffset(0); }
  function zoomToSelection() {
    if (!selection) return;
    const dur = selection.endSec - selection.startSec;
    if (dur < 0.01) return;
    setZoom(dimensions.w / dur);
    setPanOffset(selection.startSec);
  }

  // Canvas interaction
  const RULER_H = 24;

  function getX(e) {
    const canvas = waveCanvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left;
  }

  function onMouseDown(e) {
    const x = getX(e);
    const y = e.clientY - (waveCanvasRef.current?.getBoundingClientRect().top ?? 0);

    if (y < RULER_H) {
      const t = Math.max(0, Math.min(duration, xToTime(x, panOffset, zoom)));
      startOffRef.current = t;
      setPlayheadSec(t);
      if (playing) play(t);
      return;
    }

    const time = xToTime(x, panOffset, zoom);

    if (selection) {
      const sx = timeToX(selection.startSec, panOffset, zoom);
      const ex = timeToX(selection.endSec,   panOffset, zoom);
      if (Math.abs(x - sx) < 10) { dragRef.current = { active:true, mode:"resize-left",  startX:x, startSel:{...selection} }; return; }
      if (Math.abs(x - ex) < 10) { dragRef.current = { active:true, mode:"resize-right", startX:x, startSel:{...selection} }; return; }
      if (x > sx+10 && x < ex-10) { dragRef.current = { active:true, mode:"move",        startX:x, startSel:{...selection} }; return; }
    }

    dragRef.current = { active:true, mode:"create", startX:x, startSel:{ startSec:time, endSec:time } };
    setSelection({ startSec:time, endSec:time });
  }

  function onMouseMove(e) {
    if (!dragRef.current.active) {
      // Check for marker hover
      const x = getX(e);
      const time = xToTime(x, panOffset, zoom);
      const nearby = qcMarkers.find(m => Math.abs(m.timeSec - time) < 0.5 / zoom * 10);
      setHoveredMarker(nearby || null);
      setMarkerTooltip(nearby ? { x, marker: nearby } : null);
      return;
    }

    const x    = getX(e);
    const time = xToTime(x, panOffset, zoom);
    const { mode, startX, startSel } = dragRef.current;
    const dt   = (x - startX) / zoom;

    if (mode === "create") {
      const s = xToTime(startX, panOffset, zoom);
      setSelection({ startSec: Math.min(s,time), endSec: Math.max(s,time) });
    } else if (mode === "resize-left") {
      setSelection({ startSec: Math.max(0, Math.min(time, startSel.endSec-0.01)), endSec: startSel.endSec });
    } else if (mode === "resize-right") {
      setSelection({ startSec: startSel.startSec, endSec: Math.min(duration, Math.max(time, startSel.startSec+0.01)) });
    } else if (mode === "move") {
      const dur  = startSel.endSec - startSel.startSec;
      const newS = Math.max(0, Math.min(duration-dur, startSel.startSec+dt));
      setSelection({ startSec:newS, endSec:newS+dur });
    }
  }

  function onMouseUp() { dragRef.current.active = false; }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY > 0 ? 0.8 : 1.25;
      setZoom(z => Math.max(5, Math.min(3000, z * factor)));
    } else {
      const maxPan = Math.max(0, duration - dimensions.w / zoom);
      setPanOffset(p => Math.max(0, Math.min(maxPan, p + e.deltaX / zoom * 0.5)));
    }
  }

  // Keyboard
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.code === "Space")  { e.preventDefault(); togglePlay(); }
      if (e.code === "KeyL")   { if(selection) loopSelection(); }
      if (e.code === "KeyZ")   zoomToSelection();
      if (e.code === "Escape") setSelection(null);
      if (e.code === "ArrowLeft")  setPanOffset(p => Math.max(0, p - 1/zoom * 50));
      if (e.code === "ArrowRight") setPanOffset(p => Math.min(duration, p + 1/zoom * 50));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, selection, looping, zoom, duration]);

  const selDur = selection ? selection.endSec - selection.startSec : 0;

  // Update working buffer when prop changes
  React.useEffect(() => { setWorkingBuffer(buffer); setEditHistory([]); setHistoryIndex(-1); }, [buffer]);

  function applyStretch() {
    if (!selection || !workingBuffer) return;
    const targetSec = parseFloat(targetDuration);
    if (isNaN(targetSec) || targetSec <= 0) { setStretchWarning("Invalid target duration"); return; }
    const ratio = targetSec / selDur;
    const validation = validateStretchRatio(ratio);
    if (!validation.valid) { setStretchWarning(validation.error || ""); return; }
    setStretching(true);
    setStretchWarning(validation.warning || "");
    setTimeout(() => {
      try {
        const result = stretchRegion(workingBuffer, selection.startSec, selection.endSec, targetSec, { ratio });
        const op = {
          id:          Date.now(),
          type:        "TIME_STRETCH",
          startMs:     Math.round(selection.startSec * 1000),
          endMs:       Math.round(selection.endSec   * 1000),
          originalMs:  Math.round(selDur * 1000),
          newMs:       Math.round(targetSec * 1000),
          ratio:       result.ratio,
          createdAt:   new Date().toISOString(),
        };
        const newHistory = [...editHistory.slice(0, historyIndex+1), { buffer: result.buffer, op }];
        setEditHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setWorkingBuffer(result.buffer);
        if (result.warning) setStretchWarning(result.warning);
      } catch(e) { setStretchWarning("Stretch failed: " + e.message); }
      setStretching(false);
    }, 50);
  }

  function undo() {
    if (historyIndex <= 0) { setWorkingBuffer(buffer); setHistoryIndex(-1); return; }
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    setWorkingBuffer(editHistory[newIdx].buffer);
  }

  function redo() {
    if (historyIndex >= editHistory.length - 1) return;
    const newIdx = historyIndex + 1;
    setHistoryIndex(newIdx);
    setWorkingBuffer(editHistory[newIdx].buffer);
  }

  function exportEdited() {
    if (!workingBuffer) return;
    const wav = exportToWav(workingBuffer, fileName.replace(".wav","_edited"));
    downloadWav(wav);
    const manifest = {
      originalFile: fileName,
      edits: editHistory.map(h => h.op),
      finalDuration: workingBuffer.duration,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url; a.download = fileName.replace(".wav","_edits.json");
    a.click(); URL.revokeObjectURL(url);
  }

  const SEVERITY_COLORS = {
    critical:"#ef4444", high:"#f97316", warning:"#f59e0b", medium:"#f59e0b", low:"#22d3ee"
  };

  return (
    <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,
      overflow:"hidden",fontFamily:"monospace",color:"#a0c4cc"}}>

      {/* Header */}
      <div style={{padding:"8px 14px",borderBottom:"1px solid #0f2a3a",
        display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:9,color:"#22d3ee",fontWeight:700,letterSpacing:1}}>◈ WAVEFORM WORKSTATION</span>
          <span style={{fontSize:8,color:"#4a8a9a",maxWidth:200,overflow:"hidden",
            textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fileName}</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          {["waveform","dual","spectrogram"].map(v=>(
            <div key={v} onClick={()=>setView(v)}
              style={{fontSize:8,padding:"3px 8px",borderRadius:4,cursor:"pointer",
                background:view===v?"#22d3ee22":"#050d14",
                border:"1px solid "+(view===v?"#22d3ee44":"#0f2a3a"),
                color:view===v?"#22d3ee":"#4a8a9a",fontWeight:700}}>
              {v === "waveform" ? "WAVE" : v === "spectrogram" ? "SPEC" : "DUAL"}
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{position:"relative",width:"100%",
        cursor:"crosshair",userSelect:"none",background:"#040c14"}}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onTouchStart={e=>{e.preventDefault();onMouseDown(e.touches[0]);}}
        onTouchMove={e=>{e.preventDefault();onMouseMove(e.touches[0]);}}
        onTouchEnd={onMouseUp}
        onWheel={onWheel}>

        {view !== "spectrogram" && (
          <canvas ref={waveCanvasRef}
            style={{display:"block",width:"100%",
              height: view==="dual" ? "160px" : "240px"}}/>
        )}
        {view !== "waveform" && (
          <canvas ref={specCanvasRef}
            style={{display:"block",width:"100%",height:"120px",
              borderTop: view==="dual" ? "1px solid #0f2a3a" : "none"}}/>
        )}

        {/* Marker tooltip */}
        {markerTooltip && (
          <div style={{position:"absolute",top:30,
            left:Math.min(markerTooltip.x, dimensions.w-180),
            background:"#060e16",border:"1px solid "+
              (SEVERITY_COLORS[markerTooltip.marker.severity]||"#4a8a9a")+"44",
            borderRadius:6,padding:"5px 8px",pointerEvents:"none",zIndex:10,maxWidth:180}}>
            <div style={{fontSize:9,color:SEVERITY_COLORS[markerTooltip.marker.severity]||"#4a8a9a",
              fontWeight:700,marginBottom:2}}>{markerTooltip.marker.type}</div>
            <div style={{fontSize:8,color:"#a0c4cc"}}>{markerTooltip.marker.message}</div>
            <div style={{fontSize:8,color:"#4a8a9a",marginTop:2}}>
              @ {formatTime(markerTooltip.marker.timeSec)}
            </div>
          </div>
        )}
      </div>

      {/* Transport controls */}
      <div style={{padding:"8px 14px",borderTop:"1px solid #0f2a3a",
        display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",background:"#050d14"}}>
        <button onClick={togglePlay}
          style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:6,
            padding:"5px 12px",cursor:"pointer",color:"#22d3ee",fontSize:10,fontWeight:700}}>
          {playing ? "⏸" : "▶"} {playing ? "Pause" : "Play"}
        </button>
        <button onClick={()=>{stopPlayback();startOffRef.current=0;setPlayheadSec(0);}}
          style={btnSm}>⏹</button>

        {selection && <>
          <button onClick={playSelection}
            style={{...btnSm,background:"#10b98122",border:"1px solid #10b98144",color:"#10b981"}}>
            ▶ Sel
          </button>
          <button onClick={loopSelection}
            style={{...btnSm,background:looping?"#f59e0b22":"#050d14",
              border:"1px solid "+(looping?"#f59e0b44":"#0f2a3a"),
              color:looping?"#f59e0b":"#4a8a9a"}}>
            ⟳ Loop
          </button>
        </>}

        <select value={playSpeed} onChange={e=>setPlaySpeed(parseFloat(e.target.value))}
          style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:4,
            padding:"3px 6px",color:"#a0c4cc",fontSize:9,fontFamily:"monospace"}}>
          {[0.5,0.75,1,1.25,1.5,2].map(s=>(
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>

        <span style={{fontSize:10,color:"#22d3ee",fontFamily:"monospace"}}>
          {formatTime(playheadSec)} / {formatTime(duration)}
        </span>

        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button onClick={zoomOut}   style={btnSm}>−</button>
          <button onClick={zoomIn}    style={btnSm}>+</button>
          <button onClick={fitScreen} style={btnSm}>Fit</button>
          {selection&&<button onClick={zoomToSelection} style={btnSm}>Zoom</button>}
        </div>
      </div>

      {/* Selection info */}
      {selection && (
        <div style={{padding:"5px 14px",borderTop:"1px solid #0f2a3a",
          background:"#040c14",display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:8,color:"#4a8a9a",fontWeight:700}}>SELECTION</span>
          <span style={{fontSize:9,color:"#22d3ee"}}>▸ {formatTime(selection.startSec)}</span>
          <span style={{fontSize:9,color:"#22d3ee"}}>◂ {formatTime(selection.endSec)}</span>
          <span style={{fontSize:9,color:"#10b981",fontWeight:700}}>{formatTime(selDur)}</span>
          <span style={{fontSize:8,color:"#4a8a9a"}}>
            {Math.round(selection.startSec*sampleRate).toLocaleString()}–
            {Math.round(selection.endSec*sampleRate).toLocaleString()} smp
          </span>
          <button onClick={()=>{setSelection(null);setLooping(false);stopPlayback();}}
            style={{fontSize:8,padding:"2px 8px",borderRadius:4,cursor:"pointer",
              background:"#ef444422",border:"1px solid #ef444444",
              color:"#ef4444",marginLeft:"auto"}}>✕ Clear</button>
        </div>
      )}

      {/* QC Markers */}
      {qcMarkers.length > 0 && (
        <div style={{padding:"5px 14px",borderTop:"1px solid #0f2a3a",
          display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",background:"#040c14"}}>
          <span style={{fontSize:8,color:"#4a8a9a",fontWeight:700}}>QC:</span>
          {qcMarkers.slice(0,8).map((m,i)=>{
            const c = SEVERITY_COLORS[m.severity]||"#4a8a9a";
            return (
              <span key={i}
                onClick={()=>{
                  const t = Math.max(0, m.timeSec - 1);
                  setPanOffset(t);
                  setPlayheadSec(m.timeSec);
                  setSelection({ startSec: m.timeSec, endSec: Math.min(duration, m.timeSec+1) });
                }}
                style={{fontSize:8,color:c,cursor:"pointer",padding:"2px 6px",
                  background:c+"11",borderRadius:3,border:"1px solid "+c+"33"}}>
                ▸ {m.type.replace(/_/g," ")} {formatTime(m.timeSec)}
              </span>
            );
          })}
        </div>
      )}

      {/* Time Stretch Panel */}
      {selection && <div style={{borderTop:"1px solid #0f2a3a",padding:"8px 14px",background:"#050d14"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:showStretch?8:0}}>
          <span style={{fontSize:9,color:"#8b5cf6",fontWeight:700}}>⏱ TIME STRETCH</span>
          <span style={{fontSize:8,color:"#4a8a9a"}}>Selected: {formatTime(selDur)}</span>
          <div onClick={()=>setShowStretch(s=>!s)}
            style={{fontSize:8,padding:"2px 8px",borderRadius:4,cursor:"pointer",
              background:"#8b5cf622",border:"1px solid #8b5cf644",color:"#8b5cf6",marginLeft:4}}>
            {showStretch?"▲ Hide":"▼ Show"}
          </div>
          {editHistory.length > 0 && <>
            <button onClick={undo} disabled={historyIndex < 0}
              style={{...btnSm,color:historyIndex>=0?"#22d3ee":"#2a5a6a"}}>↩ Undo</button>
            <button onClick={redo} disabled={historyIndex >= editHistory.length-1}
              style={{...btnSm,color:historyIndex<editHistory.length-1?"#22d3ee":"#2a5a6a"}}>↪ Redo</button>
            <button onClick={exportEdited}
              style={{...btnSm,background:"#10b98122",border:"1px solid #10b98144",color:"#10b981"}}>
              ⬇ Export WAV
            </button>
          </>}
        </div>
        {showStretch && <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:3}}>TARGET DURATION (s)</div>
            <input type="number" step="0.1" min="0.1"
              value={targetDuration}
              onChange={e=>{
                setTargetDuration(e.target.value);
                const t = parseFloat(e.target.value);
                if(!isNaN(t) && selDur > 0) {
                  setStretchRatio(t/selDur);
                  setStretchWarning(validateStretchRatio(t/selDur).warning||validateStretchRatio(t/selDur).error||"");
                }
              }}
              placeholder={selDur.toFixed(2)}
              style={{background:"#040c14",border:"1px solid #0f2a3a",borderRadius:4,
                padding:"4px 8px",color:"#a0c4cc",fontSize:10,fontFamily:"monospace",width:80}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:3}}>
              RATIO: {stretchRatio.toFixed(2)}x
              {stretchRatio < 1 ? " (compress)" : stretchRatio > 1 ? " (stretch)" : ""}
            </div>
            <input type="range" min="0.65" max="1.80" step="0.01"
              value={stretchRatio}
              onChange={e=>{
                const r = parseFloat(e.target.value);
                setStretchRatio(r);
                setTargetDuration((selDur * r).toFixed(2));
                setStretchWarning(validateStretchRatio(r).warning||validateStretchRatio(r).error||"");
              }}
              style={{width:"100%",accentColor:"#8b5cf6"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#2a5a6a"}}>
              <span>0.65x</span><span style={{color:"#4a8a9a"}}>safe: 0.80–1.25x</span><span>1.80x</span>
            </div>
          </div>
          <button onClick={applyStretch} disabled={stretching||!targetDuration}
            style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:6,
              padding:"6px 14px",cursor:"pointer",color:"#8b5cf6",fontSize:10,fontWeight:700}}>
            {stretching?"Processing...":"Apply Stretch"}
          </button>
        </div>}
        {stretchWarning && <div style={{fontSize:9,color:"#f59e0b",marginTop:4}}>⚠ {stretchWarning}</div>}
        {editHistory.length > 0 && <div style={{marginTop:6,fontSize:8,color:"#4a8a9a"}}>
          {editHistory.length} edit(s) — index {historyIndex+1}/{editHistory.length}
        </div>}
      </div>}

      {/* Keyboard shortcuts hint */}
      <div style={{padding:"3px 14px",borderTop:"1px solid #0a1a24",
        display:"flex",gap:12,background:"#040c14"}}>
        {[["Space","Play/Pause"],["L","Loop"],["Z","Zoom Sel"],["Esc","Clear"],["Scroll","Pan"],["Ctrl+Scroll","Zoom"]].map(([k,v])=>(
          <span key={k} style={{fontSize:7,color:"#2a5a6a"}}>
            <span style={{color:"#4a8a9a"}}>{k}</span> {v}
          </span>
        ))}
      </div>
    </div>
  );
}

const btnSm = {
  background:"#050d14", border:"1px solid #0f2a3a", borderRadius:4,
  padding:"4px 8px", cursor:"pointer", color:"#4a8a9a",
  fontSize:9, fontFamily:"monospace"
};
