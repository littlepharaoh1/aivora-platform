// ═══════════════════════════════════════════════════════════
// AIVORA AUDIO ANALYZER — Advanced DSP Engine
// Browser-native • Zero dependencies • Production grade
// ═══════════════════════════════════════════════════════════

// ─── TYPES ──────────────────────────────────────────────────
export interface SpectralBand {
  label: string;
  minHz: number;
  maxHz: number;
  energy: number;
  db: number;
  normalized: number;
}

export interface FFTResult {
  magnitudes: Float32Array;
  frequencies: Float32Array;
  sampleRate: number;
  size: number;
}

export interface LUFSResult {
  momentary: number;      // 400ms window
  shortTerm: number;      // 3s window
  integrated: number;     // full file
  loudnessRange: number;  // LRA
  truePeak: number;       // dBTP
}

export interface VADResult {
  voiceRatio: number;         // 0-1
  voiceFrames: number;
  silenceFrames: number;
  totalFrames: number;
  voiceRegions: Array<{ startMs: number; endMs: number }>;
  speechRate: number;         // regions per second
}

export interface NoiseProfile {
  type: "clean" | "broadband" | "hum_50" | "hum_60" | "hvac" | "phone" | "mixed";
  confidence: number;         // 0-1
  floorDb: number;
  humFreq?: number;
  humStrength?: number;
  broadbandLevel?: number;
}

export interface ClippingAnalysis {
  hardClips: number;          // samples >= 0.999
  softClips: number;          // intersample peaks
  transientClips: number;     // sudden jumps
  clippingRatio: number;      // 0-1
  maxConsecutive: number;     // longest clip run
  severity: "none" | "minor" | "moderate" | "severe";
}

export interface AcousticEnvironment {
  type: "studio" | "room" | "bathroom" | "outdoor" | "car" | "phone";
  confidence: number;
  rt60Estimate: number;       // seconds
  earlyReflections: number;   // 0-1
  diffuseField: number;       // 0-1
}

export interface SilenceAnalysis {
  leadingMs: number;
  trailingMs: number;
  totalSilenceMs: number;
  silenceRatio: number;
  maxGapMs: number;
  gaps: Array<{ startMs: number; durationMs: number }>;
}

export interface FullAudioAnalysis {
  // Basic
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  // Level
  peakDb: number;
  rmsDb: number;
  crestFactor: number;
  dynamicRange: number;
  // LUFS
  lufs: LUFSResult;
  // Spectral
  fft: FFTResult;
  spectralBands: SpectralBand[];
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlatness: number;
  // Voice
  vad: VADResult;
  // Noise
  noise: NoiseProfile;
  // Clipping
  clipping: ClippingAnalysis;
  // Environment
  environment: AcousticEnvironment;
  // Silence
  silence: SilenceAnalysis;
  // SNR
  snrDb: number;
  // Score ready
  analysisVersion: string;
  analyzedAt: string;
}

// ─── CONSTANTS ──────────────────────────────────────────────
const ANALYSIS_VERSION = "2.0.0-dsp";

const SPECTRAL_BANDS: Omit<SpectralBand, "energy" | "db" | "normalized">[] = [
  { label: "Sub-bass",   minHz: 20,    maxHz: 80    },
  { label: "Bass",       minHz: 80,    maxHz: 250   },
  { label: "Low-mid",   minHz: 250,   maxHz: 500   },
  { label: "Mid",        minHz: 500,   maxHz: 2000  },
  { label: "Upper-mid",  minHz: 2000,  maxHz: 4000  },
  { label: "Presence",   minHz: 4000,  maxHz: 8000  },
  { label: "Brilliance", minHz: 8000,  maxHz: 16000 },
  { label: "Air",        minHz: 16000, maxHz: 20000 },
];

// ─── MATH UTILITIES ─────────────────────────────────────────
function toDb(v: number): number {
  return v <= 0 ? -120 : 20 * Math.log10(v);
}

