/**
 * lufsAnalyzer.ts — EBU R128 LUFS + True Peak
 * Aivora Audio QC Engine — Batch 2
 */

import { AudioProblem, AudioProblemSeverity, makeProblem } from "./qcTypes";

// ── K-WEIGHTING FILTER COEFFICIENTS (EBU R128) ────────────────────────────────

interface BiquadState {
  x1: number; x2: number;
  y1: number; y2: number;
}

function applyBiquad(
  samples: Float32Array,
  b0: number, b1: number, b2: number,
  a1: number, a2: number,
  state: BiquadState
): Float32Array {
  const out = new Float32Array(samples.length);
  let { x1, x2, y1, y2 } = state;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  state.x1 = x1; state.x2 = x2;
  state.y1 = y1; state.y2 = y2;
  return out;
}

function kWeightChannel(samples: Float32Array, sampleRate: number): Float32Array {
  // Stage 1: High-shelf pre-filter
  const f0 = 1681.974450955533;
  const G  = 3.999843853973347;
  const Q  = 0.7071752369554196;
  const K  = Math.tan(Math.PI * f0 / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0hs = 1 + K / Q + K * K;
  const hs_b0 = (Vh + Vb * K / Q + K * K) / a0hs;
  const hs_b1 = 2 * (K * K - Vh) / a0hs;
  const hs_b2 = (Vh - Vb * K / Q + K * K) / a0hs;
  const hs_a1 = 2 * (K * K - 1) / a0hs;
  const hs_a2 = (1 - K / Q + K * K) / a0hs;
  const st1: BiquadState = { x1: 0, x2: 0, y1: 0, y2: 0 };
  const stage1 = applyBiquad(samples, hs_b0, hs_b1, hs_b2, hs_a1, hs_a2, st1);

  // Stage 2: High-pass RLB filter
  const f1 = 38.13547087602444;
  const Q2 = 0.5003270373238773;
  const K2 = Math.tan(Math.PI * f1 / sampleRate);
  const a0hp = 1 + K2 / Q2 + K2 * K2;
  const hp_b0 = 1 / a0hp;
  const hp_b1 = -2 / a0hp;
  const hp_b2 = 1 / a0hp;
  const hp_a1 = 2 * (K2 * K2 - 1) / a0hp;
  const hp_a2 = (1 - K2 / Q2 + K2 * K2) / a0hp;
  const st2: BiquadState = { x1: 0, x2: 0, y1: 0, y2: 0 };
  return applyBiquad(stage1, hp_b0, hp_b1, hp_b2, hp_a1, hp_a2, st2);
}

// ── GATED LOUDNESS ────────────────────────────────────────────────────────────

function computeGatedLUFS(weighted: Float32Array, sampleRate: number): number {
  const blockSize   = Math.round(0.4 * sampleRate);  // 400 ms
  const hopSize     = Math.round(0.1 * sampleRate);  // 100 ms overlap
  const ABS_GATE    = -70.0;  // LUFS
  const REL_GATE    = -10.0;  // LU below ungated mean

  const blockMeans: number[] = [];
  for (let i = 0; i + blockSize <= weighted.length; i += hopSize) {
    let sum = 0;
    for (let j = i; j < i + blockSize; j++) sum += weighted[j] * weighted[j];
    const meanSquare = sum / blockSize;
    const lufs = -0.691 + 10 * Math.log10(meanSquare + 1e-10);
    if (lufs > ABS_GATE) blockMeans.push(meanSquare);
  }

  if (blockMeans.length === 0) return -70;

  const ungatedMean = blockMeans.reduce((a, b) => a + b, 0) / blockMeans.length;
  const relGateLinear = ungatedMean * Math.pow(10, REL_GATE / 10);
  const gated = blockMeans.filter(m => m >= relGateLinear);
  if (gated.length === 0) return -70;

  const finalMean = gated.reduce((a, b) => a + b, 0) / gated.length;
  return -0.691 + 10 * Math.log10(finalMean + 1e-10);
}

// ── TRUE PEAK (4x OVERSAMPLE) ────────────────────────────────────────────────

function computeTruePeak(samples: Float32Array): number {
  // Simple 4x linear interpolation oversample
  let peak = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    peak = Math.max(peak, Math.abs(a));
    peak = Math.max(peak, Math.abs(0.25 * a + 0.75 * b));
    peak = Math.max(peak, Math.abs(0.5  * a + 0.5  * b));
    peak = Math.max(peak, Math.abs(0.75 * a + 0.25 * b));
  }
  return peak > 0 ? 20 * Math.log10(peak) : -144;
}

