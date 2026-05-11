/**
 * snrAnalyzer.ts — Signal-to-Noise Ratio Analysis
 * Aivora Audio QC Engine — Batch 5
 */

import { AudioProblem, makeProblem } from "./qcTypes";

// ── NOISE FLOOR ESTIMATION ────────────────────────────────────────────────────

function estimateNoiseFloor(
  samples: Float32Array,
  sampleRate: number,
  frameSizeMs = 20
): number {
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const energies: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let e = 0;
    for (let j = i; j < i + frameSize; j++) e += samples[j] * samples[j];
    energies.push(e / frameSize);
  }

  if (energies.length === 0) return 0;

  // Noise floor = average of lowest 15% frames
  energies.sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(energies.length * 0.15));
  const noiseFrames = energies.slice(0, cutoff);
  return noiseFrames.reduce((a, b) => a + b, 0) / noiseFrames.length;
}

// ── SIGNAL ENERGY ─────────────────────────────────────────────────────────────

function estimateSignalEnergy(
  samples: Float32Array,
  sampleRate: number,
  frameSizeMs = 20
): number {
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const energies: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let e = 0;
    for (let j = i; j < i + frameSize; j++) e += samples[j] * samples[j];
    energies.push(e / frameSize);
  }

  if (energies.length === 0) return 0;

  // Signal = average of top 50% frames
  energies.sort((a, b) => b - a);
  const cutoff = Math.max(1, Math.floor(energies.length * 0.50));
  const signalFrames = energies.slice(0, cutoff);
  return signalFrames.reduce((a, b) => a + b, 0) / signalFrames.length;
}

// ── SEGMENTAL SNR ─────────────────────────────────────────────────────────────

function computeSegmentalSNR(
  samples: Float32Array,
  sampleRate: number,
  noiseFloor: number,
  frameSizeMs = 20
): number {
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const snrs: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let e = 0;
    for (let j = i; j < i + frameSize; j++) e += samples[j] * samples[j];
    const frameEnergy = e / frameSize;
    if (frameEnergy > noiseFloor * 2) {
      const snr = 10 * Math.log10((frameEnergy - noiseFloor) / (noiseFloor + 1e-10));
      if (snr > -10 && snr < 60) snrs.push(snr);
    }
  }

  if (snrs.length === 0) return 0;
  return snrs.reduce((a, b) => a + b, 0) / snrs.length;
}

// ── WAVEFORM FLATNESS (fake studio detection) ─────────────────────────────────

function detectFakeStudio(
  samples: Float32Array,
  sampleRate: number
): boolean {
  // Suspiciously perfect SNR with no natural variation = possible fake
  const frameSize = Math.round(0.1 * sampleRate);
  const energies: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let e = 0;
    for (let j = i; j < i + frameSize; j++) e += samples[j] * samples[j];
    energies.push(e / frameSize);
  }

  if (energies.length < 4) return false;

  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const variance = energies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / energies.length;
  const cv = Math.sqrt(variance) / (mean + 1e-10); // Coefficient of variation

  // Natural recordings have cv > 0.3, fake/processed ones are suspiciously flat
  return cv < 0.08 && mean > 1e-6;
}

// ── PUBLIC INTERFACE ──────────────────────────────────────────────────────────

export interface SNRResult {
  snrDb:          number;
  noiseFloorDb:   number;
  signalDb:       number;
  segmentalSnr:   number;
  fakeStudio:     boolean;
  quality:        "excellent" | "good" | "fair" | "poor" | "unusable";
  problems:       AudioProblem[];
}

export function analyzeSNR(
  buffer: AudioBuffer,
  profile: "wakeword" | "asr" | "tts" | "conversation" = "asr"
): SNRResult {
  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  const noiseFloor   = estimateNoiseFloor(mono, buffer.sampleRate);
  const signalEnergy = estimateSignalEnergy(mono, buffer.sampleRate);
  const snrDb        = 10 * Math.log10((signalEnergy - noiseFloor) / (noiseFloor + 1e-10));
  const noiseFloorDb = 10 * Math.log10(noiseFloor + 1e-10);
  const signalDb     = 10 * Math.log10(signalEnergy + 1e-10);
  const segmentalSnr = computeSegmentalSNR(mono, buffer.sampleRate, noiseFloor);
  const fakeStudio   = detectFakeStudio(mono, buffer.sampleRate);

  // ── Quality rating ────────────────────────────────────────────────────────
  const quality: SNRResult["quality"] =
    snrDb >= 40 ? "excellent" :
    snrDb >= 30 ? "good"      :
    snrDb >= 20 ? "fair"      :
    snrDb >= 10 ? "poor"      : "unusable";

  // ── Profile thresholds ────────────────────────────────────────────────────
  const minSnr: Record<string, number> = {
    wakeword: 25, asr: 20, tts: 30, conversation: 15,
  };

  const problems: AudioProblem[] = [];

  if (snrDb < minSnr[profile] - 10) {
    problems.push(makeProblem("BACKGROUND_NOISE", "critical",
      `SNR ${snrDb.toFixed(1)} dB is far below minimum (${minSnr[profile]} dB) for ${profile}`,
      { confidence: 0.93, suggestedAction: "Re-record in a quieter environment" }));
  } else if (snrDb < minSnr[profile]) {
    problems.push(makeProblem("BACKGROUND_NOISE", "warning",
      `SNR ${snrDb.toFixed(1)} dB below recommended minimum (${minSnr[profile]} dB)`,
      { confidence: 0.85 }));
  }

  if (noiseFloorDb > -40) {
    problems.push(makeProblem("BACKGROUND_NOISE", "medium",
      `Noise floor ${noiseFloorDb.toFixed(1)} dB is too high — noisy environment`,
      { confidence: 0.88 }));
  }

  if (fakeStudio) {
    problems.push(makeProblem("BACKGROUND_NOISE", "warning",
      "Suspiciously flat waveform — possible artificial noise removal or fake studio processing",
      { confidence: 0.70, suggestedAction: "Verify recording authenticity" }));
  }

  if (quality === "unusable") {
    problems.push(makeProblem("BACKGROUND_NOISE", "critical",
      `SNR ${snrDb.toFixed(1)} dB — audio unusable for AI training`,
      { confidence: 0.95, suggestedAction: "Reject and re-record" }));
  }

  return { snrDb, noiseFloorDb, signalDb, segmentalSnr, fakeStudio, quality, problems };
}