function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── COOLEY-TUKEY FFT ───────────────────────────────────────
function fft(real: Float32Array, imag: Float32Array): void {
  const N = real.length;
  if (N <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Cooley-Tukey
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = real[i + k];
        const uIm = imag[i + k];
        const vRe = real[i + k + len / 2] * curRe - imag[i + k + len / 2] * curIm;
        const vIm = real[i + k + len / 2] * curIm + imag[i + k + len / 2] * curRe;
        real[i + k] = uRe + vRe;
        imag[i + k] = uIm + vIm;
        real[i + k + len / 2] = uRe - vRe;
        imag[i + k + len / 2] = uIm - vIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

// Hann window
function hannWindow(N: number): Float32Array {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  }
  return w;
}

export function computeFFT(data: Float32Array, sampleRate: number, fftSize = 4096): FFTResult {
  const N = Math.min(fftSize, nextPow2(Math.min(data.length, fftSize)));
  const window = hannWindow(N);
  const real = new Float32Array(N);
  const imag = new Float32Array(N);

  // Apply window to center of signal
  const offset = Math.max(0, Math.floor((data.length - N) / 2));
  for (let i = 0; i < N; i++) {
    real[i] = (data[offset + i] || 0) * window[i];
    imag[i] = 0;
  }

  fft(real, imag);

  const half = N / 2;
  const magnitudes = new Float32Array(half);
  const frequencies = new Float32Array(half);
  const scale = 2 / N;

  for (let i = 0; i < half; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) * scale;
    frequencies[i] = i * sampleRate / N;
  }

  return { magnitudes, frequencies, sampleRate, size: N };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ─── SPECTRAL BANDS ─────────────────────────────────────────
export function computeSpectralBands(fftResult: FFTResult): SpectralBand[] {
  const { magnitudes, frequencies } = fftResult;
  const bands: SpectralBand[] = [];
  let maxDb = -120;

  for (const band of SPECTRAL_BANDS) {
    let sumSq = 0;
    let count = 0;
    for (let i = 0; i < frequencies.length; i++) {
      if (frequencies[i] >= band.minHz && frequencies[i] < band.maxHz) {
        sumSq += magnitudes[i] * magnitudes[i];
        count++;
      }
    }
    const energy = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const db = toDb(energy);
    if (db > maxDb) maxDb = db;
    bands.push({ ...band, energy, db, normalized: 0 });
  }

  // Normalize
  for (const b of bands) {
    b.normalized = clamp((b.db - (maxDb - 60)) / 60, 0, 1);
  }

  return bands;
}

// ─── SPECTRAL FEATURES ──────────────────────────────────────
export function computeSpectralCentroid(fftResult: FFTResult): number {
  const { magnitudes, frequencies } = fftResult;
  let weightedSum = 0, totalMag = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    weightedSum += frequencies[i] * magnitudes[i];
    totalMag += magnitudes[i];
  }
  return totalMag > 0 ? weightedSum / totalMag : 0;
}

export function computeSpectralRolloff(fftResult: FFTResult, threshold = 0.85): number {
  const { magnitudes, frequencies } = fftResult;
  const totalEnergy = magnitudes.reduce((a, v) => a + v * v, 0);
  const target = totalEnergy * threshold;
  let cumEnergy = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    cumEnergy += magnitudes[i] * magnitudes[i];
    if (cumEnergy >= target) return frequencies[i];
  }
  return frequencies[frequencies.length - 1];
}

export function computeSpectralFlatness(fftResult: FFTResult): number {
  const { magnitudes } = fftResult;
  const N = magnitudes.length;
  if (N === 0) return 0;
  let logSum = 0, linSum = 0;
  for (let i = 0; i < N; i++) {
    const v = Math.max(magnitudes[i], 1e-10);
    logSum += Math.log(v);
    linSum += v;
  }
  const geoMean = Math.exp(logSum / N);
  const arithMean = linSum / N;
  return arithMean > 0 ? geoMean / arithMean : 0;
}

// ─── LUFS EBU R128 ──────────────────────────────────────────
// K-weighting filter coefficients (48kHz)
function applyKWeighting(data: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(data.length);

  // Stage 1: High-shelf +4dB at 1681Hz
  const f1 = 1681.974450955533;
  const G1 = 3.999843853973347;
  const Q1 = 0.7071752369554196;
  const K1 = Math.tan(Math.PI * f1 / sampleRate);
  const Vb1 = Math.pow(10, G1 / 20);
  const a0_1 = 1 + K1 / Q1 + K1 * K1;
  const b0_1 = (Vb1 + Vb1 * K1 / Q1 + K1 * K1) / a0_1;
  const b1_1 = 2 * (K1 * K1 - Vb1) / a0_1;
  const b2_1 = (Vb1 - Vb1 * K1 / Q1 + K1 * K1) / a0_1;
  const a1_1 = 2 * (K1 * K1 - 1) / a0_1;
  const a2_1 = (1 - K1 / Q1 + K1 * K1) / a0_1;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const stage1 = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0_1 * x + b1_1 * x1 + b2_1 * x2 - a1_1 * y1 - a2_1 * y2;
    stage1[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }

  // Stage 2: High-pass 38Hz
  const f2 = 38.13547087602444;
  const Q2 = 0.5003270373238773;
  const K2 = Math.tan(Math.PI * f2 / sampleRate);
  const a0_2 = 1 + K2 / Q2 + K2 * K2;
  const b0_2 = 1 / a0_2;
  const b1_2 = -2 / a0_2;
  const b2_2 = 1 / a0_2;
  const a1_2 = 2 * (K2 * K2 - 1) / a0_2;
  const a2_2 = (1 - K2 / Q2 + K2 * K2) / a0_2;

  x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  for (let i = 0; i < stage1.length; i++) {
    const x = stage1[i];
    const y = b0_2 * x + b1_2 * x1 + b2_2 * x2 - a1_2 * y1 - a2_2 * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }

  return out;
}

