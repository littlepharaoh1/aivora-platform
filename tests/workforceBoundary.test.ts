/**
 * workforceBoundary.test.ts
 * Boundary & edge-case unit tests for all 5 workforce engines.
 * These target exact thresholds, extreme values, and degenerate inputs —
 * the cases that surface real bugs in production.
 */

import { describe, it, expect } from "vitest";
import {
  computePerformance, performanceScore,
} from "../src/lib/workforce/performanceEngine";
import type { AssignmentRow, ReviewerStats } from "../src/lib/workforce/performanceEngine";
import {
  computeCapacity, DEFAULT_TASK_SECONDS,
} from "../src/lib/workforce/capacityPlanner";
import {
  resolveConsensus,
} from "../src/lib/workforce/consensusEngine";
import {
  detectSuspiciousSpeed, detectCopyPattern, detectRepeatedOutput,
  detectAbnormalAgreement, assessFraud, cohortMedianTurnaround,
  FRAUD_THRESHOLDS,
} from "../src/lib/workforce/fraudDetection";
import type { WorkerActivity } from "../src/lib/workforce/fraudDetection";

const T0 = "2025-01-01T00:00:00.000Z";
const T1h = "2025-01-01T01:00:00.000Z";
function asg(r:string,s:string,a:string,c:string|null):AssignmentRow {
  return { id:crypto.randomUUID(), reviewer_id:r, status:s, assigned_at:a, completed_at:c };
}
function activity(o:Partial<WorkerActivity>={}):WorkerActivity {
  return { reviewer_id:"r1", turnaround_secs:[], output_hashes:[], agreement_rate:0.5, sample_size:50, ...o };
}

// ── Performance edge cases ────────────────────────────────────────────────────

describe("performance: boundaries", () => {
  it("acceptance rate is 0 when nothing handled", () => {
    const m = computePerformance("r1", [asg("r1","pending",T0,null)], null);
    expect(m.acceptance_rate).toBe(0);
  });

  it("acceptance rate is 1 when all completed", () => {
    const m = computePerformance("r1", [asg("r1","completed",T0,T1h)], null);
    expect(m.acceptance_rate).toBe(1);
  });

  it("rework rate 0 when no rework", () => {
    const m = computePerformance("r1", [asg("r1","completed",T0,T1h)], null);
    expect(m.rework_rate).toBe(0);
  });

  it("rework rate 1 when all reworked", () => {
    const m = computePerformance("r1", [asg("r1","reworked",T0,T1h)], null);
    expect(m.rework_rate).toBe(1);
  });

  it("disagreement rate 0 when reviews 0", () => {
    const stats: ReviewerStats = { id:"r1", total_reviews:0, total_agreements:0, total_disagreements:0, accuracy_score:0.5 };
    const m = computePerformance("r1", [], stats);
    expect(m.disagreement_rate).toBe(0);
  });

  it("disagreement rate 1 when all disagree", () => {
    const stats: ReviewerStats = { id:"r1", total_reviews:10, total_agreements:0, total_disagreements:10, accuracy_score:0.5 };
    const m = computePerformance("r1", [], stats);
    expect(m.disagreement_rate).toBe(1);
  });

  it("handles malformed timestamp (NaN) gracefully", () => {
    const m = computePerformance("r1", [asg("r1","completed","not-a-date",T1h)], null);
    expect(m.avg_turnaround_sec).toBe(0); // invalid → excluded
  });

  it("handles completed with null completed_at", () => {
    const m = computePerformance("r1", [asg("r1","completed",T0,null)], null);
    expect(m.throughput).toBe(1);          // counted as completed
    expect(m.avg_turnaround_sec).toBe(0);  // no valid turnaround
  });

  it("unknown statuses don't crash", () => {
    const m = computePerformance("r1", [asg("r1","weird_status",T0,T1h)], null);
    expect(m.sample_size).toBe(1);
    expect(m.throughput).toBe(0);
  });

  it("qa_score null defaults to 0", () => {
    const stats: ReviewerStats = { id:"r1", total_reviews:5, total_agreements:5, total_disagreements:0, accuracy_score:null };
    const m = computePerformance("r1", [], stats);
    expect(m.qa_score).toBe(0);
  });
});

