/**
 * repairPipeline.ts — Manual-only repair pipeline
 * Aivora Honest Audio Repair Suite — Batch 9
 */

import { removeHum }          from "./humRemover";
import { normalizeLoudness }  from "./loudnessNormalizer";
import { trimSilence }        from "./silenceTrimmer";
import { reduceNoise }        from "./noiseReducer";
import { compressDynamics }   from "./dynamicCompressor";
import { applyEQ, SPEECH_CLARITY_EQ } from "./multiBandEQ";

export interface RepairOptions {
  humRemoval:             boolean;
  dynamicCompression:     boolean;
  speechEQ:               boolean;
  noiseReduction:         boolean;
  noiseStrength:          number;
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

  // Step 0: Noise reduction
  if (options.noiseReduction) {
    const result = reduceNoise(current, {
      strength:     options.noiseStrength ?? 0.7,
      noiseEstMs:   500,
      overSubtract: 1.2,
    });
    current = result.buffer;
    operations.push(`Noise reduction: ${options.noiseStrength ?? 0.7}x strength (${result.reductionDb.toFixed(1)} dB reduction)`);
    warnings.push(...result.warnings);
  }

  // Step 0b: Dynamic compression
  if (options.dynamicCompression) {
    const result = compressDynamics(current, { threshold:-24, ratio:4, attack:10, release:100, makeupGain:6 });
    current = result.buffer;
    operations.push(`Dynamic compression: ${result.gainReductionDb.toFixed(1)} dB max reduction`);
    warnings.push(...result.warnings);
  }

  // Step 0c: Speech clarity EQ
  if (options.speechEQ) {
    const result = applyEQ(current, { bands: SPEECH_CLARITY_EQ });
    current = result.buffer;
    operations.push("Speech clarity EQ applied (80Hz HP, presence boost, 3kHz clarity)");
    warnings.push(...result.warnings);
  }

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
