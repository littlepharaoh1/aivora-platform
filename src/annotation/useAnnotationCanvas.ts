/**
 * useAnnotationCanvas.ts — Enterprise Canvas Engine Hook
 * Aivora Platform — Phase 15.2
 *
 * Pure canvas rendering — no React re-renders during drawing.
 * Handles all tools: bbox, polygon, polyline, keypoints, segmentation.
 * Zoom/pan via transform matrix.
 * Smart snapping. Grid overlay. Review mode.
 */

import { useRef, useCallback, useEffect } from "react";
import type {
  EnterpriseAnnotationState, EnterpriseAnnotation,
  Transform, ToolConfig, Point, BBox, Keypoint,
} from "./annotationTypes";
import {
  normalizeBBox, clampPoint, snapPoint,
  hitTestAll, addAnnotation, updateAnnotation,
  deleteAnnotations, undoState, redoState,
  selectAnnotations, duplicateAnnotations,
  createAnnotation, bboxFromPoints,
} from "./enterpriseAnnotationState";

const MIN_SCALE = 0.1;
const MAX_SCALE = 40;

// ── Coord transforms ──────────────────────────────────────────────────────────

function screenToNorm(
  sx: number, sy: number,
  t: Transform,
  imgW: number, imgH: number,
): Point {
  const ix = (sx - t.tx) / t.scale;
  const iy = (sy - t.ty) / t.scale;
  return { x: ix / imgW, y: iy / imgH };
}

// ── Draw state ────────────────────────────────────────────────────────────────

interface DrawState {
  active:  boolean;
  tool:    string;
  points:  Point[];
  startPt: Point | null;
  curPt:   Point | null;
  color:   string;
}

const EMPTY_DRAW: DrawState = {
  active:false, tool:"", points:[], startPt:null, curPt:null, color:"#22d3ee",
};

// ── Renderer ──────────────────────────────────────────────────────────────────

function render(
  ctx:        CanvasRenderingContext2D,
  canvas:     HTMLCanvasElement,
  img:        HTMLImageElement | null,
  state:      EnterpriseAnnotationState,
  transform:  Transform,
  drawState:  DrawState,
  showGrid:   boolean,
  reviewMode: boolean,
  imgW:       number,
  imgH:       number,
): void {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#080c14";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(transform.tx, transform.ty);
  ctx.scale(transform.scale, transform.scale);

  // Image
  if(img && imgW > 0 && imgH > 0) {
    ctx.drawImage(img, 0, 0, imgW, imgH);
  } else {
    ctx.fillStyle = "#0f1116";
    ctx.fillRect(0, 0, imgW || W, imgH || H);
  }

  // Grid
  if(showGrid) {
    const step = (imgW || W) / 10;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth   = 1 / transform.scale;
    for(let x=0; x<=(imgW||W); x+=step){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,imgH||H);ctx.stroke(); }
    for(let y=0; y<=(imgH||H); y+=step){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(imgW||W,y);ctx.stroke(); }
  }

  // Annotations
  const iW = imgW || W, iH = imgH || H;
  const visibleLayers = new Set(state.layers.filter(l=>l.visible).map(l=>l.id));
  for(const ann of state.annotations) {
    if(!visibleLayers.has(ann.layer_id)) continue;
    renderAnnotation(ctx, ann, state.selected_ids.includes(ann.id), reviewMode, iW, iH, transform.scale);
  }

  renderDrawState(ctx, drawState, iW, iH, transform.scale);
  ctx.restore();
}