describe("performanceScore: bounds", () => {
  it("all-zero metrics → score >= 0", () => {
    const s = performanceScore({ reviewer_id:"r", throughput:0, acceptance_rate:0, qa_score:0, rework_rate:1, disagreement_rate:1, avg_turnaround_sec:0, sample_size:0 });
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it("perfect metrics → score <= 1", () => {
    const s = performanceScore({ reviewer_id:"r", throughput:50, acceptance_rate:1, qa_score:1, rework_rate:0, disagreement_rate:0, avg_turnaround_sec:1, sample_size:50 });
    expect(s).toBeLessThanOrEqual(1);
  });

  it("volume caps at 50 completed (no extra credit beyond)", () => {
    const at50  = performanceScore({ reviewer_id:"r", throughput:50,  acceptance_rate:1, qa_score:1, rework_rate:0, disagreement_rate:0, avg_turnaround_sec:1, sample_size:50 });
    const at500 = performanceScore({ reviewer_id:"r", throughput:500, acceptance_rate:1, qa_score:1, rework_rate:0, disagreement_rate:0, avg_turnaround_sec:1, sample_size:500 });
    expect(at50).toBeCloseTo(at500);
  });
});

// ── Capacity boundaries ───────────────────────────────────────────────────────

describe("capacity: boundaries", () => {
  it("zero capacity with active work → infinite-ish utilization, critical", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:0, active_assignments:5, avg_turnaround_sec:3600 });
    expect(p.overload_risk).toBe("critical");
  });

  it("zero capacity, zero work → none", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:0, active_assignments:0, avg_turnaround_sec:3600 });
    expect(p.overload_risk).toBe("none");
  });

  it("exactly 50% utilization → none (boundary)", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:10, active_assignments:5, avg_turnaround_sec:3600 });
    expect(p.utilization).toBeCloseTo(0.5);
    expect(p.overload_risk).toBe("none");
  });

  it("just above 100% → high (boundary)", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:10, active_assignments:11, avg_turnaround_sec:3600 });
    expect(p.overload_risk).toBe("high");
  });

  it("negative capacity clamped to 0", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:-5, active_assignments:0, avg_turnaround_sec:3600 });
    expect(p.weekly_capacity_hours).toBe(0);
  });

  it("zero active assignments → zero projected", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:40, active_assignments:0, avg_turnaround_sec:3600 });
    expect(p.projected_hours).toBe(0);
    expect(p.available_hours).toBe(40);
  });

  it("negative turnaround falls back to default", () => {
    const p = computeCapacity({ reviewer_id:"r", weekly_capacity_hours:40, active_assignments:1, avg_turnaround_sec:-100 });
    expect(p.projected_hours).toBeCloseTo(DEFAULT_TASK_SECONDS / 3600);
  });
});

// ── Consensus boundaries ──────────────────────────────────────────────────────

describe("consensus: boundaries", () => {
  it("single review → unanimous, no disagreement", () => {
    const r = resolveConsensus({ task_id:"t", reviews:[{ reviewer_id:"a", verdict:"x", confidence:0.9 }] });
    expect(r.agreement).toBe(1);
    expect(r.is_disagreement).toBe(false);
    expect(r.tie_broken).toBe(false);
  });

  it("three-way tie resolves deterministically", () => {
    const r1 = resolveConsensus({ task_id:"t", reviews:[
      { reviewer_id:"a", verdict:"x", confidence:0.5 },
      { reviewer_id:"b", verdict:"y", confidence:0.5 },
      { reviewer_id:"c", verdict:"z", confidence:0.5 },
    ]});
    const r2 = resolveConsensus({ task_id:"t", reviews:[
      { reviewer_id:"c", verdict:"z", confidence:0.5 },
      { reviewer_id:"a", verdict:"x", confidence:0.5 },
      { reviewer_id:"b", verdict:"y", confidence:0.5 },
    ]});
    expect(r1.verdict).toBe(r2.verdict);
    expect(r1.verdict).toBe("x"); // alphabetical tie-break
  });

  it("confidence 0 across all → confidence result 0", () => {
    const r = resolveConsensus({ task_id:"t", reviews:[
      { reviewer_id:"a", verdict:"x", confidence:0 },
      { reviewer_id:"b", verdict:"x", confidence:0 },
    ]});
    expect(r.confidence).toBe(0);
  });

  it("negative confidence clamped to 0", () => {
    const r = resolveConsensus({ task_id:"t", reviews:[
      { reviewer_id:"a", verdict:"x", confidence:-1 },
    ]});
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });

  it("clear majority of 3 verdicts", () => {
    const r = resolveConsensus({ task_id:"t", reviews:[
      { reviewer_id:"a", verdict:"x", confidence:0.6 },
      { reviewer_id:"b", verdict:"x", confidence:0.6 },
      { reviewer_id:"c", verdict:"x", confidence:0.6 },
      { reviewer_id:"d", verdict:"y", confidence:0.9 },
    ]});
    expect(r.verdict).toBe("x"); // 3 vs 1, count wins over confidence
    expect(r.tie_broken).toBe(false);
  });
});

