/**
 * workforcePerformance.test.ts
 * Performance Engine + Capacity Planner — unit tests
 */

import { describe, it, expect } from "vitest";
import {
  computePerformance, computePerformanceBatch, performanceScore,
} from "../src/lib/workforce/performanceEngine";
import type { AssignmentRow, ReviewerStats } from "../src/lib/workforce/performanceEngine";
import {
  computeCapacity, computeCapacityBatch, suggestCapacityTarget,
  computeTeamCapacity, DEFAULT_TASK_SECONDS,
} from "../src/lib/workforce/capacityPlanner";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function asg(reviewer: string, status: string, assigned: string, completed: string|null): AssignmentRow {
  return { id: crypto.randomUUID(), reviewer_id: reviewer, status, assigned_at: assigned, completed_at: completed };
}

const T0 = "2025-01-01T00:00:00.000Z";
const T1h = "2025-01-01T01:00:00.000Z";  // +1 hour
const T2h = "2025-01-01T02:00:00.000Z";  // +2 hours

// ── Performance Engine ────────────────────────────────────────────────────────

describe("computePerformance", () => {
  it("counts completed throughput", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r1","completed",T0,T1h), asg("r1","pending",T0,null)];
    const m = computePerformance("r1", a, null);
    expect(m.throughput).toBe(2);
  });

  it("computes acceptance rate (completed / handled)", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r1","completed",T0,T1h), asg("r1","rejected",T0,null)];
    const m = computePerformance("r1", a, null);
    expect(m.acceptance_rate).toBeCloseTo(2/3);
  });

  it("computes rework rate", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r1","reworked",T0,T1h)];
    const m = computePerformance("r1", a, null);
    expect(m.rework_rate).toBeCloseTo(0.5);
  });

  it("computes average turnaround in seconds", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r1","completed",T0,T2h)];
    const m = computePerformance("r1", a, null);
    expect(m.avg_turnaround_sec).toBeCloseTo((3600 + 7200) / 2);
  });

  it("uses reviewer stats for qa_score and disagreement", () => {
    const stats: ReviewerStats = { id:"r1", total_reviews:100, total_agreements:80, total_disagreements:20, accuracy_score:0.9 };
    const m = computePerformance("r1", [], stats);
    expect(m.qa_score).toBe(0.9);
    expect(m.disagreement_rate).toBeCloseTo(0.2);
  });

  it("handles reviewer with no data", () => {
    const m = computePerformance("ghost", [], null);
    expect(m.throughput).toBe(0);
    expect(m.acceptance_rate).toBe(0);
    expect(m.qa_score).toBe(0);
  });

  it("ignores assignments from other reviewers", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r2","completed",T0,T1h)];
    const m = computePerformance("r1", a, null);
    expect(m.throughput).toBe(1);
  });

  it("ignores invalid turnaround (completed before assigned)", () => {
    const a = [asg("r1","completed",T1h,T0)]; // completed < assigned
    const m = computePerformance("r1", a, null);
    expect(m.avg_turnaround_sec).toBe(0);
  });

  it("is deterministic", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r1","rejected",T0,null)];
    expect(computePerformance("r1", a, null)).toEqual(computePerformance("r1", a, null));
  });
});

describe("computePerformanceBatch", () => {
  it("computes for multiple reviewers", () => {
    const a = [asg("r1","completed",T0,T1h), asg("r2","completed",T0,T1h), asg("r2","completed",T0,T1h)];
    const out = computePerformanceBatch(["r1","r2"], a, new Map());
    expect(out.find(m=>m.reviewer_id==="r1")!.throughput).toBe(1);
    expect(out.find(m=>m.reviewer_id==="r2")!.throughput).toBe(2);
  });

  it("handles 10k assignments efficiently (smoke)", () => {
    const big: AssignmentRow[] = [];
    for(let i=0;i<10000;i++) big.push(asg(`r${i%100}`,"completed",T0,T1h));
    const ids = Array.from({length:100},(_,i)=>`r${i}`);
    const out = computePerformanceBatch(ids, big, new Map());
    expect(out).toHaveLength(100);
    expect(out[0].throughput).toBe(100); // 10000/100
  });
});

