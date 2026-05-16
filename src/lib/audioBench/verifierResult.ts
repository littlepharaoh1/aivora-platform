/**
 * verifierResult.ts — Verifier Output Type System
 * Deterministic, reproducible, non-falsifiable verification results
 */

import type { FullAudioMetrics } from "./metricTypes";
import type { MetricResult } from "./types";
import type { VerifierDecision, TaskCategory } from "./types";

export interface BlockingFailure {
  readonly code:     string;       // e.g. "SPEECH_DAMAGED"
  readonly message:  string;
  readonly severity: "critical" | "high" | "medium";
  readonly metric:   string;
  readonly actual:   number;
  readonly threshold: number;
}

export interface VerifierWarning {
  readonly code:    string;
  readonly message: string;
  readonly metric:  string;
  readonly actual:  number;
}

export interface VerifierResult {
  readonly taskId:              string;
  readonly taskCategory:        TaskCategory;
  readonly decision:            VerifierDecision;
  readonly score:               number;        // 0-100
  readonly grade:               "A"|"B"|"C"|"D"|"F";
  readonly passed:              boolean;
  readonly blockingFailures:    BlockingFailure[];
  readonly warnings:            VerifierWarning[];
  readonly metrics:             FullAudioMetrics;
  readonly metricResults:       MetricResult[];
  readonly evidence:            VerifierEvidence;
  readonly reproducibilityHash: string;        // SHA-256 of inputs + outputs
  readonly verifiedAt:          number;        // timestamp ms
  readonly verifierVersion:     string;        // semver
}

export interface VerifierEvidence {
  readonly inputSha256:    string;
  readonly outputSha256:   string;
  readonly taskVersion:    string;
  readonly processingLog:  string[];
  readonly metricsLog:     string[];
}

// ── Grade calculation ─────────────────────────────────────────────────────────
// Score → Grade mapping (Adobe/iZotope-inspired thresholds)
// A: 90-100 — broadcast ready
// B: 75-89  — acceptable
// C: 60-74  — needs review
// D: 40-59  — significant issues
// F: 0-39   — blocking failures

export function scoreToGrade(score: number): "A"|"B"|"C"|"D"|"F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function gradeToColor(grade: "A"|"B"|"C"|"D"|"F"): string {
  const map = { A:"#10B981", B:"#0EA5E9", C:"#F59E0B", D:"#F97316", F:"#EF4444" };
  return map[grade];
}
