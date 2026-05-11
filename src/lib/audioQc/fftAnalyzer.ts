/**
 * fftAnalyzer.ts — FFT Spectral Analysis
 * Aivora Audio QC Engine — Batch 3
 */

import { AudioProblem, makeProblem } from "./qcTypes";

// ── COOLEY-TUKEY FFT ──────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len >> 1; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

function computeMagnitudeSpectrum(
  samples: Float32Array,
  fftSize: number,
  sampleRate: number
): { magnitudes: Float64Array; freqBinHz: number } {
  const window = hannWindow(fftSize);
  // Average over multiple frames
  const hop = Math.floor(fftSize / 2);
  const frames = Math.floor((samples.length - fftSize) / hop) + 1;
  const avgMag = new Float64Array(fftSize / 2);

  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++)
      re[i] = samples[f * hop + i] * window[i];
    fft(re, im);
    for (let i = 0; i < fftSize / 2; i++)
      avgMag[i] += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  if (frames > 0)
    for (let i = 0; i < avgMag.length; i++) avgMag[i] /= frames;

  return { magnitudes: avgMag, freqBinHz: sampleRate / fftSize };
}

// ── SPECTRAL FEATURES ─────────────────────────────────────────────────────────

function spectralCentroid(mag: Float64Array, binHz: number): number {
  let num = 0, den = 0;
  for (let i = 0; i < mag.length; i++) {
    num += i * binHz * mag[i];
    den += mag[i];
  }
  return den > 0 ? num / den : 0;
}

function spectralRolloff(mag: Float64Array, binHz: number, pct = 0.85): number {
  const total = mag.reduce((a, b) => a + b, 0);
  const thresh = total * pct;
  let cum = 0;
  for (let i = 0; i < mag.length; i++) {
    cum += mag[i];
    if (cum >= thresh) return i * binHz;
  }
  return mag.length * binHz;
}

function spectralFlatness(mag: Float64Array): number {
  const n = mag.length;
  let logSum = 0, linSum = 0;
  for (let i = 0; i < n; i++) {
    const v = mag[i] + 1e-10;
    logSum += Math.log(v);
    linSum += v;
  }
  return Math.exp(logSum / n) / (linSum / n);
}

function bandEnergy(
  mag: Float64Array,
  binHz: number,
  loHz: number,
  hiHz: number
): number {
  const lo = Math.floor(loHz / binHz);
  const hi = Math.min(Math.ceil(hiHz / binHz), mag.length - 1);
  let e = 0;
  for (let i = lo; i <= hi; i++) e += mag[i] * mag[i];
  return e;
}

// ── NOISE CLASSIFICATION ──────────────────────────────────────────────────────

type NoiseClass =
  | "clean"
  | "broadband_noise"
  | "hum_50hz"
  | "hum_60hz"
  | "hvac"
  | "phone_mic";

function classifyNoise(mag: Float64Array, binHz: number): NoiseClass {
  const totalE   = bandEnergy(mag, binHz, 20, 20000);
  const speechE  = bandEnergy(mag, binHz, 300, 3400);
  const lowE     = bandEnergy(mag, binHz, 20, 150);
  const highE    = bandEnergy(mag, binHz, 8000, 16000);
  const flatness = spectralFlatness(mag);

  // Hum detection — check 50 Hz and harmonics
  const hum50 = [50, 100, 150, 200].reduce((s, f) => {
    const b = Math.round(f / binHz);
    return s + (mag[b] ?? 0);
  }, 0);
  const hum60 = [60, 120, 180, 240].reduce((s, f) => {
    const b = Math.round(f / binHz);
    return s + (mag[b] ?? 0);
  }, 0);
  const avgMag = mag.reduce((a, b) => a + b, 0) / mag.length;

  if (hum50 > avgMag * 12) return "hum_50hz";
  if (hum60 > avgMag * 12) return "hum_60hz";
  if (flatness > 0.35 && totalE > 0) return "broadband_noise";
  if (lowE / (totalE + 1e-10) > 0.45) return "hvac";
  if (highE / (totalE + 1e-10) < 0.02 && speechE / (totalE + 1e-10) > 0.85)
    return "phone_mic";
  return "clean";
}

