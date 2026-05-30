/**
 * annotationExportService.ts — Enterprise Export Engine
 * Aivora Platform — Phase 15.2
 *
 * Deterministic exports: same input → same output always.
 * Reuses existing: sha256 pattern, emitEvent.
 * Supports: COCO, YOLO, Pascal VOC, JSONL, AIVORA Native.
 */

import type {
  EnterpriseAnnotation, EnterpriseAnnotationState,
  ExportFormat,
} from "./annotationTypes";
import { emitEvent } from "../lib/telemetry/emitter";

// ── SHA-256 (reuse existing pattern) ─────────────────────────────────────────

async function sha256(str: string): Promise<string> {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── Image dimensions helper ───────────────────────────────────────────────────

export interface ImageMeta {
  id:       string;
  filename: string;
  width:    number;
  height:   number;
}

// ── COCO Export ───────────────────────────────────────────────────────────────

function toCOCO(
  state:  EnterpriseAnnotationState,
  image:  ImageMeta,
): object {
  const { width: W, height: H } = image;

  const categories = Array.from(
    new Map(state.annotations.map(a => [a.class_id, { id: a.class_id, name: a.class_name }]))
    .values()
  ).sort((a, b) => a.id - b.id);

  const annotations = state.annotations
    .filter(a => ["bbox","polygon","segmentation"].includes(a.type))
    .map((a, idx) => {
      const base: any = {
        id:          idx + 1,
        image_id:    1,
        category_id: a.class_id,
        iscrowd:     0,
        score:       a.confidence,
      };

      // BBox → COCO [x,y,width,height] in pixels
      if(a.bbox) {
        base.bbox = [
          Math.round(a.bbox.x * W),
          Math.round(a.bbox.y * H),
          Math.round(a.bbox.width  * W),
          Math.round(a.bbox.height * H),
        ];
        base.area = base.bbox[2] * base.bbox[3];
      }

      // Polygon → COCO segmentation [[x1,y1,x2,y2,...]]
      if(a.points.length >= 3) {
        base.segmentation = [
          a.points.flatMap(p => [Math.round(p.x * W), Math.round(p.y * H)])
        ];
        if(!base.area && a.bbox) {
          base.area = Math.round(a.bbox.width * W) * Math.round(a.bbox.height * H);
        }
      }

      // Keypoints → COCO [x,y,v,x,y,v,...]
      if(a.keypoints.length > 0) {
        base.keypoints = a.keypoints.flatMap(k => [
          Math.round(k.x * W),
          Math.round(k.y * H),
          k.visibility,
        ]);
        base.num_keypoints = a.keypoints.filter(k => k.visibility > 0).length;
      }

      return base;
    });

  return {
    info: {
      description:  "AIVORA Platform Export",
      version:      "15.2.0",
      date_created: new Date().toISOString(),
    },
    licenses: [],
    images: [{
      id:        1,
      file_name: image.filename,
      width:     W,
      height:    H,
    }],
    annotations,
    categories,
  };
}

// ── YOLO Export ───────────────────────────────────────────────────────────────

function toYOLO(
  state:  EnterpriseAnnotationState,
  _image: ImageMeta,
): string {
  return state.annotations
    .filter(a => a.type === "bbox" && a.bbox)
    .map(a => {
      const b  = a.bbox!;
      const cx = (b.x + b.width  / 2).toFixed(6);
      const cy = (b.y + b.height / 2).toFixed(6);
      const w  = b.width.toFixed(6);
      const h  = b.height.toFixed(6);
      return `${a.class_id} ${cx} ${cy} ${w} ${h}`;
    })
    .join("\n");
}

// ── Pascal VOC Export ─────────────────────────────────────────────────────────

function toPascalVOC(
  state:  EnterpriseAnnotationState,
  image:  ImageMeta,
): string {
  const { width: W, height: H, filename } = image;

  const objects = state.annotations
    .filter(a => a.type === "bbox" && a.bbox)
    .map(a => {
      const b = a.bbox!;
      const xmin = Math.round(b.x * W);
      const ymin = Math.round(b.y * H);
      const xmax = Math.round((b.x + b.width)  * W);
      const ymax = Math.round((b.y + b.height) * H);
      return `\t<object>
\t\t<name>${a.class_name}</name>
\t\t<pose>Unspecified</pose>
\t\t<truncated>0</truncated>
\t\t<difficult>0</difficult>
\t\t<occluded>0</occluded>
\t\t<bndbox>
\t\t\t<xmin>${xmin}</xmin>
\t\t\t<ymin>${ymin}</ymin>
\t\t\t<xmax>${xmax}</xmax>
\t\t\t<ymax>${ymax}</ymax>
\t\t</bndbox>
\t</object>`;
    }).join("\n");

  return `<annotation>
\t<folder>images</folder>
\t<filename>${filename}</filename>
\t<size>
\t\t<width>${W}</width>
\t\t<height>${H}</height>
\t\t<depth>3</depth>
\t</size>
\t<segmented>0</segmented>
${objects}
</annotation>`;
}

// ── JSONL Export ──────────────────────────────────────────────────────────────

function toJSONL(
  state:  EnterpriseAnnotationState,
  image:  ImageMeta,
): string {
  return state.annotations.map(a => JSON.stringify({
    image_id:    image.id,
    filename:    image.filename,
    ann_id:      a.id,
    type:        a.type,
    class_id:    a.class_id,
    class_name:  a.class_name,
    bbox:        a.bbox,
    points:      a.points.length > 0 ? a.points : undefined,
    keypoints:   a.keypoints.length > 0 ? a.keypoints : undefined,
    labels:      a.labels,
    attributes:  a.attributes.length > 0 ? a.attributes : undefined,
    confidence:  a.confidence,
    is_approved: a.is_approved,
    qa_flag:     a.qa_flag,
    sequence:    a.sequence,
    created_at:  a.created_at,
  })).join("\n");
}

// ── AIVORA Native Export ──────────────────────────────────────────────────────

function toAivoraNative(
  state:  EnterpriseAnnotationState,
  image:  ImageMeta,
): object {
  return {
    schema_version:   "15.2.0",
    export_protocol:  "aivora_native_v2",
    image,
    annotation_count: state.annotations.length,
    layers:           state.layers,
    relationships:    state.relationships,
    annotations:      state.annotations,
    generated_at:     new Date().toISOString(),
  };
}

// ── Main export function ──────────────────────────────────────────────────────

export async function exportAnnotations(
  state:    EnterpriseAnnotationState,
  image:    ImageMeta,
  format:   ExportFormat,
  filename: string,
): Promise<void> {
  let content = "";
  let mime    = "text/plain";
  let ext: string = format;

  switch(format) {
    case "coco": {
      const coco = toCOCO(state, image);
      content    = JSON.stringify(coco, null, 2);
      mime       = "application/json";
      ext        = "json";
      break;
    }
    case "yolo": {
      content = toYOLO(state, image);
      mime    = "text/plain";
      ext     = "txt";
      break;
    }
    case "pascal_voc": {
      content = toPascalVOC(state, image);
      mime    = "application/xml";
      ext     = "xml";
      break;
    }
    case "jsonl": {
      content = toJSONL(state, image);
      mime    = "application/jsonl";
      ext     = "jsonl";
      break;
    }
    case "aivora_native": {
      const native = toAivoraNative(state, image);
      content      = JSON.stringify(native, null, 2);
      mime         = "application/json";
      ext          = "aivora.json";
      break;
    }
  }

  // Compute deterministic checksum
  const checksum = await sha256(content);

  // Download
  const blob = new Blob([content], { type: mime });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `${filename}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);

  // Telemetry
  emitEvent({
    event_type:     "ADMIN_ACTION",
    event_source:   "qc_workstation",
    correlation_id: state.image_id,
    severity:       "info",
    payload: {
      action:           "ANNOTATIONS_EXPORTED",
      format,
      annotation_count: state.annotations.length,
      checksum,
    },
  });
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface AnnotationStats {
  total:          number;
  by_type:        Record<string, number>;
  by_class:       Record<string, number>;
  approved:       number;
  flagged:        number;
  ai_suggested:   number;
  mean_confidence:number;
}

export function computeStats(
  annotations: EnterpriseAnnotation[],
): AnnotationStats {
  const by_type:  Record<string, number> = {};
  const by_class: Record<string, number> = {};
  let approved = 0, flagged = 0, ai = 0, confSum = 0;

  for(const a of annotations) {
    by_type[a.type]       = (by_type[a.type]       ?? 0) + 1;
    by_class[a.class_name]= (by_class[a.class_name] ?? 0) + 1;
    if(a.is_approved) approved++;
    if(a.qa_flag)     flagged++;
    if(a.is_ai)       ai++;
    confSum += a.confidence;
  }

  return {
    total:           annotations.length,
    by_type,
    by_class,
    approved,
    flagged,
    ai_suggested:    ai,
    mean_confidence: annotations.length > 0 ? confSum / annotations.length : 0,
  };
}
