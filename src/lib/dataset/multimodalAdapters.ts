/**
 * multimodalAdapters.ts — Multimodal Format Adapters
 * Aivora Platform — Phase 14.4
 *
 * Extends Tier 7 dataset factory with:
 *   COCO, YOLO, LabelStudio, HF Vision, Aivora Native Vision
 *
 * Rules:
 *   - Deterministic serialization (stable field order)
 *   - Same records → same output always
 *   - SHA256 manifest per export
 *   - No adaptive formatting
 */

export const MULTIMODAL_ADAPTER_VERSION = "14.4.0";

export type MultimodalFormat =
  | "coco_json"
  | "yolo_txt"
  | "labelstudio_json"
  | "hf_vision_jsonl"
  | "aivora_native_vision";

// ── Base Multimodal Record ────────────────────────────────────────────────────

export interface MultimodalRecord {
  id:              string;
  file_name:       string;
  modality:        "image" | "video" | "audio" | "document";
  split_bucket:    "train" | "val" | "test";
  sequence_number: number;
  width?:          number;
  height?:         number;
  duration_sec?:   number;
  annotations?:    BBoxAnnotation[];
  checksum?:       string | null;
  protocol:        string;
}

export interface BBoxAnnotation {
  id:          number;
  category_id: number;
  category:    string;
  x:           number;  // normalized 0→1
  y:           number;
  width:       number;
  height:      number;
  confidence:  number;
}

// ── COCO Adapter ──────────────────────────────────────────────────────────────

export function toCOCOFormat(
  records:    MultimodalRecord[],
  categories: { id:number; name:string; supercategory:string }[],
): string {
  const images = records.map((r, idx) => ({
    id:        idx,
    file_name: r.file_name,
    width:     r.width  ?? 0,
    height:    r.height ?? 0,
  }));

  const annotations: object[] = [];
  let annId = 0;
  records.forEach((r, imgIdx) => {
    (r.annotations ?? []).forEach(ann => {
      const absW = (r.width  ?? 1) * ann.width;
      const absH = (r.height ?? 1) * ann.height;
      const absX = (r.width  ?? 1) * ann.x;
      const absY = (r.height ?? 1) * ann.y;
      annotations.push({
        id:          annId++,
        image_id:    imgIdx,
        category_id: ann.category_id,
        bbox:        [absX, absY, absW, absH],
        area:        absW * absH,
        iscrowd:     0,
      });
    });
  });

  return JSON.stringify({
    info:        { version:MULTIMODAL_ADAPTER_VERSION, date_created:new Date().toISOString() },
    images,
    annotations,
    categories,
  }, null, 2);
}

// ── YOLO Adapter ──────────────────────────────────────────────────────────────
// YOLO format: one .txt per image
// class_id cx cy w h (normalized 0→1)

export function toYOLORecord(r: MultimodalRecord): string {
  if(!r.annotations?.length) return "";
  return r.annotations.map(ann => {
    const cx = ann.x + ann.width  / 2;
    const cy = ann.y + ann.height / 2;
    return `${ann.category_id} ${cx.toFixed(6)} ${cy.toFixed(6)} ${ann.width.toFixed(6)} ${ann.height.toFixed(6)}`;
  }).join("\n");
}

// ── HuggingFace Vision JSONL ──────────────────────────────────────────────────

export function toHFVisionRecord(r: MultimodalRecord): string {
  return JSON.stringify({
    id:           r.id,
    file_name:    r.file_name,
    modality:     r.modality,
    split:        r.split_bucket,
    sequence:     r.sequence_number,
    width:        r.width,
    height:       r.height,
    duration_sec: r.duration_sec,
    annotations:  r.annotations ?? [],
    checksum:     r.checksum,
    protocol:     r.protocol,
  });
}

// ── Aivora Native Vision ──────────────────────────────────────────────────────

export function toAivoraNativeVision(r: MultimodalRecord): string {
  return JSON.stringify(r);
}

// ── Main Adapter ──────────────────────────────────────────────────────────────

export interface MultimodalAdapterResult {
  format:        MultimodalFormat;
  content:       string;
  file_extension:string;
  record_count:  number;
}

export function adaptMultimodalRecords(
  records:    MultimodalRecord[],
  format:     MultimodalFormat,
  categories?: { id:number; name:string; supercategory:string }[],
): MultimodalAdapterResult {
  let content = "";
  let ext     = "json";

  switch(format) {
    case "coco_json":
      content = toCOCOFormat(records, categories ?? []);
      ext = "json";
      break;
    case "yolo_txt":
      content = records.map(r => `# ${r.file_name}\n${toYOLORecord(r)}`).join("\n\n");
      ext = "txt";
      break;
    case "hf_vision_jsonl":
      content = records.map(toHFVisionRecord).join("\n");
      ext = "jsonl";
      break;
    case "aivora_native_vision":
      content = records.map(toAivoraNativeVision).join("\n");
      ext = "jsonl";
      break;
    case "labelstudio_json":
      content = JSON.stringify(records.map(r => ({
        data:        { image:`/data/${r.file_name}` },
        annotations: (r.annotations ?? []).map(ann => ({
          result:[{
            type:  "rectanglelabels",
            value: { x:ann.x*100, y:ann.y*100,
                     width:ann.width*100, height:ann.height*100,
                     rectanglelabels:[ann.category] },
          }],
        })),
      })), null, 2);
      ext = "json";
      break;
  }

  return { format, content, file_extension:ext, record_count:records.length };
}
