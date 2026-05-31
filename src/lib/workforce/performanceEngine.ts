/**
 * performanceEngine.ts
 * Aivora Platform — Workforce Performance Engine
 *
 * PURE, deterministic computation. Reads nothing directly — callers pass in
 * rows already fetched from existing tables (task_assignments, reviewers,
 * consensus_log). Same input → same output. Scales to 100k+ assignments
 * because it is O(n) over the provided arrays with no DB round-trips.
 */

import type { PerformanceMetrics } from "./workforceTypes";

// ── Input row shapes (subsets of existing tables) ─────────────────────────────

export interface AssignmentRow {
  id:           string;
  reviewer_id:  string | null;
  status:       string | null;   // pending|assigned|in_progress|completed|rejected|reworked
  assigned_at:  string;
  completed_at: string | null;
}

export interface ReviewerStats {
  id:                  string;
  total_reviews:       number;
  total_agreements:    number;
  total_disagreements: number;
  accuracy_score:      number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function turnaroundSeconds(assigned: string, completed: string | null): number | null {
  if(!completed) return null;
  const a = new Date(assigned).getTime();
  const c = new Date(completed).getTime();
  if(!isFinite(a) || !isFinite(c) || c < a) return null;
  return (c - a) / 1000;
}

// ── Core: compute metrics for ONE reviewer ────────────────────────────────────

export function computePerformance(
  reviewerId: string,
  assignments: AssignmentRow[],
  stats:       ReviewerStats | null,
): PerformanceMetrics {
  const mine = assignments.filter(a => a.reviewer_id === reviewerId);

  const completed = mine.filter(a => a.status === "completed");
  const rejected  = mine.filter(a => a.status === "rejected");
  const reworked  = mine.filter(a => a.status === "reworked");

  // Turnaround over completed assignments with valid timestamps
  const turnarounds = completed
    .map(a => turnaroundSeconds(a.assigned_at, a.completed_at))
    .filter((t): t is number => t !== null);
  const avgTurnaround = turnarounds.length > 0
    ? turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length
    : 0;

  const totalHandled = completed.length + rejected.length;
  const reviews      = stats?.total_reviews ?? 0;
  const disagreements= stats?.total_disagreements ?? 0;

  return {
    reviewer_id:        reviewerId,
    throughput:         completed.length,
    acceptance_rate:    safeDiv(completed.length, totalHandled),
    qa_score:           stats?.accuracy_score ?? 0,
    rework_rate:        safeDiv(reworked.length, completed.length + reworked.length),
    disagreement_rate:  safeDiv(disagreements, reviews),
    avg_turnaround_sec: avgTurnaround,
    sample_size:        mine.length,
  };
}

// ── Batch: compute for many reviewers at once (10k-safe) ──────────────────────

export function computePerformanceBatch(
  reviewerIds: string[],
  assignments: AssignmentRow[],
  statsById:   Map<string, ReviewerStats>,
): PerformanceMetrics[] {
  // Group assignments by reviewer once — O(n) instead of O(n*m)
  const byReviewer = new Map<string, AssignmentRow[]>();
  for(const a of assignments) {
    if(!a.reviewer_id) continue;
    const arr = byReviewer.get(a.reviewer_id) ?? [];
    arr.push(a);
    byReviewer.set(a.reviewer_id, arr);
  }

  return reviewerIds.map(id =>
    computePerformance(id, byReviewer.get(id) ?? [], statsById.get(id) ?? null)
  );
}

// ── Aggregate score (used for ranking) ────────────────────────────────────────
// Deterministic weighted blend. Weights chosen so quality dominates volume.

export function performanceScore(m: PerformanceMetrics): number {
  const qa         = m.qa_score;                    // 0..1
  const acceptance = m.acceptance_rate;             // 0..1
  const lowRework  = 1 - m.rework_rate;             // 0..1 (less rework = better)
  const lowDisagree= 1 - m.disagreement_rate;      // 0..1
  // Volume factor: diminishing returns, capped at 1 (50+ completed = full credit)
  const volume     = Math.min(1, m.throughput / 50);

  return (
    qa          * 0.35 +
    acceptance  * 0.25 +
    lowRework   * 0.15 +
    lowDisagree * 0.15 +
    volume      * 0.10
  );
}
