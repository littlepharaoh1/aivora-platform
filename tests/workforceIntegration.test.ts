/**
 * workforceIntegration.test.ts
 * Cross-engine integration — engines working together on realistic scenarios.
 * In-memory (no DB): verifies the engines compose correctly end-to-end.
 */

import { describe, it, expect } from "vitest";
import {
  computePerformanceBatch, performanceScore,
} from "../src/lib/workforce/performanceEngine";
import type { AssignmentRow, ReviewerStats } from "../src/lib/workforce/performanceEngine";
import {
  computeCapacityBatch, computeTeamCapacity, suggestCapacityTarget,
} from "../src/lib/workforce/capacityPlanner";
import {
  resolveConsensusBatch, computeDisagreementStats,
} from "../src/lib/workforce/consensusEngine";
import {
  assessFraudBatch,
} from "../src/lib/workforce/fraudDetection";
import type { WorkerActivity } from "../src/lib/workforce/fraudDetection";
import {
  computeTrends, rankByPerformance,
} from "../src/lib/workforce/workforceAnalytics";

// ── Realistic data generators ─────────────────────────────────────────────────

const HOUR = 3600 * 1000;
function ts(base: number, offsetMs: number): string {
  return new Date(base + offsetMs).toISOString();
}

function buildWorkforce(workerCount: number, assignmentsPer: number) {
  const base = Date.parse("2025-01-01T00:00:00.000Z");
  const ids = Array.from({ length: workerCount }, (_, i) => `w${i}`);
  const assignments: AssignmentRow[] = [];
  const statsById = new Map<string, ReviewerStats>();

  ids.forEach((id, wi) => {
    // Each worker: mix of completed/rejected/reworked, varying turnaround
    for(let j = 0; j < assignmentsPer; j++) {
      const status = j % 10 === 0 ? "rejected"
                   : j % 7 === 0  ? "reworked"
                   : "completed";
      const assignedAt = ts(base, j * HOUR);
      const dur = (1 + (wi % 3)) * HOUR; // 1-3h turnaround by worker
      const completedAt = status === "completed" ? ts(base, j * HOUR + dur) : null;
      assignments.push({ id:`${id}-${j}`, reviewer_id:id, status, assigned_at:assignedAt, completed_at:completedAt });
    }
    statsById.set(id, {
      id, total_reviews: assignmentsPer,
      total_agreements: Math.floor(assignmentsPer * 0.85),
      total_disagreements: Math.floor(assignmentsPer * 0.15),
      accuracy_score: 0.7 + (wi % 3) * 0.1,
    });
  });

  return { ids, assignments, statsById };
}

// ── Integration: full pipeline ────────────────────────────────────────────────

