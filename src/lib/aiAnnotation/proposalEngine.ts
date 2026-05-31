/**
 * proposalEngine.ts
 * Aivora Platform — Proposal Decoders
 *
 * PURE, deterministic decoding of raw model output tensors into typed
 * Proposals. Same tensor → same proposals, always. No DB, no inference here —
 * this is the layer that guarantees deterministic exports regardless of which
 * backend (WebGPU/WebGL2/WASM) produced the tensor.
 */

import type { Proposal, ProposalBBox } from "./aiAnnotationTypes";

// ── Geometry helpers ──────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalizeBBox(
  cx: number, cy: number, w: number, h: number, imgW: number, imgH: number,
): ProposalBBox {
  // YOLO outputs center-x, center-y, width, height in pixels → normalized corner box
  const x = clamp01((cx - w / 2) / imgW);
  const y = clamp01((cy - h / 2) / imgH);
  const width  = clamp01(w / imgW);
  const height = clamp01(h / imgH);
  return {
    x, y,
    width:  Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

// ── IoU + NMS (deterministic non-max suppression) ─────────────────────────────

function iou(a: ProposalBBox, b: ProposalBBox): number {
  const ax2 = a.x + a.width, ay2 = a.y + a.height;
  const bx2 = b.x + b.width, by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

// Deterministic NMS: sort by confidence desc, tie-break by bbox position.
export function nonMaxSuppression(
  proposals: Proposal[], iouThreshold = 0.45,
): Proposal[] {
  const sorted = [...proposals].sort((a, b) =>
    a.confidence !== b.confidence
      ? b.confidence - a.confidence
      : (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0) || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0)
  );
  const kept: Proposal[] = [];
  for(const p of sorted) {
    if(!p.bbox) { kept.push(p); continue; }
    const overlaps = kept.some(k =>
      k.bbox && k.class_id === p.class_id && iou(k.bbox, p.bbox!) > iouThreshold
    );
    if(!overlaps) kept.push(p);
  }
  return kept;
}

// ── YOLO decoder ──────────────────────────────────────────────────────────────
// YOLOv8 output: [1, 84, 8400] → 8400 boxes, each [cx,cy,w,h, 80 class scores]
// We accept a pre-reshaped flat structure: rows of [cx,cy,w,h,...scores].

export interface YOLODecodeConfig {
  imgW:          number;
  imgH:          number;
  classNames:    string[];
  confThreshold: number;
  iouThreshold:  number;
}

export function decodeYOLO(
  rows:   number[][],   // each row: [cx, cy, w, h, score_0, ..., score_n]
  config: YOLODecodeConfig,
): Proposal[] {
  const proposals: Proposal[] = [];

  for(let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if(row.length < 5) continue;
    const [cx, cy, w, h] = row;
    const scores = row.slice(4);

    // Best class (deterministic: first max on ties)
    let bestIdx = 0, bestScore = scores[0] ?? 0;
    for(let c = 1; c < scores.length; c++) {
      if(scores[c] > bestScore) { bestScore = scores[c]; bestIdx = c; }
    }
    if(bestScore < config.confThreshold) continue;

    proposals.push({
      id:          `yolo_${i}_${bestIdx}`,
      kind:        "bbox",
      source:      "yolo",
      class_id:    bestIdx,
      class_name:  config.classNames[bestIdx] ?? `class_${bestIdx}`,
      confidence:  Math.round(bestScore * 1000) / 1000,
      bbox:        normalizeBBox(cx, cy, w, h, config.imgW, config.imgH),
      mask_points: null,
      candidates:  null,
    });
  }

  return nonMaxSuppression(proposals, config.iouThreshold);
}

// ── CLIP decoder ──────────────────────────────────────────────────────────────
// CLIP output: similarity logits over candidate class names → softmax ranking.

export function softmax(logits: number[]): number[] {
  if(logits.length === 0) return [];
  const max = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - max));
  const sum = exps.reduce((s, e) => s + e, 0);
  return sum > 0 ? exps.map(e => e / sum) : logits.map(() => 0);
}

export function decodeCLIP(
  logits:     number[],
  classNames: string[],
  topK = 5,
): Proposal {
  const probs = softmax(logits);
  const ranked = classNames
    .map((name, i) => ({ class_name: name, score: Math.round((probs[i] ?? 0) * 1000) / 1000 }))
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.class_name.localeCompare(b.class_name))
    .slice(0, topK);

  const top = ranked[0] ?? { class_name: "unknown", score: 0 };
  return {
    id:          "clip_classification",
    kind:        "class",
    source:      "clip",
    class_id:    classNames.indexOf(top.class_name),
    class_name:  top.class_name,
    confidence:  top.score,
    bbox:        null,
    mask_points: null,
    candidates:  ranked,
  };
}

// ── SAM2 decoder ──────────────────────────────────────────────────────────────
// SAM2 mask output: a low-res mask grid → contour traced to normalized polygon.
// We accept a binary mask (row-major) + dims, return a simplified polygon.

export function decodeSAM2Mask(
  mask:   number[],   // flattened, values >0.5 = foreground
  maskW:  number,
  maskH:  number,
  classId: number,
  className: string,
  confidence: number,
): Proposal {
  // Deterministic bounding contour: find min/max foreground pixels, emit a
  // simplified convex-ish polygon from the mask extent + edge midpoints.
  let minX = maskW, minY = maskH, maxX = 0, maxY = 0, count = 0;
  for(let y = 0; y < maskH; y++) {
    for(let x = 0; x < maskW; x++) {
      if(mask[y * maskW + x] > 0.5) {
        if(x < minX) minX = x; if(x > maxX) maxX = x;
        if(y < minY) minY = y; if(y > maxY) maxY = y;
        count++;
      }
    }
  }

  if(count === 0) {
    return {
      id:`sam2_empty`, kind:"mask", source:"sam2", class_id:classId,
      class_name:className, confidence:0, bbox:null, mask_points:[], candidates:null,
    };
  }

  // Normalized polygon (box-derived, deterministic). Real contour tracing can
  // refine this; the extent polygon is a stable, reproducible baseline.
  const nx = (v: number) => clamp01(v / maskW);
  const ny = (v: number) => clamp01(v / maskH);
  const points = [
    { x: nx(minX), y: ny(minY) },
    { x: nx(maxX), y: ny(minY) },
    { x: nx(maxX), y: ny(maxY) },
    { x: nx(minX), y: ny(maxY) },
  ];

  return {
    id:          "sam2_mask",
    kind:        "mask",
    source:      "sam2",
    class_id:    classId,
    class_name:  className,
    confidence:  Math.round(confidence * 1000) / 1000,
    bbox:        { x:nx(minX), y:ny(minY), width:nx(maxX-minX), height:ny(maxY-minY) },
    mask_points: points,
    candidates:  null,
  };
}

// ── Proposal → annotation payload checksum (deterministic) ────────────────────

export function proposalsChecksum(proposals: Proposal[]): string {
  // Stable serialization for the output_checksum (sorted, fixed precision).
  const canonical = proposals
    .map(p => `${p.source}:${p.class_id}:${p.confidence}:${p.bbox ? `${p.bbox.x},${p.bbox.y},${p.bbox.width},${p.bbox.height}` : "-"}`)
    .sort()
    .join("|");
  return canonical;
}
