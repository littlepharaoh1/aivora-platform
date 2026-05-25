/**
 * ImageAnnotationWorkstation.tsx — Production Image Annotation
 * Aivora Platform — Phase 15.1
 *
 * ✅ Pure HTML5 Canvas — no external deps
 * ✅ Pointer events (mouse + touch unified)
 * ✅ Zoom + pan via transform matrix
 * ✅ Normalized coords (0→1) always
 * ✅ Undo/redo via immutable state
 * ✅ Canvas cleanup on unmount
 * ✅ No re-render storm (useRef for canvas)
 */

import React, {
  useRef, useState, useEffect, useCallback, useReducer,
} from "react";
import {
  createAnnotationState, addAnnotation, updateAnnotation,
  deleteAnnotation, undoAnnotation, redoAnnotation,
  isBBoxValid, normalizeBBox, toYOLOLines,
  ANNOTATION_LIMITS,
} from "./annotationState";
import type { AnnotationState, Annotation, BBox } from "./annotationState";
import {
  SIMPLE_TAXONOMY, COCO_TAXONOMY, getClassById,
} from "./taxonomyEngine";
import type { Taxonomy, LabelClass } from "./taxonomyEngine";
import { sha256Bytes } from "../vision/imageGovernance";

// ── Tool types ────────────────────────────────────────────────────────────────

type Tool = "bbox" | "select" | "pan";

// ── Transform matrix for zoom/pan ─────────────────────────────────────────────

interface Transform {
  scale: number;
  tx:    number;
  ty:    number;
}

const DEFAULT_TRANSFORM: Transform = { scale:1, tx:0, ty:0 };

// Screen → image normalized coords
function screenToNorm(
  sx: number, sy: number,
  t:  Transform,
  canvasW: number, canvasH: number,
  imgW: number, imgH: number,
): { nx: number; ny: number } {
  const ix = (sx - t.tx) / t.scale;
  const iy = (sy - t.ty) / t.scale;
  return {
    nx: Math.max(0, Math.min(1, ix / imgW)),
    ny: Math.max(0, Math.min(1, iy / imgH)),
  };
}

// Image normalized → screen coords
function normToScreen(
  nx: number, ny: number,
  t:  Transform,
  imgW: number, imgH: number,
): { sx: number; sy: number } {
  return {
    sx: nx * imgW * t.scale + t.tx,
    sy: ny * imgH * t.scale + t.ty,
  };
}

// ── Canvas renderer ───────────────────────────────────────────────────────────

function renderCanvas(
  canvas:    HTMLCanvasElement,
  img:       HTMLImageElement,
  state:     AnnotationState,
  transform: Transform,
  selected:  string | null,
  drawing:   { sx:number; sy:number; ex:number; ey:number } | null,
  activeColor: string,
) {
  const ctx = canvas.getContext("2d");
  if(!ctx) return;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Draw image
  const iw = img.naturalWidth  * transform.scale;
  const ih = img.naturalHeight * transform.scale;
  ctx.drawImage(img, transform.tx, transform.ty, iw, ih);

  // Draw annotations
  for(const ann of state.annotations) {
    const { sx, sy } = normToScreen(
      ann.bbox.x, ann.bbox.y, transform,
      img.naturalWidth, img.naturalHeight,
    );
    const bw = ann.bbox.width  * img.naturalWidth  * transform.scale;
    const bh = ann.bbox.height * img.naturalHeight * transform.scale;
    const isSelected = ann.id === selected;

    // Fill
    ctx.fillStyle = ann.is_ai ? `${ann.class_color}22` : `${ann.class_color}18`;
    ctx.fillRect(sx, sy, bw, bh);

    // Border
    ctx.strokeStyle = isSelected ? "#ffffff" : ann.class_color;
    ctx.lineWidth   = isSelected ? 2 : 1.5;
    if(ann.is_ai && !ann.is_approved) {
      ctx.setLineDash([4, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.strokeRect(sx, sy, bw, bh);
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = ann.class_color;
    ctx.font = "11px 'JetBrains Mono', monospace";
    const label = ann.is_ai ? `${ann.class_name}?` : ann.class_name;
    ctx.fillText(label, sx + 3, sy - 3);

    // Resize handle if selected
    if(isSelected) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx + bw - 5, sy + bh - 5, 8, 8);
      ctx.strokeStyle = ann.class_color;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + bw - 5, sy + bh - 5, 8, 8);
    }
  }

  // Draw in-progress bbox
  if(drawing) {
    const dx = drawing.ex - drawing.sx;
    const dy = drawing.ey - drawing.sy;
    ctx.strokeStyle = activeColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      Math.min(drawing.sx, drawing.ex),
      Math.min(drawing.sy, drawing.ey),
      Math.abs(dx), Math.abs(dy),
    );
    ctx.fillStyle = `${activeColor}18`;
    ctx.fillRect(
      Math.min(drawing.sx, drawing.ex),
      Math.min(drawing.sy, drawing.ey),
      Math.abs(dx), Math.abs(dy),
    );
    ctx.setLineDash([]);
  }
}

