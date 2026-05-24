/**
 * runtimeConstants.ts — Runtime Control Plane Constants
 * Aivora Platform — Phase 5.1
 *
 * All constants are immutable. No runtime mutation allowed.
 */

import type { RuntimeTaskType, RuntimePriority } from "./runtimeTypes";

// ── Worker Ceilings ───────────────────────────────────────────────────────────

export const MAX_WORKERS_DESKTOP = 6;
export const MAX_WORKERS_MOBILE  = 3;
export const MAX_WORKERS_LOW_MEM = 1;

// ── Task Timeouts (ms) ────────────────────────────────────────────────────────

export const TASK_TIMEOUT_MS: Record<RuntimeTaskType, number> = {
  FORENSIC:    15_000,
  SPECTROGRAM: 20_000,
  REPAIR:      60_000,
  EXPORT:     120_000,
  ANALYTICS:   30_000,
  SIMILARITY:  45_000,
  BATCH:       90_000,
  IMAGE:       30_000,
  VIDEO:       60_000,
  OCR:         20_000,
} as const;

// ── Priority Order (lower = higher priority) ──────────────────────────────────

export const PRIORITY_ORDER: Record<RuntimePriority, number> = {
  CRITICAL: 0,
  HIGH:     1,
  NORMAL:   2,
  LOW:      3,
} as const;

// ── Queue Limits ──────────────────────────────────────────────────────────────

export const MAX_QUEUE_DEPTH          = 50;
export const MAX_QUEUE_DEPTH_LOW_MEM  = 10;

// ── Pressure Thresholds ───────────────────────────────────────────────────────

export const PRESSURE_SOFT_THRESHOLD  = 0.65;
export const PRESSURE_HARD_THRESHOLD  = 0.85;

// ── Pressure Weights (must sum to 1.0) ───────────────────────────────────────

export const PRESSURE_WEIGHTS = {
  memory: 0.35,
  worker: 0.25,
  gpu:    0.15,
  raf:    0.10,
  queue:  0.15,
} as const;

// ── Scheduler Tick ───────────────────────────────────────────────────────────

export const SCHEDULER_TICK_MS = 250; // check queue every 250ms