function renderAnnotation(
  ctx:      CanvasRenderingContext2D,
  ann:      EnterpriseAnnotation,
  selected: boolean,
  review:   boolean,
  iW: number, iH: number, scale: number,
): void {
  const lw    = (selected ? 2.5 : 1.5) / scale;
  const col   = ann.class_color;
  ctx.globalAlpha = review && !ann.is_approved ? 0.4 : 1.0;

  // BBox / Classification
  if(ann.bbox && (ann.type === "bbox" || ann.type === "classification")) {
    const { x, y, width: w, height: h } = ann.bbox;
    const px=x*iW, py=y*iH, pw=w*iW, ph=h*iH;
    ctx.fillStyle=`${col}18`; ctx.fillRect(px,py,pw,ph);
    ctx.strokeStyle=selected?"#fff":col; ctx.lineWidth=lw; ctx.strokeRect(px,py,pw,ph);
    if(selected) {
      const hs=6/scale;
      [[px,py],[px+pw,py],[px,py+ph],[px+pw,py+ph]].forEach(([hx,hy])=>{
        ctx.fillStyle="#fff"; ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs);
      });
    }
    const fs=Math.max(10,12/scale);
    ctx.font=`bold ${fs}px Inter,system-ui,sans-serif`;
    const tw=ctx.measureText(ann.class_name).width;
    ctx.fillStyle=col; ctx.fillRect(px,py-fs-4,tw+8,fs+4);
    ctx.fillStyle="#fff"; ctx.fillText(ann.class_name,px+4,py-4);
  }

  // Polygon / Segmentation
  if(ann.points.length>=3 && (ann.type==="polygon"||ann.type==="segmentation")) {
    ctx.beginPath();
    ann.points.forEach((p,i)=>i===0?ctx.moveTo(p.x*iW,p.y*iH):ctx.lineTo(p.x*iW,p.y*iH));
    ctx.closePath();
    ctx.fillStyle=`${col}28`; ctx.fill();
    ctx.strokeStyle=selected?"#fff":col; ctx.lineWidth=lw; ctx.stroke();
    ann.points.forEach(p=>{
      ctx.beginPath(); ctx.arc(p.x*iW,p.y*iH,4/scale,0,Math.PI*2);
      ctx.fillStyle=selected?"#fff":col; ctx.fill();
    });
  }

  // Polyline
  if(ann.points.length>=2 && ann.type==="polyline") {
    ctx.beginPath();
    ann.points.forEach((p,i)=>i===0?ctx.moveTo(p.x*iW,p.y*iH):ctx.lineTo(p.x*iW,p.y*iH));
    ctx.strokeStyle=selected?"#fff":col; ctx.lineWidth=lw*1.5; ctx.stroke();
    ann.points.forEach(p=>{
      ctx.beginPath(); ctx.arc(p.x*iW,p.y*iH,4/scale,0,Math.PI*2);
      ctx.fillStyle=col; ctx.fill();
    });
  }

  // Keypoints
  if(ann.keypoints.length>0) {
    ann.keypoints.forEach(kp=>{
      if(kp.visibility===0) return;
      const sx=kp.x*iW, sy=kp.y*iH, r=5/scale;
      ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2);
      ctx.fillStyle=kp.visibility===2?col:`${col}88`; ctx.fill();
      ctx.strokeStyle="#fff"; ctx.lineWidth=1/scale; ctx.stroke();
      const fs2=Math.max(8,10/scale);
      ctx.font=`${fs2}px Inter`; ctx.fillStyle="#fff";
      ctx.fillText(kp.name,sx+r+2,sy+3);
    });
    const SKELETON=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8]];
    SKELETON.forEach(([a,b])=>{
      const kpA=ann.keypoints[a], kpB=ann.keypoints[b];
      if(!kpA||!kpB||kpA.visibility===0||kpB.visibility===0) return;
      ctx.beginPath(); ctx.moveTo(kpA.x*iW,kpA.y*iH); ctx.lineTo(kpB.x*iW,kpB.y*iH);
      ctx.strokeStyle=`${col}88`; ctx.lineWidth=1.5/scale; ctx.stroke();
    });
  }

  // QA flag
  if(ann.qa_flag) {
    const pt = ann.bbox
      ? {x:ann.bbox.x*iW+2,y:ann.bbox.y*iH+2}
      : ann.points[0] ? {x:ann.points[0].x*iW,y:ann.points[0].y*iH} : null;
    if(pt) { ctx.font=`${12/scale}px system-ui`; ctx.fillStyle="#f59e0b"; ctx.fillText("⚑",pt.x,pt.y+12/scale); }
  }

  ctx.globalAlpha=1;
}