// ── LOUDNESS RANGE (LRA) ─────────────────────────────────────────────────────

function computeLRA(weighted: Float32Array, sampleRate: number): number {
  const blockSize = Math.round(3.0 * sampleRate);  // 3-second blocks
  const hopSize   = Math.round(1.0 * sampleRate);  // 1-second hop
  const ABS_GATE  = -70.0;

  const shorts: number[] = [];
  for (let i = 0; i + blockSize <= weighted.length; i += hopSize) {
    let sum = 0;
    for (let j = i; j < i + blockSize; j++) sum += weighted[j] * weighted[j];
    const ms = sum / blockSize;
    const lufs = -0.691 + 10 * Math.log10(ms + 1e-10);
    if (lufs > ABS_GATE) shorts.push(lufs);
  }

  if (shorts.length < 2) return 0;
  shorts.sort((a, b) => a - b);
  const lo = shorts[Math.floor(shorts.length * 0.10)];
  const hi = shorts[Math.floor(shorts.length * 0.95)];
  return Math.max(0, hi - lo);
}

// ── PUBLIC INTERFACE ──────────────────────────────────────────────────────────

export interface LUFSResult {
  integrated: number;   // LUFS
  truePeak:   number;   // dBTP
  lra:        number;   // LU
  problems:   AudioProblem[];
}

export function analyzeLUFS(
  buffer: AudioBuffer,
  profile: "wakeword" | "asr" | "tts" | "conversation" = "asr"
): LUFSResult {
  // Mix to mono & K-weight
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  }

  const weighted   = kWeightChannel(mono, buffer.sampleRate);
  const integrated = computeGatedLUFS(weighted, buffer.sampleRate);
  const truePeak   = computeTruePeak(mono);
  const lra        = computeLRA(weighted, buffer.sampleRate);

  // ── Profile targets ───────────────────────────────────────────────────────
  const targets: Record<string, { min: number; max: number; peakMax: number }> = {
    wakeword:     { min: -26, max: -16, peakMax: -1.0 },
    asr:          { min: -26, max: -14, peakMax: -1.0 },
    tts:          { min: -24, max: -16, peakMax: -1.0 },
    conversation: { min: -30, max: -14, peakMax: -1.0 },
  };
  const t = targets[profile];
  const problems: AudioProblem[] = [];

  if (integrated < t.min - 6) {
    problems.push(makeProblem("TOO_QUIET", "critical",
      `Loudness ${integrated.toFixed(1)} LUFS is far below target (${t.min}–${t.max} LUFS)`,
      { confidence: 0.95, suggestedAction: "Re-record or normalize audio" }));
  } else if (integrated < t.min) {
    problems.push(makeProblem("TOO_QUIET", "warning",
      `Loudness ${integrated.toFixed(1)} LUFS below target (${t.min}–${t.max} LUFS)`,
      { confidence: 0.85 }));
  } else if (integrated > t.max + 3) {
    problems.push(makeProblem("TOO_LOUD", "critical",
      `Loudness ${integrated.toFixed(1)} LUFS exceeds target (${t.min}–${t.max} LUFS)`,
      { confidence: 0.95, suggestedAction: "Reduce gain" }));
  } else if (integrated > t.max) {
    problems.push(makeProblem("TOO_LOUD", "warning",
      `Loudness ${integrated.toFixed(1)} LUFS above target (${t.min}–${t.max} LUFS)`,
      { confidence: 0.85 }));
  }

  if (truePeak > -0.5) {
    problems.push(makeProblem("CLIPPING", "critical",
      `True peak ${truePeak.toFixed(2)} dBTP — likely clipping`,
      { confidence: 0.98, suggestedAction: "Reduce peak level below -1 dBTP" }));
  } else if (truePeak > t.peakMax) {
    problems.push(makeProblem("CLIPPING", "warning",
      `True peak ${truePeak.toFixed(2)} dBTP exceeds ${t.peakMax} dBTP`,
      { confidence: 0.90 }));
  }

  if (lra > 20) {
    problems.push(makeProblem("DYNAMIC_RANGE_ISSUE", "warning",
      `Loudness range ${lra.toFixed(1)} LU is very high — inconsistent recording`,
      { confidence: 0.80 }));
  }

  return { integrated, truePeak, lra, problems };
}
