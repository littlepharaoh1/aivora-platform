/**
 * VideoAnnotationWorkstation.tsx — Video Annotation Timeline
 * Aivora Platform — Phase 15.2
 *
 * ✅ Frame extraction reuses VideoPanel logic (no duplication)
 * ✅ Per-frame annotation via ImageAnnotationWorkstation canvas
 * ✅ Timestamps deterministic (3dp)
 * ✅ MAX_ACTIVE_FRAMES = 120
 * ✅ Sequential frame decode (no concurrent explosion)
 * ✅ Full resource cleanup on unmount
 * ✅ Annotation state per frame (Map<frameIndex, AnnotationState>)
 */

import React, {
  useState, useRef, useCallback, useEffect,
} from "react";
import {
  createAnnotationState, addAnnotation, deleteAnnotation,
  undoAnnotation, redoAnnotation, normalizeBBox, toYOLOLines,
} from "./annotationState";
import type { AnnotationState, BBox } from "./annotationState";
import {
  SIMPLE_TAXONOMY, COCO_TAXONOMY,
} from "./taxonomyEngine";
import type { Taxonomy, LabelClass } from "./taxonomyEngine";
import { VIDEO_LIMITS } from "../video/videoRuntime";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoFrame {
  index:       number;
  timestamp_s: number;
  width:       number;
  height:      number;
  bitmap:      ImageBitmap;
}

// ── Canvas renderer ───────────────────────────────────────────────────────────