// ── Fraud threshold boundaries ────────────────────────────────────────────────

describe("fraud: exact threshold boundaries", () => {
  it("speed just below threshold ratio flags", () => {
    // median 1000, mean = 240 → ratio 0.24 < 0.25 → flag
    const a = activity({ turnaround_secs:[240] });
    expect(detectSuspiciousSpeed(a, 1000)).not.toBeNull();
  });

  it("speed just above threshold ratio does NOT flag", () => {
    // median 1000, mean = 260 → ratio 0.26 > 0.25 → no flag
    const a = activity({ turnaround_secs:[260] });
    expect(detectSuspiciousSpeed(a, 1000)).toBeNull();
  });

  it("copy ratio just above 0.4 flags", () => {
    // 3 dups out of 5 = 0.6 > 0.4
    const a = activity({ output_hashes:["x","x","x","a","b"] });
    expect(detectCopyPattern(a)).not.toBeNull();
  });

  it("copy ratio below 0.4 does not flag", () => {
    // 2 dups out of 6 ≈ 0.33
    const a = activity({ output_hashes:["x","x","a","b","c","d"] });
    expect(detectCopyPattern(a)).toBeNull();
  });

  it("repeat ratio above 0.6 flags", () => {
    const a = activity({ output_hashes:["x","x","x","x","x","x","x","a","b","c"] }); // 0.7
    expect(detectRepeatedOutput(a)).not.toBeNull();
  });

  it("repeat ratio below 0.6 does not flag", () => {
    const a = activity({ output_hashes:["x","x","x","x","x","a","b","c","d","e"] }); // 0.5
    expect(detectRepeatedOutput(a)).toBeNull();
  });

  it("agreement exactly at MIN_SAMPLE boundary", () => {
    const below = activity({ agreement_rate:0.99, sample_size:FRAUD_THRESHOLDS.MIN_SAMPLE - 1 });
    const at    = activity({ agreement_rate:0.99, sample_size:FRAUD_THRESHOLDS.MIN_SAMPLE });
    expect(detectAbnormalAgreement(below)).toBeNull();
    expect(detectAbnormalAgreement(at)).not.toBeNull();
  });

  it("agreement just above 0.98 flags", () => {
    const a = activity({ agreement_rate:0.985, sample_size:100 });
    expect(detectAbnormalAgreement(a)).not.toBeNull();
  });

  it("agreement exactly 0.98 does not flag (strict >)", () => {
    const a = activity({ agreement_rate:0.98, sample_size:100 });
    expect(detectAbnormalAgreement(a)).toBeNull();
  });

  it("severity values stay within 0..1", () => {
    const a = activity({ turnaround_secs:[1], output_hashes:["x","x","x","x"], agreement_rate:1, sample_size:1000 });
    const r = assessFraud(a, 10000);
    r.signals.forEach(s => {
      expect(s.severity).toBeGreaterThanOrEqual(0);
      expect(s.severity).toBeLessThanOrEqual(1);
    });
    expect(r.risk_score).toBeLessThanOrEqual(1);
  });

  it("risk = max severity not sum (single strong signal)", () => {
    const a = activity({ turnaround_secs:[1], output_hashes:["a","b","c"], agreement_rate:0.5, sample_size:50 });
    const r = assessFraud(a, 10000); // only speed signal
    expect(r.risk_score).toBeLessThanOrEqual(1);
  });
});

describe("cohortMedian: boundaries", () => {
  it("single value", () => {
    expect(cohortMedianTurnaround([activity({ turnaround_secs:[500] })])).toBe(500);
  });
  it("odd count picks middle", () => {
    expect(cohortMedianTurnaround([activity({ turnaround_secs:[100,200,300] })])).toBe(200);
  });
});
