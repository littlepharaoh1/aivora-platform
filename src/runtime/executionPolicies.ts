/**
 * executionPolicies.ts — Adaptive Execution Policies
 * Aivora Platform — Phase 5.6
 *
 * Architecture:
 * - 4 deterministic execution modes
 * - Same pressure → same policy (no randomness)
 * - Policies consumed by all subsystems
 * - Policy transitions logged for auditability
 * - No ML. No probabilistic switching.
 */

import { scheduler }           from "./runtimeScheduler";
import { resourceProfiler }    from "./resourceProfiler";
import { sessionSurvivability } from "./sessionSurvivability";
import type { RuntimeExecutionMode } from "./runtimeTypes";

// ── Policy Definition ─────────────────────────────────────────────────────────

export interface ExecutionPolicy {
  mode:                  RuntimeExecutionMode;

  // Worker budget
  max_workers:           number;
  max_forensic_workers:  number;

  // Rendering
  target_fps:            number;
  spectrogram_fft_size:  number;
  spectrogram_overlap:   number;

  // Features
  similarity_enabled:    boolean;
  analytics_enabled:     boolean;
  repair_enabled:        boolean;
  batch_enabled:         boolean;
  export_enabled:        boolean;

  // Queue
  max_queue_depth:       number;

  // Memory
  max_cached_files:      number;
  lod_levels:            number;
}

// ── Policy Table (immutable) ──────────────────────────────────────────────────

export const EXECUTION_POLICIES: Record<RuntimeExecutionMode, ExecutionPolicy> = {

  DESKTOP_ULTRA: {
    mode:                  "DESKTOP_ULTRA",
    max_workers:           6,
    max_forensic_workers:  4,
    target_fps:            60,
    spectrogram_fft_size:  4096,
    spectrogram_overlap:   0.875,
    similarity_enabled:    true,
    analytics_enabled:     true,
    repair_enabled:        true,
    batch_enabled:         true,
    export_enabled:        true,
    max_queue_depth:       50,
    max_cached_files:      10,
    lod_levels:            8,
  },

  DESKTOP_BALANCED: {
    mode:                  "DESKTOP_BALANCED",
    max_workers:           4,
    max_forensic_workers:  3,
    target_fps:            45,
    spectrogram_fft_size:  2048,
    spectrogram_overlap:   0.75,
    similarity_enabled:    true,
    analytics_enabled:     true,
    repair_enabled:        true,
    batch_enabled:         true,
    export_enabled:        true,
    max_queue_depth:       30,
    max_cached_files:      5,
    lod_levels:            6,
  },

  MOBILE_SAFE: {
    mode:                  "MOBILE_SAFE",
    max_workers:           2,
    max_forensic_workers:  2,
    target_fps:            30,
    spectrogram_fft_size:  1024,
    spectrogram_overlap:   0.50,
    similarity_enabled:    false,
    analytics_enabled:     false,
    repair_enabled:        true,
    batch_enabled:         false,
    export_enabled:        true,
    max_queue_depth:       10,
    max_cached_files:      3,
    lod_levels:            4,
  },

  LOW_MEMORY: {
    mode:                  "LOW_MEMORY",
    max_workers:           1,
    max_forensic_workers:  1,
    target_fps:            20,
    spectrogram_fft_size:  512,
    spectrogram_overlap:   0.25,
    similarity_enabled:    false,
    analytics_enabled:     false,
    repair_enabled:        false,
    batch_enabled:         false,
    export_enabled:        false,
    max_queue_depth:       5,
    max_cached_files:      1,
    lod_levels:            2,
  },

} as const;

// ── Policy Manager ────────────────────────────────────────────────────────────

class PolicyManager {
  private _current:   RuntimeExecutionMode;
  private _history:   Array<{ mode: RuntimeExecutionMode; ts: number }> = [];
  private _listeners: Set<(p: ExecutionPolicy) => void> = new Set();

  constructor() {
    this._current = scheduler.getState().execution_mode;

    // Track scheduler mode changes
    scheduler.onStateChange(state => {
      if(state.execution_mode !== this._current) {
        this._transition(state.execution_mode);
      }
    });
  }

  // ── Policy Access ────────────────────────────────────────────────────────────

  getCurrent(): ExecutionPolicy {
    return EXECUTION_POLICIES[this._current];
  }

  getMode(): RuntimeExecutionMode {
    return this._current;
  }

  // ── Derived Helpers ──────────────────────────────────────────────────────────

  canRunForensic():    boolean { return this.getCurrent().max_forensic_workers > 0; }
  canRunRepair():      boolean { return this.getCurrent().repair_enabled; }
  canRunSimilarity():  boolean { return this.getCurrent().similarity_enabled; }
  canRunBatch():       boolean { return this.getCurrent().batch_enabled; }
  canRunExport():      boolean { return this.getCurrent().export_enabled; }
  canRunAnalytics():   boolean { return this.getCurrent().analytics_enabled; }
  getTargetFPS():      number  { return this.getCurrent().target_fps; }
  getFFTSize():        number  { return this.getCurrent().spectrogram_fft_size; }
  getMaxCachedFiles(): number  { return this.getCurrent().max_cached_files; }
  getLODLevels():      number  { return this.getCurrent().lod_levels; }

  // ── Health-based Override ────────────────────────────────────────────────────

  getEffectivePolicy(): ExecutionPolicy {
    const health = sessionSurvivability.getLastScore();
    if(!health) return this.getCurrent();

    // If health degraded → downgrade one tier for safety
    if(health.overall < 0.35) {
      return EXECUTION_POLICIES["LOW_MEMORY"];
    }
    if(health.overall < 0.50) {
      return EXECUTION_POLICIES["MOBILE_SAFE"];
    }
    return this.getCurrent();
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  private _transition(newMode: RuntimeExecutionMode): void {
    const prev = this._current;
    this._current = newMode;
    this._history.push({ mode: newMode, ts: Date.now() });

    // Keep last 20 transitions only
    if(this._history.length > 20) this._history.shift();

    console.info(`[PolicyManager] Mode: ${prev} → ${newMode}`);
    this._notify();
  }

  getTransitionHistory(): Array<{ mode: RuntimeExecutionMode; ts: number }> {
    return [...this._history];
  }

  // ── Listeners ────────────────────────────────────────────────────────────────

  onPolicyChange(cb: (p: ExecutionPolicy) => void): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  private _notify(): void {
    const policy = this.getCurrent();
    this._listeners.forEach(cb => {
      try { cb(policy); } catch {}
    });
  }
}

export const policyManager = new PolicyManager();
