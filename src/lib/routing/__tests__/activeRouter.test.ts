/**
 * activeRouter.test.ts — Determinism + Boundary Tests
 * Phase 3.4 Validation
 */

import {
  routeTask,
  ROUTE_VERSION,
  type QCSignals,
  type AssignmentHistory,
} from "../activeRouter";

// ── Test Helpers ──────────────────────────────────────────────────────────────

const BASE_SIGNALS: QCSignals = {
  qc_score:              75,
  appen_score:           70,
  forensic_verdict:      "AUTHENTIC",
  forensic_confidence:   0.93,
  synthetic_probability: 0.07,
  snr_db:                32.4,
  noise_class:           "clean",
  environment:           "studio",
  artifact_score:        0.05,
  problem_count:         0,
};

const BASE_HISTORY: AssignmentHistory = {
  previous_decisions: [],
  escalation_depth:   0,
  total_assignments:  0,
};

const CORR_ID = "test-correlation-id-001";

function run(
  signals:  Partial<QCSignals> = {},
  history:  Partial<AssignmentHistory> = {},
  corrId = CORR_ID
) {
  return routeTask(
    { ...BASE_SIGNALS, ...signals },
    { ...BASE_HISTORY, ...history },
    corrId
  );
}

// ── Test Runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── CHECKPOINT 1A: Determinism (100x repeat) ──────────────────────────────────

console.log("\n── CHECKPOINT 1A: Determinism (100x repeat) ──");
{
  const first = run();
  let allSame = true;
  for(let i = 0; i < 100; i++) {
    const r = run();
    if(r.routing_decision !== first.routing_decision ||
       r.route_version    !== first.route_version    ||
       r.routing_confidence !== first.routing_confidence) {
      allSame = false;
      break;
    }
  }
  expect("100x identical input → identical output", allSame, true);
}

// ── CHECKPOINT 1B: Route Version ─────────────────────────────────────────────

console.log("\n── CHECKPOINT 1B: Route Version ──");
{
  const r = run();
  expect("route_version = 3.4.0", r.route_version, ROUTE_VERSION);
  expect("ledger route_version = 3.4.0",
    r.explainability_ledger.route_version, ROUTE_VERSION);
}

// ── CHECKPOINT 1C: Priority Order (first match wins) ─────────────────────────

console.log("\n── CHECKPOINT 1C: Priority Order ──");
{
  // REJECT_IMMEDIATELY — ALL 3 must be true
  const r1 = run({ qc_score:20, appen_score:20, problem_count:6 });
  expect("REJECT: qc<30 + appen<25 + problems>=5",
    r1.routing_decision, "REJECT_IMMEDIATELY");

  // Only 2 of 3 — should NOT reject
  const r2 = run({ qc_score:20, appen_score:20, problem_count:2 });
  expect("NOT REJECT: only 2 of 3 conditions",
    r2.routing_decision !== "REJECT_IMMEDIATELY", true);

  // FORENSIC overrides DUAL
  const r3 = run({
    qc_score: 50,
    forensic_verdict: "SYNTHETIC",
    synthetic_probability: 0.80,
  });
  expect("FORENSIC beats DUAL (priority 2 > 4)",
    r3.routing_decision, "FORENSIC_REVIEW");

  // SUPERVISOR: suspicious + depth < 2 (not solely depth >= 1)
  const r4 = run(
    { forensic_verdict:"SUSPICIOUS" },
    { escalation_depth: 1 }
  );
  expect("SUPERVISOR: suspicious (not solely depth>=1)",
    r4.routing_decision, "SUPERVISOR_ESCALATION");

  // SUPERVISOR: depth limit reached
  const r5 = run({}, { escalation_depth: 2 });
  expect("SUPERVISOR: escalation depth limit = 2",
    r5.routing_decision, "SUPERVISOR_ESCALATION");

  // DUAL: qc < 70
  const r6 = run({ qc_score: 65 });
  expect("DUAL: qc_score < 70", r6.routing_decision, "DUAL_REVIEW");

  // SINGLE: qc < 85 but >= 70
  const r7 = run({ qc_score: 72 });
  expect("SINGLE: 70 <= qc < 85", r7.routing_decision, "SINGLE_REVIEW");

  // AUTO: all conditions met
  const r8 = run({
    qc_score:              90,
    appen_score:           85,
    forensic_verdict:      "AUTHENTIC",
    synthetic_probability: 0.05,
    artifact_score:        0.05,
    problem_count:         0,
  });
  expect("AUTO: all conditions met", r8.routing_decision, "AUTO_APPROVE");
}