export function computeLUFS(buffer: AudioBuffer): LUFSResult {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const weighted = applyKWeighting(data, sr);

  // Momentary (400ms)
  const momentarySize = Math.floor(sr * 0.4);
  const momentaryStart = Math.max(0, Math.floor(data.length / 2) - momentarySize / 2);
  let momentarySum = 0;
  for (let i = momentaryStart; i < momentaryStart + momentarySize && i < weighted.length; i++) {
    momentarySum += weighted[i] * weighted[i];
  }
  const momentaryLUFS = -0.691 + 10 * Math.log10(momentarySum / momentarySize);

  // Short-term (3s)
  const shortTermSize = Math.floor(sr * 3);
  const shortTermStart = Math.max(0, Math.floor(data.length / 2) - shortTermSize / 2);
  let shortTermSum = 0;
  for (let i = shortTermStart; i < shortTermStart + shortTermSize && i < weighted.length; i++) {
    shortTermSum += weighted[i] * weighted[i];
  }
  const shortTermLUFS = -0.691 + 10 * Math.log10(shortTermSum / shortTermSize);

  // Integrated (gated, full file)
  const blockSize = Math.floor(sr * 0.4);
  const hopSize = Math.floor(sr * 0.1);
  const blocks: number[] = [];

  for (let start = 0; start + blockSize <= weighted.length; start += hopSize) {
    let sum = 0;
    for (let i = start; i < start + blockSize; i++) sum += weighted[i] * weighted[i];
    const loudness = -0.691 + 10 * Math.log10(sum / blockSize);
    blocks.push(loudness);
  }

  // Absolute gate -70 LUFS
  const absGated = blocks.filter(b => b > -70);
  if (absGated.length === 0) {
    return { momentary: momentaryLUFS, shortTerm: shortTermLUFS, integrated: -70, loudnessRange: 0, truePeak: -120 };
  }

  // Relative gate -10 from mean
  const mean1 = absGated.reduce((a, b) => a + Math.pow(10, b / 10), 0) / absGated.length;
  const relThreshold = 10 * Math.log10(mean1) - 10;
  const relGated = absGated.filter(b => b > relThreshold);

  const integratedLUFS = relGated.length > 0
    ? -0.691 + 10 * Math.log10(relGated.reduce((a, b) => a + Math.pow(10, b / 10), 0) / relGated.length)
    : momentaryLUFS;

  // LRA
  const sorted = [...relGated].sort((a, b) => a - b);
  const lra = sorted.length > 1
    ? sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.10)]
    : 0;

  // True Peak
  let truePeak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > truePeak) truePeak = v;
  }

  return {
    momentary: Math.max(-120, momentaryLUFS),
    shortTerm: Math.max(-120, shortTermLUFS),
    integrated: Math.max(-120, integratedLUFS),
    loudnessRange: Math.max(0, lra),
    truePeak: toDb(truePeak),
  };
}

