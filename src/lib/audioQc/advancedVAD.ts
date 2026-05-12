/**
 * advancedVAD.ts — Advanced Voice Activity Detection
 * Multi-feature VAD: Energy + ZCR + Spectral Flatness + Pitch
 * Aivora Audio QC Engine
 */

import { AudioProblem, makeProblem } from "./qcTypes";

// ── FFT (reuse) ────────────────────────────────────────────────────────────────

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

// ── Frame Features ────────────────────────────────────────────────────────────

interface FrameFeatures {
  energy:        number;
  zcr:           number;
  spectralFlat:  number;
  spectralCent:  number;
  pitchHz:       number;
  isSpeech:      boolean;
  confidence:    number;
}

function extractFeatures(
  samples:    Float32Array,
  sampleRate: number,
  fftSize =   512
): FrameFeatures {
  const n = samples.length;

  // Energy (RMS)
  let energy = 0;
  for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
  energy = Math.sqrt(energy / n);

  // Zero Crossing Rate
  let zcr = 0;
  for (let i = 1; i < n; i++)
    if (samples[i] * samples[i-1] < 0) zcr++;
  zcr /= n;

  // FFT for spectral features
  const size = Math.min(fftSize, n);
  const re   = new Float64Array(size);
  const im   = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = samples[i];
  fft(re, im);

  const mag = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++)
    mag[i] = Math.sqrt(re[i]*re[i] + im[i]*im[i]) / size;

  // Spectral Flatness (Wiener entropy)
  let logSum = 0, linSum = 0;
  for (let i = 1; i < mag.length; i++) {
    const v = mag[i] + 1e-10;
    logSum += Math.log(v);
    linSum += v;
  }
  const spectralFlat = Math.exp(logSum / mag.length) / (linSum / mag.length + 1e-10);

  // Spectral Centroid
  let num = 0, den = 0;
  const binHz = sampleRate / size;
  for (let i = 0; i < mag.length; i++) {
    num += i * binHz * mag[i];
    den += mag[i];
  }
  const spectralCent = den > 0 ? num / den : 0;

  // Pitch estimation (autocorrelation)
  const minPeriod = Math.round(sampleRate / 400); // 400 Hz max
  const maxPeriod = Math.round(sampleRate / 60);  // 60 Hz min
  let bestCorr = 0, bestPeriod = 0;
  for (let p = minPeriod; p <= Math.min(maxPeriod, n/2); p++) {
    let corr = 0;
    for (let i = 0; i < n - p; i++) corr += samples[i] * samples[i + p];
    if (corr > bestCorr) { bestCorr = corr; bestPeriod = p; }
  }
  const pitchHz = bestPeriod > 0 ? sampleRate / bestPeriod : 0;

  return { energy, zcr, spectralFlat, spectralCent, pitchHz, isSpeech: false, confidence: 0 };
}

// ── Multi-feature Classification ──────────────────────────────────────────────

function classifyFrame(
  f:           FrameFeatures,
  energyThresh: number,
  noiseFloor:  number
): { isSpeech: boolean; confidence: number } {
  let score = 0;
  let total = 0;

  // 1. Energy above noise floor (weight: 3)
  const energyRatio = f.energy / (noiseFloor + 1e-10);
  if (energyRatio > 3.0) { score += 3; }
  else if (energyRatio > 1.5) { score += 1.5; }
  total += 3;

  // 2. ZCR in speech range 0.01–0.15 (weight: 2)
  if (f.zcr > 0.01 && f.zcr < 0.15) { score += 2; }
  else if (f.zcr > 0.005 && f.zcr < 0.25) { score += 1; }
  total += 2;

  // 3. Spectral flatness < 0.3 (tonal = speech) (weight: 2)
  if (f.spectralFlat < 0.15) { score += 2; }
  else if (f.spectralFlat < 0.30) { score += 1; }
  total += 2;

  // 4. Spectral centroid in speech range 200–4000 Hz (weight: 2)
  if (f.spectralCent > 200 && f.spectralCent < 4000) { score += 2; }
  else if (f.spectralCent > 100 && f.spectralCent < 6000) { score += 1; }
  total += 2;

  // 5. Pitch in voice range 60–400 Hz (weight: 1)
  if (f.pitchHz > 60 && f.pitchHz < 400) { score += 1; }
  total += 1;

  const confidence = score / total;
  return { isSpeech: confidence > 0.5, confidence };
}

// ── Smoothing ─────────────────────────────────────────────────────────────────

