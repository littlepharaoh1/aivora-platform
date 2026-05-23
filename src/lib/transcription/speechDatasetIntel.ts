/**
 * speechDatasetIntel.ts — Speech Dataset Intelligence
 * Aivora Platform — Phase 8.6
 *
 * Advisory only — no automatic relabeling.
 * Deterministic math. No ML.
 */

import type { ASRTranscript } from "./asrTypes";

export const SPEECH_INTEL_VERSION = "8.6.0";

// ── Noisy Speech Classification (threshold-based) ────────────────────────────

export type NoisyLevel = "clean" | "light" | "moderate" | "heavy";

export function classifyNoisyLevel(meanConfidence: number): NoisyLevel {
  if(meanConfidence >= 0.8)  return "clean";
  if(meanConfidence >= 0.6)  return "light";
  if(meanConfidence >= 0.4)  return "moderate";
  return "heavy";
}

// ── Hard Example Detection ────────────────────────────────────────────────────

export function isHardExample(
  transcript:   ASRTranscript,
  threshold:    number = 0.5,
  window:       number = 0.15,
): boolean {
  const tokens = transcript.segments.flatMap(s => s.tokens);
  if(!tokens.length) return false;
  const mean = tokens.reduce((s,t) => s + t.confidence, 0) / tokens.length;
  return Math.abs(mean - threshold) <= window;
}

// ── Disagreement Detection ────────────────────────────────────────────────────
// Compare two transcripts of same audio — disagreement = different text

export function detectTranscriptDisagreement(
  t1: ASRTranscript,
  t2: ASRTranscript,
): { disagrees: boolean; edit_distance: number } {
  const a = t1.full_text.trim().toLowerCase();
  const b = t2.full_text.trim().toLowerCase();
  if(a === b) return { disagrees: false, edit_distance: 0 };

  // Levenshtein distance (bounded to 100 chars for performance)
  const maxLen = Math.min(100, Math.max(a.length, b.length));
  const as = a.slice(0, maxLen), bs = b.slice(0, maxLen);
  const dp = Array.from({length:as.length+1}, (_,i) =>
    Array.from({length:bs.length+1}, (_,j) => i===0?j:j===0?i:0)
  );
  for(let i=1;i<=as.length;i++) {
    for(let j=1;j<=bs.length;j++) {
      dp[i][j] = as[i-1]===bs[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }

  return { disagrees: true, edit_distance: dp[as.length][bs.length] };
}

// ── Synthetic Speech Detection ────────────────────────────────────────────────
// Heuristic: unnaturally uniform confidence = synthetic

export function estimateSyntheticProbability(transcript: ASRTranscript): number {
  const tokens = transcript.segments.flatMap(s => s.tokens);
  if(tokens.length < 5) return 0;

  const confs = tokens.map(t => t.confidence);
  const mean  = confs.reduce((a,b) => a+b, 0) / confs.length;
  const variance = confs.reduce((s,c) => s + (c-mean)**2, 0) / confs.length;

  // Very low variance = unnaturally uniform = higher synthetic probability
  // Natural speech: variance > 0.02
  const syntheticProb = Math.max(0, Math.min(1, 1 - variance / 0.02));
  return Math.round(syntheticProb * 1000) / 1000;
}

// ── Full Intelligence Report ──────────────────────────────────────────────────

export interface SpeechDatasetRecord {
  transcript_id:        string;
  input_checksum:       string | null;
  output_checksum:      string | null;
  noisy_level:          NoisyLevel;
  is_hard_example:      boolean;
  synthetic_probability:number;
  mean_confidence:      number;
  duration_sec:         number;
  language:             string;
  model_id:             string;
  backend:              string;
  protocol:             string;
  generated_at:         string;
}

export function buildSpeechDatasetRecord(
  transcript: ASRTranscript,
): SpeechDatasetRecord {
  const tokens    = transcript.segments.flatMap(s => s.tokens);
  const meanConf  = tokens.length
    ? tokens.reduce((s,t) => s + t.confidence, 0) / tokens.length
    : 0;

  return {
    transcript_id:        transcript.id,
    input_checksum:       transcript.input_checksum,
    output_checksum:      transcript.output_checksum,
    noisy_level:          classifyNoisyLevel(meanConf),
    is_hard_example:      isHardExample(transcript),
    synthetic_probability:estimateSyntheticProbability(transcript),
    mean_confidence:      Math.round(meanConf * 10000) / 10000,
    duration_sec:         transcript.duration_sec,
    language:             transcript.language_detected,
    model_id:             transcript.model_id,
    backend:              transcript.backend,
    protocol:             transcript.inference_protocol,
    generated_at:         new Date().toISOString(),
  };
}