// ─── VOICE ACTIVITY DETECTION ───────────────────────────────
export function computeVAD(data: Float32Array, sampleRate: number): VADResult {
  const frameSamples = Math.floor(sampleRate * 0.025); // 25ms
  const hopSamples = Math.floor(sampleRate * 0.010);   // 10ms
  const frames = Math.floor((data.length - frameSamples) / hopSamples);

  const energies: number[] = [];
  const zcrs: number[] = [];

  for (let f = 0; f < frames; f++) {
    const start = f * hopSamples;
    let energy = 0, zcr = 0;
    for (let i = 0; i < frameSamples; i++) {
      const v = data[start + i] || 0;
      energy += v * v;
      if (i > 0) {
        const prev = data[start + i - 1] || 0;
        if ((v >= 0) !== (prev >= 0)) zcr++;
      }
    }
    energies.push(Math.sqrt(energy / frameSamples));
    zcrs.push(zcr / frameSamples);
  }

  // Adaptive thresholds
  const sortedE = [...energies].sort((a, b) => a - b);
  const noiseFloor = sortedE[Math.floor(sortedE.length * 0.1)] || 0.001;
  const energyThresh = noiseFloor * 4;
  const zcrThresh = 0.15;

  // Voice frames
  const isVoice = energies.map((e, i) =>
    e > energyThresh && zcrs[i] < zcrThresh
  );

  // Smooth (median filter 5)
  const smoothed = isVoice.map((_, i) => {
    const window = isVoice.slice(Math.max(0, i - 2), i + 3);
    return window.filter(Boolean).length > window.length / 2;
  });

  // Find regions
  const regions: Array<{ startMs: number; endMs: number }> = [];
  let inVoice = false;
  let regionStart = 0;

  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] && !inVoice) {
      inVoice = true;
      regionStart = i;
    } else if (!smoothed[i] && inVoice) {
      inVoice = false;
      regions.push({
        startMs: regionStart * hopSamples / sampleRate * 1000,
        endMs: i * hopSamples / sampleRate * 1000,
      });
    }
  }
  if (inVoice) {
    regions.push({
      startMs: regionStart * hopSamples / sampleRate * 1000,
      endMs: frames * hopSamples / sampleRate * 1000,
    });
  }

  const voiceFrames = smoothed.filter(Boolean).length;
  const duration = data.length / sampleRate;

  return {
    voiceRatio: frames > 0 ? voiceFrames / frames : 0,
    voiceFrames,
    silenceFrames: frames - voiceFrames,
    totalFrames: frames,
    voiceRegions: regions,
    speechRate: duration > 0 ? regions.length / duration : 0,
  };
}

// ─── NOISE CLASSIFICATION ────────────────────────────────────
export function classifyNoise(data: Float32Array, sampleRate: number, fftResult: FFTResult): NoiseProfile {
  // Noise floor
  const sorted = Array.from(data).map(Math.abs).sort((a, b) => a - b);
  const noiseLevel = sorted[Math.floor(sorted.length * 0.05)] || 0.00001;
  const floorDb = toDb(noiseLevel);

  const { magnitudes, frequencies } = fftResult;

  // Check for 50Hz hum
  const p50 = Math.round(sampleRate / 50);
  const p60 = Math.round(sampleRate / 60);
  let c50 = 0, c60 = 0, tot = 0;
  const corrLen = Math.min(3000, data.length - Math.max(p50, p60));
  for (let i = 0; i < corrLen; i++) {
    c50 += data[i] * (data[i + p50] || 0);
    c60 += data[i] * (data[i + p60] || 0);
    tot += data[i] * data[i];
  }
  const norm = tot / corrLen || 1;
  const h50 = Math.abs(c50 / corrLen) / norm;
  const h60 = Math.abs(c60 / corrLen) / norm;
  const humStrength = Math.max(h50, h60);
  const humDetected = humStrength > 0.12;
  const humFreq = h50 > h60 ? 50 : 60;

  // Broadband noise (energy in high freq)
  let highFreqEnergy = 0, lowFreqEnergy = 0, totalEnergy = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const e = magnitudes[i] * magnitudes[i];
    totalEnergy += e;
    if (frequencies[i] > 4000) highFreqEnergy += e;
    else lowFreqEnergy += e;
  }
  const broadbandRatio = totalEnergy > 0 ? highFreqEnergy / totalEnergy : 0;

  // HVAC (energy concentrated in very low freq 50-200Hz)
  let hvacEnergy = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    if (frequencies[i] >= 50 && frequencies[i] <= 200) {
      hvacEnergy += magnitudes[i] * magnitudes[i];
    }
  }
  const hvacRatio = totalEnergy > 0 ? hvacEnergy / totalEnergy : 0;

  // Phone mic (roll-off above 8kHz)
  let above8k = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    if (frequencies[i] > 8000) above8k += magnitudes[i];
  }
  const phoneArtifact = above8k < 0.01 && sampleRate < 16000;

  // Classify
  let type: NoiseProfile["type"] = "clean";
  let confidence = 0.9;

  if (humDetected && broadbandRatio > 0.3) {
    type = "mixed"; confidence = 0.75;
  } else if (humDetected) {
    type = humFreq === 50 ? "hum_50" : "hum_60"; confidence = 0.85;
  } else if (hvacRatio > 0.4 && floorDb > -55) {
    type = "hvac"; confidence = 0.7;
  } else if (broadbandRatio > 0.4 && floorDb > -50) {
    type = "broadband"; confidence = 0.8;
  } else if (phoneArtifact) {
    type = "phone"; confidence = 0.75;
  } else if (floorDb < -60) {
    type = "clean"; confidence = 0.9;
  } else {
    type = "broadband"; confidence = 0.6;
  }

  return {
    type,
    confidence,
    floorDb,
    humFreq: humDetected ? humFreq : undefined,
    humStrength: humDetected ? humStrength : undefined,
    broadbandLevel: broadbandRatio,
  };
}

