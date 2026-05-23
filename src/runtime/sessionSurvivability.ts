/**
 * sessionSurvivability.ts — Session Survivability Engine
 * Aivora Platform — Phase 5.5
 *
 * Architecture:
 * - Monitors session health over time
 * - Detects memory drift, worker accumulation, queue growth
 * - Triggers auto-recovery actions (non-destructive)
 * - Produces deterministic SessionHealthScore (0→1 per dimension)
 * - Non-blocking: all checks synchronous, recovery async
 * - No ML. No probabilistic estimation.
 */

import { scheduler }        from "./runtimeScheduler";
import { resourceProfiler } from "./resourceProfiler";
import { workerRegistry }   from "./workerRegistry";

// ── Session Health Score ──────────────────────────────────────────────────────

export interface SessionHealthScore {
  memory_health:   number;   // 0→1 (1=healthy)
  worker_health:   number;   // 0→1
  gpu_health:      number;   // 0→1
  sync_health:     number;   // 0→1
  forensic_health: number;   // 0→1
  overall:         number;   // 0→1 weighted
  degraded:        boolean;  // overall < 0.5
  sampled_at:      number;   // Date.now()
}

// ── Recovery Action ───────────────────────────────────────────────────────────

export type RecoveryAction =
  | "EVICT_LOD_CACHE"
  | "CLEAR_STALE_SPECTROGRAMS"
  | "COMPACT_INDEXEDDB"
  | "RECYCLE_IDLE_WORKERS"
  | "RESTART_AUDIO_CONTEXT";

export interface RecoveryCallback {
  action:  RecoveryAction;
  handler: () => void | Promise<void>;
}

// ── Baseline Snapshot ─────────────────────────────────────────────────────────

interface SessionBaseline {
  heap_mb:        number;
  worker_count:   number;
  queue_depth:    number;
  captured_at:    number;
}

// ── Session Survivability Engine ──────────────────────────────────────────────

class SessionSurvivabilityEngine {
  private _baseline:         SessionBaseline | null = null;
  private _lastScore:        SessionHealthScore | null = null;
  private _recoveryHandlers: Map<RecoveryAction, () => void | Promise<void>> = new Map();
  private _monitorHandle:    ReturnType<typeof setInterval> | null = null;
  private _destroyed         = false;

  // Health thresholds
  private readonly MEMORY_DRIFT_THRESHOLD = 0.15;  // 15% growth = degraded
  private readonly WORKER_MAX_RATIO       = 0.80;  // 80% of ceiling = degraded
  private readonly QUEUE_MAX_RATIO        = 0.70;  // 70% of max queue = degraded

  constructor() {
    // Capture baseline after 5 seconds (allow initial load)
    setTimeout(() => {
      if(!this._destroyed) this._captureBaseline();
    }, 5000);

    // Monitor every 30 seconds
    this._monitorHandle = setInterval(() => {
      if(this._destroyed) return;
      this._monitor();
    }, 30_000);
  }

  // ── Baseline ────────────────────────────────────────────────────────────────

  private _captureBaseline(): void {
    const snap = resourceProfiler.sample();
    const state = scheduler.getState();
    this._baseline = {
      heap_mb:      snap.js_heap_used_mb,
      worker_count: workerRegistry.getActiveCount(),
      queue_depth:  state.queue_depth,
      captured_at:  Date.now(),
    };
  }

  // ── Monitor ──────────────────────────────────────────────────────────────────

  private _monitor(): void {
    const score = this.getHealthScore();
    this._lastScore = score;

    if(score.degraded) {
      console.warn(`[SessionSurvivability] Health degraded: ${score.overall.toFixed(2)}`);
      this._triggerRecovery(score);
    }
  }

  // ── Health Score ─────────────────────────────────────────────────────────────

  getHealthScore(): SessionHealthScore {
    const snap   = resourceProfiler.sample();
    const state  = scheduler.getState();
    const pressure = scheduler.getPressure();

    // Memory health: penalize drift from baseline
    let memHealth = 1 - snap.memory_pressure;
    if(this._baseline) {
      const drift = (snap.js_heap_used_mb - this._baseline.heap_mb)
        / Math.max(1, this._baseline.heap_mb);
      if(drift > this._MEMORY_DRIFT_THRESHOLD()) {
        memHealth = Math.max(0, memHealth - drift * 0.5);
      }
    }

    // Worker health
    const workerRatio  = state.active_workers / Math.max(1, state.max_workers);
    const workerHealth = 1 - Math.min(1, workerRatio / this.WORKER_MAX_RATIO);

    // GPU health
    const gpuHealth = 1 - pressure.gpu_pressure;

    // Sync health (queue pressure)
    const queueRatio = state.queue_depth / Math.max(1, 50);
    const syncHealth = 1 - Math.min(1, queueRatio / this.QUEUE_MAX_RATIO);

    // Forensic health (no forensic-specific metrics yet — use overall)
    const forensicHealth = 1 - pressure.overall_pressure * 0.5;

    const clamp = (v: number) => Math.max(0, Math.min(1, isFinite(v) ? v : 0));

    const mH = clamp(memHealth);
    const wH = clamp(workerHealth);
    const gH = clamp(gpuHealth);
    const sH = clamp(syncHealth);
    const fH = clamp(forensicHealth);

    // Weighted overall
    const overall = clamp(
      mH * 0.35 +
      wH * 0.25 +
      gH * 0.15 +
      sH * 0.15 +
      fH * 0.10
    );

    return {
      memory_health:   mH,
      worker_health:   wH,
      gpu_health:      gH,
      sync_health:     sH,
      forensic_health: fH,
      overall,
      degraded:        overall < 0.50,
      sampled_at:      Date.now(),
    };
  }

  private _MEMORY_DRIFT_THRESHOLD(): number {
    return this.MEMORY_DRIFT_THRESHOLD;
  }

  // ── Recovery ──────────────────────────────────────────────────────────────────

  registerRecovery(action: RecoveryAction, handler: () => void | Promise<void>): void {
    this._recoveryHandlers.set(action, handler);
  }

  private _triggerRecovery(score: SessionHealthScore): void {
    // Deterministic recovery order based on which dimension is worst
    if(score.memory_health < 0.4) {
      this._invoke("EVICT_LOD_CACHE");
      this._invoke("CLEAR_STALE_SPECTROGRAMS");
    }
    if(score.worker_health < 0.4) {
      this._invoke("RECYCLE_IDLE_WORKERS");
    }
    if(score.sync_health < 0.4) {
      this._invoke("COMPACT_INDEXEDDB");
    }
    if(score.gpu_health < 0.4) {
      this._invoke("RESTART_AUDIO_CONTEXT");
    }
  }

  private _invoke(action: RecoveryAction): void {
    const handler = this._recoveryHandlers.get(action);
    if(!handler) return;
    try {
      const result = handler();
      if(result instanceof Promise) {
        result.catch(e =>
          console.warn(`[SessionSurvivability] Recovery failed: ${action}`, e)
        );
      }
    } catch(e) {
      console.warn(`[SessionSurvivability] Recovery error: ${action}`, e);
    }
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  getLastScore(): SessionHealthScore | null {
    return this._lastScore;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  destroy(): void {
    this._destroyed = true;
    if(this._monitorHandle) clearInterval(this._monitorHandle);
    this._recoveryHandlers.clear();
  }
}

export const sessionSurvivability = new SessionSurvivabilityEngine();
