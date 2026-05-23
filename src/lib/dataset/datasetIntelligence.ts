/**
 * datasetIntelligence.ts — Dataset Intelligence Layer
 * Aivora Platform — Phase 7.6
 *
 * Advisory signals only — no auto-corrections.
 * Deterministic math. No ML.
 * Bounded scans (100 rows/page).
 */

import type { DatasetRecord } from "./datasetRuntime";

export const INTELLIGENCE_VERSION = "7.6.0";

// ── Quality Distribution ──────────────────────────────────────────────────────

export interface QualityDistribution {
  mean_qc_score:    number;
  p25_qc_score:     number;
  p50_qc_score:     number;
  p75_qc_score:     number;
  below_threshold:  number;   // count below 60
  above_threshold:  number;   // count above 60
  total:            number;
}

export function computeQualityDistribution(
  records: DatasetRecord[],
  threshold = 60,
): QualityDistribution {
  const scores = records
    .map(r => r.qc_score)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);

  if(scores.length === 0) {
    return { mean_qc_score:0, p25_qc_score:0, p50_qc_score:0,
             p75_qc_score:0, below_threshold:0, above_threshold:0, total:0 };
  }

  const mean   = scores.reduce((a,b) => a+b, 0) / scores.length;
  const p25    = scores[Math.floor(scores.length * 0.25)];
  const p50    = scores[Math.floor(scores.length * 0.50)];
  const p75    = scores[Math.floor(scores.length * 0.75)];
  const below  = scores.filter(s => s < threshold).length;

  return {
    mean_qc_score:   Math.round(mean * 10) / 10,
    p25_qc_score:    p25,
    p50_qc_score:    p50,
    p75_qc_score:    p75,
    below_threshold: below,
    above_threshold: scores.length - below,
    total:           scores.length,
  };
}

// ── Hard Example Mining ───────────────────────────────────────────────────────
// Files near quality gate threshold — borderline cases

export function mineHardExamples(
  records:   DatasetRecord[],
  threshold: number = 60,
  window:    number = 10,
): DatasetRecord[] {
  return records.filter(r =>
    r.qc_score !== null &&
    Math.abs(r.qc_score - threshold) <= window
  ).sort((a, b) => (a.qc_score ?? 0) - (b.qc_score ?? 0));
}

// ── Disagreement Extraction ───────────────────────────────────────────────────
// Files where forensic verdict ≠ expected from QC score

export function extractDisagreements(
  records: DatasetRecord[],
): DatasetRecord[] {
  return records.filter(r => {
    if(!r.qc_score || !r.forensic_verdict) return false;
    // High QC score but suspicious verdict = disagreement
    if(r.qc_score >= 70 && r.forensic_verdict === "SUSPICIOUS") return true;
    // Low QC score but authentic verdict = disagreement
    if(r.qc_score < 40 && r.forensic_verdict === "AUTHENTIC")   return true;
    return false;
  });
}

// ── Imbalance Analysis ────────────────────────────────────────────────────────

export interface ImbalanceReport {
  verdict_distribution: Record<string, number>;
  most_common_verdict:  string | null;
  imbalance_ratio:      number;  // max/min count ratio
  advisory:             string;
}

export function analyzeImbalance(
  records: DatasetRecord[],
): ImbalanceReport {
  const verdicts: Record<string, number> = {};
  for(const r of records) {
    const v = r.forensic_verdict ?? "UNKNOWN";
    verdicts[v] = (verdicts[v] ?? 0) + 1;
  }

  const counts = Object.values(verdicts);
  if(counts.length === 0) {
    return { verdict_distribution:{}, most_common_verdict:null,
             imbalance_ratio:0, advisory:"No data" };
  }

  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const ratio = min > 0 ? max / min : Infinity;

  const mostCommon = Object.entries(verdicts)
    .sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;

  const advisory = ratio > 10
    ? `High imbalance (${ratio.toFixed(1)}x) — consider rebalancing`
    : ratio > 3
    ? `Moderate imbalance (${ratio.toFixed(1)}x) — monitor`
    : "Balanced distribution";

  return {
    verdict_distribution: verdicts,
    most_common_verdict:  mostCommon,
    imbalance_ratio:      Math.round(ratio * 10) / 10,
    advisory,
  };
}

// ── Split Drift Analysis ──────────────────────────────────────────────────────
// Checks if quality metrics are similar across splits

export interface SplitDriftReport {
  train_mean_qc: number;
  val_mean_qc:   number;
  test_mean_qc:  number;
  max_drift:     number;   // max difference between any two splits
  advisory:      string;
}

export function analyzeSplitDrift(
  records: DatasetRecord[],
): SplitDriftReport {
  function meanQC(split: "train"|"val"|"test"): number {
    const scores = records
      .filter(r => r.split_bucket === split && r.qc_score !== null)
      .map(r => r.qc_score as number);
    if(!scores.length) return 0;
    return scores.reduce((a,b) => a+b, 0) / scores.length;
  }

  const trainMean = meanQC("train");
  const valMean   = meanQC("val");
  const testMean  = meanQC("test");

  const diffs = [
    Math.abs(trainMean - valMean),
    Math.abs(trainMean - testMean),
    Math.abs(valMean   - testMean),
  ];
  const maxDrift = Math.max(...diffs);

  const advisory = maxDrift > 15
    ? `High split drift (${maxDrift.toFixed(1)} pts) — splits may not be representative`
    : maxDrift > 5
    ? `Moderate drift (${maxDrift.toFixed(1)} pts)`
    : "Splits well-balanced";

  return {
    train_mean_qc: Math.round(trainMean * 10) / 10,
    val_mean_qc:   Math.round(valMean   * 10) / 10,
    test_mean_qc:  Math.round(testMean  * 10) / 10,
    max_drift:     Math.round(maxDrift  * 10) / 10,
    advisory,
  };
}

// ── Full Intelligence Report ──────────────────────────────────────────────────

export interface DatasetIntelligenceReport {
  version_id:          string;
  intelligence_version:string;
  quality_distribution:QualityDistribution;
  hard_examples:       number;
  disagreements:       number;
  imbalance:           ImbalanceReport;
  split_drift:         SplitDriftReport;
  generated_at:        string;
}

export function generateIntelligenceReport(
  versionId: string,
  records:   DatasetRecord[],
): DatasetIntelligenceReport {
  return {
    version_id:           versionId,
    intelligence_version: INTELLIGENCE_VERSION,
    quality_distribution: computeQualityDistribution(records),
    hard_examples:        mineHardExamples(records).length,
    disagreements:        extractDisagreements(records).length,
    imbalance:            analyzeImbalance(records),
    split_drift:          analyzeSplitDrift(records),
    generated_at:         new Date().toISOString(),
  };
}
