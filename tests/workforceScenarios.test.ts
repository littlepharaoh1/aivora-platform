/**
 * workforceScenarios.test.ts
 * Extended cross-engine integration scenarios — production-shaped flows.
 * In-memory composition of all engines.
 */

import { describe, it, expect } from "vitest";
import {
  computePerformance, computePerformanceBatch, performanceScore,
} from "../src/lib/workforce/performanceEngine";
import type { AssignmentRow, ReviewerStats } from "../src/lib/workforce/performanceEngine";
import {
  computeCapacity, computeCapacityBatch, computeTeamCapacity, suggestCapacityTarget,
} from "../src/lib/workforce/capacityPlanner";
import {
  resolveConsensus, resolveConsensusBatch, computeDisagreementStats,
} from "../src/lib/workforce/consensusEngine";
import {
  assessFraudBatch, cohortMedianTurnaround,
} from "../src/lib/workforce/fraudDetection";
import type { WorkerActivity } from "../src/lib/workforce/fraudDetection";
import {
  computeTrends, rankByPerformance, rankReviewers, percentile,
} from "../src/lib/workforce/workforceAnalytics";
import { assembleWorkers, skillCoverage } from "../src/lib/workforce/workerService";
import type { WorkerIdentity, WorkerCapabilities, WorkerSkill } from "../src/lib/workforce/workforceTypes";

const HOUR = 3600 * 1000;
const BASE = Date.parse("2025-01-01T00:00:00.000Z");
const iso = (off:number) => new Date(BASE + off).toISOString();

function asg(r:string,s:string,assignedOff:number,durOff:number|null):AssignmentRow {
  return { id:crypto.randomUUID(), reviewer_id:r, status:s,
    assigned_at:iso(assignedOff), completed_at:durOff===null?null:iso(assignedOff+durOff) };
}
function stats(id:string,rev:number,dis:number,acc:number):ReviewerStats {
  return { id, total_reviews:rev, total_agreements:rev-dis, total_disagreements:dis, accuracy_score:acc };
}
function act(o:Partial<WorkerActivity>={}):WorkerActivity {
  return { reviewer_id:"r", turnaround_secs:[], output_hashes:[], agreement_rate:0.5, sample_size:50, ...o };
}

// ── Scenario 1: New project staffing ──────────────────────────────────────────

describe("Scenario: staffing a new project", () => {
  it("ranks candidates and picks the best available", () => {
    const ids = ["alice","bob","carol","dave"];
    const a: AssignmentRow[] = [
      ...Array(20).fill(0).map((_,i)=>asg("alice","completed",i*HOUR,HOUR)),
      ...Array(10).fill(0).map((_,i)=>asg("bob","completed",i*HOUR,2*HOUR)),
      ...Array(5).fill(0).map((_,i)=>asg("carol","completed",i*HOUR,HOUR)),
    ];
    const s = new Map([
      ["alice",stats("alice",20,1,0.95)],
      ["bob",stats("bob",10,3,0.80)],
      ["carol",stats("carol",5,0,0.90)],
      ["dave",stats("dave",0,0,0)],
    ]);
    const metrics = computePerformanceBatch(ids, a, s);
    const ranked = rankByPerformance(metrics, {});
    expect(ranked[0].reviewer_id).toBe("alice"); // best all-round
  });

  it("balances load: most-loaded excluded from suggestion", () => {
    const plans = computeCapacityBatch([
      { reviewer_id:"alice", weekly_capacity_hours:40, active_assignments:38, avg_turnaround_sec:3600 },
      { reviewer_id:"bob",   weekly_capacity_hours:40, active_assignments:5,  avg_turnaround_sec:3600 },
    ]);
    expect(suggestCapacityTarget(plans)?.reviewer_id).toBe("bob");
  });
});

// ── Scenario 2: QA review round with disagreements ────────────────────────────

describe("Scenario: multi-reviewer QA round", () => {
  it("resolves 100 tasks and reports disagreement rate", () => {
    const inputs = Array.from({length:100},(_,i)=>({
      task_id:`task${i}`,
      reviews: i % 5 === 0
        ? [{reviewer_id:"a",verdict:"accept",confidence:0.8},{reviewer_id:"b",verdict:"reject",confidence:0.7},{reviewer_id:"c",verdict:"accept",confidence:0.9}]
        : [{reviewer_id:"a",verdict:"accept",confidence:0.9},{reviewer_id:"b",verdict:"accept",confidence:0.85}],
    }));
    const results = resolveConsensusBatch(inputs);
    const stat = computeDisagreementStats(results);
    expect(stat.total).toBe(100);
    expect(stat.disagreements).toBe(20);
    expect(stat.disagreement_rate).toBeCloseTo(0.2);
    // All disagreements still resolved to a verdict (majority)
    expect(stat.unresolved).toBe(0);
  });

  it("escalation candidates = low-confidence disagreements", () => {
    const results = resolveConsensusBatch([
      { task_id:"t1", reviews:[{reviewer_id:"a",verdict:"x",confidence:0.5},{reviewer_id:"b",verdict:"y",confidence:0.5}] },
      { task_id:"t2", reviews:[{reviewer_id:"a",verdict:"x",confidence:0.9},{reviewer_id:"b",verdict:"x",confidence:0.9}] },
    ]);
    const escalate = results.filter(r => r.is_disagreement || r.confidence < 0.3);
    expect(escalate.map(r=>r.task_id)).toContain("t1");
    expect(escalate.map(r=>r.task_id)).not.toContain("t2");
  });
});

