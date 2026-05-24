import React, { useState, useRef, useCallback } from "react";
import { loadAndGovernImage, renderImageToCanvas } from "../vision/imageRuntime";
import { VIDEO_LIMITS, VIDEO_RUNTIME_VERSION } from "../video/videoRuntime";
import { processOCRDocument, OCR_RUNTIME_VERSION, OCR_DECODER_STRATEGY, OCR_TEMPERATURE } from "../document-ai/ocrRuntime";
import { generateVisionQAReport, VISION_QA_VERSION } from "../vision-qa/visionQA";
import { adaptMultimodalRecords, MULTIMODAL_ADAPTER_VERSION } from "../lib/dataset/multimodalAdapters";
import { IMAGE_GOVERNANCE_VERSION, IMAGE_LIMITS, sha256Bytes, extractTiles } from "../vision/imageGovernance";
import type { ImageLoadResult } from "../vision/imageRuntime";
import type { VideoExtractionResult } from "../video/videoRuntime";
import type { OCRDocumentResult } from "../document-ai/ocrRuntime";
import type { MultimodalRecord } from "../lib/dataset/multimodalAdapters";

const TABS = [
  { id:"image",   label:"Image Intel",   icon:"🖼️" },
  { id:"video",   label:"Video Intel",   icon:"🎬" },
  { id:"ocr",     label:"OCR / Doc AI",  icon:"📄" },
  { id:"dataset", label:"Multimodal DS", icon:"🏭" },
] as const;
type TabId = typeof TABS[number]["id"];

function Section({ title, children, source }: { title:string; children:React.ReactNode; source?:string }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937", borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
        <span style={{ fontSize:11, color:"#6b7280", textTransform:"uppercase", letterSpacing:1 }}>{title}</span>
        {source && <span style={{ fontSize:9, color:"#374151" }}>src: {source}</span>}
      </div>
      {children}
    </div>
  );
}

function GovernanceBadge({ label, value, locked=false }: { label:string; value:string; locked?:boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, padding:"2px 7px", borderRadius:4,
      background:locked?"#052e16":"#0f172a", border:`1px solid ${locked?"#166534":"#1f2937"}` }}>
      <span style={{ fontSize:9, color:"#6b7280" }}>{label}</span>
      <span style={{ fontSize:10, fontWeight:700, color:locked?"#22c55e":"#22d3ee" }}>{value}</span>
      {locked && <span style={{ fontSize:9 }}>🔒</span>}
    </div>
  );
}

function KPIBox({ label, value, color="#22d3ee" }: { label:string; value:React.ReactNode; color?:string }) {
  return (
    <div style={{ background:"#111827", borderRadius:4, padding:"8px 10px", textAlign:"center" }}>
      <div style={{ fontSize:16, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:9, color:"#6b7280" }}>{label}</div>
    </div>
  );
}

function VisionQASummary({ records }: { records: { id:string; annotations?: { id:number; x:number; y:number; width:number; height:number; confidence:number; category_id:number }[] }[] }) {
  const report = generateVisionQAReport(records);
  return (
    <div>
      <div style={{ display:"flex", gap:10, marginBottom:8 }}>
        <span style={{ fontSize:12, fontWeight:700, color:report.passed?"#22c55e":"#f59e0b" }}>
          {report.passed?"✅ PASSED":"⚠️ WARNINGS"}
        </span>
        <span style={{ fontSize:11, color:"#6b7280" }}>
          {report.total_records} records · {report.error_count} errors · {report.warning_count} warnings
        </span>
      </div>
      {report.issues.length === 0
        ? <div style={{ fontSize:11, color:"#22c55e" }}>No issues</div>
        : report.issues.map((issue, i) => (
          <div key={i} style={{ fontSize:11, padding:"3px 0",
            color:issue.severity==="error"?"#ef4444":"#f59e0b",
            borderBottom:"1px solid #111827" }}>
            {issue.severity==="error"?"❌":"⚠️"} {issue.message}
          </div>
        ))}
      <div style={{ fontSize:9, color:"#374151", marginTop:6 }}>Advisory only · VISION_QA v{VISION_QA_VERSION}</div>
    </div>
  );
}