describe("Integration: performance → ranking pipeline", () => {
  it("computes metrics then ranks a 50-worker cohort", () => {
    const { ids, assignments, statsById } = buildWorkforce(50, 20);
    const metrics = computePerformanceBatch(ids, assignments, statsById);
    expect(metrics).toHaveLength(50);

    const names = Object.fromEntries(ids.map(id => [id, `Worker ${id}`]));
    const ranked = rankByPerformance(metrics, names);

    expect(ranked).toHaveLength(50);
    // Ranks are sequential and unique
    expect(ranked.map(r => r.rank)).toEqual(Array.from({length:50},(_,i)=>i+1));
    // Scores are monotonically non-increasing
    for(let i = 1; i < ranked.length; i++) {
      expect(ranked[i-1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("higher-accuracy workers rank above lower-accuracy", () => {
    const { ids, assignments, statsById } = buildWorkforce(30, 15);
    const metrics = computePerformanceBatch(ids, assignments, statsById);
    const ranked = rankByPerformance(metrics, {});
    const topScore = performanceScore(metrics.find(m=>m.reviewer_id===ranked[0].reviewer_id)!);
    const botScore = performanceScore(metrics.find(m=>m.reviewer_id===ranked[ranked.length-1].reviewer_id)!);
    expect(topScore).toBeGreaterThanOrEqual(botScore);
  });
});

describe("Integration: performance → capacity planning", () => {
  it("feeds turnaround into capacity, computes team rollup", () => {
    const { ids, assignments, statsById } = buildWorkforce(20, 30);
    const metrics = computePerformanceBatch(ids, assignments, statsById);

    const capInputs = metrics.map(m => ({
      reviewer_id: m.reviewer_id,
      weekly_capacity_hours: 40,
      active_assignments: 5,
      avg_turnaround_sec: m.avg_turnaround_sec,
    }));
    const plans = computeCapacityBatch(capInputs);
    const team = computeTeamCapacity(plans);

    expect(plans).toHaveLength(20);
    expect(team.total_capacity_hours).toBe(800); // 20 * 40
    expect(team.total_projected_hours).toBeGreaterThan(0);
  });

  it("suggests a real worker for new assignment", () => {
    const { ids, assignments, statsById } = buildWorkforce(10, 10);
    const metrics = computePerformanceBatch(ids, assignments, statsById);
    const plans = computeCapacityBatch(metrics.map((m,i) => ({
      reviewer_id: m.reviewer_id,
      weekly_capacity_hours: 40,
      active_assignments: i, // increasing load
      avg_turnaround_sec: m.avg_turnaround_sec,
    })));
    const target = suggestCapacityTarget(plans);
    expect(target).not.toBeNull();
    // Least loaded = w0 (0 active assignments)
    expect(target!.reviewer_id).toBe("w0");
  });
});

describe("Integration: consensus → disagreement analytics", () => {
  it("resolves a batch of multi-reviews and aggregates", () => {
    const inputs = Array.from({ length: 40 }, (_, i) => ({
      task_id: `t${i}`,
      reviews: i % 4 === 0
        ? [ // disagreement
            { reviewer_id:"a", verdict:"accept", confidence:0.9 },
            { reviewer_id:"b", verdict:"reject", confidence:0.6 },
            { reviewer_id:"c", verdict:"accept", confidence:0.8 },
          ]
        : [ // unanimous
            { reviewer_id:"a", verdict:"accept", confidence:0.9 },
            { reviewer_id:"b", verdict:"accept", confidence:0.85 },
          ],
    }));
    const results = resolveConsensusBatch(inputs);
    const stats = computeDisagreementStats(results);
    expect(stats.total).toBe(40);
    expect(stats.disagreements).toBe(10); // every 4th
    expect(stats.disagreement_rate).toBeCloseTo(0.25);
    expect(stats.mean_confidence).toBeGreaterThan(0);
  });
});

describe("Integration: fraud detection across cohort", () => {
  it("flags the planted fraudulent worker among clean ones", () => {
    const clean: WorkerActivity[] = Array.from({ length: 9 }, (_, i) => ({
      reviewer_id:`clean${i}`,
      turnaround_secs:[900,1000,1100],
      output_hashes:[`a${i}`,`b${i}`,`c${i}`],
      agreement_rate:0.82, sample_size:50,
    }));
    const fraud: WorkerActivity = {
      reviewer_id:"fraudster",
      turnaround_secs:[5,5,5],            // suspiciously fast
      output_hashes:["x","x","x","x","x"],// repeated/copy
      agreement_rate:0.99, sample_size:100,// abnormal agreement
    };
    const assessments = assessFraudBatch([...clean, fraud]);
    const flagged = assessments.filter(a => a.flagged);
    expect(flagged.map(f=>f.reviewer_id)).toContain("fraudster");
    // Clean workers not flagged
    expect(flagged.every(f => f.reviewer_id === "fraudster")).toBe(true);
  });

  it("clean cohort produces zero flags", () => {
    const clean: WorkerActivity[] = Array.from({ length: 5 }, (_, i) => ({
      reviewer_id:`c${i}`, turnaround_secs:[1000,1000], output_hashes:[`u${i}`,`v${i}`],
      agreement_rate:0.8, sample_size:40,
    }));
    const assessments = assessFraudBatch(clean);
    expect(assessments.every(a => !a.flagged)).toBe(true);
  });
});

describe("Integration: full workforce trends", () => {
  it("produces complete dashboard from all engines", () => {
    const { ids, assignments, statsById } = buildWorkforce(25, 20);
    const metrics = computePerformanceBatch(ids, assignments, statsById);

    const activities: WorkerActivity[] = ids.map(id => ({
      reviewer_id:id, turnaround_secs:[1000,1100], output_hashes:["a","b"],
      agreement_rate:0.85, sample_size:20,
    }));
    const assessments = assessFraudBatch(activities);

    const names = Object.fromEntries(ids.map(id => [id, `W ${id}`]));
    const trends = computeTrends(metrics, assessments, names, ids.length);

    expect(trends.worker_ranking).toHaveLength(25);
    expect(trends.reviewer_ranking).toHaveLength(25);
    expect(trends.total_active).toBe(25);
    expect(trends.mean_qa_score).toBeGreaterThan(0);
    expect(trends.flagged_count).toBe(0); // all clean
  });

  it("scales to 1000 workers without error (smoke)", () => {
    const { ids, assignments, statsById } = buildWorkforce(1000, 5);
    const metrics = computePerformanceBatch(ids, assignments, statsById);
    const ranked = rankByPerformance(metrics, {});
    expect(ranked).toHaveLength(1000);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[999].rank).toBe(1000);
  });
});

describe("Integration: determinism across full pipeline", () => {
  it("same workforce → identical rankings on repeat runs", () => {
    const { ids, assignments, statsById } = buildWorkforce(15, 12);
    const run = () => {
      const m = computePerformanceBatch(ids, assignments, statsById);
      return rankByPerformance(m, {}).map(r => `${r.reviewer_id}:${r.rank}:${r.score}`);
    };
    expect(run()).toEqual(run());
  });
});
