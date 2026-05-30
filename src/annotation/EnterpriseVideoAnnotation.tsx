/**
 * EnterpriseVideoAnnotation.tsx
 * Aivora Platform — Phase 15.3
 *
 * Enterprise Video Annotation Workstation.
 * Frame extraction via existing videoRuntime.ts.
 * Multi-object tracking + linear interpolation.
 * Timeline editor. Shot segmentation. QA review.
 * Worker architecture — zero UI blocking.
 */

import React, {
  useState, useRef, useCallback, useEffect, memo,
} from "react";
import { extractFrames, VIDEO_LIMITS } from "../video/videoRuntime";
import type { VideoExtractionConfig } from "../video/videoRuntime";
import {
  createVideoState, undoVideoState, redoVideoState,
  createTrack, deleteTrack, toggleTrackActive, selectTrack,
  addKeyframe, deleteKeyframe, updateKeyframe, setQAFlagVideo,
  interpolateTrack, addShot, deleteShot,
  goToFrame, setTool, setFramesMeta,
  getFrameKeyframes, computeVideoStats, normalizeBBoxV,
} from "./videoAnnotationState";
import { exportVideoAnnotations } from "./videoAnnotationExport";
import type {
  VideoAnnotationState, Track, Keyframe,
  VideoTool, VideoExportFormat, VideoQAFlag, VBBox,
} from "./videoAnnotationTypes";
import { VIDEO_SHORTCUTS } from "./videoAnnotationTypes";
import { COCO_TAXONOMY } from "./taxonomyEngine";
import { emitEvent } from "../lib/telemetry/emitter";
import { enqueueMutation } from "../lib/offline/mutationQueue";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Btn({ label, onClick, color="#6b7280", active=false, title="", disabled=false }: {
  label:string; onClick:()=>void; color?:string;
  active?:boolean; title?:string; disabled?:boolean;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      padding:"3px 9px", borderRadius:5, fontSize:10, cursor:disabled?"not-allowed":"pointer",
      border:`1px solid ${active?color:"#1f2937"}`,
      background:active?`${color}18`:"transparent",
      color:disabled?"#374151":active?color:"#6b7280",
      fontFamily:"inherit", whiteSpace:"nowrap", transition:"all 0.15s",
    }}>{label}</button>
  );
}