// ── ACOUSTIC ENVIRONMENT ──────────────────────────────────────────────────────

type AcousticEnv =
  | "studio"
  | "treated_room"
  | "untreated_room"
  | "bathroom"
  | "outdoor"
  | "car";

function detectEnvironment(
  mag: Float64Array,
  binHz: number,
  flatness: number
): AcousticEnv {
  const lowMidE = bandEnergy(mag, binHz, 200, 800);
  const highMidE = bandEnergy(mag, binHz, 2000, 8000);
  const ratio = lowMidE / (highMidE + 1e-10);

  if (flatness < 0.03 && ratio < 1.5) return "studio";
  if (flatness < 0.06) return "treated_room";
  if (ratio > 4.0) return "bathroom";
  if (flatness > 0.25) return "outdoor";
  if (bandEnergy(mag, binHz, 80, 250) / (bandEnergy(mag, binHz, 20, 20000) + 1e-10) > 0.5)
    return "car";
  return "untreated_room";
}

// ── PUBLIC INTERFACE ──────────────────────────────────────────────────────────

export interface FFTResult {
  centroid:    number;
  rolloff:     number;
  flatness:    number;
  noiseClass:  NoiseClass;
  environment: AcousticEnv;
  bandEnergies: {
    sub:     number;
    low:     number;
    lowMid:  number;
    mid:     number;
    highMid: number;
    high:    number;
  };
  problems: AudioProblem[];
}

export function analyzeFFT(buffer: AudioBuffer): FFTResult {
  const FFT_SIZE = 4096;

  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  const { magnitudes: mag, freqBinHz: binHz } = computeMagnitudeSpectrum(
    mono, FFT_SIZE, buffer.sampleRate
  );

  const centroid    = spectralCentroid(mag, binHz);
  const rolloff     = spectralRolloff(mag, binHz);
  const flatness    = spectralFlatness(mag);
  const noiseClass  = classifyNoise(mag, binHz);
  const environment = detectEnvironment(mag, binHz, flatness);

  const bands = {
    sub:     bandEnergy(mag, binHz, 20,   80),
    low:     bandEnergy(mag, binHz, 80,   300),
    lowMid:  bandEnergy(mag, binHz, 300,  800),
    mid:     bandEnergy(mag, binHz, 800,  2500),
    highMid: bandEnergy(mag, binHz, 2500, 8000),
    high:    bandEnergy(mag, binHz, 8000, 20000),
  };

  const problems: AudioProblem[] = [];

  if (noiseClass === "hum_50hz" || noiseClass === "hum_60hz") {
    problems.push(makeProblem("BACKGROUND_NOISE", "warning",
      `Electrical hum detected (${noiseClass === "hum_50hz" ? "50" : "60"} Hz)`,
      { confidence: 0.88, suggestedAction: "Use a hum filter or re-record away from electrical interference" }));
  }

  if (noiseClass === "broadband_noise") {
    problems.push(makeProblem("BACKGROUND_NOISE", "warning",
      "Broadband background noise detected — flatness too high",
      { confidence: 0.82 }));
  }

  if (noiseClass === "hvac") {
    problems.push(makeProblem("BACKGROUND_NOISE", "low",
      "HVAC / air conditioning noise detected in low frequencies",
      { confidence: 0.75 }));
  }

  if (environment === "bathroom") {
    problems.push(makeProblem("REVERB", "warning",
      "Bathroom / high-reverb environment detected",
      { confidence: 0.80, suggestedAction: "Record in a treated or quieter space" }));
  }

  if (noiseClass === "phone_mic") {
    problems.push(makeProblem("BACKGROUND_NOISE", "medium",
      "Phone microphone / narrow-band recording detected",
      { confidence: 0.78 }));
  }

  if (centroid < 300) {
    problems.push(makeProblem("FREQUENCY_ISSUE", "medium",
      `Spectral centroid very low (${centroid.toFixed(0)} Hz) — possible muffled audio`,
      { confidence: 0.72 }));
  }

  return { centroid, rolloff, flatness, noiseClass, environment, bandEnergies: bands, problems };
}
