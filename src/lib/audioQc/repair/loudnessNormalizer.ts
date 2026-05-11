/**
 * loudnessNormalizer.ts — LUFS-based gain normalization
 * Aivora Honest Audio Repair Suite — Batch 9
 */

import { analyzeLUFS } from "../lufsAnalyzer";

export interface LoudnessNormalizerOptions {
  targetLufs:    number;   // e.g. -20
  truePeakLimit: number;   // e.g. -1.0 dBTP
  profile:       "wakeword" | "asr" | "tts" | "conversation";
}

export interface LoudnessNormalizerResult {
  buffer:      AudioBuffer;
  changed:     boolean;
  gainDb:      number;
  beforeLufs:  number;
  afterLufs:   number;
  warnings:    string[];
}

function dbToLinear(db: number): number { return Math.pow(10, db / 20); }
function linearToDb(v: number): number  { return v > 0 ? 20 * Math.log10(v) : -144; }

function peakAmplitude(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

function applyGain(buffer: AudioBuffer, gainLinear: number): AudioBuffer {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) dest[i] = src[i] * gainLinear;
  }
  return out;
}

export function normalizeLoudness(
  buffer: AudioBuffer,
  options: LoudnessNormalizerOptions
): LoudnessNormalizerResult {
  const { targetLufs, truePeakLimit, profile } = options;
  const warnings: string[] = [];

  const lufsResult = analyzeLUFS(buffer, profile);
  const currentLufs = lufsResult.integrated;

  if (currentLufs <= -69) {
    return {
      buffer, changed: false, gainDb: 0,
      beforeLufs: currentLufs, afterLufs: currentLufs,
      warnings: ["Audio appears silent — normalization skipped"],
    };
  }

  const gainDb     = targetLufs - currentLufs;
  const gainLinear = dbToLinear(gainDb);

  // Check true peak after gain
  const currentPeak   = peakAmplitude(buffer);
  const peakAfterGain = linearToDb(currentPeak * gainLinear);

  let finalGain = gainLinear;
  if (peakAfterGain > truePeakLimit) {
    const safeGainDb = truePeakLimit - linearToDb(currentPeak);
    finalGain = dbToLinear(safeGainDb);
    warnings.push(
      `Gain limited to ${safeGainDb.toFixed(1)} dB to prevent true peak clipping (would have been ${gainDb.toFixed(1)} dB)`
    );
  }

  if (Math.abs(gainDb) < 0.1) {
    return {
      buffer, changed: false, gainDb: 0,
      beforeLufs: currentLufs, afterLufs: currentLufs,
      warnings: ["Loudness already at target — no change needed"],
    };
  }

  const repairedBuffer = applyGain(buffer, finalGain);
  const afterResult    = analyzeLUFS(repairedBuffer, profile);

  return {
    buffer:     repairedBuffer,
    changed:    true,
    gainDb:     linearToDb(finalGain),
    beforeLufs: currentLufs,
    afterLufs:  afterResult.integrated,
    warnings,
  };
}