// ─── CLIPPING INTELLIGENCE ───────────────────────────────────
export function analyzeClipping(data: Float32Array): ClippingAnalysis {
  let hardClips = 0;
  let softClips = 0;
  let transientClips = 0;
  let maxConsecutive = 0;
  let currentRun = 0;

  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);

    // Hard clipping
    if (v >= 0.999) {
      hardClips++;
      currentRun++;
      maxConsecutive = Math.max(maxConsecutive, currentRun);
    } else {
      currentRun = 0;
    }

    // Soft clipping (near ceiling with flattening)
    if (v > 0.95 && v < 0.999) {
      if (i > 0 && i < data.length - 1) {
        const prev = Math.abs(data[i - 1]);
        const next = Math.abs(data[i + 1]);
        if (Math.abs(v - prev) < 0.005 && Math.abs(v - next) < 0.005) {
          softClips++;
        }
      }
    }

    // Transient clipping (sudden jump > 0.5)
    if (i > 0) {
      const diff = Math.abs(data[i] - data[i - 1]);
      if (diff > 0.5 && v > 0.8) transientClips++;
    }
  }

  const clippingRatio = (hardClips + softClips * 0.5) / data.length;

  const severity: ClippingAnalysis["severity"] =
    hardClips === 0 && softClips < 5 ? "none" :
    hardClips < 10 && softClips < 20 ? "minor" :
    hardClips < 100 ? "moderate" : "severe";

  return {
    hardClips,
    softClips,
    transientClips,
    clippingRatio,
    maxConsecutive,
    severity,
  };
}

// ─── ACOUSTIC ENVIRONMENT ────────────────────────────────────
export function detectAcousticEnvironment(
  data: Float32Array,
  sampleRate: number,
  fftResult: FFTResult
): AcousticEnvironment {
  // RT60 estimation via energy decay
  const windowMs = 50;
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  const numWindows = Math.floor(data.length / windowSamples);
  const energies: number[] = [];

  for (let w = 0; w < numWindows; w++) {
    let e = 0;
    for (let i = 0; i < windowSamples; i++) {
      const v = data[w * windowSamples + i] || 0;
      e += v * v;
    }
    energies.push(e / windowSamples);
  }

  // Find peak and measure decay
  const maxE = Math.max(...energies);
  const maxIdx = energies.indexOf(maxE);
  let decayTo60dB = 0;

  for (let i = maxIdx + 1; i < energies.length; i++) {
    if (energies[i] < maxE * 0.000001) { // -60dB
      decayTo60dB = (i - maxIdx) * windowMs;
      break;
    }
  }

  const rt60 = decayTo60dB / 1000; // seconds

  // Spectral analysis for environment
  const { magnitudes, frequencies } = fftResult;
  let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const e = magnitudes[i] * magnitudes[i];
    if (frequencies[i] < 300) lowEnergy += e;
    else if (frequencies[i] < 3000) midEnergy += e;
    else highEnergy += e;
  }
  const total = lowEnergy + midEnergy + highEnergy || 1;

  // Early reflections (ratio of energy in first 50ms after peak)
  const earlyEnd = Math.min(maxIdx + Math.floor(50 / windowMs), numWindows);
  const earlyEnergy = energies.slice(maxIdx, earlyEnd).reduce((a, b) => a + b, 0);
  const totalDecayEnergy = energies.slice(maxIdx).reduce((a, b) => a + b, 0) || 1;
  const earlyReflections = clamp(earlyEnergy / totalDecayEnergy, 0, 1);
  const diffuseField = clamp(1 - earlyReflections, 0, 1);

  // Classify
  let type: AcousticEnvironment["type"];
  let confidence: number;

  if (rt60 < 0.1 && highEnergy / total > 0.3) {
    type = "studio"; confidence = 0.85;
  } else if (rt60 > 0.8 && lowEnergy / total > 0.4) {
    type = "bathroom"; confidence = 0.75;
  } else if (rt60 > 0.5) {
    type = "room"; confidence = 0.7;
  } else if (highEnergy / total < 0.1) {
    type = "outdoor"; confidence = 0.65;
  } else if (midEnergy / total > 0.6) {
    type = "car"; confidence = 0.6;
  } else {
    type = "room"; confidence = 0.6;
  }

  return { type, confidence, rt60Estimate: rt60, earlyReflections, diffuseField };
}