// ── CHECKPOINT 1D: Threshold Boundaries ──────────────────────────────────────

console.log("\n── CHECKPOINT 1D: Threshold Boundaries ──");
{
  // Exact boundary: qc_score = 70 → SINGLE (not DUAL)
  const r1 = run({ qc_score: 70 });
  expect("Boundary qc=70 → SINGLE (not DUAL)",
    r1.routing_decision, "SINGLE_REVIEW");

  // qc_score = 69 → DUAL
  const r2 = run({ qc_score: 69 });
  expect("Boundary qc=69 → DUAL",
    r2.routing_decision, "DUAL_REVIEW");

  // synthetic_probability = 0.40 → DUAL
  const r3 = run({ synthetic_probability: 0.40 });
  expect("Boundary synthetic=0.40 → DUAL",
    r3.routing_decision, "DUAL_REVIEW");

  // synthetic_probability = 0.39 → SINGLE (or AUTO)
  const r4 = run({ synthetic_probability: 0.39 });
  expect("Boundary synthetic=0.39 → not DUAL",
    r4.routing_decision !== "DUAL_REVIEW", true);

  // FORENSIC: synthetic_probability = 0.70
  const r5 = run({ synthetic_probability: 0.70 });
  expect("Boundary forensic synthetic=0.70 → FORENSIC",
    r5.routing_decision, "FORENSIC_REVIEW");
}

// ── CHECKPOINT 1E: Explainability Ledger ─────────────────────────────────────

console.log("\n── CHECKPOINT 1E: Explainability Ledger ──");
{
  const r = run({ qc_score: 50 });
  expect("ledger has routing_decision",
    typeof r.explainability_ledger.routing_decision, "string");
  expect("ledger has reasons array",
    Array.isArray(r.explainability_ledger.reasons), true);
  expect("ledger has thresholds",
    typeof r.explainability_ledger.thresholds, "object");
  expect("ledger has correlation_id",
    typeof r.explainability_ledger.correlation_id, "string");
  expect("ledger has routed_at",
    typeof r.explainability_ledger.routed_at, "string");
  expect("ledger routing_confidence 0-1",
    r.explainability_ledger.routing_confidence >= 0 &&
    r.explainability_ledger.routing_confidence <= 1, true);
  expect("reasons are non-empty for non-AUTO",
    r.explainability_ledger.reasons.length > 0, true);
}

// ── CHECKPOINT 1F: AUTO_APPROVE no reviewer dependency ───────────────────────

console.log("\n── CHECKPOINT 1F: AUTO_APPROVE no reviewer context ──");
{
  const r = run({
    qc_score: 90, appen_score: 85,
    forensic_verdict: "AUTHENTIC",
    synthetic_probability: 0.05,
    artifact_score: 0.05, problem_count: 0,
  });
  expect("AUTO_APPROVE reached without reviewer context",
    r.routing_decision, "AUTO_APPROVE");
  expect("AUTO reasons contain qc_score_meets_auto_threshold",
    r.reasons.includes("qc_score_meets_auto_threshold"), true);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════`);
console.log(`CHECKPOINT 1 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);

if(failed > 0) throw new Error(`${failed} tests failed`);