// ── Scenario 3: fraud sweep + re-ranking ──────────────────────────────────────

describe("Scenario: fraud sweep then re-rank clean workers", () => {
  it("removes flagged workers before ranking", () => {
    const ids = ["good1","good2","fraud1"];
    const a = [
      ...Array(15).fill(0).map((_,i)=>asg("good1","completed",i*HOUR,HOUR)),
      ...Array(15).fill(0).map((_,i)=>asg("good2","completed",i*HOUR,HOUR)),
      ...Array(15).fill(0).map((_,i)=>asg("fraud1","completed",i*HOUR,HOUR)),
    ];
    const s = new Map([
      ["good1",stats("good1",15,2,0.9)],
      ["good2",stats("good2",15,3,0.85)],
      ["fraud1",stats("fraud1",100,0,0.99)],
    ]);
    const activities = [
      act({reviewer_id:"good1",turnaround_secs:[3600,3600],output_hashes:["a","b","c"],agreement_rate:0.87,sample_size:15}),
      act({reviewer_id:"good2",turnaround_secs:[3600,3600],output_hashes:["d","e","f"],agreement_rate:0.80,sample_size:15}),
      act({reviewer_id:"fraud1",turnaround_secs:[2,2],output_hashes:["x","x","x","x"],agreement_rate:0.99,sample_size:100}),
    ];
    const fraud = assessFraudBatch(activities);
    const flaggedIds = new Set(fraud.filter(f=>f.flagged).map(f=>f.reviewer_id));
    expect(flaggedIds.has("fraud1")).toBe(true);

    const cleanIds = ids.filter(id=>!flaggedIds.has(id));
    const metrics = computePerformanceBatch(cleanIds, a, s);
    const ranked = rankByPerformance(metrics, {});
    expect(ranked.map(r=>r.reviewer_id)).not.toContain("fraud1");
    expect(ranked).toHaveLength(2);
  });
});

// ── Scenario 4: capacity overload cascade ─────────────────────────────────────

describe("Scenario: capacity overload across team", () => {
  it("detects team-wide overload and counts at-risk workers", () => {
    const plans = computeCapacityBatch(
      Array.from({length:10},(_,i)=>({
        reviewer_id:`w${i}`, weekly_capacity_hours:40,
        active_assignments: 30 + i*5, // escalating overload
        avg_turnaround_sec:3600,
      }))
    );
    const team = computeTeamCapacity(plans);
    expect(team.overloaded_count).toBeGreaterThan(0);
    expect(team.team_utilization).toBeGreaterThan(0.5);
  });

  it("redistribution target found when some have spare", () => {
    const plans = computeCapacityBatch([
      { reviewer_id:"overloaded", weekly_capacity_hours:40, active_assignments:50, avg_turnaround_sec:3600 },
      { reviewer_id:"spare",      weekly_capacity_hours:40, active_assignments:3,  avg_turnaround_sec:3600 },
    ]);
    expect(suggestCapacityTarget(plans)?.reviewer_id).toBe("spare");
  });
});

// ── Scenario 5: skill-based worker assembly ───────────────────────────────────

function ident(id:string,acc:number):WorkerIdentity {
  return { id, name:`W-${id}`, email:`${id}@x.com`, role:"operator", is_active:true,
    accuracy_score:acc, consensus_score:acc, avg_latency_seconds:600,
    total_reviews:50, total_agreements:45, total_disagreements:5, total_escalations:1,
    fraud_flags_count:0, fast_completions:0, overwrite_count:0, last_active_at:null, last_review_at:null };
}
function cap(id:string,langs:string[]):WorkerCapabilities {
  return { id:`c-${id}`, reviewer_id:id, languages:langs, certifications:[],
    availability:"available", weekly_capacity_hours:40, timezone:"UTC", notes:"", created_at:"", updated_at:"" };
}
function sk(id:string,t:WorkerSkill["skill_type"],p:number):WorkerSkill {
  return { id:crypto.randomUUID(), reviewer_id:id, skill_type:t, proficiency:p,
    validation_count:0, last_validated_at:null, created_at:"", updated_at:"" };
}

