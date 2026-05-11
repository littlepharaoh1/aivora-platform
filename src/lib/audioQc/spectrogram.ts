/**
 * spectrogram.ts — Canvas-based Spectrogram Generator
 * Aivora Audio QC Engine — Batch 10
 */

export interface SpectrogramOptions {
  fftSize:     number;   // 1024, 2048, 4096
  hopSize?:    number;   // default fftSize/4
  minDb?:      number;   // default -90
  maxDb?:      number;   // default 0
  sampleRate:  number;
}

export interface SpectrogramData {
  frames:      Float32Array[];  // each frame = magnitude spectrum in dB
  numFrames:   number;
  numBins:     number;
  minDb:       number;
  maxDb:       number;
  durationSec: number;
  sampleRate:  number;
  fftSize:     number;
}

// ── Hann window ───────────────────────────────────────────────────────────────

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

// ── Cooley-Tukey FFT ──────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len >> 1; j++) {
        const uRe = re[i+j], uIm = im[i+j];
        const vRe = re[i+j+len/2]*cRe - im[i+j+len/2]*cIm;
        const vIm = re[i+j+len/2]*cIm + im[i+j+len/2]*cRe;
        re[i+j] = uRe+vRe; im[i+j] = uIm+vIm;
        re[i+j+len/2] = uRe-vRe; im[i+j+len/2] = uIm-vIm;
        const nRe = cRe*wRe - cIm*wIm;
        cIm = cRe*wIm + cIm*wRe; cRe = nRe;
      }
    }
  }
}

// ── Compute spectrogram data ──────────────────────────────────────────────────

export function computeSpectrogram(
  buffer: AudioBuffer,
  options: SpectrogramOptions
): SpectrogramData {
  const { fftSize, sampleRate } = options;
  const hopSize = options.hopSize ?? Math.floor(fftSize / 4);
  const minDb   = options.minDb  ?? -90;
  const maxDb   = options.maxDb  ?? 0;
  const numBins = fftSize / 2;
  const window  = hannWindow(fftSize);

  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  const frames: Float32Array[] = [];
  for (let start = 0; start + fftSize <= mono.length; start += hopSize) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = mono[start + i] * window[i];
    fft(re, im);

    const mag = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      const m = Math.sqrt(re[i]*re[i] + im[i]*im[i]) / fftSize;
      mag[i] = Math.max(minDb, Math.min(maxDb, 20 * Math.log10(m + 1e-10)));
    }
    frames.push(mag);
  }

  return {
    frames,
    numFrames:   frames.length,
    numBins,
    minDb,
    maxDb,
    durationSec: buffer.length / sampleRate,
    sampleRate,
    fftSize,
  };
}

// ── Draw to canvas ────────────────────────────────────────────────────────────

const COLORMAP: [number, number, number][] = [
  [  8,  10,  20],  // -90 dB — near black
  [  5,  30,  70],  // dark blue
  [  0,  80, 120],  // deep teal
  [  0, 140, 160],  // cyan
  [  0, 200, 120],  // green
  [180, 220,   0],  // yellow-green
  [255, 160,   0],  // orange
  [255,  60,  20],  // red-orange
  [255, 255, 255],  // 0 dB — white
];

function interpolateColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const idx     = clamped * (COLORMAP.length - 1);
  const lo      = Math.floor(idx);
  const hi      = Math.min(lo + 1, COLORMAP.length - 1);
  const f       = idx - lo;
  return [
    Math.round(COLORMAP[lo][0] * (1-f) + COLORMAP[hi][0] * f),
    Math.round(COLORMAP[lo][1] * (1-f) + COLORMAP[hi][1] * f),
    Math.round(COLORMAP[lo][2] * (1-f) + COLORMAP[hi][2] * f),
  ];
}

export function drawSpectrogram(
  canvas: HTMLCanvasElement,
  data: SpectrogramData
): void {
  const { frames, numFrames, numBins, minDb, maxDb } = data;
  const ctx    = canvas.getContext("2d");
  if (!ctx || numFrames === 0) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const imageData = ctx.createImageData(W, H);
  const pixels    = imageData.data;

  for (let px = 0; px < W; px++) {
    const frameIdx = Math.floor((px / W) * numFrames);
    const frame    = frames[Math.min(frameIdx, numFrames - 1)];

    for (let py = 0; py < H; py++) {
      // py=0 is top (high freq), py=H-1 is bottom (low freq)
      const binIdx = Math.floor(((H - 1 - py) / H) * numBins);
      const db     = frame[Math.min(binIdx, numBins - 1)];
      const t      = (db - minDb) / (maxDb - minDb);
      const [r, g, b] = interpolateColor(t);
      const i = (py * W + px) * 4;
      pixels[i]   = r;
      pixels[i+1] = g;
      pixels[i+2] = b;
      pixels[i+3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Draw frequency axis labels
  ctx.font      = "9px monospace";
  ctx.fillStyle = "rgba(160,196,204,0.8)";
  const freqLabels = [20, 100, 500, 1000, 4000, 8000, 16000];
  const nyquist    = data.sampleRate / 2;
  for (const freq of freqLabels) {
    if (freq > nyquist) continue;
    const y = H - Math.floor((freq / nyquist) * H);
    ctx.fillStyle = "rgba(74,138,154,0.5)";
    ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = "rgba(160,196,204,0.9)";
    const label = freq >= 1000 ? (freq/1000)+"k" : String(freq);
    ctx.fillText(label, 4, y - 2);
  }

  // Draw time axis
  const timeLabels = Math.floor(data.durationSec);
  for (let t = 1; t <= timeLabels; t++) {
    const x = Math.floor((t / data.durationSec) * W);
    ctx.fillStyle = "rgba(74,138,154,0.4)";
    ctx.fillRect(x, 0, 1, H);
    ctx.fillStyle = "rgba(160,196,204,0.7)";
    ctx.fillText(t+"s", x + 2, H - 4);
  }
}