// ─── SILENCE ANALYSIS ────────────────────────────────────────
export function analyzeSilence(data: Float32Array, sampleRate: number): SilenceAnalysis {
  const frameSamples = Math.floor(sampleRate * 0.01);
  const frames = Math.floor(data.length / frameSamples);
  const threshold = 0.002;

  const isSilent: boolean[] = [];
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < frameSamples; i++) {
      const v = data[f * frameSamples + i] || 0;
      e += v * v;
    }
    isSilent.push(Math.sqrt(e / frameSamples) < threshold);
  }

  // Leading silence
  let leadingFrames = 0;
  while (leadingFrames < frames && isSilent[leadingFrames]) leadingFrames++;

  // Trailing silence
  let trailingFrames = 0;
  let idx = frames - 1;
  while (idx >= 0 && isSilent[idx]) { trailingFrames++; idx--; }

  // Gaps
  const gaps: Array<{ startMs: number; durationMs: number }> = [];
  let inSilence = false;
  let gapStart = 0;
  let totalSilence = 0;
  let maxGap = 0;

  for (let f = leadingFrames; f < frames - trailingFrames; f++) {
    if (isSilent[f] && !inSilence) {
      inSilence = true;
      gapStart = f;
    } else if (!isSilent[f] && inSilence) {
      inSilence = false;
      const dur = (f - gapStart) * 10;
      if (dur > 100) { // gaps > 100ms
        gaps.push({ startMs: gapStart * 10, durationMs: dur });
        maxGap = Math.max(maxGap, dur);
      }
      totalSilence += dur;
    }
  }

  const silenceRatio = isSilent.filter(Boolean).length / frames;

  return {
    leadingMs: leadingFrames * 10,
    trailingMs: trailingFrames * 10,
    totalSilenceMs: silenceRatio * data.length / sampleRate * 1000,
    silenceRatio,
    maxGapMs: maxGap,
    gaps,
  };
}

// ─── BASIC STATS ─────────────────────────────────────────────
function computeBasicStats(data: Float32Array): {
  peakDb: number; rmsDb: number; crestFactor: number; dynamicRange: number;
} {
  let peak = 0, sumSq = 0;
  const step = Math.max(1, Math.floor(data.length / 50000));

  for (let i = 0; i < data.length; i += step) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sumSq += v * v;
  }

  const count = Math.floor(data.length / step);
  const rms = Math.sqrt(sumSq / count);
  const peakDb = toDb(peak);
  const rmsDb = toDb(rms);
  const crestFactor = peakDb - rmsDb;

  // Dynamic range (95th - 5th percentile)
  const samples: number[] = [];
  const sampleStep = Math.max(1, Math.floor(data.length / 5000));
  for (let i = 0; i < data.length; i += sampleStep) {
    samples.push(Math.abs(data[i]));
  }
  samples.sort((a, b) => a - b);
  const p5 = toDb(samples[Math.floor(samples.length * 0.05)] || 0.00001);
  const p95 = toDb(samples[Math.floor(samples.length * 0.95)] || 0.00001);
  const dynamicRange = p95 - p5;

  return { peakDb, rmsDb, crestFactor, dynamicRange };
}

// ─── FULL ANALYSIS ───────────────────────────────────────────
export async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  onProgress?: (pct: number, stage: string) => void
): Promise<FullAudioAnalysis> {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const progress = (pct: number, stage: string) => onProgress?.(pct, stage);

  progress(5, "Basic analysis");
  const basic = computeBasicStats(data);

  progress(15, "FFT computation");
  const fftResult = computeFFT(data, sr, 8192);

  progress(30, "Spectral analysis");
  const spectralBands = computeSpectralBands(fftResult);
  const spectralCentroid = computeSpectralCentroid(fftResult);
  const spectralRolloff = computeSpectralRolloff(fftResult);
  const spectralFlatness = computeSpectralFlatness(fftResult);

  progress(45, "LUFS EBU R128");
  const lufs = computeLUFS(buffer);

  progress(60, "Voice activity detection");
  const vad = computeVAD(data, sr);

  progress(72, "Noise classification");
  const noise = classifyNoise(data, sr, fftResult);

  progress(82, "Clipping analysis");
  const clipping = analyzeClipping(data);

  progress(90, "Acoustic environment");
  const environment = detectAcousticEnvironment(data, sr, fftResult);

  progress(95, "Silence analysis");
  const silence = analyzeSilence(data, sr);

  const snrDb = basic.rmsDb - noise.floorDb;

  progress(100, "Complete");

  return {
    duration: buffer.duration,
    sampleRate: sr,
    channels: buffer.numberOfChannels,
    bitDepth: 32,
    ...basic,
    lufs,
    fft: fftResult,
    spectralBands,
    spectralCentroid,
    spectralRolloff,
    spectralFlatness,
    vad,
    noise,
    clipping,
    environment,
    silence,
    snrDb,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: new Date().toISOString(),
  };
}