function timeStr(sec: number): string {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  if(h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}

// ── Track row ─────────────────────────────────────────────────────────────────

const TrackRow = memo(function TrackRow({
  track, selected, keyframeCount, onSelect, onDelete, onToggle,
}: {
  track:         Track;
  selected:      boolean;
  keyframeCount: number;
  onSelect:      ()=>void;
  onDelete:      ()=>void;
  onToggle:      ()=>void;
}) {
  return (
    <div onClick={onSelect} style={{
      display:"flex", alignItems:"center", gap:6, padding:"5px 10px",
      cursor:"pointer", borderBottom:"1px solid #111",
      background:selected?"rgba(255,255,255,0.05)":"transparent",
      borderLeft:`2px solid ${selected?track.color:"transparent"}`,
    }}>
      <div style={{width:8,height:8,borderRadius:2,background:track.color,flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,fontWeight:700,color:selected?track.color:"#e5e7eb",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {track.label}
        </div>
        <div style={{fontSize:9,color:"#4b5563"}}>{keyframeCount} keyframes</div>
      </div>
      <button onClick={e=>{e.stopPropagation();onToggle();}}
        style={{background:"none",border:"none",cursor:"pointer",
          color:track.is_active?"#22c55e":"#374151",fontSize:10,padding:"0 2px"}}>
        {track.is_active?"●":"○"}
      </button>
      <button onClick={e=>{e.stopPropagation();onDelete();}}
        style={{background:"none",border:"none",cursor:"pointer",
          color:"#ef444466",fontSize:10,padding:"0 2px"}}>✕</button>
    </div>
  );
});

// ── Timeline ──────────────────────────────────────────────────────────────────

const Timeline = memo(function Timeline({
  state, totalFrames, onFrameClick, onKeyframeClick,
}: {
  state:           VideoAnnotationState;
  totalFrames:     number;
  onFrameClick:    (f:number)=>void;
  onKeyframeClick: (kf:Keyframe)=>void;
}) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const TRACK_H  = 20;
  const HEADER_H = 20;

  if(totalFrames === 0) return null;

  const svgW  = svgRef.current?.clientWidth ?? 600;
  const scale = svgW / totalFrames;

  // Build track rows
  const trackRows = state.tracks.map((track, ti) => {
    const kfs = state.keyframes.filter(k => k.track_id === track.id);
    const y   = HEADER_H + ti * TRACK_H;
    return { track, kfs, y };
  });

  const totalH = HEADER_H + state.tracks.length * TRACK_H + 4;

  return (
    <svg ref={svgRef} width="100%" height={totalH}
      style={{display:"block",cursor:"pointer"}}
      onClick={e => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const x    = e.clientX - rect.left;
        const f    = Math.round(x / scale);
        onFrameClick(Math.max(0, Math.min(totalFrames-1, f)));
      }}
    >
      {/* Frame ruler */}
      {Array.from({length:Math.min(20, totalFrames)}, (_,i) => {
        const step = Math.ceil(totalFrames / 20);
        const fi   = i * step;
        const x    = fi * scale;
        return (
          <g key={fi}>
            <line x1={x} y1={0} x2={x} y2={HEADER_H} stroke="#1f2937" strokeWidth={1}/>
            <text x={x+2} y={12} fill="#374151" fontSize={8} fontFamily="monospace">
              {fi}
            </text>
          </g>
        );
      })}

      {/* Track rows */}
      {trackRows.map(({track, kfs, y}) => (
        <g key={track.id}>
          {/* Track background */}
          <rect x={0} y={y} width="100%" height={TRACK_H}
            fill={state.selected_track_id===track.id?"rgba(255,255,255,0.03)":"transparent"}/>

          {/* Interpolated segments */}
          {kfs.filter(k=>k.is_interpolated).map(kf => (
            <rect key={kf.id}
              x={kf.frame_index*scale} y={y+4}
              width={Math.max(1, scale)} height={TRACK_H-8}
              fill={`${track.color}44`}/>
          ))}

          {/* Manual keyframes */}
          {kfs.filter(k=>!k.is_interpolated).map(kf => (
            <rect key={kf.id}
              x={kf.frame_index*scale-3} y={y+2}
              width={Math.max(3,scale)+3} height={TRACK_H-4}
              fill={track.color}
              onClick={e=>{e.stopPropagation();onKeyframeClick(kf);}}
              style={{cursor:"pointer"}}
            />
          ))}
        </g>
      ))}

      {/* Playhead */}
      <line
        x1={state.current_frame*scale} y1={0}
        x2={state.current_frame*scale} y2={totalH}
        stroke="#22d3ee" strokeWidth={1.5}/>
    </svg>
  );
});

// ── Canvas renderer for current frame ─────────────────────────────────────────

function renderFrame(
  ctx:          CanvasRenderingContext2D,
  canvas:       HTMLCanvasElement,
  bitmap:       ImageBitmap | null,
  keyframes:    Keyframe[],
  tracks:       Track[],
  selectedKfId: string | null,
  drawState:    DrawState,
): void {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#080c14";
  ctx.fillRect(0, 0, W, H);

  if(bitmap) ctx.drawImage(bitmap, 0, 0, W, H);

  const trackMap = new Map(tracks.map(t=>[t.id,t]));

  keyframes.forEach(kf => {
    const track    = trackMap.get(kf.track_id);
    if(!track || !track.is_active) return;
    const selected = kf.id === selectedKfId;
    const col      = track.color;
    const b        = kf.bbox;
    const px=b.x*W, py=b.y*H, pw=b.width*W, ph=b.height*H;
    const lw       = selected ? 2.5 : kf.is_interpolated ? 1 : 1.8;

    ctx.fillStyle   = kf.is_interpolated ? `${col}10` : `${col}18`;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = selected ? "#fff" : col;
    ctx.lineWidth   = lw;
    if(kf.is_interpolated) ctx.setLineDash([4,4]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);

    // Corner handles when selected
    if(selected) {
      const hs = 6;
      [[px,py],[px+pw,py],[px,py+ph],[px+pw,py+ph]].forEach(([hx,hy])=>{
        ctx.fillStyle="#fff"; ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs);
      });
    }

    // Label chip
    const fs = 11;
    ctx.font      = `bold ${fs}px Inter,system-ui`;
    const tw      = ctx.measureText(track.label).width;
    ctx.fillStyle = col;
    ctx.fillRect(px, py - fs - 4, tw + 8, fs + 4);
    ctx.fillStyle = "#fff";
    ctx.fillText(track.label, px + 4, py - 4);

    // Occluded marker
    if(kf.occluded) {
      ctx.font      = "9px system-ui";
      ctx.fillStyle = "#f59e0b";
      ctx.fillText("⊘", px + pw - 14, py + 12);
    }

    // QA flag
    if(kf.qa_flag) {
      ctx.font      = "9px system-ui";
      ctx.fillStyle = "#f59e0b";
      ctx.fillText("⚑", px + 2, py + 12);
    }
  });

  // In-progress BBox
  if(drawState.active && drawState.startPt && drawState.curPt) {
    const x1=drawState.startPt.x*W, y1=drawState.startPt.y*H;
    const x2=drawState.curPt.x*W,   y2=drawState.curPt.y*H;
    ctx.strokeStyle = drawState.color; ctx.lineWidth = 2;
    ctx.setLineDash([4,4]);
    ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
    ctx.setLineDash([]);
    ctx.fillStyle = `${drawState.color}18`;
    ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
  }
}

