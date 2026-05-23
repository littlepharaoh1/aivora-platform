/**
 * speechQA.ts — Speech QA Intelligence
 * Aivora Platform — Phase 8.4
 *
 * Advisory signals only — no autonomous correction.
 * Deterministic math. No ML.
 */

import type { ASRTranscript, ASRSegment } from "./asrTypes";
import type { AlignmentResult }           from "./tokenAlignment";

export const SPEECH_QA_VERSION = "8.4.0";

// ── QA Issue Types ────────────────────────────────────────────────────────────

export type SpeechQACode =
  | "HALLUCINATION_RISK"
  | "TIMESTAMP_DRIFT"
  | "OVERLAP_DETECTED"
  | "SILENCE_MISMATCH"
  | "LOW_CONFIDENCE"
  | "CLIPPING_MISMATCH"
  | "SHORT_SEGMENT"
  | "EMPTY_TRANSCRIPT";

export interface SpeechQAIssue {
  code:       SpeechQACode;
  severity:   "error" | "warning" | "info";
  message:    string;
  segment_id?:number;
  details?:   Record<string, unknown>;
}

export interface SpeechQAReport {
  version:       string;
  passed:        boolean;
  issues:        SpeechQAIssue[];
  error_count:   number;
  warning_count: number;
  mean_confidence:number;
  generated_at:  string;
}

// ── Hallucination Detection ───────────────────────────────────────────────────
// Heuristic: repeated phrases within short window = likely hallucination

export function detectHallucination(transcript: ASRTranscript): SpeechQAIssue[] {
  const issues: SpeechQAIssue[] = [];
  const words = transcript.full_text.toLowerCase().split(/\s+/).filter(Boolean);

  if(words.length < 4) return issues;

  // Check for repeated 3-gram patterns
  const trigrams = new Map<string, number>();
  for(let i = 0; i <= words.length - 3; i++) {
    const gram = `${words[i]} ${words[i+1]} ${words[i+2]}`;
    trigrams.set(gram, (trigrams.get(gram) ?? 0) + 1);
  }

  for(const [gram, count] of trigrams) {
    if(count >= 3) {
      issues.push({
        code:    "HALLUCINATION_RISK",
        severity:"warning",
        message: `Repeated phrase detected: "${gram}" (×${count})`,
        details: { phrase:gram, count },
      });
    }
  }

  return issues;
}

// ── Timestamp Drift Check ────────────────────────────────────────────────────

export function checkTimestampDrift(
  alignment:  AlignmentResult,
  maxDriftMs: number = 500,
): SpeechQAIssue[] {
  const issues: SpeechQAIssue[] = [];
  const driftMs = (alignment.drift_frames / alignment.sample_rate) * 1000;

  if(driftMs > maxDriftMs) {
    issues.push({
      code:    "TIMESTAMP_DRIFT",
      severity:"warning",
      message: `Timestamp drift ${driftMs.toFixed(0)}ms > ${maxDriftMs}ms`,
      details: { drift_frames:alignment.drift_frames, drift_ms:driftMs },
    });
  }

  return issues;
}

// ── Confidence Check ──────────────────────────────────────────────────────────

export function checkConfidence(
  transcript:     ASRTranscript,
  minConfidence:  number = 0.3,
): SpeechQAIssue[] {
  const issues: SpeechQAIssue[] = [];
  const allTokens = transcript.segments.flatMap(s => s.tokens);
  if(!allTokens.length) return issues;

  const mean = allTokens.reduce((s,t) => s + t.confidence, 0) / allTokens.length;
  const lowConf = allTokens.filter(t => t.confidence < minConfidence);

  if(mean < minConfidence) {
    issues.push({
      code:    "LOW_CONFIDENCE",
      severity:"warning",
      message: `Mean confidence ${(mean*100).toFixed(1)}% < ${(minConfidence*100).toFixed(1)}%`,
      details: { mean_confidence:mean, low_confidence_tokens:lowConf.length },
    });
  }

  return issues;
}

// ── Empty Transcript Check ────────────────────────────────────────────────────

export function checkEmptyTranscript(transcript: ASRTranscript): SpeechQAIssue[] {
  if(!transcript.full_text.trim()) {
    return [{
      code:    "EMPTY_TRANSCRIPT",
      severity:"error",
      message: "Empty transcript — no speech detected",
    }];
  }
  return [];
}

// ── Full QA Report ────────────────────────────────────────────────────────────

export function generateSpeechQAReport(
  transcript: ASRTranscript,
  alignment:  AlignmentResult,
): SpeechQAReport {
  const allTokens = transcript.segments.flatMap(s => s.tokens);
  const mean = allTokens.length
    ? allTokens.reduce((s,t) => s + t.confidence, 0) / allTokens.length
    : 0;

  const issues = [
    ...checkEmptyTranscript(transcript),
    ...detectHallucination(transcript),
    ...checkTimestampDrift(alignment),
    ...checkConfidence(transcript),
  ];

  return {
    version:         SPEECH_QA_VERSION,
    passed:          issues.filter(i => i.severity === "error").length === 0,
    issues,
    error_count:     issues.filter(i => i.severity === "error").length,
    warning_count:   issues.filter(i => i.severity === "warning").length,
    mean_confidence: Math.round(mean * 10000) / 10000,
    generated_at:    new Date().toISOString(),
  };
}