function renderDrawState(
  ctx: CanvasRenderingContext2D,
  ds:  DrawState,
  iW:  number, iH: number, scale: number,
): void {
  if(!ds.active||!ds.curPt) return;
  const lw=1.5/scale;

  if(ds.tool==="bbox"&&ds.startPt) {
    const x1=ds.startPt.x*iW,y1=ds.startPt.y*iH,x2=ds.curPt.x*iW,y2=ds.curPt.y*iH;
    ctx.strokeStyle=ds.color; ctx.lineWidth=lw;
    ctx.setLineDash([4/scale,4/scale]);
    ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
    ctx.setLineDash([]);
    ctx.fillStyle=`${ds.color}18`;
    ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
  }

  if(["polygon","polyline","segmentation"].includes(ds.tool)&&ds.points.length>0) {
    ctx.beginPath();
    ds.points.forEach((p,i)=>i===0?ctx.moveTo(p.x*iW,p.y*iH):ctx.lineTo(p.x*iW,p.y*iH));
    ctx.lineTo(ds.curPt.x*iW,ds.curPt.y*iH);
    ctx.strokeStyle=ds.color; ctx.lineWidth=lw;
    ctx.setLineDash([4/scale,4/scale]); ctx.stroke(); ctx.setLineDash([]);
    ds.points.forEach((p,i)=>{
      ctx.beginPath(); ctx.arc(p.x*iW,p.y*iH,4/scale,0,Math.PI*2);
      ctx.fillStyle=i===0?"#22d3ee":ds.color; ctx.fill();
    });
    ctx.beginPath(); ctx.arc(ds.curPt.x*iW,ds.curPt.y*iH,5/scale,0,Math.PI*2);
    ctx.strokeStyle="#22d3ee"; ctx.lineWidth=1.5/scale; ctx.stroke();
  }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useAnnotationCanvas(
  canvasRef:  React.RefObject<HTMLCanvasElement>,
  imgRef:     React.RefObject<HTMLImageElement | null>,
  state:      EnterpriseAnnotationState,
  setState:   (s: EnterpriseAnnotationState) => void,
  toolConfig: ToolConfig,
  showGrid:   boolean,
  reviewMode: boolean,
  imgW:       number,
  imgH:       number,
) {
  const transformRef  = useRef<Transform>({ scale:1, tx:0, ty:0 });
  const drawRef       = useRef<DrawState>({ ...EMPTY_DRAW });
  const isPanningRef  = useRef(false);
  const lastPtRef     = useRef<Point>({x:0,y:0});
  const isDraggingRef = useRef(false);
  const rafRef        = useRef<number>(0);

  // Render loop
  const scheduleRender = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if(!canvas) return;
      const ctx = canvas.getContext("2d");
      if(!ctx) return;
      render(ctx, canvas, imgRef.current ?? null,
        state, transformRef.current, drawRef.current,
        showGrid, reviewMode, imgW, imgH);
    });
  }, [state, showGrid, reviewMode, imgW, imgH]);

  useEffect(()=>{ scheduleRender(); },[scheduleRender]);

  // Fit to screen
  const fitToScreen = useCallback(() => {
    const canvas = canvasRef.current;
    if(!canvas||!imgW||!imgH) return;
    const scale = Math.min(canvas.width/imgW, canvas.height/imgH) * 0.92;
    transformRef.current = {
      scale,
      tx: (canvas.width  - imgW*scale) / 2,
      ty: (canvas.height - imgH*scale) / 2,
    };
    scheduleRender();
  }, [imgW, imgH, scheduleRender]);

  useEffect(()=>{ fitToScreen(); },[fitToScreen]);

  // Zoom
  const zoom = useCallback((delta: number, cx?: number, cy?: number) => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const t  = transformRef.current;
    const ox = cx ?? canvas.width  / 2;
    const oy = cy ?? canvas.height / 2;
    const f  = delta > 0 ? 1.15 : 1/1.15;
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale*f));
    transformRef.current = {
      scale: ns,
      tx:    ox - (ox-t.tx)*(ns/t.scale),
      ty:    oy - (oy-t.ty)*(ns/t.scale),
    };
    scheduleRender();
  }, [scheduleRender]);

  // getNorm — convert pointer event to normalized image coords
  const getNorm = useCallback((e: PointerEvent): Point => {
    const canvas = canvasRef.current;
    if(!canvas) return {x:0,y:0};
    const rect = canvas.getBoundingClientRect();
    const sx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const sy   = (e.clientY - rect.top)  * (canvas.height / rect.height);
    let p = screenToNorm(sx, sy, transformRef.current, imgW, imgH);
    p = clampPoint(p);
    if(toolConfig.snap_enabled && imgW > 0) {
      const snapDist = toolConfig.snap_distance / (imgW * transformRef.current.scale);
      p = snapPoint(p, state.annotations, snapDist);
    }
    return p;
  }, [imgW, imgH, state.annotations, toolConfig]);

  // ── commitPolygon — MUST be defined BEFORE onPointerDown ─────────────────
  const commitPolygon = useCallback((points: Point[]) => {
    if(points.length < 3) {
      drawRef.current = { ...EMPTY_DRAW };
      scheduleRender();
      return;
    }
    const bbox = bboxFromPoints(points);
    const ann  = createAnnotation({
      type:        toolConfig.tool as any,
      class_id:    toolConfig.class_id,
      class_name:  toolConfig.class_name,
      class_color: toolConfig.class_color,
      layer_id:    toolConfig.layer_id,
      image_id:    state.image_id,
      sequence:    state.sequence,
      points,
      bbox:        bbox ?? undefined,
    });
    setState(addAnnotation(state, ann));
    drawRef.current = { ...EMPTY_DRAW };
    scheduleRender();
  }, [state, setState, toolConfig, scheduleRender]);

  // ── Pointer down ──────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: PointerEvent) => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const sy   = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const p    = getNorm(e);

    // Pan
    if(toolConfig.tool==="pan" || e.button===1 || e.altKey) {
      isPanningRef.current = true;
      lastPtRef.current    = {x:sx, y:sy};
      return;
    }

    // Select
    if(toolConfig.tool==="select") {
      const hit = hitTestAll(state.annotations, p.x, p.y);
      if(hit) {
        const ids = e.shiftKey
          ? state.selected_ids.includes(hit.id)
            ? state.selected_ids.filter(id=>id!==hit.id)
            : [...state.selected_ids, hit.id]
          : [hit.id];
        setState(selectAnnotations(state, ids));
        isDraggingRef.current = true;
      } else {
        setState(selectAnnotations(state, []));
        isDraggingRef.current = false;
      }
      lastPtRef.current = p;
      return;
    }

    // BBox start
    if(toolConfig.tool==="bbox") {
      drawRef.current = { active:true, tool:"bbox", points:[], startPt:p, curPt:p, color:toolConfig.class_color };
      scheduleRender();
      return;
    }

    // Polygon / Polyline / Segmentation
    if(["polygon","polyline","segmentation"].includes(toolConfig.tool)) {
      const dr = drawRef.current;
      if(dr.active && dr.points.length>=3) {
        const first = dr.points[0];
        if(Math.hypot(p.x-first.x, p.y-first.y) < 0.02) {
          commitPolygon(dr.points);
          return;
        }
      }
      if(!dr.active) {
        drawRef.current = { active:true, tool:toolConfig.tool, points:[p], startPt:p, curPt:p, color:toolConfig.class_color };
      } else {
        drawRef.current = { ...dr, points:[...dr.points, p], curPt:p };
      }
      scheduleRender();
      return;
    }

    // Keypoints
    if(toolConfig.tool==="keypoints") {
      const newKp: Keypoint = { x:p.x, y:p.y, name:`kp_${state.sequence}`, visibility:2, idx:state.sequence };
      const existing = state.annotations.find(a=>a.type==="keypoints" && state.selected_ids.includes(a.id));
      if(existing) {
        const keypoints = [...existing.keypoints, newKp];
        setState(updateAnnotation(state, existing.id, {
          keypoints,
          bbox: bboxFromPoints(keypoints.map(k=>({x:k.x,y:k.y}))),
        }));
      } else {
        const ann = createAnnotation({
          type:"keypoints", class_id:toolConfig.class_id, class_name:toolConfig.class_name,
          class_color:toolConfig.class_color, layer_id:toolConfig.layer_id,
          image_id:state.image_id, sequence:state.sequence, keypoints:[newKp],
        });
        setState(addAnnotation(state, ann));
      }
      return;
    }

    // Classification / Multi-label
    if(toolConfig.tool==="classification" || toolConfig.tool==="multi_label") {
      const ann = createAnnotation({
        type:toolConfig.tool, class_id:toolConfig.class_id, class_name:toolConfig.class_name,
        class_color:toolConfig.class_color, layer_id:toolConfig.layer_id,
        image_id:state.image_id, sequence:state.sequence,
        bbox:{x:0.1,y:0.1,width:0.8,height:0.8}, labels:[toolConfig.class_name],
      });
      setState(addAnnotation(state, ann));
      return;
    }
  }, [state, setState, toolConfig, getNorm, commitPolygon, scheduleRender]);

  // ── Pointer move ──────────────────────────────────────────────────────────
  const onPointerMove = useCallback((e: PointerEvent) => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const sy   = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const p    = getNorm(e);

    if(isPanningRef.current) {
      const t = transformRef.current;
      transformRef.current = { ...t, tx:t.tx+sx-lastPtRef.current.x, ty:t.ty+sy-lastPtRef.current.y };
      lastPtRef.current = {x:sx,y:sy};
      scheduleRender();
      return;
    }

    if(isDraggingRef.current && toolConfig.tool==="select" && state.selected_ids.length>0) {
      const dx=p.x-lastPtRef.current.x, dy=p.y-lastPtRef.current.y;
      let s = state;
      for(const id of state.selected_ids) {
        const ann = s.annotations.find(a=>a.id===id);
        if(!ann) continue;
        const patch: Partial<EnterpriseAnnotation> = {};
        if(ann.bbox) patch.bbox = normalizeBBox({...ann.bbox, x:ann.bbox.x+dx, y:ann.bbox.y+dy});
        if(ann.points.length>0) patch.points = ann.points.map(pt=>clampPoint({x:pt.x+dx,y:pt.y+dy}));
        s = updateAnnotation(s, id, patch);
      }
      setState(s);
      lastPtRef.current = p;
      return;
    }

    if(drawRef.current.active) {
      drawRef.current = { ...drawRef.current, curPt:p };
      scheduleRender();
    }
  }, [state, setState, toolConfig, getNorm, scheduleRender]);

  // ── Pointer up ────────────────────────────────────────────────────────────
  const onPointerUp = useCallback((e: PointerEvent) => {
    const p = getNorm(e);
    if(isPanningRef.current)  { isPanningRef.current  = false; return; }
    if(isDraggingRef.current) { isDraggingRef.current = false; return; }

    if(drawRef.current.active && toolConfig.tool==="bbox" && drawRef.current.startPt) {
      const start = drawRef.current.startPt;
      const bbox  = normalizeBBox({ x:start.x, y:start.y, width:p.x-start.x, height:p.y-start.y });
      if(bbox.width>=0.002 && bbox.height>=0.002) {
        const ann = createAnnotation({
          type:"bbox", class_id:toolConfig.class_id, class_name:toolConfig.class_name,
          class_color:toolConfig.class_color, layer_id:toolConfig.layer_id,
          image_id:state.image_id, sequence:state.sequence, bbox,
        });
        setState(addAnnotation(state, ann));
      }
      drawRef.current = { ...EMPTY_DRAW };
      scheduleRender();
    }
  }, [state, setState, toolConfig, getNorm, scheduleRender]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if(!canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoom(-e.deltaY,
      (e.clientX - rect.left) * (canvas.width  / rect.width),
      (e.clientY - rect.top)  * (canvas.height / rect.height),
    );
  }, [zoom]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if(ctrl && e.key==="z" && !e.shiftKey) { e.preventDefault(); setState(undoState(state)); return; }
    if(ctrl && (e.key==="y" || (e.key==="z" && e.shiftKey))) { e.preventDefault(); setState(redoState(state)); return; }
    if(ctrl && e.key==="a") { e.preventDefault(); setState({...state, selected_ids:state.annotations.map(a=>a.id)}); return; }
    if(ctrl && e.key==="d") { e.preventDefault(); setState(duplicateAnnotations(state, state.selected_ids)); return; }
    if(e.key==="Delete"||e.key==="Backspace") {
      if(state.selected_ids.length>0) { setState(deleteAnnotations(state, state.selected_ids)); return; }
      if(drawRef.current.active && drawRef.current.points.length>0) {
        drawRef.current = { ...drawRef.current, points:drawRef.current.points.slice(0,-1) };
        scheduleRender();
      }
      return;
    }
    if(e.key==="Escape") {
      drawRef.current = { ...EMPTY_DRAW };
      setState(selectAnnotations(state, []));
      scheduleRender();
      return;
    }
    if(e.key==="Enter" && drawRef.current.active) { commitPolygon(drawRef.current.points); return; }
    if(e.key==="+"||e.key==="=") zoom(1);
    if(e.key==="-") zoom(-1);
    if(e.key==="0") fitToScreen();
  }, [state, setState, zoom, fitToScreen, commitPolygon, scheduleRender]);

  // ── Bind events ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup",   onPointerUp);
    canvas.addEventListener("wheel",       onWheel, {passive:false});
    window.addEventListener("keydown",     onKeyDown);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup",   onPointerUp);
      canvas.removeEventListener("wheel",       onWheel);
      window.removeEventListener("keydown",     onKeyDown);
    };
  }, [onPointerDown, onPointerMove, onPointerUp, onWheel, onKeyDown]);

  return { zoom, fitToScreen };
}