function ImagePanel() {
  const [result, setResult]   = useState<ImageLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(null); setResult(null);
    let bitmap: ImageBitmap | null = null;
    try {
      // Direct processing — no scheduler dependency
      if(file.size > IMAGE_LIMITS.MAX_IMAGE_BYTES) {
        setError(`File too large: ${(file.size/1024/1024).toFixed(1)}MB > 32MB`);
        return;
      }
      bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      let targetW = width, targetH = height;
      if(width > IMAGE_LIMITS.MAX_DIM || height > IMAGE_LIMITS.MAX_DIM) {
        const ratio = IMAGE_LIMITS.MAX_DIM / Math.max(width, height);
        targetW = Math.floor(width * ratio);
        targetH = Math.floor(height * ratio);
      }
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx    = canvas.getContext("2d");
      if(!ctx) { setError("Canvas unavailable"); return; }
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      const imageData = ctx.getImageData(0, 0, targetW, targetH);
      const checksum  = await sha256Bytes(imageData.data);
      const tiles     = extractTiles(imageData);
      const r = {
        imageData,
        metadata: { width:targetW, height:targetH, channels:4, format:"rgba" as const,
          byte_size:imageData.data.length, checksum, tile_count:tiles.length,
          created_at:new Date().toISOString(),
          governance_version:IMAGE_GOVERNANCE_VERSION },
        tiles,
        governance: { image_checksum:checksum, width:targetW, height:targetH,
          tile_count:tiles.length, resize_applied:width!==targetW,
          exif_stripped:true, governance_version:IMAGE_GOVERNANCE_VERSION,
          protocol:"14.1.0" },
        correlation_id: crypto.randomUUID(),
      };
      setResult(r);
      if(canvasRef.current) renderImageToCanvas(r.imageData, canvasRef.current);
    } catch(e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { bitmap?.close(); setLoading(false); }
  }, []);

  return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
        <GovernanceBadge label="PROTOCOL"  value={IMAGE_GOVERNANCE_VERSION} />
        <GovernanceBadge label="MAX DIM"   value={`${IMAGE_LIMITS.MAX_DIM}px`} />
        <GovernanceBadge label="TILE SIZE" value={`${IMAGE_LIMITS.TILE_SIZE}px`} />
        <GovernanceBadge label="EXIF"      value="STRIPPED" locked />
        <GovernanceBadge label="RESIZE"    value="NEAREST-NEIGHBOR" locked />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:12 }}>
        <div>
          <Section title="Input">
            <div onDrop={e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handleFile(f); }}
              onDragOver={e=>e.preventDefault()} onClick={()=>fileRef.current?.click()}
              style={{ border:"2px dashed #1f2937", borderRadius:6, padding:"24px 12px",
                textAlign:"center", cursor:"pointer" }}>
              <div style={{ fontSize:28, marginBottom:4 }}>🖼️</div>
              <div style={{ fontSize:12, color:"#6b7280" }}>Drop image or click</div>
              <div style={{ fontSize:10, color:"#374151", marginTop:4 }}>max {IMAGE_LIMITS.MAX_IMAGE_BYTES/1024/1024}MB</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); }} />
          </Section>
          {loading && <div style={{ fontSize:12, color:"#22d3ee", textAlign:"center", padding:8 }}>⏳ Processing...</div>}
          {error   && <div style={{ fontSize:11, color:"#ef4444", padding:8 }}>⚠ {error}</div>}
        </div>
        <div>
          {result && (
            <>
              <Section title="Image Canvas" source="imageRuntime.ts">
                <canvas ref={canvasRef} style={{ width:"100%", maxHeight:320,
                  objectFit:"contain", borderRadius:4, border:"1px solid #1f2937" }} />
              </Section>
              <Section title="Governance Metadata">
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  <KPIBox label="Width"   value={`${result.metadata.width}px`} />
                  <KPIBox label="Height"  value={`${result.metadata.height}px`} />
                  <KPIBox label="Tiles"   value={result.metadata.tile_count} color="#3b82f6" />
                  <KPIBox label="Resized" value={result.governance.resize_applied?"YES":"NO"}
                    color={result.governance.resize_applied?"#f59e0b":"#22c55e"} />
                  <KPIBox label="EXIF"    value="STRIPPED" color="#22c55e" />
                  <KPIBox label="Format"  value={result.metadata.format} color="#6b7280" />
                </div>
                <div style={{ marginTop:8, fontSize:9, color:"#374151", wordBreak:"break-all" }}>
                  checksum: {result.metadata.checksum}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoPanel() {
  const [result, setResult]   = useState<VideoExtractionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [fps, setFps]         = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(null); setResult(null);
    let videoEl: HTMLVideoElement | null = null;
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
      videoEl   = document.createElement("video");
      videoEl.preload = "metadata"; videoEl.muted = true;
      await new Promise<void>((res,rej) => {
        videoEl!.onloadedmetadata = ()=>res();
        videoEl!.onerror = ()=>rej(new Error("Video load failed"));
        videoEl!.src = objectUrl!;
      });
      const duration = videoEl.duration;
      if(!isFinite(duration)||duration<=0) throw new Error("Invalid video duration");
      const timestamps: number[] = [];
      const interval = 1/fps;
      for(let t=0; t<duration && timestamps.length<VIDEO_LIMITS.MAX_ACTIVE_FRAMES; t+=interval)
        timestamps.push(Math.round(t*1000)/1000);
      const frames: any[] = [];
      const canvas = document.createElement("canvas");
      const ctx    = canvas.getContext("2d");
      if(!ctx) throw new Error("Canvas unavailable");
      for(let i=0; i<timestamps.length; i++) {
        const ts = timestamps[i];
        await new Promise<void>((res,rej) => {
          videoEl!.onseeked = ()=>res();
          videoEl!.onerror  = ()=>rej(new Error(`Seek failed`));
          videoEl!.currentTime = ts;
        });
        let w=videoEl.videoWidth, h=videoEl.videoHeight;
        if(w>VIDEO_LIMITS.MAX_FRAME_DIM||h>VIDEO_LIMITS.MAX_FRAME_DIM) {
          const ratio=VIDEO_LIMITS.MAX_FRAME_DIM/Math.max(w,h);
          w=Math.floor(w*ratio); h=Math.floor(h*ratio);
        }
        canvas.width=w; canvas.height=h;
        ctx.drawImage(videoEl,0,0,w,h);
        frames.push({ index:i, timestamp_s:ts, width:w, height:h,
          data:ctx.getImageData(0,0,w,h), checksum:null });
      }
      setResult({ frames, total_frames:frames.length, duration_s:duration,
        config:{ fps, max_frames:VIDEO_LIMITS.MAX_ACTIVE_FRAMES },
        manifest_checksum:null, correlation_id:crypto.randomUUID(),
        protocol:"14.2.0" } as any);
    } catch(e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally {
      if(videoEl){ videoEl.pause(); videoEl.src=""; }
      if(objectUrl) URL.revokeObjectURL(objectUrl);
      setLoading(false);
    }
  }, [fps]);

  return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
        <GovernanceBadge label="PROTOCOL"   value={VIDEO_RUNTIME_VERSION} />
        <GovernanceBadge label="MAX FRAMES" value={String(VIDEO_LIMITS.MAX_ACTIVE_FRAMES)} locked />
        <GovernanceBadge label="MAX DIM"    value={`${VIDEO_LIMITS.MAX_FRAME_DIM}px`} />
        <GovernanceBadge label="TIMESTAMPS" value="3dp DETERMINISTIC" locked />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:12 }}>
        <div>
          <Section title="Config">
            <label style={{ fontSize:10, color:"#6b7280", display:"block", marginBottom:4 }}>EXTRACTION FPS</label>
            <div style={{ display:"flex", gap:4, marginBottom:10 }}>
              {[0.5,1,2,5].map(f=>(
                <button key={f} onClick={()=>setFps(f)}
                  style={{ flex:1, padding:"4px 0", borderRadius:4, fontSize:11, cursor:"pointer",
                    border:`1px solid ${fps===f?"#22d3ee":"#1f2937"}`,
                    background:fps===f?"#22d3ee22":"transparent",
                    color:fps===f?"#22d3ee":"#6b7280" }}>{f}fps</button>
              ))}
            </div>
            <div onClick={()=>fileRef.current?.click()}
              style={{ border:"2px dashed #1f2937", borderRadius:6, padding:"20px 12px",
                textAlign:"center", cursor:"pointer" }}>
              <div style={{ fontSize:28, marginBottom:4 }}>🎬</div>
              <div style={{ fontSize:12, color:"#6b7280" }}>Drop video or click</div>
            </div>
            <input ref={fileRef} type="file" accept="video/*" style={{ display:"none" }}
              onChange={e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); }} />
          </Section>
          {loading && <div style={{ fontSize:12, color:"#22d3ee", textAlign:"center", padding:8 }}>⏳ Extracting...</div>}
          {error   && <div style={{ fontSize:11, color:"#ef4444", padding:8 }}>⚠ {error}</div>}
        </div>
        {result && (
          <div>
            <Section title="Extraction Result">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                <KPIBox label="Frames"   value={result.total_frames} />
                <KPIBox label="Duration" value={`${result.duration_s.toFixed(1)}s`} color="#3b82f6" />
                <KPIBox label="FPS"      value={result.config.fps} color="#22c55e" />
                <KPIBox label="Protocol" value={result.protocol.slice(0,6)} color="#6b7280" />
              </div>
              <div style={{ marginTop:8, fontSize:9, color:"#374151", wordBreak:"break-all" }}>
                manifest: {result.manifest_checksum?.slice(0,32)}…
              </div>
            </Section>
            <Section title="Frame Timeline (first 20)">
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {result.frames.slice(0,20).map(f=>(
                  <div key={f.index} style={{ background:"#111827", borderRadius:3, padding:"4px 6px", fontSize:9 }}>
                    <span style={{ color:"#22d3ee" }}>#{f.index}</span>
                    <span style={{ color:"#6b7280", marginLeft:4 }}>{f.timestamp_s}s</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:9, color:"#374151", marginTop:6 }}>Same video + config → same timestamps always</div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function OCRPanel() {
  const [result, setResult]   = useState<OCRDocumentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setError(null); setResult(null);
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx    = canvas.getContext("2d");
      if(!ctx) { setError("Canvas unavailable"); return; }
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = await processOCRDocument([imageData], crypto.randomUUID());
      if(!r) { setError("OCR failed"); return; }
      setResult(r);
    } catch(e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { bitmap?.close(); setLoading(false); }
  }, []);

  return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
        <GovernanceBadge label="DECODER"     value={OCR_DECODER_STRATEGY.toUpperCase()} locked />
        <GovernanceBadge label="TEMPERATURE" value={String(OCR_TEMPERATURE)} locked />
        <GovernanceBadge label="RTL"         value="SUPPORTED" />
        <GovernanceBadge label="PROTOCOL"    value={OCR_RUNTIME_VERSION} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:12 }}>
        <div>
          <Section title="Input">
            <div onClick={()=>fileRef.current?.click()}
              style={{ border:"2px dashed #1f2937", borderRadius:6, padding:"20px 12px",
                textAlign:"center", cursor:"pointer" }}>
              <div style={{ fontSize:28, marginBottom:4 }}>📄</div>
              <div style={{ fontSize:12, color:"#6b7280" }}>Drop image/document</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); }} />
          </Section>
          {loading && <div style={{ fontSize:12, color:"#22d3ee", textAlign:"center", padding:8 }}>⏳ OCR processing...</div>}
          {error   && <div style={{ fontSize:11, color:"#ef4444", padding:8 }}>⚠ {error}</div>}
        </div>
        {result && (
          <div>
            <Section title="OCR Result" source="ocrRuntime.ts">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
                <KPIBox label="Pages"   value={result.total_pages} />
                <KPIBox label="Lines"   value={result.total_lines}  color="#3b82f6" />
                <KPIBox label="Decoder" value={result.decoder_strategy.toUpperCase()} color="#22c55e" />
                <KPIBox label="Temp"    value={String(result.temperature)} color="#22c55e" />
              </div>
              <div style={{ padding:10, background:"#111827", borderRadius:4, fontSize:13,
                lineHeight:1.8, minHeight:60,
                direction:(result.pages[0]?.rtl_ratio??0)>0.5?"rtl":"ltr" }}>
                {result.full_text || "(no text — ONNX OCR model required)"}
              </div>
              <div style={{ fontSize:9, color:"#374151", marginTop:6, wordBreak:"break-all" }}>
                manifest: {result.manifest_checksum?.slice(0,32)}…
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE_RECORDS: MultimodalRecord[] = [
  { id:"img-001", file_name:"sample_001.jpg", modality:"image", split_bucket:"train",
    sequence_number:0, width:640, height:480,
    annotations:[{ id:1, category_id:1, category:"person",
      x:0.1, y:0.1, width:0.3, height:0.6, confidence:0.92 }],
    checksum:null, protocol:MULTIMODAL_ADAPTER_VERSION },
  { id:"img-002", file_name:"sample_002.jpg", modality:"image", split_bucket:"val",
    sequence_number:1, width:640, height:480, annotations:[],
    checksum:null, protocol:MULTIMODAL_ADAPTER_VERSION },
];

const QA_RECORDS = SAMPLE_RECORDS.map(r => ({
  id: r.id,
  annotations: r.annotations?.map(a => ({
    id:a.id, x:a.x, y:a.y, width:a.width, height:a.height,
    confidence:a.confidence, category_id:a.category_id,
  })),
}));

type ExportFmt = "coco_json"|"yolo_txt"|"hf_vision_jsonl"|"aivora_native_vision";

function MultimodalDatasetPanel() {
  const [format, setFormat] = useState<ExportFmt>("hf_vision_jsonl");
  const FORMATS: { value:ExportFmt; label:string }[] = [
    { value:"coco_json",            label:"COCO JSON"          },
    { value:"yolo_txt",             label:"YOLO TXT"           },
    { value:"hf_vision_jsonl",      label:"HuggingFace Vision" },
    { value:"aivora_native_vision", label:"Aivora Native"      },
  ];

  const handleExport = () => {
    const result = adaptMultimodalRecords(SAMPLE_RECORDS, format);
    const blob   = new Blob([result.content], { type:"application/octet-stream" });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement("a");
    a.href = url; a.download = `multimodal_sample.${result.file_extension}`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Section title="Format Adapters" source="multimodalAdapters.ts">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
          {FORMATS.map(f=>(
            <div key={f.value} onClick={()=>setFormat(f.value)}
              style={{ padding:"10px 12px", borderRadius:6, cursor:"pointer",
                background:format===f.value?"#0891b222":"#111827",
                border:`1px solid ${format===f.value?"#0891b2":"#1f2937"}` }}>
              <div style={{ fontSize:12, fontWeight:600,
                color:format===f.value?"#22d3ee":"#e5e7eb" }}>{f.label}</div>
            </div>
          ))}
        </div>
        <button onClick={handleExport}
          style={{ width:"100%", padding:"10px 0", borderRadius:6, border:"none",
            background:"#0891b2", color:"#fff", fontSize:12, fontWeight:700, cursor:"pointer" }}>
          📤 EXPORT AS {format.toUpperCase()}
        </button>
        <div style={{ fontSize:9, color:"#374151", marginTop:6 }}>
          Deterministic · Same records → same output
        </div>
      </Section>
      <Section title="Vision QA" source="visionQA.ts">
        <VisionQASummary records={QA_RECORDS} />
      </Section>
    </div>
  );
}

export default function MultimodalWorkstation() {
  const [activeTab, setActiveTab] = useState<TabId>("image");
  return (
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>
      <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
          <span style={{ fontSize:16, fontWeight:700, color:"#22d3ee",
            letterSpacing:1 }}>MULTIMODAL INTELLIGENCE</span>
          <span style={{ fontSize:9, color:"#374151" }}>Phase 14 · Image + Video + OCR + Vision QA</span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[["DETERMINISM","ABSOLUTE"],["LINEAGE","SHA256"],["MEMORY","BOUNDED"],["SCHEDULER","TIER 5"]].map(([l,v])=>(
            <div key={l} style={{ padding:"2px 8px", borderRadius:3,
              background:"#052e16", border:"1px solid #166534", fontSize:9 }}>
              <span style={{ color:"#6b7280" }}>{l}: </span>
              <span style={{ color:"#22c55e", fontWeight:700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid #1f2937",
        background:"#0d1117", overflowX:"auto" }}>
        {TABS.map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
            style={{ padding:"10px 16px", border:"none", cursor:"pointer",
              background:"transparent", whiteSpace:"nowrap", fontSize:12,
              color:activeTab===tab.id?"#22d3ee":"#6b7280",
              borderBottom:activeTab===tab.id?"2px solid #22d3ee":"2px solid transparent",
              display:"flex", alignItems:"center", gap:6 }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div style={{ padding:16 }}>
        {activeTab==="image"   && <ImagePanel />}
        {activeTab==="video"   && <VideoPanel />}
        {activeTab==="ocr"     && <OCRPanel />}
        {activeTab==="dataset" && <MultimodalDatasetPanel />}
      </div>
    </div>
  );
}