function smoothDecisions(
  frames:   FrameFeatures[],
  hopMs:    number
): FrameFeatures[] {
  // Fill short gaps (< 200ms)
  const gapFrames = Math.round(200 / hopMs);
  let inGap = false, gapStart = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].isSpeech) {
      if (inGap && i - gapStart < gapFrames)
        for (let j = gapStart; j < i; j++) frames[j].isSpeech = true;
      inGap = false;
    } else if (!inGap) { inGap = true; gapStart = i; }
  }

  // Remove short bursts (< 80ms)
  const burstFrames = Math.round(80 / hopMs);
  let inBurst = false, burstStart = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].isSpeech) {
      if (!inBurst) { inBurst = true; burstStart = i; }
    } else {
      if (inBurst && i - burstStart < burstFrames)
        for (let j = burstStart; j < i; j++) frames[j].isSpeech = false;
      inBurst = false;
    }
  }
  return frames;
}

// ── Public Interface ──────────────────────────────────────────────────────────

export interface AdvancedVADResult {
  speechRatio:    number;
  speechRegions:  { startSec: number; endSec: number; avgConfidence: number }[];
  noiseFloorDb:   number;
  dominantPitch:  number;
  frameCount:     number;
  speechFrames:   number;
  problems:       AudioProblem[];
}

export function analyzeAdvancedVAD(
  buffer:  AudioBuffer,
  profile: "wakeword" | "asr" | "tts" | "conversation" = "asr"
): AdvancedVADResult {
  const sr        = buffer.sampleRate;
  const FRAME_MS  = 20;
  const HOP_MS    = 10;
  const frameSize = Math.round((FRAME_MS / 1000) * sr);
  const hopSize   = Math.round((HOP_MS   / 1000) * sr);

  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  // Extract features per frame
  const allFeatures: FrameFeatures[] = [];
  for (let i = 0; i + frameSize <= mono.length; i += hopSize) {
    const frame = mono.slice(i, i + frameSize);
    allFeatures.push(extractFeatures(frame, sr));
  }

  if (allFeatures.length === 0) {
    return {
      speechRatio: 0, speechRegions: [], noiseFloorDb: -120,
      dominantPitch: 0, frameCount: 0, speechFrames: 0, problems: [],
    };
  }

  // Estimate noise floor from quietest 10% of frames
  const energies = allFeatures.map(f => f.energy).sort((a,b) => a-b);
  const cutoff   = Math.max(1, Math.floor(energies.length * 0.10));
  const noiseFloor = energies.slice(0, cutoff).reduce((s,v) => s+v, 0) / cutoff;
  const energyThresh = noiseFloor * 4;

  // Classify frames
  for (const f of allFeatures) {
    const { isSpeech, confidence } = classifyFrame(f, energyThresh, noiseFloor);
    f.isSpeech   = isSpeech;
    f.confidence = confidence;
  }

  // Smooth
  smoothDecisions(allFeatures, HOP_MS);

  // Extract speech regions
  const regions: { startSec: number; endSec: number; avgConfidence: number }[] = [];
  let inSpeech = false, regionStart = 0, confSum = 0, confCount = 0;

  for (let i = 0; i < allFeatures.length; i++) {
    const timeSec = (i * hopSize) / sr;
    if (allFeatures[i].isSpeech && !inSpeech) {
      inSpeech = true; regionStart = timeSec; confSum = 0; confCount = 0;
    }
    if (allFeatures[i].isSpeech) {
      confSum += allFeatures[i].confidence; confCount++;
    }
    if (!allFeatures[i].isSpeech && inSpeech) {
      inSpeech = false;
      regions.push({ startSec: regionStart, endSec: timeSec,
        avgConfidence: confCount > 0 ? confSum / confCount : 0 });
    }
  }
  if (inSpeech) {
    regions.push({ startSec: regionStart,
      endSec: allFeatures.length * hopSize / sr,
      avgConfidence: confCount > 0 ? confSum / confCount : 0 });
  }

  const speechFrames = allFeatures.filter(f => f.isSpeech).length;
  const speechRatio  = speechFrames / allFeatures.length;
  const noiseFloorDb = 20 * Math.log10(noiseFloor + 1e-10);

  // Dominant pitch
  const pitchFrames  = allFeatures.filter(f => f.isSpeech && f.pitchHz > 60 && f.pitchHz < 400);
  const dominantPitch = pitchFrames.length > 0
    ? pitchFrames.reduce((s,f) => s + f.pitchHz, 0) / pitchFrames.length : 0;

  // Problems
  const minRatios = { wakeword:0.35, asr:0.25, tts:0.45, conversation:0.15 };
  const problems: AudioProblem[] = [];

  if (speechRatio < minRatios[profile]) {
    problems.push(makeProblem("SILENCE_ABUSE", "warning",
      `Advanced VAD: Speech ratio ${(speechRatio*100).toFixed(1)}% below minimum`,
      { confidence: 0.88 }));
  }
  if (regions.length === 0) {
    problems.push(makeProblem("DIGITAL_SILENCE", "critical",
      "Advanced VAD: No speech detected",
      { confidence: 0.97 }));
  }

  return {
    speechRatio, speechRegions: regions, noiseFloorDb,
    dominantPitch, frameCount: allFeatures.length, speechFrames, problems,
  };
}
