/**
 * workforceAnalytics.ts
 * Aivora Platform — Workforce Analytics
 *
 * PURE, deterministic aggregation over engine outputs. Produces worker /
 * reviewer rankings and trend rollups. No DB access.
 */

import type {
  PerformanceMetrics, FraudAssessment, RankingEntry, WorkforceTrends,
} from "./workforceTypes";
import { performanceScore } from "./performanceEngine";

export interface WorkerNameMap {
  [reviewerId: string]: string;
}

// ── Ranking (deterministic) ───────────────────────────────────────────────────
// Sort by score desc, tie-break by reviewer_id asc, then assign 1-based ranks.

export function rankByPerformance(
  metrics: PerformanceMetrics[],
  names:   WorkerNameMap,
): RankingEntry[] {
  const scored = metrics.map(m => ({
    reviewer_id: m.reviewer_id,
    name:        names[m.reviewer_id] ?? m.reviewer_id,
    score:       Math.round(performanceScore(m) * 1000) / 1000,
  }));

  scored.sort((a, b) =>
    a.score !== b.score ? b.score - a.score : a.reviewer_id.localeCompare(b.reviewer_id)
  );

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

// Reviewer ranking weights QA + disagreement more heavily (review quality).
export function rankReviewers(
  metrics: PerformanceMetrics[],
  names:   WorkerNameMap,
): RankingEntry[] {
  const scored = metrics.map(m => {
    const reviewScore =
      m.qa_score * 0.5 +
      (1 - m.disagreement_rate) * 0.3 +
      m.acceptance_rate * 0.2;
    return {
      reviewer_id: m.reviewer_id,
      name:        names[m.reviewer_id] ?? m.reviewer_id,
      score:       Math.round(reviewScore * 1000) / 1000,
    };
  });

  scored.sort((a, b) =>
    a.score !== b.score ? b.score - a.score : a.reviewer_id.localeCompare(b.reviewer_id)
  );

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

// ── Trends rollup ─────────────────────────────────────────────────────────────

export function computeTrends(
  metrics:     PerformanceMetrics[],
  assessments: FraudAssessment[],
  names:       WorkerNameMap,
  activeCount: number,
): WorkforceTrends {
  const n = metrics.length;
  const meanQA = n > 0
    ? metrics.reduce((s, m) => s + m.qa_score, 0) / n : 0;
  const meanThroughput = n > 0
    ? metrics.reduce((s, m) => s + m.throughput, 0) / n : 0;
  const flagged = assessments.filter(a => a.flagged).length;

  return {
    worker_ranking:   rankByPerformance(metrics, names),
    reviewer_ranking: rankReviewers(metrics, names),
    mean_qa_score:    Math.round(meanQA * 1000) / 1000,
    mean_throughput:  Math.round(meanThroughput * 100) / 100,
    total_active:     activeCount,
    flagged_count:    flagged,
  };
}

// ── Percentile helper (for quality/productivity trend bands) ──────────────────

export function percentile(values: number[], p: number): number {
  if(values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