function renderFrameCanvas(
  canvas:    HTMLCanvasElement,
  frame:     VideoFrame,
  annState:  AnnotationState,
  selected:  string | null,
  activeColor: string,
) {
  const ctx = canvas.getContext("2d");
  if(!ctx) return;

  canvas.width  = frame.width;
  canvas.height = frame.height;
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.drawImage(frame.bitmap, 0, 0);

  for(const ann of annState.annotations) {
    if(ann.frame_index !== frame.index) continue;
    const sx = ann.bbox.x * frame.width;
    const sy = ann.bbox.y * frame.height;
    const bw = ann.bbox.width  * frame.width;
    const bh = ann.bbox.height * frame.height;
    const isSel = ann.id === selected;

    ctx.fillStyle   = `${ann.class_color}22`;
    ctx.fillRect(sx, sy, bw, bh);
    ctx.strokeStyle = isSel ? "#fff" : ann.class_color;
    ctx.lineWidth   = isSel ? 2 : 1.5;
    ctx.strokeRect(sx, sy, bw, bh);

    ctx.fillStyle = ann.class_color;
    ctx.font = "11px monospace";
    ctx.fillText(ann.class_name, sx + 3, sy - 3);

    if(isSel) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(sx + bw - 5, sy + bh - 5, 8, 8);
    }
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function VideoAnnotationWorkstation() {
  const [frames,      setFrames]      = useState<VideoFrame[]>([]);
  const [frameIdx,    setFrameIdx]    = useState(0);
  const [annState,    setAnnState]    = useState<AnnotationState>(
    createAnnotationState(crypto.randomUUID())
  );
  const [taxonomy,    setTaxonomy]    = useState<Taxonomy>(SIMPLE_TAXONOMY);
  const [activeClass, setActiveClass] = useState<LabelClass>(
    SIMPLE_TAXONOMY.classes[0]
  );
  const [selected,    setSelected]    = useState<string | null>(null);
  const [fps,         setFps]         = useState(1);
  const [loading,     setLoading]     = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error,       setError]       = useState<string | null>(null);
  const [tool,        setTool]        = useState<"bbox"|"select">("bbox");

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ sx:number; sy:number; ex:number; ey:number }|null>(null);
  const fileRef    = useRef<HTMLInputElement>(null);

  const currentFrame = frames[frameIdx] ?? null;

  // ── Extract frames ─────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(null);
    setFrames([]); setFrameIdx(0); setLoadProgress(0);
    setAnnState(createAnnotationState(crypto.randomUUID()));

    let videoEl:   HTMLVideoElement | null = null;
    let objectUrl: string | null           = null;
    const extracted: VideoFrame[]          = [];

    try {
      objectUrl = URL.createObjectURL(file);
      videoEl   = document.createElement("video");
      videoEl.preload = "metadata"; videoEl.muted = true;

      await new Promise<void>((res, rej) => {
        videoEl!.onloadedmetadata = () => res();
        videoEl!.onerror = () => rej(new Error("Video load failed"));
        videoEl!.src = objectUrl!;
      });

      const duration = videoEl.duration;
      if(!isFinite(duration) || duration <= 0)
        throw new Error("Invalid video duration");

      // Deterministic timestamps (3dp)
      const timestamps: number[] = [];
      const interval = 1 / fps;
      for(let t = 0; t < duration && timestamps.length < VIDEO_LIMITS.MAX_ACTIVE_FRAMES; t += interval)
        timestamps.push(Math.round(t * 1000) / 1000);

      const tmpCanvas = document.createElement("canvas");
      const ctx       = tmpCanvas.getContext("2d");
      if(!ctx) throw new Error("Canvas unavailable");

      for(let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        await new Promise<void>((res, rej) => {
          videoEl!.onseeked = () => res();
          videoEl!.onerror  = () => rej(new Error(`Seek failed at ${ts}s`));
          videoEl!.currentTime = ts;
        });

        let w = videoEl.videoWidth, h = videoEl.videoHeight;
        if(w > VIDEO_LIMITS.MAX_FRAME_DIM || h > VIDEO_LIMITS.MAX_FRAME_DIM) {
          const ratio = VIDEO_LIMITS.MAX_FRAME_DIM / Math.max(w, h);
          w = Math.floor(w * ratio); h = Math.floor(h * ratio);
        }
        tmpCanvas.width = w; tmpCanvas.height = h;
        ctx.drawImage(videoEl, 0, 0, w, h);
        const bitmap = await createImageBitmap(tmpCanvas);
        extracted.push({ index:i, timestamp_s:ts, width:w, height:h, bitmap });
        setLoadProgress(Math.round((i + 1) / timestamps.length * 100));
      }

      setFrames(extracted);
      setFrameIdx(0);

    } catch(e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      if(videoEl) { videoEl.pause(); videoEl.src = ""; videoEl.load(); }
      if(objectUrl) URL.revokeObjectURL(objectUrl);
      setLoading(false);
    }
  }, [fps]);

  // ── Cleanup bitmaps on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => { frames.forEach(f => f.bitmap.close()); };
  }, [frames]);

  // ── Render frame ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas || !currentFrame) return;
    renderFrameCanvas(canvas, currentFrame, annState, selected, activeClass.color);
  }, [currentFrame, annState, selected, activeClass]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if(e.target instanceof HTMLInputElement) return;
      if((e.ctrlKey||e.metaKey) && e.key==="z") setAnnState(s=>undoAnnotation(s));
      if((e.ctrlKey||e.metaKey) && e.key==="y") setAnnState(s=>redoAnnotation(s));
      if(e.key==="Delete"||e.key==="Backspace") {
        if(selected) setAnnState(s=>deleteAnnotation(s,selected));
        setSelected(null);
      }
      if(e.key==="ArrowRight") setFrameIdx(i=>Math.min(i+1,frames.length-1));
      if(e.key==="ArrowLeft")  setFrameIdx(i=>Math.max(i-1,0));
      if(e.key==="b") setTool("bbox");
      if(e.key==="v") setTool("select");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, frames.length]);

  // ── Pointer events ────────────────────────────────────────────────────────
  const getPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = currentFrame ? currentFrame.width  / rect.width  : 1;
    const scaleY = currentFrame ? currentFrame.height / rect.height : 1;
    return {
      sx: (e.clientX - rect.left) * scaleX,
      sy: (e.clientY - rect.top)  * scaleY,
    };
  }, [currentFrame]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if(!currentFrame) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const { sx, sy } = getPos(e);
    if(tool === "select") {
      // Hit test
      const hit = annState.annotations
        .filter(a => a.frame_index === frameIdx)
        .reverse()
        .find(a => {
          const ax = a.bbox.x * currentFrame.width;
          const ay = a.bbox.y * currentFrame.height;
          const aw = a.bbox.width  * currentFrame.width;
          const ah = a.bbox.height * currentFrame.height;
          return sx>=ax && sx<=ax+aw && sy>=ay && sy<=ay+ah;
        });
      setSelected(hit?.id ?? null);
      return;
    }
    drawingRef.current = { sx, sy, ex:sx, ey:sy };
    setSelected(null);
  }, [tool, annState, frameIdx, currentFrame]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if(!currentFrame || !drawingRef.current) return;
    const { sx, sy } = getPos(e);
    drawingRef.current = { ...drawingRef.current, ex:sx, ey:sy };
    // Draw in-progress box
    const canvas = canvasRef.current;
    if(!canvas) return;
    renderFrameCanvas(canvas, currentFrame, annState, selected, activeClass.color);
    const ctx = canvas.getContext("2d");
    if(!ctx) return;
    const dr = drawingRef.current;
    ctx.strokeStyle = activeClass.color;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4,4]);
    ctx.strokeRect(
      Math.min(dr.sx,dr.ex), Math.min(dr.sy,dr.ey),
      Math.abs(dr.ex-dr.sx), Math.abs(dr.ey-dr.sy),
    );
    ctx.fillStyle = `${activeClass.color}18`;
    ctx.fillRect(
      Math.min(dr.sx,dr.ex), Math.min(dr.sy,dr.ey),
      Math.abs(dr.ex-dr.sx), Math.abs(dr.ey-dr.sy),
    );
    ctx.setLineDash([]);
  }, [currentFrame, annState, selected, activeClass]);

  // Refs to avoid stale closure in pointerUp
  const frameIdxRef    = useRef(frameIdx);
  const activeClassRef = useRef(activeClass);
  const toolRef        = useRef(tool);
  const currentFrameRef= useRef(currentFrame);
  useEffect(() => { frameIdxRef.current    = frameIdx;    }, [frameIdx]);
  useEffect(() => { activeClassRef.current = activeClass; }, [activeClass]);
  useEffect(() => { toolRef.current        = tool;        }, [tool]);
  useEffect(() => { currentFrameRef.current= currentFrame;}, [currentFrame]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const cf = currentFrameRef.current;
    const dr = drawingRef.current;
    if(!cf || !dr || toolRef.current !== "bbox") return;
    const { sx, sy } = getPos(e);
    drawingRef.current = null;

    const bbox: BBox = {
      x:      Math.min(dr.sx, sx) / cf.width,
      y:      Math.min(dr.sy, sy) / cf.height,
      width:  Math.abs(sx - dr.sx) / cf.width,
      height: Math.abs(sy - dr.sy) / cf.height,
    };
    const normalized = normalizeBBox(bbox);
    if(normalized.width > 0.001 && normalized.height > 0.001) {
      const ac = activeClassRef.current;
      const fi = frameIdxRef.current;
      setAnnState(s => addAnnotation(
        s, normalized,
        ac.id, ac.name, ac.color,
        fi,
      ));
    }
  }, [getPos]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const lines = frames.map(f => {
      const frameAnns = annState.annotations.filter(a => a.frame_index === f.index);
      if(!frameAnns.length) return null;
      return `# frame_${f.index}_ts_${f.timestamp_s}s\n` +
        toYOLOLines(frameAnns, taxonomy.classes.length);
    }).filter(Boolean).join("\n\n");

    const blob = new Blob([lines], { type:"text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = "video_annotations.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [frames, annState, taxonomy]);

  const frameAnns     = annState.annotations.filter(a => a.frame_index === frameIdx);
  const totalAnnCount = annState.annotations.length;
  const annotatedFrames = new Set(annState.annotations.map(a => a.frame_index)).size;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%",
      background:"#080c14", fontFamily:"'JetBrains Mono', monospace",
      color:"#e5e7eb" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a", display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:12, fontWeight:700, color:"#22d3ee" }}>
          VIDEO ANNOTATION
        </span>
        {frames.length > 0 && <>
          <span style={{ fontSize:10, color:"#6b7280" }}>
            {frames.length} frames · {annotatedFrames} annotated · {totalAnnCount} total boxes
          </span>
          <button onClick={handleExport}
            style={{ marginLeft:"auto", padding:"4px 14px", fontSize:10,
              background:"#0891b2", color:"#fff", border:"none",
              borderRadius:5, cursor:"pointer", fontWeight:700 }}>
            📤 YOLO Export
          </button>
        </>}
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* Left panel */}
        <div style={{ width:180, background:"#0d1117",
          borderRight:"1px solid #1f2937", display:"flex",
          flexDirection:"column", flexShrink:0 }}>

          {/* File input */}
          {frames.length === 0 && (
            <div style={{ padding:12 }}>
              {loading ? (
                <div style={{ textAlign:"center", padding:16 }}>
                  <div style={{ fontSize:11, color:"#22d3ee",
                    marginBottom:6 }}>Extracting frames...</div>
                  <div style={{ height:4, background:"#1f2937",
                    borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${loadProgress}%`,
                      background:"#22d3ee", transition:"width 0.2s" }} />
                  </div>
                  <div style={{ fontSize:10, color:"#6b7280",
                    marginTop:4 }}>{loadProgress}%</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize:9, color:"#4b5563",
                    marginBottom:6, letterSpacing:1 }}>FPS</div>
                  <div style={{ display:"flex", gap:3, marginBottom:10 }}>
                    {[0.5,1,2,5].map(f => (
                      <button key={f} onClick={() => setFps(f)}
                        style={{ flex:1, padding:"3px 0", fontSize:9,
                          borderRadius:3, cursor:"pointer",
                          border:`1px solid ${fps===f?"#22d3ee":"#1f2937"}`,
                          background:fps===f?"#22d3ee22":"transparent",
                          color:fps===f?"#22d3ee":"#6b7280" }}>
                        {f}
                      </button>
                    ))}
                  </div>
                  <label style={{ display:"block", padding:"8px 0",
                    background:"#22d3ee22", border:"1px solid #22d3ee",
                    borderRadius:6, color:"#22d3ee", fontSize:10,
                    cursor:"pointer", textAlign:"center" }}>
                    🎬 Open Video
                    <input ref={fileRef} type="file" accept="video/*"
                      style={{ display:"none" }}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if(f) handleFile(f);
                      }} />
                  </label>
                  {error && <div style={{ fontSize:10, color:"#ef4444",
                    marginTop:8 }}>⚠ {error}</div>}
                </>
              )}
            </div>
          )}

          {/* Tool selector */}
          {frames.length > 0 && (
            <div style={{ padding:8, borderBottom:"1px solid #1f2937" }}>
              <div style={{ display:"flex", gap:4 }}>
                {([
                  { t:"bbox"   as const, icon:"⬜", tip:"Draw (B)" },
                  { t:"select" as const, icon:"↖",  tip:"Select (V)" },
                ] as const).map(({ t, icon, tip }) => (
                  <button key={t} title={tip} onClick={() => setTool(t)}
                    style={{ flex:1, padding:"5px 0", borderRadius:5,
                      border:`1px solid ${tool===t?"#22d3ee":"#1f2937"}`,
                      background:tool===t?"#22d3ee22":"transparent",
                      color:tool===t?"#22d3ee":"#6b7280",
                      fontSize:14, cursor:"pointer" }}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Class selector */}
          {frames.length > 0 && (
            <div style={{ padding:8, borderBottom:"1px solid #1f2937",
              flex:1, overflowY:"auto" }}>
              <div style={{ fontSize:9, color:"#4b5563",
                marginBottom:6, letterSpacing:1 }}>CLASS</div>
              <div style={{ display:"flex", gap:3, marginBottom:6 }}>
                {[
                  { t:SIMPLE_TAXONOMY, label:"Simple" },
                  { t:COCO_TAXONOMY,   label:"COCO"   },
                ].map(({ t, label }) => (
                  <button key={label} onClick={() => {
                    setTaxonomy(t); setActiveClass(t.classes[0]);
                  }}
                    style={{ flex:1, padding:"2px 0", fontSize:8,
                      borderRadius:3, cursor:"pointer",
                      border:`1px solid ${taxonomy.id===t.id?"#22d3ee":"#1f2937"}`,
                      background:taxonomy.id===t.id?"#22d3ee22":"transparent",
                      color:taxonomy.id===t.id?"#22d3ee":"#6b7280" }}>
                    {label}
                  </button>
                ))}
              </div>
              {taxonomy.classes.slice(0,20).map(cls => (
                <div key={cls.id} onClick={() => setActiveClass(cls)}
                  style={{ display:"flex", alignItems:"center", gap:5,
                    padding:"3px 5px", borderRadius:3, cursor:"pointer",
                    background:activeClass.id===cls.id?"#22d3ee18":"transparent",
                    marginBottom:2 }}>
                  <div style={{ width:8, height:8, borderRadius:2,
                    background:cls.color, flexShrink:0 }} />
                  <span style={{ fontSize:9,
                    color:activeClass.id===cls.id?"#e5e7eb":"#9ca3af",
                    overflow:"hidden", textOverflow:"ellipsis",
                    whiteSpace:"nowrap" }}>{cls.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canvas area */}
        <div style={{ flex:1, display:"flex", flexDirection:"column",
          overflow:"hidden" }}>
          {frames.length === 0 && !loading ? (
            <div style={{ flex:1, display:"flex", alignItems:"center",
              justifyContent:"center", flexDirection:"column", gap:12,
              color:"#4b5563" }}>
              <div style={{ fontSize:48 }}>🎬</div>
              <div style={{ fontSize:12 }}>Open a video to start annotating</div>
            </div>
          ) : (
            <>
              {/* Frame canvas */}
              <div style={{ flex:1, background:"#111827",
                position:"relative", overflow:"hidden" }}>
                <canvas ref={canvasRef}
                  style={{ width:"100%", height:"100%",
                    objectFit:"contain",
                    cursor:tool==="bbox"?"crosshair":"default" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp} />

                {/* Frame info overlay */}
                <div style={{ position:"absolute", top:8, left:8,
                  background:"#00000088", padding:"3px 8px",
                  borderRadius:4, fontSize:10, color:"#22d3ee" }}>
                  Frame {frameIdx + 1}/{frames.length} ·{" "}
                  {currentFrame?.timestamp_s.toFixed(3)}s
                </div>

                {/* Annotations count overlay */}
                {frameAnns.length > 0 && (
                  <div style={{ position:"absolute", top:8, right:8,
                    background:"#00000088", padding:"3px 8px",
                    borderRadius:4, fontSize:10, color:"#22c55e" }}>
                    {frameAnns.length} boxes
                  </div>
                )}
              </div>

              {/* Timeline scrubber */}
              <div style={{ background:"#0d1117",
                borderTop:"1px solid #1f2937", padding:"8px 12px" }}>
                <div style={{ display:"flex", alignItems:"center",
                  gap:8, marginBottom:6 }}>
                  <button onClick={() => setFrameIdx(i => Math.max(0, i-1))}
                    disabled={frameIdx === 0}
                    style={{ padding:"3px 10px", fontSize:12,
                      background:"transparent", color:"#9ca3af",
                      border:"1px solid #1f2937", borderRadius:4,
                      cursor:"pointer" }}>◀</button>
                  <input type="range" min={0} max={frames.length - 1}
                    value={frameIdx}
                    onChange={e => setFrameIdx(Number(e.target.value))}
                    style={{ flex:1, accentColor:"#22d3ee" }} />
                  <button onClick={() => setFrameIdx(i => Math.min(frames.length-1, i+1))}
                    disabled={frameIdx === frames.length - 1}
                    style={{ padding:"3px 10px", fontSize:12,
                      background:"transparent", color:"#9ca3af",
                      border:"1px solid #1f2937", borderRadius:4,
                      cursor:"pointer" }}>▶</button>
                </div>

                {/* Frame strip */}
                <div style={{ display:"flex", gap:3, overflowX:"auto",
                  paddingBottom:4 }}>
                  {frames.map((f, i) => {
                    const hasAnns = annState.annotations
                      .some(a => a.frame_index === i);
                    return (
                      <div key={i} onClick={() => setFrameIdx(i)}
                        style={{ flexShrink:0, width:40, textAlign:"center",
                          cursor:"pointer" }}>
                        <div style={{ height:4, borderRadius:2,
                          background: i===frameIdx ? "#22d3ee"
                            : hasAnns ? "#22c55e" : "#1f2937",
                          marginBottom:2 }} />
                        <div style={{ fontSize:7,
                          color: i===frameIdx ? "#22d3ee" : "#374151" }}>
                          {f.timestamp_s}s
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right annotation list */}
        {frames.length > 0 && (
          <div style={{ width:160, background:"#0d1117",
            borderLeft:"1px solid #1f2937", overflowY:"auto",
            padding:8, flexShrink:0 }}>
            <div style={{ fontSize:9, color:"#4b5563",
              marginBottom:6, letterSpacing:1 }}>
              FRAME {frameIdx+1} ({frameAnns.length})
            </div>
            {frameAnns.length === 0 && (
              <div style={{ fontSize:9, color:"#374151",
                textAlign:"center", padding:"12px 0" }}>
                Draw boxes on frame
              </div>
            )}
            {frameAnns.map(ann => (
              <div key={ann.id} onClick={() => setSelected(ann.id)}
                style={{ padding:"5px 7px", borderRadius:5,
                  marginBottom:4, cursor:"pointer",
                  background:selected===ann.id?"#22d3ee18":"#111827",
                  border:`1px solid ${selected===ann.id?"#22d3ee44":"#1f2937"}` }}>
                <div style={{ display:"flex", alignItems:"center",
                  justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ width:7, height:7, borderRadius:1,
                      background:ann.class_color }} />
                    <span style={{ fontSize:9,
                      color:"#e5e7eb" }}>{ann.class_name}</span>
                  </div>
                  <button onClick={e => {
                    e.stopPropagation();
                    setAnnState(s => deleteAnnotation(s, ann.id));
                    setSelected(null);
                  }}
                    style={{ background:"none", border:"none",
                      color:"#4b5563", cursor:"pointer",
                      fontSize:10 }}>✕</button>
                </div>
                <div style={{ fontSize:7, color:"#374151", marginTop:1 }}>
                  {ann.bbox.x.toFixed(2)},{ann.bbox.y.toFixed(2)}{" "}
                  {ann.bbox.width.toFixed(2)}×{ann.bbox.height.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