// ─── PROFILE-BASED SCORING ───────────────────────────────────
export interface ProfileThresholds {
  peakMin: number; peakMax: number;
  rmsMin: number; rmsMax: number;
  lufsMin: number; lufsMax: number;
  noiseMax: number;
  snrMin: number;
  silMax: number;
  voiceMin: number;
}

export const PROFILE_THRESHOLDS: Record<string, ProfileThresholds> = {
  wakeword: {
    peakMin: -6, peakMax: -1,
    rmsMin: -28, rmsMax: -10,
    lufsMin: -23, lufsMax: -12,
    noiseMax: -60, snrMin: 45,
    silMax: 0.15, voiceMin: 0.4,
  },
  asr: {
    peakMin: -9, peakMax: -2,
    rmsMin: -32, rmsMax: -12,
    lufsMin: -26, lufsMax: -14,
    noiseMax: -55, snrMin: 35,
    silMax: 0.30, voiceMin: 0.3,
  },
  tts: {
    peakMin: -6, peakMax: -1,
    rmsMin: -24, rmsMax: -8,
    lufsMin: -20, lufsMax: -10,
    noiseMax: -65, snrMin: 50,
    silMax: 0.20, voiceMin: 0.5,
  },
  conversation: {
    peakMin: -12, peakMax: -3,
    rmsMin: -35, rmsMax: -15,
    lufsMin: -30, lufsMax: -16,
    noiseMax: -50, snrMin: 25,
    silMax: 0.40, voiceMin: 0.2,
  },
};

export interface ScoredCheck {
  id: string;
  label: string;
  value: string;
  passed: boolean;
  warning: boolean;
  score: number;
  weight: number;
  detail: string;
  bonus: boolean;
}