describe("performanceScore", () => {
  it("returns higher score for better metrics", () => {
    const good = performanceScore({ reviewer_id:"a", throughput:50, acceptance_rate:1, qa_score:1, rework_rate:0, disagreement_rate:0, avg_turnaround_sec:100, sample_size:50 });
    const bad  = performanceScore({ reviewer_id:"b", throughput:1, acceptance_rate:0.2, qa_score:0.3, rework_rate:0.8, disagreement_rate:0.7, avg_turnaround_sec:100, sample_size:5 });
    expect(good).toBeGreaterThan(bad);
  });

  it("is bounded 0..1", () => {
    const max = performanceScore({ reviewer_id:"a", throughput:1000, acceptance_rate:1, qa_score:1, rework_rate:0, disagreement_rate:0, avg_turnaround_sec:1, sample_size:1000 });
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThanOrEqual(0);
  });
});

// ── Capacity Planner ──────────────────────────────────────────────────────────

describe("computeCapacity", () => {
  it("computes projected hours from active assignments", () => {
    // 4 active tasks * 3600s = 4 hours
    const p = computeCapacity({ reviewer_id:"r1", weekly_capacity_hours:40, active_assignments:4, avg_turnaround_sec:3600 });
    expect(p.projected_hours).toBeCloseTo(4);
  });

  it("uses default task seconds when no turnaround history", () => {
    const p = computeCapacity({ reviewer_id:"r1", weekly_capacity_hours:40, active_assignments:2, avg_turnaround_sec:0 });
    expect(p.projected_hours).toBeCloseTo((2 * DEFAULT_TASK_SECONDS) / 3600);
  });

  it("computes utilization", () => {
    const p = computeCapacity({ reviewer_id:"r1", weekly_capacity_hours:10, active_assignments:10, avg_turnaround_sec:3600 });
    expect(p.utilization).toBeCloseTo(1.0); // 10h projected / 10h capacity
  });

  it("classifies overload risk none/low/medium/high/critical", () => {
    const mk = (active:number) => computeCapacity({ reviewer_id:"r", weekly_capacity_hours:10, active_assignments:active, avg_turnaround_sec:3600 }).overload_risk;
    expect(mk(4)).toBe("none");      // 0.4
    expect(mk(7)).toBe("low");       // 0.7
    expect(mk(10)).toBe("medium");   // 1.0
    expect(mk(12)).toBe("high");     // 1.2
    expect(mk(20)).toBe("critical"); // 2.0
  });

  it("computes available hours (can be negative)", () => {
    const p = computeCapacity({ reviewer_id:"r1", weekly_capacity_hours:5, active_assignments:10, avg_turnaround_sec:3600 });
    expect(p.available_hours).toBeLessThan(0);
  });

  it("is deterministic", () => {
    const input = { reviewer_id:"r1", weekly_capacity_hours:40, active_assignments:5, avg_turnaround_sec:1800 };
    expect(computeCapacity(input)).toEqual(computeCapacity(input));
  });
});

describe("suggestCapacityTarget", () => {
  it("picks least-utilized with spare capacity", () => {
    const plans = computeCapacityBatch([
      { reviewer_id:"busy", weekly_capacity_hours:10, active_assignments:9, avg_turnaround_sec:3600 },
      { reviewer_id:"free", weekly_capacity_hours:10, active_assignments:2, avg_turnaround_sec:3600 },
    ]);
    expect(suggestCapacityTarget(plans)?.reviewer_id).toBe("free");
  });

  it("returns null when all critical", () => {
    const plans = computeCapacityBatch([
      { reviewer_id:"r1", weekly_capacity_hours:1, active_assignments:50, avg_turnaround_sec:3600 },
    ]);
    expect(suggestCapacityTarget(plans)).toBeNull();
  });
});

describe("computeTeamCapacity", () => {
  it("rolls up team utilization", () => {
    const plans = computeCapacityBatch([
      { reviewer_id:"r1", weekly_capacity_hours:10, active_assignments:5, avg_turnaround_sec:3600 },
      { reviewer_id:"r2", weekly_capacity_hours:10, active_assignments:5, avg_turnaround_sec:3600 },
    ]);
    const team = computeTeamCapacity(plans);
    expect(team.total_capacity_hours).toBe(20);
    expect(team.total_projected_hours).toBeCloseTo(10);
    expect(team.team_utilization).toBeCloseTo(0.5);
  });
});
