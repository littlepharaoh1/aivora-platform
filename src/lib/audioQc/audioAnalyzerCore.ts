/**
 * audioAnalyzerCore.ts — Unified QC Engine
 * Aivora Audio QC Engine — Batch 7
 */

import { detectAdaptiveDigitalSilence } from "./adaptiveSilenceDetector";
import { detectHardCuts }               from "./hardCutDetector";
import { detectClipping }               from "./clippingDetector";
import { analyzeLUFS }                  from "./lufsAnalyzer";
import { analyzeFFT }                   from "./fftAnalyzer";
import { analyzeVAD }                   from "./vadAnalyzer";
import { analyzeSNR }                   from "./snrAnalyzer";

import type { AudioProblem, AudioProblemSeverity } from "./qcTypes";

// ── PUBLIC TYPES ──────────────────────────────────────────────────────────────

export type QcProfile = "wakeword" | "asr" | "tts" | "conversation";

export interface AudioQcResult {
  score:          number;
  deliveryRisk:   "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  problems:       AudioProblem[];
  technicalScore: number;
  integrityScore: number;

  // Extended metrics (new)
  metrics: {
    lufs:        number;
    truePeak:    number;
    lra:         number;
    snrDb:       number;
    noiseClass:  string;
    environment: string;
    speechRatio: number;
    quality:     string;
  };

  restoration: {
    changed:          boolean;
    segmentsRestored: number;
    totalRestoredMs:  number;
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function severityPenalty(severity: AudioProblemSeverity): number {
  switch (severity) {
    case "critical": return 25;
    case "high":     return 15;
    case "warning":  return 5;
    case "medium":   return 8;
    case "low":      return 3;
    default:         return 3;
  }
}

function deliveryRiskFromScore(score: number): AudioQcResult["deliveryRisk"] {
  if (score > 90) return "LOW";
  if (score > 75) return "MEDIUM";
  if (score > 50) return "HIGH";
  return "CRITICAL";
}

function sortProblems(problems: AudioProblem[]): AudioProblem[] {
  const rank: Record<AudioProblemSeverity, number> = {
    critical: 4,
    high:     3,
    warning:  2,
    medium:   2,
    low:      1,
  };
  return [...problems].sort((a, b) => {
    const sd = rank[b.severity] - rank[a.severity];
    if (sd !== 0) return sd;
    return (a.timeMs ?? 0) - (b.timeMs ?? 0);
  });
}

function buildAudioBuffer(
  samples: Float32Array,
  sampleRate: number
): AudioBuffer {
  const ctx = new OfflineAudioContext(1, samples.length, sampleRate);
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.getChannelData(0).set(samples);
  return buf;
}

// ── MAIN ANALYZER ─────────────────────────────────────────────────────────────

export async function analyzeAudioQuality(
  samples: Float32Array,
  sampleRate: number,
  profile: QcProfile = "asr"
): Promise<AudioQcResult> {

  // Build AudioBuffer for new analyzers
  const buffer = buildAudioBuffer(samples, sampleRate);

  // ── Run all analyzers ─────────────────────────────────────────────────────
  const [
    silenceProblems,
    hardCutProblems,
    clippingProblems,
    lufsResult,
    fftResult,
    vadResult,
    snrResult,
    restorationResult,// placeholder — call restoreNaturalSilence separately
  ] = await Promise.all([
    Promise.resolve(detectAdaptiveDigitalSilence(samples, sampleRate)),
    Promise.resolve(detectHardCuts(samples, sampleRate)),
    Promise.resolve(detectClipping(samples, sampleRate)),
    Promise.resolve(analyzeLUFS(buffer, profile)),
    Promise.resolve(analyzeFFT(buffer)),
    Promise.resolve(analyzeVAD(buffer, profile)),
    Promise.resolve(analyzeSNR(buffer, profile)),
    Promise.resolve({ changed: false, segmentsRestored: 0, totalRestoredMs: 0, problems: [] }),
  ]);

  // ── Merge all problems ────────────────────────────────────────────────────
  const allProblems = sortProblems([
    ...silenceProblems,
    ...hardCutProblems,
    ...clippingProblems,
    ...lufsResult.problems,
    ...fftResult.problems,
    ...vadResult.problems,
    ...snrResult.problems,
    ...restorationResult.problems,
  ]);

  // ── Scoring ───────────────────────────────────────────────────────────────
  let score = 100;
  for (const p of allProblems) score -= severityPenalty(p.severity);
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Technical score: clipping + LUFS + SNR
  const lufsOk  = lufsResult.problems.filter(p => p.severity === "critical").length === 0;
  const snrOk   = snrResult.quality !== "unusable" && snrResult.quality !== "poor";
  const techPen = clippingProblems.length * 12 + (lufsOk ? 0 : 15) + (snrOk ? 0 : 10);
  const technicalScore = Math.max(0, Math.min(100, 100 - techPen));

  // Integrity score: silence + hard cuts + VAD
  const intPen =
    silenceProblems.length * 10 +
    hardCutProblems.length * 15 +
    (vadResult.speechRatio < 0.2 ? 20 : 0) +
    restorationResult.segmentsRestored * 3;
  const integrityScore = Math.max(0, Math.min(100, 100 - intPen));

  return {
    score,
    deliveryRisk: deliveryRiskFromScore(score),
    problems:     allProblems,
    technicalScore,
    integrityScore,
    metrics: {
      lufs:        lufsResult.integrated,
      truePeak:    lufsResult.truePeak,
      lra:         lufsResult.lra,
      snrDb:       snrResult.snrDb,
      noiseClass:  fftResult.noiseClass,
      environment: fftResult.environment,
      speechRatio: vadResult.speechRatio,
      quality:     snrResult.quality,
    },
    restoration: {
      changed:          restorationResult.changed,
      segmentsRestored: restorationResult.segmentsRestored,
      totalRestoredMs:  restorationResult.totalRestoredMs,
    },
  };
}