export function scoreAnalysis(
  analysis: FullAudioAnalysis,
  profileKey: string
): { checks: ScoredCheck[]; total: number; grade: string; verdict: string } {
  const th = PROFILE_THRESHOLDS[profileKey] || PROFILE_THRESHOLDS.asr;
  const checks: ScoredCheck[] = [];

  // Sample Rate
  const srOk = analysis.sampleRate === 48000;
  checks.push({
    id: "sr", label: "Sample Rate", weight: 10, bonus: false,
    value: `${analysis.sampleRate} Hz`,
    passed: srOk, warning: analysis.sampleRate === 44100,
    score: srOk ? 100 : analysis.sampleRate === 44100 ? 60 : 20,
    detail: srOk ? "48kHz professional standard ✓" : `${analysis.sampleRate}Hz — target: 48000Hz`,
  });

  // Peak Level
  const pkOk = analysis.peakDb >= th.peakMin && analysis.peakDb <= th.peakMax;
  const pkClip = analysis.peakDb > -0.3;
  checks.push({
    id: "peak", label: "Peak Level", weight: 15, bonus: false,
    value: `${analysis.peakDb.toFixed(1)} dBFS`,
    passed: pkOk && !pkClip, warning: !pkOk && !pkClip,
    score: pkClip ? 0 : pkOk ? 100 : Math.max(10, 65 - Math.abs(analysis.peakDb - th.peakMax) * 4),
    detail: pkClip ? "⚠ Clipping!" : pkOk ? "In target range ✓" : `Target: ${th.peakMin} to ${th.peakMax} dBFS`,
  });

  // LUFS
  const lufsOk = analysis.lufs.integrated >= th.lufsMin && analysis.lufs.integrated <= th.lufsMax;
  checks.push({
    id: "lufs", label: "LUFS (EBU R128)", weight: 15, bonus: false,
    value: `${analysis.lufs.integrated.toFixed(1)} LUFS`,
    passed: lufsOk, warning: !lufsOk,
    score: lufsOk ? 100 : Math.max(15, 65 - Math.abs(analysis.lufs.integrated - th.lufsMax) * 3),
    detail: lufsOk ? "Loudness in target range ✓" : `Target: ${th.lufsMin} to ${th.lufsMax} LUFS`,
  });

  // Noise Floor
  const nfOk = analysis.noise.floorDb <= th.noiseMax;
  checks.push({
    id: "noise", label: "Noise Floor", weight: 15, bonus: false,
    value: `${analysis.noise.floorDb.toFixed(1)} dBFS`,
    passed: nfOk, warning: !nfOk && analysis.noise.floorDb <= th.noiseMax + 10,
    score: nfOk ? 100 : analysis.noise.floorDb <= th.noiseMax + 10 ? 55 : 15,
    detail: nfOk ? "Noise floor excellent ✓" : `Target: ≤${th.noiseMax} dBFS`,
  });

  // SNR
  const snrOk = analysis.snrDb >= th.snrMin;
  checks.push({
    id: "snr", label: "Signal-to-Noise", weight: 15, bonus: false,
    value: `${analysis.snrDb.toFixed(1)} dB`,
    passed: snrOk, warning: !snrOk && analysis.snrDb >= th.snrMin - 15,
    score: snrOk ? 100 : analysis.snrDb >= th.snrMin - 15 ? 50 : 15,
    detail: snrOk ? "SNR excellent ✓" : `Target: ≥${th.snrMin} dB`,
  });

  // Clipping
  const clipOk = analysis.clipping.severity === "none";
  checks.push({
    id: "clip", label: "Clipping", weight: 10, bonus: false,
    value: analysis.clipping.severity === "none" ? "None" : `${analysis.clipping.hardClips} hard / ${analysis.clipping.softClips} soft`,
    passed: clipOk, warning: analysis.clipping.severity === "minor",
    score: clipOk ? 100 : analysis.clipping.severity === "minor" ? 50 : analysis.clipping.severity === "moderate" ? 20 : 0,
    detail: clipOk ? "No clipping ✓" : `${analysis.clipping.severity} clipping — ${analysis.clipping.hardClips} samples`,
  });

  // Voice Presence
  const vpOk = analysis.vad.voiceRatio >= th.voiceMin;
  checks.push({
    id: "vad", label: "Voice Presence", weight: 10, bonus: false,
    value: `${Math.round(analysis.vad.voiceRatio * 100)}%`,
    passed: vpOk, warning: !vpOk && analysis.vad.voiceRatio >= th.voiceMin * 0.5,
    score: vpOk ? 100 : Math.round(analysis.vad.voiceRatio / th.voiceMin * 80),
    detail: vpOk ? `Voice in ${Math.round(analysis.vad.voiceRatio * 100)}% of file ✓` : "Low voice presence",
  });

  // Silence
  const silOk = analysis.silence.silenceRatio <= th.silMax;
  checks.push({
    id: "silence", label: "Silence Ratio", weight: 10, bonus: false,
    value: `${(analysis.silence.silenceRatio * 100).toFixed(1)}%`,
    passed: silOk, warning: !silOk && analysis.silence.silenceRatio <= th.silMax + 0.2,
    score: silOk ? 100 : 50,
    detail: silOk ? "Silence ratio acceptable ✓" : `High silence — lead: ${analysis.silence.leadingMs}ms, trail: ${analysis.silence.trailingMs}ms`,
  });

  // BONUS: Noise Type
  checks.push({
    id: "noisetype", label: "Noise Classification", weight: 0, bonus: true,
    value: analysis.noise.type.replace(/_/g, " ").toUpperCase(),
    passed: analysis.noise.type === "clean",
    warning: analysis.noise.type !== "clean" && analysis.noise.type !== "broadband",
    score: analysis.noise.type === "clean" ? 100 : 50,
    detail: `Noise type: ${analysis.noise.type} (confidence: ${Math.round(analysis.noise.confidence * 100)}%)`,
  });

  // BONUS: Environment
  checks.push({
    id: "env", label: "Acoustic Environment", weight: 0, bonus: true,
    value: analysis.environment.type.toUpperCase(),
    passed: analysis.environment.type === "studio" || analysis.environment.type === "room",
    warning: analysis.environment.type === "bathroom" || analysis.environment.type === "car",
    score: analysis.environment.type === "studio" ? 100 : analysis.environment.type === "room" ? 75 : 40,
    detail: `${analysis.environment.type} — RT60: ${analysis.environment.rt60Estimate.toFixed(2)}s`,
  });

  // BONUS: True Peak
  checks.push({
    id: "truepeak", label: "True Peak", weight: 0, bonus: true,
    value: `${analysis.lufs.truePeak.toFixed(1)} dBTP`,
    passed: analysis.lufs.truePeak <= -1,
    warning: analysis.lufs.truePeak > -1 && analysis.lufs.truePeak <= 0,
    score: analysis.lufs.truePeak <= -1 ? 100 : analysis.lufs.truePeak <= 0 ? 60 : 0,
    detail: analysis.lufs.truePeak <= -1 ? "True peak safe ✓" : "True peak too high",
  });

  // Weighted total
  const mainChecks = checks.filter(c => !c.bonus);
  const tw = mainChecks.reduce((a, c) => a + c.weight, 0);
  const total = Math.round(mainChecks.reduce((a, c) => a + c.score * c.weight, 0) / tw);
  const grade = total >= 90 ? "A" : total >= 75 ? "B" : total >= 60 ? "C" : total >= 40 ? "D" : "F";
  const verdict = total >= 75 && analysis.clipping.severity === "none" ? "READY" : total >= 50 ? "REVIEW" : "REJECT";

  return { checks, total, grade, verdict };
}
