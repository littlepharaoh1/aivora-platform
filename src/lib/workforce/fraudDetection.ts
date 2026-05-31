/**
 * fraudDetection.ts
 * Aivora Platform — Workforce Fraud Detection
 *
 * PURE, deterministic anomaly detection. Produces ADVISORY signals only —
 * never takes automatic action (matches existing WorkforcePanel policy).
 * Extends the fraud_heatmap concept with explicit, explainable signals.
 */

import type { FraudSignal, FraudAssessment, FraudSignalType } from "./workforceTypes";

// ── Tunable thresholds (deterministic constants) ──────────────────────────────

export const FRAUD_THRESHOLDS = {
  // Completions faster than this fraction of the cohort median = suspicious
  SPEED_RATIO:          0.25,   // <25% of median turnaround
  // Identical-output ratio that looks like copy/paste
  COPY_RATIO:           0.4,    // >40% identical outputs
  // Repeated single output dominating a worker's submissions
  REPEAT_RATIO:         0.6,    // >60% same output value
  // Agreement so high it's statistically abnormal (collusion / rubber-stamping)
  ABNORMAL_AGREEMENT:   0.98,   // >98% agreement over a large sample
  MIN_SAMPLE:           20,     // need enough data before flagging agreement
  FLAG_RISK:            0.5,    // aggregate risk above this → flagged
} as const;

// ── Input shapes ──────────────────────────────────────────────────────────────

export interface WorkerActivity {
  reviewer_id:        string;
  turnaround_secs:    number[];   // per-completed-task seconds
  output_hashes:      string[];   // hash/signature per submitted output
  agreement_rate:     number;     // 0..1 from reviewer stats
  sample_size:        number;     // total reviews
}

// ── Individual detectors (each returns a signal or null) ──────────────────────

export function detectSuspiciousSpeed(
  a: WorkerActivity, cohortMedianSec: number,
): FraudSignal | null {
  if(a.turnaround_secs.length === 0 || cohortMedianSec <= 0) return null;
  const mean = a.turnaround_secs.reduce((s, t) => s + t, 0) / a.turnaround_secs.length;
  const ratio = mean / cohortMedianSec;
  if(ratio < FRAUD_THRESHOLDS.SPEED_RATIO) {
    return {
      reviewer_id: a.reviewer_id,
      signal:      "suspicious_speed",
      severity:    Math.min(1, (FRAUD_THRESHOLDS.SPEED_RATIO - ratio) / FRAUD_THRESHOLDS.SPEED_RATIO),
      detail:      `Mean turnaround ${mean.toFixed(0)}s is ${(ratio*100).toFixed(0)}% of cohort median`,
    };
  }
  return null;
}

export function detectCopyPattern(a: WorkerActivity): FraudSignal | null {
  if(a.output_hashes.length < 2) return null;
  const counts = new Map<string, number>();
  for(const h of a.output_hashes) counts.set(h, (counts.get(h) ?? 0) + 1);
  const duplicates = [...counts.values()].filter(c => c > 1).reduce((s, c) => s + c, 0);
  const ratio = duplicates / a.output_hashes.length;
  if(ratio > FRAUD_THRESHOLDS.COPY_RATIO) {
    return {
      reviewer_id: a.reviewer_id,
      signal:      "copy_pattern",
      severity:    Math.min(1, ratio),
      detail:      `${(ratio*100).toFixed(0)}% of outputs are duplicates`,
    };
  }
  return null;
}

export function detectRepeatedOutput(a: WorkerActivity): FraudSignal | null {
  if(a.output_hashes.length === 0) return null;
  const counts = new Map<string, number>();
  for(const h of a.output_hashes) counts.set(h, (counts.get(h) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const ratio = maxCount / a.output_hashes.length;
  if(ratio > FRAUD_THRESHOLDS.REPEAT_RATIO) {
    return {
      reviewer_id: a.reviewer_id,
      signal:      "repeated_output",
      severity:    Math.min(1, ratio),
      detail:      `Single output repeated in ${(ratio*100).toFixed(0)}% of submissions`,
    };
  }
  return null;
}

export function detectAbnormalAgreement(a: WorkerActivity): FraudSignal | null {
  if(a.sample_size < FRAUD_THRESHOLDS.MIN_SAMPLE) return null;
  if(a.agreement_rate > FRAUD_THRESHOLDS.ABNORMAL_AGREEMENT) {
    return {
      reviewer_id: a.reviewer_id,
      signal:      "abnormal_agreement",
      severity:    Math.min(1, (a.agreement_rate - FRAUD_THRESHOLDS.ABNORMAL_AGREEMENT) / (1 - FRAUD_THRESHOLDS.ABNORMAL_AGREEMENT)),
      detail:      `${(a.agreement_rate*100).toFixed(1)}% agreement over ${a.sample_size} reviews`,
    };
  }
  return null;
}

// ── Aggregate assessment ──────────────────────────────────────────────────────

export function assessFraud(
  a: WorkerActivity, cohortMedianSec: number,
): FraudAssessment {
  const signals: FraudSignal[] = [
    detectSuspiciousSpeed(a, cohortMedianSec),
    detectCopyPattern(a),
    detectRepeatedOutput(a),
    detectAbnormalAgreement(a),
  ].filter((s): s is FraudSignal => s !== null);

  // Risk = max severity (worst signal dominates), not average — one strong
  // signal is enough to warrant review.
  const risk = signals.length > 0 ? Math.max(...signals.map(s => s.severity)) : 0;

  return {
    reviewer_id: a.reviewer_id,
    signals,
    risk_score:  Math.round(risk * 1000) / 1000,
    flagged:     risk > FRAUD_THRESHOLDS.FLAG_RISK,
  };
}

// ── Cohort median helper (deterministic) ──────────────────────────────────────

export function cohortMedianTurnaround(activities: WorkerActivity[]): number {
  const all: number[] = [];
  for(const a of activities) all.push(...a.turnaround_secs);
  if(all.length === 0) return 0;
  const sorted = [...all].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function assessFraudBatch(activities: WorkerActivity[]): FraudAssessment[] {
  const median = cohortMedianTurnaround(activities);
  return activities.map(a => assessFraud(a, median));
}
