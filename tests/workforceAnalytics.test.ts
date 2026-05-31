/**
 * workforceAnalytics.test.ts
 * Workforce Analytics + worker assembly — unit tests
 */

import { describe, it, expect } from "vitest";
import {
  rankByPerformance, rankReviewers, computeTrends, percentile,
} from "../src/lib/workforce/workforceAnalytics";
import { assembleWorkers, skillCoverage } from "../src/lib/workforce/workerService";
import { SKILL_TYPES } from "../src/lib/workforce/workforceTypes";
import type {
  PerformanceMetrics, FraudAssessment, WorkerIdentity,
  WorkerCapabilities, WorkerSkill,
} from "../src/lib/workforce/workforceTypes";

function metrics(id: string, over: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    reviewer_id:id, throughput:10, acceptance_rate:0.9, qa_score:0.85,
    rework_rate:0.1, disagreement_rate:0.15, avg_turnaround_sec:600, sample_size:10, ...over,
  };
}

// ── Rankings ──────────────────────────────────────────────────────────────────

describe("rankByPerformance", () => {
  it("ranks higher performers first", () => {
    const m = [
      metrics("low",  { qa_score:0.3, acceptance_rate:0.4, rework_rate:0.5 }),
      metrics("high", { qa_score:1.0, acceptance_rate:1.0, rework_rate:0.0 }),
    ];
    const ranked = rankByPerformance(m, { low:"Low", high:"High" });
    expect(ranked[0].reviewer_id).toBe("high");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("uses names when provided", () => {
    const ranked = rankByPerformance([metrics("r1")], { r1:"Alice" });
    expect(ranked[0].name).toBe("Alice");
  });

  it("falls back to id when name missing", () => {
    const ranked = rankByPerformance([metrics("r1")], {});
    expect(ranked[0].name).toBe("r1");
  });

  it("tie-break deterministic by reviewer_id", () => {
    const m = [metrics("zzz"), metrics("aaa")]; // identical scores
    const ranked = rankByPerformance(m, {});
    expect(ranked[0].reviewer_id).toBe("aaa"); // alphabetical
  });

  it("assigns sequential ranks", () => {
    const m = [metrics("a"), metrics("b"), metrics("c")];
    const ranked = rankByPerformance(m, {});
    expect(ranked.map(r=>r.rank)).toEqual([1,2,3]);
  });

  it("handles empty input", () => {
    expect(rankByPerformance([], {})).toEqual([]);
  });
});

describe("rankReviewers", () => {
  it("weights QA score heavily", () => {
    const m = [
      metrics("highQA", { qa_score:1.0, disagreement_rate:0.0 }),
      metrics("lowQA",  { qa_score:0.2, disagreement_rate:0.5 }),
    ];
    const ranked = rankReviewers(m, {});
    expect(ranked[0].reviewer_id).toBe("highQA");
  });

  it("is deterministic", () => {
    const m = [metrics("a"), metrics("b")];
    expect(rankReviewers(m, {})).toEqual(rankReviewers(m, {}));
  });
});

describe("computeTrends", () => {
  it("computes means and flagged count", () => {
    const m = [metrics("a", { qa_score:0.8, throughput:10 }), metrics("b", { qa_score:0.9, throughput:20 })];
    const assessments: FraudAssessment[] = [
      { reviewer_id:"a", signals:[], risk_score:0, flagged:false },
      { reviewer_id:"b", signals:[], risk_score:0.7, flagged:true },
    ];
    const t = computeTrends(m, assessments, {}, 2);
    expect(t.mean_qa_score).toBeCloseTo(0.85);
    expect(t.mean_throughput).toBeCloseTo(15);
    expect(t.flagged_count).toBe(1);
    expect(t.total_active).toBe(2);
  });

  it("produces both rankings", () => {
    const m = [metrics("a"), metrics("b")];
    const t = computeTrends(m, [], {}, 2);
    expect(t.worker_ranking).toHaveLength(2);
    expect(t.reviewer_ranking).toHaveLength(2);
  });

  it("handles empty metrics", () => {
    const t = computeTrends([], [], {}, 0);
    expect(t.mean_qa_score).toBe(0);
    expect(t.worker_ranking).toEqual([]);
  });
});

describe("percentile", () => {
  it("computes median (p50)", () => {
    expect(percentile([1,2,3,4,5], 0.5)).toBe(3);
  });

  it("computes p90", () => {
    expect(percentile([1,2,3,4,5,6,7,8,9,10], 0.9)).toBe(9);
  });

  it("handles empty", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("is order-independent", () => {
    expect(percentile([5,1,3,2,4], 0.5)).toBe(percentile([1,2,3,4,5], 0.5));
  });
});

// ── Worker assembly ───────────────────────────────────────────────────────────

function identity(id: string): WorkerIdentity {
  return {
    id, name:`W-${id}`, email:`${id}@x.com`, role:"operator", is_active:true,
    accuracy_score:0.9, consensus_score:0.85, avg_latency_seconds:600,
    total_reviews:100, total_agreements:80, total_disagreements:20, total_escalations:5,
    fraud_flags_count:0, fast_completions:2, overwrite_count:1,
    last_active_at:null, last_review_at:null,
  };
}

function cap(id: string): WorkerCapabilities {
  return {
    id:`c-${id}`, reviewer_id:id, languages:["ar","en"], certifications:[],
    availability:"available", weekly_capacity_hours:40, timezone:"UTC", notes:"",
    created_at:"", updated_at:"",
  };
}

function skill(id: string, type: WorkerSkill["skill_type"], prof: number): WorkerSkill {
  return {
    id:crypto.randomUUID(), reviewer_id:id, skill_type:type, proficiency:prof,
    validation_count:0, last_validated_at:null, created_at:"", updated_at:"",
  };
}

describe("assembleWorkers", () => {
  it("joins identity + capabilities + skills", () => {
    const workers = assembleWorkers(
      [identity("r1")],
      [cap("r1")],
      [skill("r1","image",0.8), skill("r1","video",0.6)],
    );
    expect(workers).toHaveLength(1);
    expect(workers[0].capabilities?.weekly_capacity_hours).toBe(40);
    expect(workers[0].skills).toHaveLength(2);
  });

  it("handles worker with no capabilities", () => {
    const workers = assembleWorkers([identity("r1")], [], []);
    expect(workers[0].capabilities).toBeNull();
    expect(workers[0].skills).toEqual([]);
  });

  it("matches skills to correct worker", () => {
    const workers = assembleWorkers(
      [identity("r1"), identity("r2")],
      [],
      [skill("r1","image",0.8), skill("r2","ocr",0.5)],
    );
    expect(workers.find(w=>w.identity.id==="r1")!.skills[0].skill_type).toBe("image");
    expect(workers.find(w=>w.identity.id==="r2")!.skills[0].skill_type).toBe("ocr");
  });
});

describe("skillCoverage", () => {
  it("returns all 6 skill types", () => {
    const cov = skillCoverage([]);
    expect(Object.keys(cov).sort()).toEqual([...SKILL_TYPES].sort());
  });

  it("sets proficiency for present skills, 0 for absent", () => {
    const cov = skillCoverage([skill("r1","image",0.8)]);
    expect(cov.image).toBe(0.8);
    expect(cov.video).toBe(0);
  });
});
