/**
 * safetyConstraints.ts — Enterprise Safety Constraints
 * Aivora Platform — Phase 5.8
 *
 * Hard safety rules enforced across all subsystems:
 * - No unbounded loops
 * - No main thread heavy DSP
 * - No memory-unsafe repairs
 * - No worker storms
 * - All limits deterministic and documented
 */

import { scheduler }     from "./runtimeScheduler";
import { workerPool }    from "./workerPool";
import { policyManager } from "./executionPolicies";

// ── Safety Constraint Results ─────────────────────────────────────────────────

export interface SafetyCheckResult {
  allowed:  boolean;
  reason:   string | null;
  fallback: string | null;
}

const ALLOW:  SafetyCheckResult = { allowed: true,  reason: null, fallback: null };
const reject = (reason: string, fallback: string): SafetyCheckResult =>
  ({ allowed: false, reason, fallback });

// ── File Size Constraints ─────────────────────────────────────────────────────

export const FILE_CONSTRAINTS = {
  MAX_FILE_BYTES:     200 * 1024 * 1024,  // 200MB
  MAX_DURATION_SEC:   30 * 60,            // 30 minutes
  MAX_CACHED_FILES:   () => policyManager.getCurrent().max_cached_files,
} as const;

export function checkFileLoad(fileSizeBytes: number, durationSec: number): SafetyCheckResult {
  if(fileSizeBytes > FILE_CONSTRAINTS.MAX_FILE_BYTES) {
    return reject(
      `file_too_large: ${(fileSizeBytes/1024/1024).toFixed(0)}MB > 200MB`,
      "reduce_file_size"
    );
  }
  if(durationSec > FILE_CONSTRAINTS.MAX_DURATION_SEC) {
    return reject(
      `duration_too_long: ${(durationSec/60).toFixed(1)}min > 30min`,
      "trim_file"
    );
  }
  if(!policyManager.getCurrent().batch_enabled && durationSec > 600) {
    return reject("long_file_blocked_in_low_memory_mode", "switch_to_desktop");
  }
  return ALLOW;
}

// ── Worker Storm Prevention ───────────────────────────────────────────────────

export function checkWorkerAllocation(): SafetyCheckResult {
  if(workerPool.isSaturated()) {
    return reject(
      `worker_pool_exhausted: ${workerPool.getActiveCount()}/${workerPool.getMaxWorkers()}`,
      "queue_task_and_wait"
    );
  }
  const state = scheduler.getState();
  if(state.pressure.overall_pressure >= 0.85) {
    return reject(
      `system_pressure_too_high: ${state.pressure.overall_pressure.toFixed(2)}`,
      "wait_for_pressure_relief"
    );
  }
  return ALLOW;
}

// ── Repair Safety ─────────────────────────────────────────────────────────────

export const REPAIR_CONSTRAINTS = {
  MAX_FILE_MB_FOR_REPAIR: 100,           // 100MB max for repair
  MAX_SIMULTANEOUS_REPAIRS: () => policyManager.getCurrent().max_forensic_workers ?? 1,
} as const;

export function checkRepairAllowed(fileSizeMb: number): SafetyCheckResult {
  if(!policyManager.canRunRepair()) {
    return reject("repair_disabled_in_current_mode", "switch_to_higher_mode");
  }
  if(fileSizeMb > REPAIR_CONSTRAINTS.MAX_FILE_MB_FOR_REPAIR) {
    return reject(
      `file_too_large_for_repair: ${fileSizeMb.toFixed(0)}MB > 100MB`,
      "use_smaller_file"
    );
  }
  return ALLOW;
}

// ── Similarity Engine Constraints ────────────────────────────────────────────

export const SIMILARITY_CONSTRAINTS = {
  MAX_BATCH_SIZE: 100,  // hard O(N²) bound
  MAX_PAIRS:      4950, // N=100 → N*(N-1)/2 = 4950
} as const;

export function checkSimilarityAllowed(batchSize: number): SafetyCheckResult {
  if(!policyManager.canRunSimilarity()) {
    return reject("similarity_disabled_in_current_mode", "switch_to_desktop_mode");
  }
  if(batchSize > SIMILARITY_CONSTRAINTS.MAX_BATCH_SIZE) {
    return reject(
      `batch_too_large: ${batchSize} > ${SIMILARITY_CONSTRAINTS.MAX_BATCH_SIZE}`,
      "reduce_batch_size"
    );
  }
  return ALLOW;
}

// ── Export Constraints ────────────────────────────────────────────────────────

export function checkExportAllowed(): SafetyCheckResult {
  if(!policyManager.canRunExport()) {
    return reject("export_disabled_in_low_memory_mode", "switch_to_higher_mode");
  }
  return ALLOW;
}

// ── Analytics Constraints ─────────────────────────────────────────────────────

export function checkAnalyticsAllowed(): SafetyCheckResult {
  if(!policyManager.canRunAnalytics()) {
    return reject("analytics_disabled_in_current_mode", "switch_to_desktop_mode");
  }
  return ALLOW;
}

// ── Queue Depth Constraints ───────────────────────────────────────────────────

export function checkQueueDepth(): SafetyCheckResult {
  const state = scheduler.getState();
  if(state.queue_depth >= state.max_workers * 5) {
    return reject(
      `queue_overloaded: ${state.queue_depth} pending tasks`,
      "wait_for_queue_drain"
    );
  }
  return ALLOW;
}

// ── Main Thread DSP Guard ─────────────────────────────────────────────────────

/**
 * Validates that heavy DSP is routed to workers, not main thread.
 * Call before any synchronous FFT/DSP operation.
 */
export function assertWorkerDSP(operation: string): void {
  // In production, this is a no-op safety assertion
  // In development, warns if heavy DSP runs synchronously
  if(typeof self !== "undefined" && self === self.window) {
    // We are on main thread
    const HEAVY_OPS = ["FFT", "STFT", "SPECTROGRAM", "REPAIR_FFT"];
    if(HEAVY_OPS.some(op => operation.toUpperCase().includes(op))) {
      console.warn(
        `[SafetyConstraints] Heavy DSP on main thread: ${operation}. ` +
        `Route to worker for Phase 5.8 compliance.`
      );
    }
  }
}

// ── Global Safety Summary ─────────────────────────────────────────────────────

export function getSystemSafetySummary(): {
  worker_pool_ok:   boolean;
  queue_ok:         boolean;
  repair_available: boolean;
  export_available: boolean;
  similarity_available: boolean;
} {
  const workerOk   = !workerPool.isSaturated();
  const queueOk    = checkQueueDepth().allowed;
  const repairOk   = checkRepairAllowed(0).allowed;
  const exportOk   = checkExportAllowed().allowed;
  const simOk      = checkSimilarityAllowed(1).allowed;

  return {
    worker_pool_ok:       workerOk,
    queue_ok:             queueOk,
    repair_available:     repairOk,
    export_available:     exportOk,
    similarity_available: simOk,
  };
}
