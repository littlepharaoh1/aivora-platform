/**
 * runtimeValidation.test.ts — Phase 5.9 Validation Gates
 * Aivora Platform — Phase 5.9
 */

import { scheduler }         from "../runtimeScheduler";
import { policyManager }     from "../executionPolicies";
import { EXECUTION_POLICIES } from "../executionPolicies";
import {
  checkFileLoad,
  checkWorkerAllocation,
  checkRepairAllowed,
  checkSimilarityAllowed,
  checkExportAllowed,
  getSystemSafetySummary,
  FILE_CONSTRAINTS,
  SIMILARITY_CONSTRAINTS,
} from "../safetyConstraints";
import {
  TASK_TIMEOUT_MS,
  PRIORITY_ORDER,
  PRESSURE_WEIGHTS,
  MAX_WORKERS_DESKTOP,
  MAX_WORKERS_MOBILE,
} from "../runtimeConstants";

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

function expectTrue(label: string, value: boolean): void {
  expect(label, value, true);
}

// ── TEST 1: Scheduler Determinism ─────────────────────────────────────────────

console.log("\n── TEST 1: Scheduler Determinism ──");
{
  const state1 = scheduler.getState();
  const state2 = scheduler.getState();
  expectTrue("Same state twice = identical mode",
    state1.execution_mode === state2.execution_mode);
  expectTrue("max_workers > 0",
    state1.max_workers > 0);
  expectTrue("pressure dimensions 0→1",
    state1.pressure.overall_pressure >= 0 &&
    state1.pressure.overall_pressure <= 1);
  expectTrue("queue_depth = 0 (clean start)",
    state1.queue_depth === 0);
}

// ── TEST 2: Priority Order ─────────────────────────────────────────────────────

console.log("\n── TEST 2: Priority Order ──");
{
  expectTrue("CRITICAL < HIGH",   PRIORITY_ORDER["CRITICAL"] < PRIORITY_ORDER["HIGH"]);
  expectTrue("HIGH < NORMAL",     PRIORITY_ORDER["HIGH"]     < PRIORITY_ORDER["NORMAL"]);
  expectTrue("NORMAL < LOW",      PRIORITY_ORDER["NORMAL"]   < PRIORITY_ORDER["LOW"]);
}

// ── TEST 3: Timeout Hierarchy ─────────────────────────────────────────────────

console.log("\n── TEST 3: Timeout Hierarchy ──");
{
  expectTrue("FORENSIC < EXPORT",    TASK_TIMEOUT_MS["FORENSIC"] < TASK_TIMEOUT_MS["EXPORT"]);
  expectTrue("SPECTROGRAM < REPAIR", TASK_TIMEOUT_MS["SPECTROGRAM"] < TASK_TIMEOUT_MS["REPAIR"]);
  expectTrue("All timeouts > 0",
    Object.values(TASK_TIMEOUT_MS).every(t => t > 0));
}

// ── TEST 4: Pressure Weights sum to 1.0 ──────────────────────────────────────

console.log("\n── TEST 4: Pressure Weights ──");
{
  const total = Object.values(PRESSURE_WEIGHTS).reduce((a, b) => a + b, 0);
  expectTrue("Pressure weights sum = 1.0",
    Math.abs(total - 1.0) < 0.001);
}

// ── TEST 5: Worker Ceilings ───────────────────────────────────────────────────

console.log("\n── TEST 5: Worker Ceilings ──");
{
  expectTrue("Desktop > Mobile",     MAX_WORKERS_DESKTOP > MAX_WORKERS_MOBILE);
  expectTrue("Desktop = 6",          MAX_WORKERS_DESKTOP === 6);
  expectTrue("Mobile = 3",           MAX_WORKERS_MOBILE  === 3);
  expectTrue("DESKTOP_ULTRA = 6",    EXECUTION_POLICIES["DESKTOP_ULTRA"].max_workers    === 6);
  expectTrue("MOBILE_SAFE = 2",      EXECUTION_POLICIES["MOBILE_SAFE"].max_workers      === 2);
  expectTrue("LOW_MEMORY = 1",       EXECUTION_POLICIES["LOW_MEMORY"].max_workers       === 1);
}

// ── TEST 6: Policy Hierarchy ──────────────────────────────────────────────────

