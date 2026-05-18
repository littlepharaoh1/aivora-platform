/**
 * spectrogramWorker.js — OffscreenCanvas Spectrogram Worker
 * Aivora Audio Infrastructure Platform
 *
 * Renders spectrogram on OffscreenCanvas in dedicated worker thread
 * Zero main-thread blocking for large file spectrogram rendering
 *
 * Protocol:
 * Main → Worker: { type:"render", fftData, width, height, colormap, minDb, maxDb }
 * Worker → Main: { type:"done", imageBitmap }
 */

// ── Colormaps ─────────────────────────────────────────────────────────────────

const COLORMAPS = {
  plasma: (t) => {
    const r = Math.round(Math.max(0,Math.min(255, 13+t*(248-13))));
    const g = Math.round(Math.max(0,Math.min(255, 8+t*(148-8))));
    const b = Math.round(Math.max(0,Math.min(255, 135+t*(52-135))));
    return [r,g,b];
  },
  inferno: (t) => {
    const r = Math.round(Math.max(0,Math.min(255, 0+t*252)));
    const g = Math.round(Math.max(0,Math.min(255, 0+t*(168-0))));
    const b = Math.round(Math.max(0,Math.min(255, 4+t*(18-4))));
    return [r,g,b];
  },
  aivora: (t) => {
    // Teal → Purple → White
    if(t < 0.5) {
      const s = t*2;
      return [
        Math.round(14+s*(139-14)),
        Math.round(165+s*(92-165)),
        Math.round(233+s*(204-233)),
      ];
    }
    const s = (t-0.5)*2;
    return [
      Math.round(139+s*(255-139)),
      Math.round(92+s*(255-92)),
      Math.round(204+s*(255-204)),
    ];
  },
  forensic: (t) => {
    // Black → Green → Yellow → Red
    if(t < 0.33) {
      const s=t/0.33;
      return [0, Math.round(s*255), 0];
    } else if(t < 0.66) {
      const s=(t-0.33)/0.33;
      return [Math.round(s*255), 255, 0];
    }
    const s=(t-0.66)/0.34;
    return [255, Math.round(255*(1-s)), 0];
  },
};

// ── Render ────────────────────────────────────────────────────────────────────

self.onmessage = function(e) {
  const { type, fftData, width, height, colormap="aivora",
          minDb=-90, maxDb=0, canvas } = e.data;

  if(type !== "render" || !canvas) return;

  const ctx = canvas.getContext("2d");
  if(!ctx) return;

  const numFrames = fftData.length;
  const numBins   = fftData[0]?.length ?? 0;
  if(!numFrames || !numBins) return;

  const imageData = ctx.createImageData(width, height);
  const data      = imageData.data;
  const mapFn     = COLORMAPS[colormap] ?? COLORMAPS.aivora;
  const dbRange   = maxDb - minDb;

  for(let x=0; x<width; x++) {
    const frameIdx = Math.floor(x / width * numFrames);
    const frame    = fftData[frameIdx];
    if(!frame) continue;

    for(let y=0; y<height; y++) {
      // Flip Y — high freq at top
      const binIdx = Math.floor((1 - y/height) * numBins);
      const db     = frame[Math.min(binIdx, frame.length-1)] ?? minDb;
      const t      = Math.max(0, Math.min(1, (db - minDb) / dbRange));
      const [r,g,b] = mapFn(t);
      const idx    = (y * width + x) * 4;
      data[idx]   = r;
      data[idx+1] = g;
      data[idx+2] = b;
      data[idx+3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Transfer back as ImageBitmap
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ type:"done", bitmap }, [bitmap]);
};
