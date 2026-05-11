/**
 * repairPipeline.ts — Manual-only repair pipeline
 * Aivora Honest Audio Repair Suite — Batch 9
 */

import { removeHum }          from "./humRemover";
import { normalizeLoudness }  from "./loudnessNormalizer";
import { trimSilence }        from "./silenceTrimmer";

export interface RepairOptions {
  humRemoval:             boolean;
  humFrequency:           50 | 60;
  loudnessNormalize:      boolean;
  targetLufs:             number;
  trimSilence:            boolean;
  shortenInternalSilence: boolean;
  profile:                "wakeword" | "asr" | "tts" | "conversation";
}

export interface RepairResult {
  repairedBuffer:       AudioBuffer;
  changed:              boolean;
  operations:           string[];
  warnings:             string[];
  exportNameSuggestion: string;
}

export function repairAudioBuffer(
  buffer:   AudioBuffer,
  options:  RepairOptions,
  filename: string = "audio"
): RepairResult {
  let current    = buffer;
  const operations: string[] = [];
  const warnings:   string[] = [];

  // Step 1: Hum removal
  if (options.humRemoval) {
    const result = removeHum(current, {
      frequency: options.humFrequency,
      harmonics: 4,
      qFactor:   30,
      amount:    1.0,
    });
    current = result.buffer;
    operations.push(`Hum removal: ${options.humFrequency} Hz + ${result.notchesApplied} harmonics`);
    warnings.push(...result.warnings);
  }

  // Step 2: Silence trim
  if (options.trimSilence) {
    const result = trimSilence(current, {
      trimLeading:           true,
      trimTrailing:          true,
      shortenInternalGaps:   options.shortenInternalSilence,
      maxInternalSilenceSec: 0.5,
      keepPaddingMs:         50,
    });
    current = result.buffer;
    if (result.changed) {
      const totalMs = result.trimmedRegions.reduce((s, r) => s + r.durationMs, 0);
      operations.push(`Silence trim: ${result.trimmedRegions.length} region(s), ${totalMs.toFixed(0)} ms removed`);
    }
    warnings.push(...result.warnings);
  }

  // Step 3: Loudness normalization (last — after trim for accurate LUFS)
  if (options.loudnessNormalize) {
    const result = normalizeLoudness(current, {
      targetLufs:    options.targetLufs,
      truePeakLimit: -1.0,
      profile:       options.profile,
    });
    current = result.buffer;
    if (result.changed) {
      operations.push(
        `Loudness: ${result.beforeLufs.toFixed(1)} → ${result.afterLufs.toFixed(1)} LUFS (${result.gainDb > 0 ? "+" : ""}${result.gainDb.toFixed(1)} dB)`
      );
    }
    warnings.push(...result.warnings);
  }

  const changed = operations.length > 0;
  const baseName = filename.replace(/\.wav$/i, "");
  const exportNameSuggestion = `${baseName}_repaired.wav`;

  return { repairedBuffer: current, changed, operations, warnings, exportNameSuggestion };
}
