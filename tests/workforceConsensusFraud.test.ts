/**
 * workforceConsensusFraud.test.ts
 * Consensus Engine + Fraud Detection — unit tests
 */

import { describe, it, expect } from "vitest";
import {
  resolveConsensus, resolveConsensusBatch, computeDisagreementStats,
} from "../src/lib/workforce/consensusEngine";
import {
  detectSuspiciousSpeed, detectCopyPattern, detectRepeatedOutput,
  detectAbnormalAgreement, assessFraud, assessFraudBatch,
  cohortMedianTurnaround, FRAUD_THRESHOLDS,
} from "../src/lib/workforce/fraudDetection";
import type { WorkerActivity } from "../src/lib/workforce/fraudDetection";

// ── Consensus Engine ──────────────────────────────────────────────────────────

describe("resolveConsensus", () => {
  it("resolves unanimous agreement", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[
      { reviewer_id:"a", verdict:"accept", confidence:0.9 },
      { reviewer_id:"b", verdict:"accept", confidence:0.8 },
    ]});
    expect(r.verdict).toBe("accept");
    expect(r.agreement).toBe(1);
    expect(r.is_disagreement).toBe(false);
  });

  it("detects disagreement (majority wins)", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[
      { reviewer_id:"a", verdict:"accept", confidence:0.9 },
      { reviewer_id:"b", verdict:"accept", confidence:0.8 },
      { reviewer_id:"c", verdict:"reject", confidence:0.7 },
    ]});
    expect(r.verdict).toBe("accept");
    expect(r.is_disagreement).toBe(true);
    expect(r.agreement).toBeCloseTo(2/3);
  });

  it("breaks ties deterministically", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[
      { reviewer_id:"a", verdict:"accept", confidence:0.5 },
      { reviewer_id:"b", verdict:"reject", confidence:0.5 },
    ]});
    expect(r.tie_broken).toBe(true);
    expect(r.verdict).not.toBeNull();
  });

  it("tie-break is order-independent (deterministic)", () => {
    const reviews1 = [
      { reviewer_id:"a", verdict:"accept", confidence:0.5 },
      { reviewer_id:"b", verdict:"reject", confidence:0.5 },
    ];
    const reviews2 = [...reviews1].reverse();
    const r1 = resolveConsensus({ task_id:"t1", reviews:reviews1 });
    const r2 = resolveConsensus({ task_id:"t1", reviews:reviews2 });
    expect(r1.verdict).toBe(r2.verdict);
  });

  it("higher confidence breaks ties when counts equal", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[
      { reviewer_id:"a", verdict:"accept", confidence:0.9 },
      { reviewer_id:"b", verdict:"reject", confidence:0.3 },
    ]});
    expect(r.verdict).toBe("accept"); // higher weight wins
  });

  it("handles empty reviews", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[] });
    expect(r.verdict).toBeNull();
    expect(r.review_count).toBe(0);
  });

  it("clamps confidence to 0..1", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[
      { reviewer_id:"a", verdict:"accept", confidence:5 },
    ]});
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("computes weighted confidence dampened by agreement", () => {
    const r = resolveConsensus({ task_id:"t1", reviews:[
      { reviewer_id:"a", verdict:"accept", confidence:1.0 },
      { reviewer_id:"b", verdict:"accept", confidence:1.0 },
      { reviewer_id:"c", verdict:"reject", confidence:1.0 },
    ]});
    // mean_conf of accept = 1.0, agreement = 2/3 → confidence ≈ 0.667
    expect(r.confidence).toBeCloseTo(2/3, 1);
  });
});

describe("computeDisagreementStats", () => {
  it("aggregates disagreement rate across batch", () => {
    const results = resolveConsensusBatch([
      { task_id:"t1", reviews:[{reviewer_id:"a",verdict:"x",confidence:1},{reviewer_id:"b",verdict:"x",confidence:1}] },
      { task_id:"t2", reviews:[{reviewer_id:"a",verdict:"x",confidence:1},{reviewer_id:"b",verdict:"y",confidence:1}] },
    ]);
    const stats = computeDisagreementStats(results);
    expect(stats.total).toBe(2);
    expect(stats.disagreements).toBe(1);
    expect(stats.disagreement_rate).toBeCloseTo(0.5);
  });

  it("handles empty batch", () => {
    const stats = computeDisagreementStats([]);
    expect(stats.total).toBe(0);
    expect(stats.disagreement_rate).toBe(0);
  });
});

