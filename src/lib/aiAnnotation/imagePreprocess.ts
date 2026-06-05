/**
 * imagePreprocess.ts
 * Aivora Platform — Image → Tensor preprocessing for vision models
 *
 * Deterministic conversion of an image into the input tensor each model needs.
 * YOLO expects [1,3,640,640], RGB, normalized 0..1, letterboxed to preserve
 * aspect ratio. Pure given the same pixels → same tensor.
 */

export interface PreprocessResult {
  data:    Float32Array;
  dims:    number[];
  // Letterbox metadata — needed to map detections back to original coords
  scale:   number;   // resize ratio applied
  padX:    number;   // horizontal padding (in resized px)
  padY:    number;   // vertical padding
  origW:   number;
  origH:   number;
}

/**
 * Letterbox + normalize an ImageBitmap/HTMLImageElement/Canvas into a YOLO tensor.
 * Uses an offscreen canvas to read pixels deterministically.
 */
export function preprocessForYOLO(
  source: CanvasImageSource,
  origW:  number,
  origH:  number,
  target = 640,
): PreprocessResult | null {
  // Compute letterbox scale (fit within target, preserve aspect ratio)
  const scale = Math.min(target / origW, target / origH);
  const newW  = Math.round(origW * scale);
  const newH  = Math.round(origH * scale);
  const padX  = Math.floor((target - newW) / 2);
  const padY  = Math.floor((target - newH) / 2);

  // Draw onto a target×target canvas with gray padding (114 = YOLO default)
  const canvas = document.createElement("canvas");
  canvas.width = target; canvas.height = target;
  const ctx = canvas.getContext("2d");
  if(!ctx) return null;

  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, target, target);
  ctx.drawImage(source, padX, padY, newW, newH);

  const img = ctx.getImageData(0, 0, target, target).data; // RGBA, row-major

  // Convert to CHW float32, normalized 0..1 (YOLO expects RGB, channel-first)
  const area = target * target;
  const data = new Float32Array(3 * area);
  for(let i = 0; i < area; i++) {
    const r = img[i*4]     / 255;
    const g = img[i*4 + 1] / 255;
    const b = img[i*4 + 2] / 255;
    data[i]            = r;  // R plane
    data[area + i]     = g;  // G plane
    data[2*area + i]   = b;  // B plane
  }

  return {
    data, dims: [1, 3, target, target],
    scale, padX, padY, origW, origH,
  };
}

/**
 * Reshape YOLOv8 raw output [1, 84, 8400] into decoder rows.
 * Each of the 8400 anchors becomes [cx, cy, w, h, score_0..score_79], with
 * coordinates mapped from letterboxed 640-space back to ORIGINAL image pixels.
 * Deterministic.
 */
export function reshapeYOLOOutput(
  raw:  Float32Array,
  dims: number[],
  meta: PreprocessResult,
): number[][] {
  // dims expected [1, 84, 8400] → 84 attrs, 8400 anchors
  if(dims.length !== 3) return [];
  const attrs   = dims[1];   // 84
  const anchors = dims[2];   // 8400
  const rows: number[][] = [];

  for(let a = 0; a < anchors; a++) {
    // Column-major read: value(attr, anchor) = raw[attr*anchors + a]
    const cx = raw[0*anchors + a];
    const cy = raw[1*anchors + a];
    const w  = raw[2*anchors + a];
    const h  = raw[3*anchors + a];

    // Map from 640-letterbox space → original pixels
    const ox = (cx - meta.padX) / meta.scale;
    const oy = (cy - meta.padY) / meta.scale;
    const ow = w / meta.scale;
    const oh = h / meta.scale;

    const row = new Array(4 + (attrs - 4));
    row[0] = ox; row[1] = oy; row[2] = ow; row[3] = oh;
    for(let c = 4; c < attrs; c++) {
      row[c] = raw[c*anchors + a];
    }
    rows.push(row);
  }

  return rows;
}