interface DrawState {
  active:  boolean;
  startPt: {x:number;y:number} | null;
  curPt:   {x:number;y:number} | null;
  color:   string;
}

const EMPTY_DRAW: DrawState = { active:false, startPt:null, curPt:null, color:"#22d3ee" };

// ── Main Component ────────────────────────────────────────────────────────────

export interface EnterpriseVideoAnnotationProps {
  onClose?: ()=>void;
}

export default function EnterpriseVideoAnnotation({ onClose }: EnterpriseVideoAnnotationProps) {
  const [annState,   setAnnState]  = useState<VideoAnnotationState | null>(null);
  const [frames,     setFrames]    = useState<Map<number, ImageBitmap>>(new Map());
  const [loading,    setLoading]   = useState(false);
  const [loadPct,    setLoadPct]   = useState(0);
  const [isDirty,    setIsDirty]   = useState(false);
  const [isSaving,   setIsSaving]  = useState(false);
  const [newLabel,   setNewLabel]  = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(0);

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawRef    = useRef<DrawState>({ ...EMPTY_DRAW });
  const rafRef     = useRef<number>(0);
  const fileRef    = useRef<HTMLInputElement>(null);
  const autoSaveRef= useRef<ReturnType<typeof setInterval>|null>(null);

  const taxonomy = COCO_TAXONOMY;

  // ── setState wrapper ────────────────────────────────────────────────────────
  const setState = useCallback((s: VideoAnnotationState) => {
    setAnnState(s);
    setIsDirty(true);
  }, []);

  // ── Canvas resize ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const parent = canvas.parentElement;
    if(!parent) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = parent.clientWidth;
      canvas.height = parent.clientHeight;
    });
    ro.observe(parent);
    canvas.width  = parent.clientWidth;
    canvas.height = parent.clientHeight;
    return () => ro.disconnect();
  }, []);

  // ── Render current frame ────────────────────────────────────────────────────
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if(!canvas || !annState) return;
      const ctx = canvas.getContext("2d");
      if(!ctx) return;
      const bitmap = frames.get(annState.current_frame) ?? null;
      const kfs    = getFrameKeyframes(annState, annState.current_frame);
      renderFrame(ctx, canvas, bitmap, kfs, annState.tracks,
        annState.selected_kf_id, drawRef.current);
    });
  }, [annState, frames]);

  // ── File load ───────────────────────────────────────────────────────────────
  const handleFileLoad = useCallback(async (file: File) => {
    setLoading(true);
    setLoadPct(0);

    const config: VideoExtractionConfig = {
      fps:        2,
      max_frames: VIDEO_LIMITS.MAX_ACTIVE_FRAMES,
    };

    const corrId = crypto.randomUUID();
    const result = await extractFrames(file, config, corrId);

    if(!result) { setLoading(false); return; }

    // Convert ImageData → ImageBitmap
    const bitmapMap = new Map<number, ImageBitmap>();
    for(let i = 0; i < result.frames.length; i++) {
      const f   = result.frames[i];
      const bmp = await createImageBitmap(f.data);
      bitmapMap.set(f.index, bmp);
      setLoadPct(Math.round(((i+1)/result.frames.length)*100));
    }
    setFrames(bitmapMap);

    const videoId = crypto.randomUUID();
    const state   = createVideoState({
      video_id:     videoId,
      filename:     file.name,
      duration_s:   result.duration_s,
      fps:          config.fps,
      width:        result.frames[0]?.width  ?? 1920,
      height:       result.frames[0]?.height ?? 1080,
      total_frames: result.frames.length,
    });

    const withMeta = setFramesMeta(state, result.frames.map(f => ({
      index:       f.index,
      timestamp_s: parseFloat(f.timestamp_s.toFixed(3)),
      width:       f.width,
      height:      f.height,
      checksum:    f.checksum,
    })));

    setAnnState(withMeta);
    setIsDirty(false);
    setLoading(false);

    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:corrId, severity:"info",
      payload:{ action:"VIDEO_LOADED", filename:file.name, frames:result.frames.length },
    });
  }, []);

  // ── Canvas pointer events ───────────────────────────────────────────────────
  const getCanvasNorm = useCallback((e: React.PointerEvent): {x:number;y:number} => {
    const canvas = canvasRef.current;
    if(!canvas) return {x:0,y:0};
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if(!annState) return;
    if(annState.active_tool === "bbox" && annState.selected_track_id) {
      const p = getCanvasNorm(e);
      const track = annState.tracks.find(t=>t.id===annState.selected_track_id);
      drawRef.current = { active:true, startPt:p, curPt:p, color:track?.color??"#22d3ee" };
    }
  }, [annState, getCanvasNorm]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if(!drawRef.current.active) return;
    const p = getCanvasNorm(e);
    drawRef.current = { ...drawRef.current, curPt:p };
    // Trigger re-render
    const canvas = canvasRef.current;
    if(!canvas || !annState) return;
    const ctx = canvas.getContext("2d");
    if(!ctx) return;
    const bitmap = frames.get(annState.current_frame) ?? null;
    const kfs    = getFrameKeyframes(annState, annState.current_frame);
    renderFrame(ctx, canvas, bitmap, kfs, annState.tracks,
      annState.selected_kf_id, drawRef.current);
  }, [annState, frames, getCanvasNorm]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if(!annState || !drawRef.current.active || !drawRef.current.startPt) return;
    const p = getCanvasNorm(e);
    const raw: VBBox = {
      x:      drawRef.current.startPt.x,
      y:      drawRef.current.startPt.y,
      width:  p.x - drawRef.current.startPt.x,
      height: p.y - drawRef.current.startPt.y,
    };
    const bbox = normalizeBBoxV(raw);
    drawRef.current = { ...EMPTY_DRAW };
    if(bbox.width < 0.01 || bbox.height < 0.01) return;
    if(!annState.selected_track_id) return;
    setState(addKeyframe(annState, annState.selected_track_id, annState.current_frame, bbox));
  }, [annState, getCanvasNorm, setState]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if(!annState) return;
    const h = (e: KeyboardEvent) => {
      if(e.target instanceof HTMLInputElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if(ctrl && e.key==="z") { setState(undoVideoState(annState)); return; }
      if(ctrl && (e.key==="y"||(e.key==="z"&&e.shiftKey))) { setState(redoVideoState(annState)); return; }
      if(ctrl && e.key==="s") { e.preventDefault(); handleSave(); return; }
      if(e.key==="ArrowRight") { setState(goToFrame(annState, annState.current_frame + (e.shiftKey?10:1))); return; }
      if(e.key==="ArrowLeft")  { setState(goToFrame(annState, annState.current_frame - (e.shiftKey?10:1))); return; }
      if(e.key==="Home"||e.key==="0") { setState(goToFrame(annState, 0)); return; }
      if(e.key==="End") { setState(goToFrame(annState, annState.total_frames-1)); return; }
      if(e.key==="PageUp")   { setState(goToFrame(annState, annState.current_frame+100)); return; }
      if(e.key==="PageDown") { setState(goToFrame(annState, annState.current_frame-100)); return; }
      if(e.key==="b") { setState(setTool(annState,"bbox")); return; }
      if(e.key==="v") { setState(setTool(annState,"select")); return; }
      if(e.key==="Delete"&&annState.selected_kf_id) {
        setState(deleteKeyframe(annState, annState.selected_kf_id)); return;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [annState, setState]);

  // ── Auto-save ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if(!annState) return;
    setIsSaving(true);
    try {
      await enqueueMutation({
        mutation_type:  "video_evidence_insert",
        correlation_id: annState.video_id,
        payload:        annState as unknown as Record<string,unknown>,
      });
      setIsDirty(false);
    } finally { setIsSaving(false); }
  }, [annState]);

  useEffect(() => {
    if(autoSaveRef.current) clearInterval(autoSaveRef.current);
    if(isDirty && annState) autoSaveRef.current = setInterval(handleSave, 30_000);
    return () => { if(autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [isDirty, annState, handleSave]);

  // ── Add track ───────────────────────────────────────────────────────────────
  const handleAddTrack = useCallback(() => {
    if(!annState || !newLabel.trim()) return;
    setState(createTrack(annState, newLabel.trim(), selectedClassId));
    setNewLabel("");
  }, [annState, newLabel, selectedClassId, setState]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = annState ? computeVideoStats(annState) : null;

  // ── Current frame metadata ──────────────────────────────────────────────────
  const curMeta = annState?.frames_meta.find(f => f.index === annState.current_frame);
  const hasBitmap = annState ? frames.has(annState.current_frame) : false;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",
      background:"#080c14",color:"#e5e7eb",
      fontFamily:"'JetBrains Mono',monospace",overflow:"hidden"}}>

      {/* TOP BAR */}
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",
        borderBottom:"1px solid #1f2937",background:"#0a0f1a",
        flexShrink:0,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:700,color:"#22d3ee",letterSpacing:0.5,marginRight:4}}>
          VIDEO ANNOTATION
        </span>
        {!annState && (
          <>
            <Btn label="📂 Load Video" onClick={()=>fileRef.current?.click()} color="#a855f7"/>
            <input ref={fileRef} type="file" accept="video/*" style={{display:"none"}}
              onChange={e=>{ const f=e.target.files?.[0]; if(f) handleFileLoad(f); }}/>
          </>
        )}
        {annState && (
          <>
            <Btn label="↩" title="Undo" onClick={()=>setState(undoVideoState(annState))}
              color="#22d3ee" active={annState.history.length>0}/>
            <Btn label="↪" title="Redo" onClick={()=>setState(redoVideoState(annState))}
              color="#22d3ee" active={annState.future.length>0}/>
            <div style={{width:1,height:16,background:"#1f2937"}}/>
            <Btn label={annState.active_tool==="bbox"?"▭ BBox":"↖ Select"}
              onClick={()=>setState(setTool(annState, annState.active_tool==="bbox"?"select":"bbox"))}
              color="#f59e0b" active/>
            <div style={{width:1,height:16,background:"#1f2937"}}/>
            {(["coco_video","mot","yolo_video","jsonl"] as VideoExportFormat[]).map(fmt=>(
              <Btn key={fmt} label={fmt.replace("_"," ").toUpperCase()}
                onClick={()=>exportVideoAnnotations(annState,fmt)} color="#22d3ee"/>
            ))}
            <div style={{width:1,height:16,background:"#1f2937"}}/>
            <Btn label={isSaving?"Saving…":isDirty?"⬆ Save*":"✓ Saved"}
              onClick={handleSave} color={isDirty?"#f59e0b":"#22c55e"} active={isDirty}/>
          </>
        )}
        <Btn label="⌨" onClick={()=>setShowShortcuts(v=>!v)} color="#6b7280"/>
        {onClose && <Btn label="✕" onClick={onClose} color="#ef4444"/>}
        {annState && (
          <div style={{marginLeft:"auto",fontSize:9,color:"#374151"}}>
            {annState.filename} · {annState.total_frames} frames · {annState.tracks.length} tracks
          </div>
        )}
      </div>

      {/* Loading bar */}
      {loading && (
        <div style={{padding:"8px 16px",background:"#0a0f1a",borderBottom:"1px solid #1f2937",flexShrink:0}}>
          <div style={{fontSize:10,color:"#22d3ee",marginBottom:4}}>Extracting frames… {loadPct}%</div>
          <div style={{height:3,background:"#1f2937",borderRadius:2}}>
            <div style={{height:3,width:`${loadPct}%`,background:"#22d3ee",borderRadius:2,transition:"width 0.3s"}}/>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!annState && !loading && (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
          flexDirection:"column",gap:16,color:"#374151"}}>
          <div style={{fontSize:32}}>🎬</div>
          <div style={{fontSize:13}}>No video loaded</div>
          <Btn label="📂 Load Video" onClick={()=>fileRef.current?.click()}
            color="#a855f7" active/>
          <input ref={fileRef} type="file" accept="video/*" style={{display:"none"}}
            onChange={e=>{ const f=e.target.files?.[0]; if(f) handleFileLoad(f); }}/>
          <div style={{fontSize:9,color:"#1f2937"}}>
            Supports MP4, WebM, MOV · Up to 2 hours · {VIDEO_LIMITS.MAX_ACTIVE_FRAMES} frames extracted
          </div>
        </div>
      )}

      {annState && (
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* LEFT: Tracks panel */}
          <div style={{width:200,flexShrink:0,borderRight:"1px solid #1f2937",
            background:"#0a0f1a",display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* Add track */}
            <div style={{padding:"8px 10px",borderBottom:"1px solid #1f2937",flexShrink:0}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#374151",marginBottom:6}}>TRACKS</div>
              <select value={selectedClassId} onChange={e=>setSelectedClassId(+e.target.value)}
                style={{width:"100%",background:"#111",color:"#e5e7eb",
                  border:"1px solid #1f2937",borderRadius:5,padding:"3px 6px",
                  fontSize:10,marginBottom:5,outline:"none"}}>
                {taxonomy.classes.slice(0,20).map(c=>(
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div style={{display:"flex",gap:4}}>
                <input value={newLabel} onChange={e=>setNewLabel(e.target.value)}
                  placeholder="Track label…" onKeyDown={e=>e.key==="Enter"&&handleAddTrack()}
                  style={{flex:1,background:"#111",color:"#e5e7eb",
                    border:"1px solid #1f2937",borderRadius:5,
                    padding:"3px 8px",fontSize:10,outline:"none"}}/>
                <Btn label="+" onClick={handleAddTrack} color="#22d3ee"
                  disabled={!newLabel.trim()}/>
              </div>
            </div>

            {/* Track list */}
            <div style={{flex:1,overflowY:"auto"}}>
              {annState.tracks.length === 0 ? (
                <div style={{padding:16,textAlign:"center",fontSize:10,color:"#374151"}}>
                  No tracks.<br/>Add a track above.
                </div>
              ) : annState.tracks.map(track=>(
                <TrackRow key={track.id}
                  track={track}
                  selected={annState.selected_track_id===track.id}
                  keyframeCount={annState.keyframes.filter(k=>k.track_id===track.id).length}
                  onSelect={()=>setState(selectTrack(annState,track.id))}
                  onDelete={()=>setState(deleteTrack(annState,track.id))}
                  onToggle={()=>setState(toggleTrackActive(annState,track.id))}
                />
              ))}
            </div>

            {/* Interpolate button */}
            {annState.selected_track_id && (
              <div style={{padding:"8px 10px",borderTop:"1px solid #1f2937",flexShrink:0}}>
                <Btn label="⟳ Interpolate Track"
                  onClick={()=>setState(interpolateTrack(annState, annState.selected_track_id!))}
                  color="#a855f7" active/>
              </div>
            )}

            {/* Stats */}
            {stats && (
              <div style={{padding:"6px 10px",borderTop:"1px solid #1f2937",
                flexShrink:0,fontSize:9,color:"#374151",display:"flex",flexWrap:"wrap",gap:6}}>
                <span style={{color:"#22c55e"}}>KF:{stats.total_keyframes}</span>
                <span style={{color:"#a855f7"}}>I:{stats.interpolated}</span>
                <span style={{color:"#22d3ee"}}>F:{stats.frames_annotated}</span>
              </div>
            )}
          </div>

          {/* CENTER: Canvas + Timeline */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* Frame info bar */}
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"4px 12px",
              background:"#0a0f1a",borderBottom:"1px solid #1f2937",flexShrink:0,fontSize:9}}>
              <span style={{color:"#22d3ee"}}>
                Frame {annState.current_frame} / {annState.total_frames-1}
              </span>
              <span style={{color:"#6b7280"}}>
                {curMeta ? timeStr(curMeta.timestamp_s) : "--:--"}
              </span>
              <span style={{color:hasBitmap?"#22c55e":"#374151"}}>
                {hasBitmap?"● Frame loaded":"○ No frame"}
              </span>
              <span style={{color:"#374151"}}>
                {getFrameKeyframes(annState, annState.current_frame).length} annotations this frame
              </span>
              {annState.selected_track_id && (
                <span style={{color:"#f59e0b"}}>
                  Track: {annState.tracks.find(t=>t.id===annState.selected_track_id)?.label}
                </span>
              )}
            </div>

            {/* Canvas */}
            <div style={{flex:1,position:"relative",overflow:"hidden",background:"#050508"}}>
              <canvas ref={canvasRef}
                style={{display:"block",cursor:annState.active_tool==="bbox"&&annState.selected_track_id?"crosshair":"default"}}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
            </div>

            {/* Frame scrubber */}
            <div style={{padding:"6px 12px",background:"#0a0f1a",
              borderTop:"1px solid #1f2937",flexShrink:0}}>
              <input type="range" min={0} max={annState.total_frames-1}
                value={annState.current_frame}
                onChange={e=>setState(goToFrame(annState,+e.target.value))}
                style={{width:"100%",accentColor:"#22d3ee",cursor:"pointer"}}/>
            </div>

            {/* Timeline */}
            <div style={{background:"#0a0f1a",borderTop:"1px solid #1f2937",
              flexShrink:0,padding:"4px 12px",overflowX:"auto"}}>
              <Timeline
                state={annState}
                totalFrames={annState.total_frames}
                onFrameClick={f=>setState(goToFrame(annState,f))}
                onKeyframeClick={kf=>setState({...annState,selected_kf_id:kf.id})}
              />
            </div>
          </div>

          {/* RIGHT: Keyframe properties */}
          <div style={{width:180,flexShrink:0,borderLeft:"1px solid #1f2937",
            background:"#0a0f1a",overflow:"auto"}}>
            <div style={{padding:"8px 10px",borderBottom:"1px solid #1f2937"}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#374151",marginBottom:6}}>
                FRAME ANNOTATIONS
              </div>
              {getFrameKeyframes(annState, annState.current_frame).map(kf=>{
                const track = annState.tracks.find(t=>t.id===kf.track_id);
                const sel   = kf.id === annState.selected_kf_id;
                return (
                  <div key={kf.id}
                    onClick={()=>setState({...annState,selected_kf_id:kf.id})}
                    style={{padding:"5px 8px",cursor:"pointer",borderRadius:5,marginBottom:3,
                      background:sel?"rgba(255,255,255,0.05)":"transparent",
                      border:`1px solid ${sel?(track?.color??"#374151"):"transparent"}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <div style={{width:7,height:7,borderRadius:2,
                        background:track?.color??"#374151",flexShrink:0}}/>
                      <span style={{fontSize:10,color:sel?track?.color:"#9ca3af"}}>
                        {track?.label}
                      </span>
                      {kf.is_interpolated && <span style={{fontSize:8,color:"#4b5563"}}>~</span>}
                    </div>
                    <div style={{fontSize:9,color:"#4b5563",marginTop:2}}>
                      {(kf.confidence*100).toFixed(0)}% conf
                      {kf.occluded&&" · ⊘"}
                      {kf.qa_flag&&` · ⚑${kf.qa_flag}`}
                    </div>
                    {sel && (
                      <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
                        <Btn label="⊘" title="Occluded"
                          onClick={()=>setState(updateKeyframe(annState,kf.id,{occluded:!kf.occluded}))}
                          color="#f59e0b" active={kf.occluded}/>
                        <Btn label="✕ Del"
                          onClick={()=>setState(deleteKeyframe(annState,kf.id))} color="#ef4444"/>
                      </div>
                    )}
                  </div>
                );
              })}
              {getFrameKeyframes(annState, annState.current_frame).length===0 && (
                <div style={{fontSize:10,color:"#374151",padding:"8px 0"}}>
                  No annotations on this frame.
                  {annState.selected_track_id&&annState.active_tool==="bbox"
                    ?" Draw to annotate.":""
                  }
                </div>
              )}
            </div>

            {/* Shot segments */}
            <div style={{padding:"8px 10px"}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#374151",marginBottom:6}}>
                SHOT SEGMENTS
              </div>
              <Btn label="+ Add Shot"
                onClick={()=>{
                  const end = Math.min(annState.current_frame+30,annState.total_frames-1);
                  setState(addShot(annState,annState.current_frame,end,"Shot"));
                }} color="#3b82f6"/>
              <div style={{marginTop:8}}>
                {annState.shots.map(shot=>(
                  <div key={shot.id} style={{padding:"4px 6px",borderRadius:5,
                    background:"rgba(59,130,246,0.08)",border:"1px solid #1f2937",
                    marginBottom:3,fontSize:10}}>
                    <div style={{color:"#3b82f6"}}>
                      {shot.label} [{shot.start_frame}→{shot.end_frame}]
                    </div>
                    <button onClick={()=>setState(deleteShot(annState,shot.id))}
                      style={{background:"none",border:"none",color:"#ef444466",
                        cursor:"pointer",fontSize:9,padding:0}}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHORTCUTS MODAL */}
      {showShortcuts && (
        <div style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,0.75)",
          display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setShowShortcuts(false)}>
          <div style={{background:"#0a0f1a",border:"1px solid #1f2937",borderRadius:14,
            padding:20,minWidth:340,maxHeight:"75vh",overflowY:"auto"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,fontWeight:700,color:"#22d3ee",marginBottom:14}}>
              VIDEO ANNOTATION SHORTCUTS
            </div>
            {Object.entries(VIDEO_SHORTCUTS).map(([key,desc])=>(
              <div key={key} style={{display:"flex",justifyContent:"space-between",
                padding:"4px 0",borderBottom:"1px solid #111",fontSize:10}}>
                <span style={{color:"#22d3ee"}}>{key}</span>
                <span style={{color:"#6b7280"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STATUS BAR */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"3px 12px",
        borderTop:"1px solid #1f2937",background:"#0a0f1a",
        fontSize:9,color:"#374151",flexShrink:0}}>
        <span>AIVORA VIDEO ANNOTATION</span>
        <span>·</span>
        <span style={{color:isDirty?"#f59e0b":"#22c55e"}}>{isDirty?"● UNSAVED":"● SAVED"}</span>
        {annState && (
          <>
            <span>·</span>
            <span>{annState.active_tool.toUpperCase()}</span>
            <span>·</span>
            <span>Tracks:{annState.tracks.length}</span>
            <span>·</span>
            <span>KF:{annState.keyframes.length}</span>
            <span>·</span>
            <span>Undo:{annState.history.length}</span>
          </>
        )}
      </div>
    </div>
  );
}