// ── Fraud Detection ───────────────────────────────────────────────────────────

function activity(over: Partial<WorkerActivity> = {}): WorkerActivity {
  return {
    reviewer_id:"r1", turnaround_secs:[], output_hashes:[],
    agreement_rate:0.5, sample_size:50, ...over,
  };
}

describe("detectSuspiciousSpeed", () => {
  it("flags worker far faster than cohort median", () => {
    const a = activity({ turnaround_secs:[10,10,10] });
    const s = detectSuspiciousSpeed(a, 1000); // median 1000s, worker ~10s
    expect(s).not.toBeNull();
    expect(s!.signal).toBe("suspicious_speed");
  });

  it("does not flag normal speed", () => {
    const a = activity({ turnaround_secs:[900,1000,1100] });
    expect(detectSuspiciousSpeed(a, 1000)).toBeNull();
  });

  it("returns null with no data", () => {
    expect(detectSuspiciousSpeed(activity(), 1000)).toBeNull();
  });
});

describe("detectCopyPattern", () => {
  it("flags high duplicate ratio", () => {
    const a = activity({ output_hashes:["x","x","x","y","x"] }); // 4/5 dup
    const s = detectCopyPattern(a);
    expect(s).not.toBeNull();
    expect(s!.signal).toBe("copy_pattern");
  });

  it("does not flag unique outputs", () => {
    const a = activity({ output_hashes:["a","b","c","d"] });
    expect(detectCopyPattern(a)).toBeNull();
  });
});

describe("detectRepeatedOutput", () => {
  it("flags single output dominating", () => {
    const a = activity({ output_hashes:["x","x","x","x","x","x","x","y","z","w"] }); // 7/10
    const s = detectRepeatedOutput(a);
    expect(s).not.toBeNull();
    expect(s!.signal).toBe("repeated_output");
  });
});

describe("detectAbnormalAgreement", () => {
  it("flags abnormally high agreement over large sample", () => {
    const a = activity({ agreement_rate:0.99, sample_size:100 });
    const s = detectAbnormalAgreement(a);
    expect(s).not.toBeNull();
    expect(s!.signal).toBe("abnormal_agreement");
  });

  it("does not flag small samples", () => {
    const a = activity({ agreement_rate:1.0, sample_size:5 });
    expect(detectAbnormalAgreement(a)).toBeNull();
  });

  it("does not flag normal agreement", () => {
    const a = activity({ agreement_rate:0.85, sample_size:100 });
    expect(detectAbnormalAgreement(a)).toBeNull();
  });
});

describe("assessFraud", () => {
  it("aggregates signals with max severity", () => {
    const a = activity({ turnaround_secs:[5,5], output_hashes:["x","x","x"], agreement_rate:0.99, sample_size:100 });
    const r = assessFraud(a, 1000);
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.flagged).toBe(true);
  });

  it("clean worker not flagged", () => {
    const a = activity({ turnaround_secs:[1000,1100], output_hashes:["a","b","c"], agreement_rate:0.8, sample_size:50 });
    const r = assessFraud(a, 1000);
    expect(r.flagged).toBe(false);
    expect(r.risk_score).toBe(0);
  });

  it("is deterministic", () => {
    const a = activity({ turnaround_secs:[5,5], output_hashes:["x","x"] });
    expect(assessFraud(a, 1000)).toEqual(assessFraud(a, 1000));
  });
});

describe("cohortMedianTurnaround", () => {
  it("computes median across all workers", () => {
    const acts = [activity({ turnaround_secs:[100,200] }), activity({ turnaround_secs:[300,400] })];
    expect(cohortMedianTurnaround(acts)).toBe(250); // [100,200,300,400] → (200+300)/2
  });

  it("returns 0 for no data", () => {
    expect(cohortMedianTurnaround([])).toBe(0);
  });
});

describe("assessFraudBatch", () => {
  it("assesses all workers against shared cohort median", () => {
    const acts = [
      activity({ reviewer_id:"fast", turnaround_secs:[5,5] }),
      activity({ reviewer_id:"normal", turnaround_secs:[1000,1000] }),
    ];
    const out = assessFraudBatch(acts);
    expect(out).toHaveLength(2);
  });
});