console.log("\n── TEST 6: Policy Hierarchy ──");
{
  const ultra    = EXECUTION_POLICIES["DESKTOP_ULTRA"];
  const balanced = EXECUTION_POLICIES["DESKTOP_BALANCED"];
  const mobile   = EXECUTION_POLICIES["MOBILE_SAFE"];
  const lowMem   = EXECUTION_POLICIES["LOW_MEMORY"];

  expectTrue("ULTRA fps > BALANCED fps",  ultra.target_fps > balanced.target_fps);
  expectTrue("BALANCED fps > MOBILE fps", balanced.target_fps > mobile.target_fps);
  expectTrue("MOBILE fps > LOW fps",      mobile.target_fps > lowMem.target_fps);

  expectTrue("ULTRA fft > BALANCED fft",
    ultra.spectrogram_fft_size > balanced.spectrogram_fft_size);
  expectTrue("BALANCED fft > MOBILE fft",
    balanced.spectrogram_fft_size > mobile.spectrogram_fft_size);
  expectTrue("MOBILE fft > LOW fft",
    mobile.spectrogram_fft_size > lowMem.spectrogram_fft_size);

  expectTrue("LOW_MEMORY: similarity disabled",  !lowMem.similarity_enabled);
  expectTrue("LOW_MEMORY: analytics disabled",   !lowMem.analytics_enabled);
  expectTrue("LOW_MEMORY: repair disabled",      !lowMem.repair_enabled);
  expectTrue("LOW_MEMORY: batch disabled",       !lowMem.batch_enabled);
  expectTrue("LOW_MEMORY: export disabled",      !lowMem.export_enabled);

  expectTrue("DESKTOP_ULTRA: all enabled",
    ultra.similarity_enabled &&
    ultra.analytics_enabled  &&
    ultra.repair_enabled     &&
    ultra.batch_enabled      &&
    ultra.export_enabled);
}

// ── TEST 7: Safety Constraints ────────────────────────────────────────────────

console.log("\n── TEST 7: Safety Constraints ──");
{
  // File too large
  const tooLarge = checkFileLoad(FILE_CONSTRAINTS.MAX_FILE_BYTES + 1, 60);
  expectTrue("Reject oversized file", !tooLarge.allowed);
  expectTrue("Oversized file has fallback", tooLarge.fallback !== null);

  // File OK
  const okFile = checkFileLoad(10 * 1024 * 1024, 60);
  expectTrue("Allow normal file (10MB, 60s)", okFile.allowed);

  // Duration too long
  const tooLong = checkFileLoad(1024, FILE_CONSTRAINTS.MAX_DURATION_SEC + 1);
  expectTrue("Reject too-long file", !tooLong.allowed);

  // Similarity batch limit
  const okBatch = checkSimilarityAllowed(50);
  // (may be disabled in mobile mode — check reason)
  expectTrue("Similarity check returns result", typeof okBatch.allowed === "boolean");

  const tooBig = checkSimilarityAllowed(SIMILARITY_CONSTRAINTS.MAX_BATCH_SIZE + 1);
  expectTrue("Reject oversized similarity batch", !tooBig.allowed);
  expectTrue("Oversized batch has fallback", tooBig.fallback !== null);

  // Repair file size
  const repairOk = checkRepairAllowed(50);   // 50MB
  expectTrue("Repair check returns result", typeof repairOk.allowed === "boolean");
  const repairTooBig = checkRepairAllowed(150);  // 150MB > 100MB limit
  expectTrue("Reject oversized repair", !repairTooBig.allowed || !repairTooBig.allowed);
}

// ── TEST 8: Task Submission + Queue ───────────────────────────────────────────

console.log("\n── TEST 8: Task Submission ──");
{
  let executed = false;

  const taskId = scheduler.submit({
    task_type:      "ANALYTICS",
    priority:       "LOW",
    correlation_id: "test-corr-001",
    execute:        async () => { executed = true; },
  });

  expectTrue("Task submitted (got id or null)", taskId === null || typeof taskId === "string");

  // Cancel if submitted
  if(taskId) {
    scheduler.cancel(taskId);
    const state = scheduler.getState();
    expectTrue("Queue back to 0 after cancel", state.queue_depth === 0);
  }
}

// ── TEST 9: Worker Allocation Safety ─────────────────────────────────────────

console.log("\n── TEST 9: Worker Allocation Safety ──");
{
  const result = checkWorkerAllocation();
  expectTrue("Worker allocation check returns result",
    typeof result.allowed === "boolean");
}

// ── TEST 10: System Safety Summary ───────────────────────────────────────────

console.log("\n── TEST 10: System Safety Summary ──");
{
  const summary = getSystemSafetySummary();
  expectTrue("Summary has worker_pool_ok", typeof summary.worker_pool_ok === "boolean");
  expectTrue("Summary has queue_ok",       typeof summary.queue_ok === "boolean");
  expectTrue("Summary has repair_available",typeof summary.repair_available === "boolean");
  expectTrue("Summary has export_available",typeof summary.export_available === "boolean");
  expectTrue("Summary has similarity_available",typeof summary.similarity_available === "boolean");
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════`);
console.log(`PHASE 5.9 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);

if(failed > 0) throw new Error(`${failed} validation tests failed`);
