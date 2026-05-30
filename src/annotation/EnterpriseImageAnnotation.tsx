/**
 * EnterpriseImageAnnotation.tsx
 * Aivora Platform — Phase 15.2
 * Enterprise Image Annotation Workstation
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { createEnterpriseState } from "./enterpriseAnnotationState";
import { useAnnotationCanvas } from "./useAnnotationCanvas";
import { exportAnnotations, computeStats } from "./annotationExportService";
import type {
  EnterpriseAnnotationState,
  AnnotationTool, ToolConfig, ExportFormat,
} from "./annotationTypes";
import { COCO_TAXONOMY, getClassById } from "./taxonomyEngine";
import { enqueueMutation } from "../lib/offline/mutationQueue";
import { emitEvent } from "../lib/telemetry/emitter";
import {
  deleteAnnotations, undoState, redoState,
  toggleLayerVisibility, setActiveLayer, addLayer,
  setQAFlag, selectAnnotations,
} from "./enterpriseAnnotationState";
import { ANNOTATION_SHORTCUTS } from "./annotationTypes";
import type { QAFlag } from "./annotationTypes";

const TOOLS: { id: AnnotationTool; icon: string; label: string; key: string }[] = [
  { id:"select",         icon:"↖", label:"Select",         key:"V" },
  { id:"pan",            icon:"✋", label:"Pan",            key:"Space" },
  { id:"bbox",           icon:"▭", label:"Bounding Box",   key:"B" },
  { id:"polygon",        icon:"⬠", label:"Polygon",        key:"P" },
  { id:"polyline",       icon:"↗", label:"Polyline",       key:"L" },
  { id:"keypoints",      icon:"⊹", label:"Keypoints",      key:"K" },
  { id:"segmentation",   icon:"⬡", label:"Segmentation",   key:"S" },
  { id:"classification", icon:"◈", label:"Classification", key:"C" },
  { id:"multi_label",    icon:"⊞", label:"Multi-label",    key:"M" },
];

function Btn({ label, onClick, color="#6b7280", active=false, title="" }: {
  label:string; onClick:()=>void; color?:string; active?:boolean; title?:string;
}) {
  return (
    <button onClick={onClick} title={title} style={{
      padding:"4px 10px", borderRadius:5,
      border:`1px solid ${active?color:"#1f2937"}`,
      background:active?`${color}18`:"transparent",
      color:active?color:"#6b7280", fontSize:10, cursor:"pointer",
      transition:"all 0.15s", fontFamily:"inherit", whiteSpace:"nowrap",
    }}>{label}</button>
  );
}

export interface EnterpriseImageAnnotationProps {
  imageUrl?:  string;
  imageId?:   string;
  filename?:  string;
  width?:     number;
  height?:    number;
  onSave?:    (state: EnterpriseAnnotationState) => void;
  onClose?:   () => void;
}

export default function EnterpriseImageAnnotation({
  imageUrl,
  imageId   = "img_001",
  filename  = "image.jpg",
  width     = 1920,
  height    = 1080,
  onSave,
  onClose,
}: EnterpriseImageAnnotationProps) {

  const [annState, setAnnState] = useState<EnterpriseAnnotationState>(() =>
    createEnterpriseState(imageId)
  );
  const [tool,          setTool]         = useState<AnnotationTool>("bbox");
  const [activeClassId, setActiveClassId]= useState<number>(0);
  const [showGrid,      setShowGrid]     = useState(false);
  const [reviewMode,    setReviewMode]   = useState(false);
  const [snapEnabled,   setSnapEnabled]  = useState(true);
  const [imgW,          setImgW]         = useState(width);
  const [imgH,          setImgH]         = useState(height);
  const [isDirty,       setIsDirty]      = useState(false);
  const [isSaving,      setIsSaving]     = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef    = useRef<HTMLImageElement | null>(null);

  const taxonomy    = COCO_TAXONOMY;
  const activeClass = getClassById(taxonomy, activeClassId) ?? taxonomy.classes[0];

  const toolConfig: ToolConfig = {
    tool,
    class_id:      activeClass?.id    ?? 0,
    class_name:    activeClass?.name  ?? "object",
    class_color:   activeClass?.color ?? "#22d3ee",
    layer_id:      annState.active_layer,
    snap_enabled:  snapEnabled,
    snap_distance: 8,
  };

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQ,       setSearchQ]       = useState("");
  const autoSaveRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const setState = useCallback((s: EnterpriseAnnotationState) => {
    setAnnState(s);
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      onSave?.(annState);
      await enqueueMutation({
        mutation_type:  "image_evidence_insert",
        correlation_id: imageId,
        payload:        annState as unknown as Record<string,unknown>,
      });
      emitEvent({
        event_type:"ADMIN_ACTION", event_source:"qc_workstation",
        correlation_id:imageId, severity:"info",
        payload:{ action:"ANNOTATIONS_SAVED", count:annState.annotations.length },
      });
      setIsDirty(false);
    } finally { setIsSaving(false); }
  }, [annState, imageId, onSave]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    await exportAnnotations(
      annState,
      { id:imageId, filename, width:imgW, height:imgH },
      format,
      filename.replace(/\.[^.]+$/,""),
    );
  }, [annState, imageId, filename, imgW, imgH]);

  // Auto-save 30s
  useEffect(() => {
    if(autoSaveRef.current) clearInterval(autoSaveRef.current);
    if(isDirty) autoSaveRef.current = setInterval(handleSave, 30_000);
    return () => { if(autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [isDirty, handleSave]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if(e.target instanceof HTMLInputElement) return;
      const map: Record<string,AnnotationTool> = {
        v:"select",b:"bbox",p:"polygon",l:"polyline",
        k:"keypoints",s:"segmentation",c:"classification",m:"multi_label",
      };
      const t = map[e.key.toLowerCase()];
      if(t) setTool(t);
      if(e.key===" "){ e.preventDefault(); setTool("pan"); }
      if(e.key==="g") setShowGrid(v=>!v);
      if(e.key==="r") setReviewMode(v=>!v);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const { zoom, fitToScreen } = useAnnotationCanvas(
    canvasRef, imgRef, annState, setState,
    toolConfig, showGrid, reviewMode, imgW, imgH,
  );

  // Load image
  useEffect(() => {
    if(!imageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImgW(img.naturalWidth  || width);
      setImgH(img.naturalHeight || height);
    };
    img.src = imageUrl;
  }, [imageUrl, width, height]);

  // Canvas resize
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

  if(!annState) return null;

  const stats = computeStats(annState.annotations);

  return (
    <div style={{
      display:"flex", flexDirection:"column", height:"100%",
      background:"#080c14", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono',monospace", overflow:"hidden",
    }}>
      {/* TOP BAR */}
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",
        borderBottom:"1px solid #1f2937",background:"#0a0f1a",flexShrink:0,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:700,color:"#22d3ee",letterSpacing:0.5,marginRight:4}}>
          ANNOTATION WORKSTATION
        </span>
        <Btn label="↩" title="Undo" onClick={()=>setState(undoState(annState))} color="#22d3ee" active={annState.history.length>0}/>
        <Btn label="↪" title="Redo" onClick={()=>setState(redoState(annState))} color="#22d3ee" active={annState.future.length>0}/>
        <div style={{width:1,height:16,background:"#1f2937"}}/>
        <Btn label={`Grid ${showGrid?"ON":"OFF"}`}     onClick={()=>setShowGrid(v=>!v)}    active={showGrid}    color="#a855f7"/>
        <Btn label={`Snap ${snapEnabled?"ON":"OFF"}`}  onClick={()=>setSnapEnabled(v=>!v)} active={snapEnabled} color="#f59e0b"/>
        <Btn label={`Review ${reviewMode?"ON":"OFF"}`} onClick={()=>setReviewMode(v=>!v)}  active={reviewMode}  color="#22c55e"/>
        <div style={{width:1,height:16,background:"#1f2937"}}/>
        <Btn label="+" onClick={()=>zoom(1)}   color="#6b7280"/>
        <Btn label="−" onClick={()=>zoom(-1)}  color="#6b7280"/>
        <Btn label="⊡" onClick={fitToScreen}   color="#6b7280" title="Fit (0)"/>
        <div style={{width:1,height:16,background:"#1f2937"}}/>
        {(["coco","yolo","pascal_voc","jsonl","aivora_native"] as ExportFormat[]).map(fmt=>(
          <Btn key={fmt} label={fmt.replace("_"," ").toUpperCase()} onClick={()=>handleExport(fmt)} color="#22d3ee"/>
        ))}
        <div style={{width:1,height:16,background:"#1f2937"}}/>
        <Btn label={isSaving?"Saving…":isDirty?"⬆ Save*":"✓ Saved"} onClick={handleSave}
          color={isDirty?"#f59e0b":"#22c55e"} active={isDirty}/>
        <Btn label="⌨" onClick={()=>setShowShortcuts(v=>!v)} color="#6b7280"/>
        <div style={{marginLeft:"auto",fontSize:9,color:"#374151"}}>
          {annState.annotations.length.toLocaleString()} annotations
        </div>
        {onClose && <Btn label="✕" onClick={onClose} color="#ef4444"/>}
      </div>

      {/* MAIN AREA */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* Tool sidebar */}
        <div style={{width:52,flexShrink:0,background:"#0a0f1a",borderRight:"1px solid #1f2937",
          display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 0",gap:2}}>
          {TOOLS.map(t=>(
            <button key={t.id} onClick={()=>setTool(t.id)} title={`${t.label} (${t.key})`}
              style={{width:38,height:38,borderRadius:7,border:"none",
                background:tool===t.id?"#22d3ee22":"transparent",
                color:tool===t.id?"#22d3ee":"#6b7280",
                fontSize:15,cursor:"pointer",transition:"all 0.15s",
                display:"flex",alignItems:"center",justifyContent:"center"}}>
              {t.icon}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div style={{flex:1,position:"relative",overflow:"hidden",background:"#050508"}}>
          {!imageUrl && (
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",
              justifyContent:"center",flexDirection:"column",gap:10,color:"#374151"}}>
              <div style={{fontSize:28}}>🖼️</div>
              <div style={{fontSize:11}}>No image loaded</div>
            </div>
          )}
          <canvas ref={canvasRef} style={{display:"block",
            cursor:tool==="pan"?"grab":tool==="select"?"default":"crosshair"}}/>
          <div style={{position:"absolute",bottom:6,left:8,fontSize:9,
            color:"rgba(255,255,255,0.2)",background:"rgba(0,0,0,0.4)",
            padding:"2px 8px",borderRadius:4}}>
            {tool.toUpperCase()} · {activeClass?.name} · {imgW}×{imgH}
          </div>
        </div>

        {/* Right panel — classes + layers + list */}
        <div style={{width:210,flexShrink:0,borderLeft:"1px solid #1f2937",
          background:"#0a0f1a",display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Classes */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid #1f2937",flexShrink:0}}>
            <div style={{fontSize:9,letterSpacing:2,color:"#374151",marginBottom:6}}>LABEL CLASS</div>
            <div style={{maxHeight:110,overflowY:"auto"}}>
              {taxonomy.classes.slice(0,20).map(cls=>(
                <div key={cls.id} onClick={()=>setActiveClassId(cls.id)}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",
                    cursor:"pointer",borderRadius:4,marginBottom:1,
                    background:activeClassId===cls.id?`${cls.color}18`:"transparent"}}>
                  <div style={{width:7,height:7,borderRadius:2,background:cls.color,flexShrink:0}}/>
                  <span style={{fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                    color:activeClassId===cls.id?cls.color:"#6b7280"}}>
                    {cls.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Layers */}
          <div style={{padding:"8px 10px",borderBottom:"1px solid #1f2937",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
              <div style={{fontSize:9,letterSpacing:2,color:"#374151"}}>LAYERS</div>
              <button onClick={()=>setState(addLayer(annState,`Layer ${annState.layers.length+1}`))}
                style={{background:"none",border:"none",color:"#22d3ee",cursor:"pointer",fontSize:14,lineHeight:1}}>+</button>
            </div>
            {annState.layers.map(l=>(
              <div key={l.id} onClick={()=>setState(setActiveLayer(annState,l.id))}
                style={{display:"flex",alignItems:"center",gap:5,padding:"3px 6px",
                  borderRadius:4,cursor:"pointer",marginBottom:1,
                  background:annState.active_layer===l.id?"rgba(255,255,255,0.04)":"transparent"}}>
                <button onClick={e=>{e.stopPropagation();setState(toggleLayerVisibility(annState,l.id));}}
                  style={{background:"none",border:"none",color:l.visible?"#22c55e":"#374151",
                    cursor:"pointer",fontSize:10,padding:0,flexShrink:0}}>
                  {l.visible?"●":"○"}
                </button>
                <div style={{width:6,height:6,borderRadius:"50%",background:l.color,flexShrink:0}}/>
                <span style={{fontSize:10,flex:1,overflow:"hidden",textOverflow:"ellipsis",
                  color:annState.active_layer===l.id?"#e5e7eb":"#6b7280"}}>
                  {l.name}
                </span>
                <span style={{fontSize:9,color:"#374151",flexShrink:0}}>
                  {annState.annotations.filter(a=>a.layer_id===l.id).length}
                </span>
              </div>
            ))}
          </div>

          {/* Annotation list */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"6px 10px",borderBottom:"1px solid #1f2937",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                <div style={{fontSize:9,letterSpacing:2,color:"#374151"}}>
                  ANNOTATIONS ({annState.annotations.length})
                </div>
                {annState.selected_ids.length>0 && (
                  <button onClick={()=>setState(deleteAnnotations(annState,annState.selected_ids))}
                    style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:9}}>
                    Del {annState.selected_ids.length}
                  </button>
                )}
              </div>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                placeholder="Search…"
                style={{width:"100%",background:"#111",color:"#e5e7eb",
                  border:"1px solid #1f2937",borderRadius:5,
                  padding:"3px 8px",fontSize:10,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {annState.annotations
                .filter(a=>!searchQ||a.class_name.toLowerCase().includes(searchQ.toLowerCase()))
                .map(ann=>(
                  <div key={ann.id} onClick={()=>setState(selectAnnotations(annState,[ann.id]))}
                    style={{padding:"5px 10px",cursor:"pointer",
                      background:annState.selected_ids.includes(ann.id)?"rgba(255,255,255,0.04)":"transparent",
                      borderLeft:`2px solid ${annState.selected_ids.includes(ann.id)?ann.class_color:"transparent"}`,
                      borderBottom:"1px solid #111",display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:7,height:7,borderRadius:2,background:ann.class_color,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#e5e7eb",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {ann.class_name}
                      </div>
                      <div style={{fontSize:9,color:"#4b5563"}}>{ann.type} #{ann.sequence}</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();setState(deleteAnnotations(annState,[ann.id]));}}
                      style={{background:"none",border:"none",color:"#ef444488",cursor:"pointer",fontSize:10,padding:"0 2px"}}>✕</button>
                  </div>
                ))}
              {annState.annotations.length===0 && (
                <div style={{padding:20,textAlign:"center",fontSize:10,color:"#374151"}}>
                  No annotations yet.<br/>Select a tool and draw.
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div style={{padding:"6px 10px",borderTop:"1px solid #1f2937",flexShrink:0,
            fontSize:9,color:"#374151",display:"flex",gap:8}}>
            <span style={{color:"#22c55e"}}>✓{stats.approved}</span>
            <span style={{color:"#f59e0b"}}>⚑{stats.flagged}</span>
            <span style={{color:"#6b7280"}}>{(stats.mean_confidence*100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* SHORTCUTS MODAL */}
      {showShortcuts && (
        <div style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,0.7)",
          display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setShowShortcuts(false)}>
          <div style={{background:"#0a0f1a",border:"1px solid #1f2937",borderRadius:14,
            padding:20,minWidth:340,maxHeight:"75vh",overflowY:"auto"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,fontWeight:700,color:"#22d3ee",marginBottom:14}}>KEYBOARD SHORTCUTS</div>
            {Object.entries(ANNOTATION_SHORTCUTS).map(([key,desc])=>(
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
        <span>AIVORA ANNOTATION</span>
        <span>·</span>
        <span style={{color:isDirty?"#f59e0b":"#22c55e"}}>{isDirty?"● UNSAVED":"● SAVED"}</span>
        <span>·</span>
        <span>{tool.toUpperCase()}</span>
        <span>·</span>
        <span>Undo:{annState.history.length}</span>
        <span>·</span>
        <span>Sel:{annState.selected_ids.length}</span>
      </div>
    </div>
  );
}
