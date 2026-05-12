/**
 * timeStretch.ts — WSOLA Time Stretch/Compress
 * Aivora Waveform Workstation — Batch C
 */

export interface StretchOptions {
  ratio:       number;   // 0.65 – 1.80
  windowSize?: number;   // samples (default 2048)
  hopSize?:    number;   // samples (default 512)
}

export interface StretchResult {
  buffer:   AudioBuffer;
  ratio:    number;
  warning?: string;
}

function crossCorrelate(
  a: Float32Array, b: Float32Array,
  maxLag: number
): number {
  let bestLag  = 0;
  let bestCorr = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < b.length) corr += a[i] * b[j];
    }
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  return bestLag;
}

function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

export function stretchRegion(
  buffer:     AudioBuffer,
  startSec:   number,
  endSec:     number,
  targetSec:  number,
  options:    StretchOptions = { ratio: 1.0 }
): StretchResult {
  const sr          = buffer.sampleRate;
  const winSize     = options.windowSize ?? 2048;
  const hopOut      = options.hopSize    ?? 512;
  const startSample = Math.round(startSec * sr);
  const endSample   = Math.round(endSec   * sr);
  const regionLen   = endSample - startSample;
  const targetLen   = Math.round(targetSec * sr);
  const ratio       = targetLen / regionLen;

  let warning: string | undefined;
  if (ratio < 0.65 || ratio > 1.80)
    warning = `Stretch ratio ${ratio.toFixed(2)}x is outside safe range (0.65–1.80x)`;
  else if (ratio < 0.80 || ratio > 1.25)
    warning = `Stretch ratio ${ratio.toFixed(2)}x may affect audio quality`;

  const window  = hannWindow(winSize);
  const hopIn   = Math.round(hopOut / ratio);
  const maxLag  = Math.round(winSize / 4);

  // Process each channel
  const numCh   = buffer.numberOfChannels;
  const totalLen = (buffer.length - regionLen) + targetLen;
  const ctx      = new OfflineAudioContext(numCh, totalLen, sr);
  const outBuf   = ctx.createBuffer(numCh, totalLen, sr);

  for (let ch = 0; ch < numCh; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = outBuf.getChannelData(ch);

    // Copy pre-region
    for (let i = 0; i < startSample; i++) dest[i] = src[i];

    // WSOLA stretch
    const region = src.slice(startSample, endSample);
    const output = new Float32Array(targetLen + winSize);
    const overlap = new Float32Array(targetLen + winSize);

    let inPos  = 0;
    let outPos = 0;

    while (inPos + winSize <= region.length) {
      const frame = new Float32Array(winSize);
      for (let i = 0; i < winSize; i++)
        frame[i] = region[Math.min(inPos + i, region.length - 1)] * window[i];

      // Find best overlap position
      let bestPos = outPos;
      if (outPos > 0) {
        const prev = output.slice(Math.max(0, outPos - hopOut), outPos);
        const lag  = crossCorrelate(prev, frame, Math.min(maxLag, hopIn));
        bestPos    = Math.max(0, outPos + lag);
      }

      // OLA
      for (let i = 0; i < winSize && bestPos + i < output.length; i++) {
        output[bestPos + i]  += frame[i];
        overlap[bestPos + i] += window[i];
      }

      inPos  += hopIn;
      outPos  = bestPos + hopOut;
    }

    // Normalize by overlap
    for (let i = 0; i < targetLen; i++) {
      const o = overlap[i] > 0.001 ? overlap[i] : 1;
      dest[startSample + i] = Math.max(-1, Math.min(1, output[i] / o));
    }

    // Copy post-region
    const postStart = endSample;
    const destPost  = startSample + targetLen;
    for (let i = 0; i < buffer.length - postStart; i++)
      dest[destPost + i] = src[postStart + i];
  }

  return { buffer: outBuf, ratio, warning };
}

export function validateStretchRatio(ratio: number): {
  valid: boolean; warning?: string; error?: string;
} {
  if (ratio < 0.65) return { valid: false, error: `Ratio ${ratio.toFixed(2)}x too low (min 0.65x)` };
  if (ratio > 1.80) return { valid: false, error: `Ratio ${ratio.toFixed(2)}x too high (max 1.80x)` };
  if (ratio < 0.80) return { valid: true,  warning: `Ratio ${ratio.toFixed(2)}x may cause artifacts` };
  if (ratio > 1.25) return { valid: true,  warning: `Ratio ${ratio.toFixed(2)}x may cause artifacts` };
  return { valid: true };
}