describe("Scenario: skill-matched staffing", () => {
  it("finds workers with required skill above proficiency threshold", () => {
    const workers = assembleWorkers(
      [ident("a",0.9), ident("b",0.8), ident("c",0.85)],
      [cap("a",["ar"]), cap("b",["en"]), cap("c",["ar","en"])],
      [sk("a","transcription",0.9), sk("b","image",0.7), sk("c","transcription",0.6)],
    );
    // Need transcription >= 0.7
    const qualified = workers.filter(w =>
      skillCoverage(w.skills).transcription >= 0.7
    );
    expect(qualified.map(w=>w.identity.id)).toEqual(["a"]);
  });

  it("finds Arabic-capable transcribers", () => {
    const workers = assembleWorkers(
      [ident("a",0.9), ident("c",0.85)],
      [cap("a",["ar"]), cap("c",["en"])],
      [sk("a","transcription",0.8), sk("c","transcription",0.9)],
    );
    const arabicTranscribers = workers.filter(w =>
      (w.capabilities?.languages.includes("ar") ?? false) &&
      skillCoverage(w.skills).transcription > 0
    );
    expect(arabicTranscribers.map(w=>w.identity.id)).toEqual(["a"]);
  });

  it("computes skill coverage breadth per worker", () => {
    const workers = assembleWorkers(
      [ident("multi",0.9)],
      [cap("multi",["ar","en","fr"])],
      [sk("multi","image",0.8), sk("multi","video",0.7), sk("multi","ocr",0.6)],
    );
    const cov = skillCoverage(workers[0].skills);
    const breadth = Object.values(cov).filter(v=>v>0).length;
    expect(breadth).toBe(3);
  });
});

// ── Scenario 6: full dashboard with quality bands ─────────────────────────────

describe("Scenario: dashboard quality bands", () => {
  it("computes percentile bands over QA scores", () => {
    const ids = Array.from({length:20},(_,i)=>`w${i}`);
    const a = ids.flatMap(id=>Array(10).fill(0).map((_,i)=>asg(id,"completed",i*HOUR,HOUR)));
    const s = new Map(ids.map((id,i)=>[id,stats(id,10,i%5,0.5+i*0.02)]));
    const metrics = computePerformanceBatch(ids, a, s);
    const qaScores = metrics.map(m=>m.qa_score);
    const p50 = percentile(qaScores, 0.5);
    const p90 = percentile(qaScores, 0.9);
    expect(p90).toBeGreaterThanOrEqual(p50);
  });

  it("end-to-end trends from raw assignments to dashboard", () => {
    const ids = Array.from({length:30},(_,i)=>`w${i}`);
    const a = ids.flatMap((id,wi)=>Array(12).fill(0).map((_,i)=>
      asg(id, i%9===0?"reworked":"completed", i*HOUR, (1+wi%3)*HOUR)));
    const s = new Map(ids.map((id,i)=>[id,stats(id,12,i%4,0.7+(i%3)*0.1)]));
    const metrics = computePerformanceBatch(ids, a, s);
    const activities = ids.map(id=>act({reviewer_id:id,turnaround_secs:[3600],output_hashes:["a","b"],agreement_rate:0.85,sample_size:12}));
    const fraud = assessFraudBatch(activities);
    const trends = computeTrends(metrics, fraud, {}, ids.length);

    expect(trends.worker_ranking).toHaveLength(30);
    expect(trends.reviewer_ranking).toHaveLength(30);
    expect(trends.mean_qa_score).toBeGreaterThan(0);
    expect(trends.mean_throughput).toBeGreaterThan(0);
  });
});

// ── Scenario 7: scale validation ──────────────────────────────────────────────

describe("Scenario: scale to success criteria", () => {
  it("handles 10,000 workers ranking", () => {
    const ids = Array.from({length:10000},(_,i)=>`w${i}`);
    const s = new Map(ids.map((id,i)=>[id,stats(id,10,i%5,0.5+(i%50)/100)]));
    const metrics = computePerformanceBatch(ids, [], s);
    const ranked = rankByPerformance(metrics, {});
    expect(ranked).toHaveLength(10000);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[9999].rank).toBe(10000);
  });

  it("handles 100,000 assignments aggregation", () => {
    const ids = Array.from({length:100},(_,i)=>`w${i}`);
    const a: AssignmentRow[] = [];
    for(let i=0;i<100000;i++) a.push(asg(`w${i%100}`,"completed",(i%24)*HOUR,HOUR));
    const metrics = computePerformanceBatch(ids, a, new Map());
    expect(metrics).toHaveLength(100);
    expect(metrics[0].throughput).toBe(1000); // 100000/100
  });

  it("consensus batch of 1000 tasks", () => {
    const inputs = Array.from({length:1000},(_,i)=>({
      task_id:`t${i}`,
      reviews:[{reviewer_id:"a",verdict:"x",confidence:0.9},{reviewer_id:"b",verdict:i%3===0?"y":"x",confidence:0.8}],
    }));
    const results = resolveConsensusBatch(inputs);
    expect(results).toHaveLength(1000);
    const stat = computeDisagreementStats(results);
    expect(stat.total).toBe(1000);
  });
});