// ── Hit test ──────────────────────────────────────────────────────────────────

function hitTest(
  sx: number, sy: number,
  state: AnnotationState,
  transform: Transform,
  imgW: number, imgH: number,
): string | null {
  // Reverse order — last drawn = topmost
  for(let i = state.annotations.length - 1; i >= 0; i--) {
    const ann = state.annotations[i];
    const { sx:ax, sy:ay } = normToScreen(
      ann.bbox.x, ann.bbox.y, transform, imgW, imgH,
    );
    const bw = ann.bbox.width  * imgW * transform.scale;
    const bh = ann.bbox.height * imgH * transform.scale;
    if(sx >= ax && sx <= ax + bw && sy >= ay && sy <= ay + bh)
      return ann.id;
  }
  return null;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  imageFile?: File;
  frameIndex?: number | null;
  initialState?: AnnotationState;
  onStateChange?: (state: AnnotationState) => void;
}

export default function ImageAnnotationWorkstation({
  imageFile, frameIndex = null,
  initialState, onStateChange,
}: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imgRef     = useRef<HTMLImageElement | null>(null);
  const imgUrlRef  = useRef<string | null>(null);

  const [annState,  setAnnState]  = useState<AnnotationState>(
    initialState ?? createAnnotationState(crypto.randomUUID())
  );
  const [tool,      setTool]      = useState<Tool>("bbox");
  const [taxonomy,  setTaxonomy]  = useState<Taxonomy>(SIMPLE_TAXONOMY);
  const [activeClass, setActiveClass] = useState<LabelClass>(
    SIMPLE_TAXONOMY.classes[0]
  );
  const [selected,  setSelected]  = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM);
  const [drawing,   setDrawing]   = useState<{
    sx:number; sy:number; ex:number; ey:number
  } | null>(null);
  const [panStart,  setPanStart]  = useState<{
    sx:number; sy:number; tx:number; ty:number
  } | null>(null);
  const [internalFile, setInternalFile] = useState<File | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageSize,   setImageSize]   = useState({ w:0, h:0 });
  const [checksum,    setChecksum]    = useState<string | null>(null);
  const activeFile = imageFile ?? internalFile;

  // ── Load image ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if(!activeFile) return;
    const url = URL.createObjectURL(activeFile);
    imgUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageSize({ w:img.naturalWidth, h:img.naturalHeight });
      setImageLoaded(true);
      setTransform(DEFAULT_TRANSFORM);
      setAnnState(createAnnotationState(crypto.randomUUID()));
      setSelected(null);
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
      imgUrlRef.current = null;
      imgRef.current = null;
      setImageLoaded(false);
    };
  }, [activeFile]);

  // ── Render loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if(!canvas || !img || !imageLoaded) return;
    renderCanvas(canvas, img, annState, transform,
      selected, drawing, activeClass.color);
  }, [annState, transform, selected, drawing, imageLoaded, activeClass]);

  // ── Resize canvas ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ro = new ResizeObserver(entries => {
      for(const e of entries) {
        canvas.width  = e.contentRect.width;
        canvas.height = e.contentRect.height;
      }
    });
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, []);

  // ── Notify parent ────────────────────────────────────────────────────────────
  useEffect(() => {
    onStateChange?.(annState);
  }, [annState]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if(e.target instanceof HTMLInputElement) return;
      if((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        setAnnState(s => undoAnnotation(s));
      }
      if((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        setAnnState(s => redoAnnotation(s));
      }
      if(e.key === "Delete" || e.key === "Backspace") {
        if(selected) setAnnState(s => deleteAnnotation(s, selected));
        setSelected(null);
      }
      if(e.key === "b") setTool("bbox");
      if(e.key === "v") setTool("select");
      if(e.key === "h") setTool("pan");
      if(e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);

  // ── Pointer events ────────────────────────────────────────────────────────────

  const getPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if(!imageLoaded || !imgRef.current) return;
    const { sx, sy } = getPos(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    if(tool === "pan") {
      setPanStart({ sx, sy, tx:transform.tx, ty:transform.ty });
      return;
    }
    if(tool === "select") {
      const hit = hitTest(sx, sy, annState, transform,
        imgRef.current.naturalWidth, imgRef.current.naturalHeight);
      setSelected(hit);
      return;
    }
    if(tool === "bbox") {
      setDrawing({ sx, sy, ex:sx, ey:sy });
      setSelected(null);
    }
  }, [tool, transform, annState, imageLoaded]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if(!imageLoaded || !imgRef.current) return;
    const { sx, sy } = getPos(e);

    if(panStart) {
      setTransform(t => ({
        ...t,
        tx: panStart.tx + (sx - panStart.sx),
        ty: panStart.ty + (sy - panStart.sy),
      }));
      return;
    }
    if(drawing) {
      setDrawing(d => d ? { ...d, ex:sx, ey:sy } : null);
    }
  }, [panStart, drawing, imageLoaded]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if(!imageLoaded || !imgRef.current) return;
    const { sx, sy } = getPos(e);

    setPanStart(null);

    if(drawing && tool === "bbox") {
      const img = imgRef.current;
      // Convert screen coords to normalized
      const { nx:nx1, ny:ny1 } = screenToNorm(
        drawing.sx, drawing.sy, transform,
        canvasRef.current!.width, canvasRef.current!.height,
        img.naturalWidth, img.naturalHeight,
      );
      const { nx:nx2, ny:ny2 } = screenToNorm(
        sx, sy, transform,
        canvasRef.current!.width, canvasRef.current!.height,
        img.naturalWidth, img.naturalHeight,
      );
      const bbox: BBox = {
        x: nx1, y: ny1,
        width:  nx2 - nx1,
        height: ny2 - ny1,
      };
      const normalized = normalizeBBox(bbox);
      if(isBBoxValid(normalized)) {
        setAnnState(s => addAnnotation(
          s, normalized,
          activeClass.id, activeClass.name, activeClass.color,
          frameIndex,
        ));
      }
      setDrawing(null);
    }
  }, [drawing, tool, transform, activeClass, frameIndex, imageLoaded]);

  // ── Wheel zoom ───────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(t => {
      const newScale = Math.max(0.1, Math.min(10, t.scale * delta));
      const ratio    = newScale / t.scale;
      return {
        scale: newScale,
        tx:    mx - ratio * (mx - t.tx),
        ty:    my - ratio * (my - t.ty),
      };
    });
  }, []);

  const approvedCount = annState.annotations.filter(a => a.is_approved).length;
  const aiCount       = annState.annotations.filter(a => a.is_ai && !a.is_approved).length;

  return (
    <div style={{ display:"flex", height:"100%", background:"#080c14",
      fontFamily:"'JetBrains Mono', monospace", color:"#e5e7eb" }}>

      {/* Left toolbar */}
      <div style={{ width:48, background:"#0d1117", borderRight:"1px solid #1f2937",
        display:"flex", flexDirection:"column", alignItems:"center",
        padding:"8px 0", gap:4, flexShrink:0 }}>
        {([
          { t:"bbox"   as Tool, icon:"⬜", tip:"Draw BBox (B)" },
          { t:"select" as Tool, icon:"↖",  tip:"Select (V)"   },
          { t:"pan"    as Tool, icon:"✋",  tip:"Pan (H)"      },
        ] as const).map(({ t, icon, tip }) => (
          <button key={t} title={tip} onClick={() => setTool(t)}
            style={{ width:36, height:36, borderRadius:6,
              background:tool===t?"#22d3ee22":"transparent",
              border:tool===t?"1px solid #22d3ee":"1px solid transparent",
              color:tool===t?"#22d3ee":"#6b7280",
              fontSize:16, cursor:"pointer" }}>
            {icon}
          </button>
        ))}
        <div style={{ flex:1 }} />
        <button title="Undo (Ctrl+Z)"
          onClick={() => setAnnState(s => undoAnnotation(s))}
          disabled={annState.history.length === 0}
          style={{ width:36, height:36, border:"1px solid #1f2937",
            borderRadius:6, background:"transparent",
            color:annState.history.length>0?"#9ca3af":"#374151",
            fontSize:14, cursor:"pointer" }}>↩</button>
        <button title="Redo (Ctrl+Y)"
          onClick={() => setAnnState(s => redoAnnotation(s))}
          disabled={annState.future.length === 0}
          style={{ width:36, height:36, border:"1px solid #1f2937",
            borderRadius:6, background:"transparent",
            color:annState.future.length>0?"#9ca3af":"#374151",
            fontSize:14, cursor:"pointer" }}>↪</button>
      </div>

      {/* Canvas area */}
      <div style={{ flex:1, position:"relative", overflow:"hidden",
        background:"#111827" }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if(f && f.type.startsWith("image/")) setInternalFile(f);
        }}>
        {!imageLoaded && (
          <div style={{ position:"absolute", inset:0, display:"flex",
            alignItems:"center", justifyContent:"center",
            flexDirection:"column", gap:16, color:"#4b5563" }}>
            <div style={{ fontSize:48 }}>🖼️</div>
            <div style={{ fontSize:13, color:"#6b7280" }}>
              Load an image to start annotating
            </div>
            <label style={{ padding:"10px 24px", background:"#22d3ee22",
              border:"1px solid #22d3ee", borderRadius:8,
              color:"#22d3ee", fontSize:12, cursor:"pointer",
              fontFamily:"'JetBrains Mono', monospace" }}>
              📂 Open Image
              <input type="file" accept="image/*"
                style={{ display:"none" }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if(f) setInternalFile(f);
                }} />
            </label>
            <div style={{ fontSize:10, color:"#374151" }}>
              JPG · PNG · WebP · or drag & drop
            </div>
          </div>
        )}
        <canvas ref={canvasRef}
          style={{ width:"100%", height:"100%",
            cursor:tool==="pan"?"grab":tool==="bbox"?"crosshair":"default" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel} />

        {/* Status bar */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0,
          background:"#0a0f1a88", padding:"4px 12px",
          display:"flex", gap:16, fontSize:9, color:"#6b7280" }}>
          <span>Tool: <b style={{color:"#22d3ee"}}>{tool.toUpperCase()}</b></span>
          <span>Zoom: <b style={{color:"#22d3ee"}}>{(transform.scale*100).toFixed(0)}%</b></span>
          <span>Annotations: <b style={{color:"#22c55e"}}>{approvedCount}</b></span>
          {aiCount > 0 && <span>AI pending: <b style={{color:"#f59e0b"}}>{aiCount}</b></span>}
          <span>Max: {ANNOTATION_LIMITS.MAX_ANNOTATIONS}</span>
          {imageLoaded && <span>
            {imageSize.w}×{imageSize.h}px
          </span>}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ width:200, background:"#0d1117",
        borderLeft:"1px solid #1f2937", display:"flex",
        flexDirection:"column", flexShrink:0, overflow:"hidden" }}>

        {/* Class selector */}
        <div style={{ padding:"8px", borderBottom:"1px solid #1f2937" }}>
          <div style={{ fontSize:9, color:"#4b5563", marginBottom:6,
            letterSpacing:1 }}>LABEL CLASS</div>
          <div style={{ display:"flex", gap:4, marginBottom:6 }}>
            {[
              { t:SIMPLE_TAXONOMY, label:"Simple" },
              { t:COCO_TAXONOMY,   label:"COCO"   },
            ].map(({ t, label }) => (
              <button key={label} onClick={() => {
                setTaxonomy(t);
                setActiveClass(t.classes[0]);
              }}
                style={{ flex:1, padding:"3px 0", fontSize:9, cursor:"pointer",
                  borderRadius:4, border:`1px solid ${taxonomy.id===t.id?"#22d3ee":"#1f2937"}`,
                  background:taxonomy.id===t.id?"#22d3ee22":"transparent",
                  color:taxonomy.id===t.id?"#22d3ee":"#6b7280" }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ maxHeight:160, overflowY:"auto" }}>
            {taxonomy.classes.map(cls => (
              <div key={cls.id} onClick={() => setActiveClass(cls)}
                style={{ display:"flex", alignItems:"center", gap:6,
                  padding:"4px 6px", borderRadius:4, cursor:"pointer",
                  background:activeClass.id===cls.id?"#22d3ee18":"transparent",
                  border:activeClass.id===cls.id?"1px solid #22d3ee33":"1px solid transparent" }}>
                <div style={{ width:10, height:10, borderRadius:2,
                  background:cls.color, flexShrink:0 }} />
                <span style={{ fontSize:10,
                  color:activeClass.id===cls.id?"#e5e7eb":"#9ca3af",
                  overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap" }}>{cls.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Annotation list */}
        <div style={{ flex:1, overflowY:"auto", padding:8 }}>
          <div style={{ fontSize:9, color:"#4b5563", marginBottom:6,
            letterSpacing:1 }}>ANNOTATIONS ({annState.annotations.length})</div>
          {annState.annotations.length === 0 && (
            <div style={{ fontSize:10, color:"#374151", textAlign:"center",
              padding:"20px 0" }}>
              Draw boxes on image
            </div>
          )}
          {annState.annotations.map(ann => (
            <div key={ann.id} onClick={() => setSelected(ann.id)}
              style={{ padding:"6px 8px", borderRadius:6, marginBottom:4,
                cursor:"pointer",
                background:selected===ann.id?"#22d3ee18":"#111827",
                border:`1px solid ${selected===ann.id?"#22d3ee44":"#1f2937"}` }}>
              <div style={{ display:"flex", alignItems:"center",
                justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <div style={{ width:8, height:8, borderRadius:2,
                    background:ann.class_color }} />
                  <span style={{ fontSize:10, color:"#e5e7eb" }}>
                    {ann.class_name}
                  </span>
                  {ann.is_ai && !ann.is_approved && (
                    <span style={{ fontSize:8, color:"#f59e0b" }}>AI</span>
                  )}
                </div>
                <button onClick={e => {
                  e.stopPropagation();
                  setAnnState(s => deleteAnnotation(s, ann.id));
                  setSelected(null);
                }}
                  style={{ background:"none", border:"none",
                    color:"#4b5563", cursor:"pointer", fontSize:11 }}>✕</button>
              </div>
              <div style={{ fontSize:8, color:"#4b5563", marginTop:2 }}>
                {(ann.bbox.x).toFixed(3)},{(ann.bbox.y).toFixed(3)}&nbsp;
                {(ann.bbox.width).toFixed(3)}×{(ann.bbox.height).toFixed(3)}
              </div>
              {ann.is_ai && !ann.is_approved && (
                <button onClick={e => {
                  e.stopPropagation();
                  setAnnState(s => updateAnnotation(s, ann.id,
                    { is_approved:true }));
                }}
                  style={{ width:"100%", marginTop:4, padding:"2px 0",
                    fontSize:9, background:"#22c55e22",
                    border:"1px solid #22c55e44", color:"#22c55e",
                    borderRadius:3, cursor:"pointer" }}>
                  ✓ Approve
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Export */}
        {annState.annotations.length > 0 && (
          <div style={{ padding:8, borderTop:"1px solid #1f2937" }}>
            <button onClick={() => {
              const lines = toYOLOLines(annState.annotations, taxonomy.classes.length);
              const blob  = new Blob([lines], { type:"text/plain" });
              const a     = document.createElement("a");
              a.href      = URL.createObjectURL(blob);
              a.download  = "annotations.txt";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
              style={{ width:"100%", padding:"6px 0", fontSize:10,
                background:"#0891b2", color:"#fff", border:"none",
                borderRadius:5, cursor:"pointer", fontWeight:700 }}>
              📤 YOLO Export
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
