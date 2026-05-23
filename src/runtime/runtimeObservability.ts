/**
 * runtimeObservability.ts — Runtime Control Plane Observability
 * Aivora Platform — Phase 5.7
 *
 * Integrates Phase 4.1 telemetry with Phase 5 Runtime Control Plane.
 *
 * Rules:
 * - ALL telemetry: fire-and-forget (never awaited)
 * - ALL payloads: < 2KB
 * - NO recursive telemetry
 * - NO hot path blocking
 * - Event types from Phase 4.1 taxonomy only
 */

import { emitEvent }           from "../lib/telemetry/emitter";
import { scheduler }           from "./runtimeScheduler";
import { sessionSurvivability }from "./sessionSurvivability";
import { policyManager }       from "./executionPolicies";
import { resourceProfiler }    from "./resourceProfiler";
import type { RuntimeExecutionMode } from "./runtimeTypes";

// ── Runtime Event Types (extends Phase 4.1 taxonomy) ─────────────────────────
// These map to operational_events.event_type CHECK constraint
// Using existing allowed values only — no new types

// ── Observability Bridge ──────────────────────────────────────────────────────

class RuntimeObservabilityBridge {
  private _lastMode:     RuntimeExecutionMode | null = null;
  private _lastPressure: number = 0;
  private _listening     = false;
  private _destroyed     = false;

  // Correlation ID for runtime-level events (session-scoped)
  private _sessionCorrId = crypto.randomUUID();

  start(): void {
    if(this._listening || this._destroyed) return;
    this._listening = true;

    // Monitor scheduler state changes
    scheduler.onStateChange(state => {
      if(this._destroyed) return;

      // EXECUTION_MODE_CHANGED → emit as ADMIN_ACTION (closest taxonomy match)
      if(this._lastMode && state.execution_mode !== this._lastMode) {
        emitEvent({
          event_type:     "ADMIN_ACTION",
          event_source:   "qc_workstation",
          correlation_id: this._sessionCorrId,
          severity:       "warn",
          payload:        {
            action:        "EXECUTION_MODE_CHANGED",
            from_mode:     this._lastMode,
            to_mode:       state.execution_mode,
            pressure:      state.pressure.overall_pressure,
            active_workers:state.active_workers,
            queue_depth:   state.queue_depth,
          },
        });
      }

      // WORKER_POOL_SATURATED → emit as WORKER_CRASHED (closest taxonomy)
      if(
        state.active_workers >= state.max_workers &&
        state.queue_depth > 0 &&
        this._lastPressure < 0.85 &&
        state.pressure.overall_pressure >= 0.85
      ) {
        emitEvent({
          event_type:     "WORKER_CRASHED",
          event_source:   "forensic_worker",
          correlation_id: this._sessionCorrId,
          severity:       "error",
          payload:        {
            action:        "WORKER_POOL_SATURATED",
            active_workers:state.active_workers,
            max_workers:   state.max_workers,
            queue_depth:   state.queue_depth,
          },
        });
      }

      this._lastMode     = state.execution_mode;
      this._lastPressure = state.pressure.overall_pressure;
    });

    // Monitor resource profiler for memory limits
    // Sampled every 60s to avoid hot path
    setInterval(() => {
      if(this._destroyed) return;
      const snap = resourceProfiler.sample();
      const ceil = resourceProfiler.getCeiling();

      if(snap.js_heap_used_mb >= ceil.hard_limit_mb) {
        emitEvent({
          event_type:     "ADMIN_ACTION",
          event_source:   "qc_workstation",
          correlation_id: this._sessionCorrId,
          severity:       "critical",
          payload:        {
            action:      "MEMORY_HARD_LIMIT",
            heap_mb:     snap.js_heap_used_mb,
            limit_mb:    ceil.hard_limit_mb,
            pressure:    snap.memory_pressure,
          },
        });
      } else if(snap.js_heap_used_mb >= ceil.soft_limit_mb) {
        emitEvent({
          event_type:     "ADMIN_ACTION",
          event_source:   "qc_workstation",
          correlation_id: this._sessionCorrId,
          severity:       "warn",
          payload:        {
            action:      "MEMORY_SOFT_LIMIT",
            heap_mb:     snap.js_heap_used_mb,
            limit_mb:    ceil.soft_limit_mb,
            pressure:    snap.memory_pressure,
          },
        });
      }

      // WebGL context loss
      if(snap.webgl_context_lost) {
        emitEvent({
          event_type:     "ADMIN_ACTION",
          event_source:   "qc_workstation",
          correlation_id: this._sessionCorrId,
          severity:       "error",
          payload:        { action: "GPU_CONTEXT_LOST" },
        });
      }
    }, 60_000);

    // Session health degradation check every 5 minutes
    setInterval(() => {
      if(this._destroyed) return;
      const health = sessionSurvivability.getLastScore();
      if(!health) return;
      if(health.overall < 0.50) {
        emitEvent({
          event_type:     "ADMIN_ACTION",
          event_source:   "qc_workstation",
          correlation_id: this._sessionCorrId,
          severity:       "warn",
          payload:        {
            action:          "SESSION_HEALTH_DEGRADED",
            overall:         health.overall,
            memory_health:   health.memory_health,
            worker_health:   health.worker_health,
            gpu_health:      health.gpu_health,
            sync_health:     health.sync_health,
            forensic_health: health.forensic_health,
          },
        });
      }
    }, 300_000);

    // Capture initial mode
    this._lastMode = scheduler.getState().execution_mode;
  }

  // ── Specific Event Emitters ───────────────────────────────────────────────

  emitCacheEviction(reason: string): void {
    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "qc_workstation",
      correlation_id: this._sessionCorrId,
      severity:       "info",
      payload:        { action: "CACHE_EVICTION_TRIGGERED", reason },
    });
  }

  emitWorkerRecycled(workerId: string, taskType: string): void {
    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "forensic_worker",
      correlation_id: this._sessionCorrId,
      severity:       "info",
      payload:        { action: "WORKER_RECYCLED", worker_id: workerId, task_type: taskType },
    });
  }

  emitAudioContextSuspended(corrId: string): void {
    emitEvent({
      event_type:     "AUDIOCONTEXT_SUSPENDED",
      event_source:   "audio_context",
      correlation_id: corrId,
      severity:       "warn",
      payload:        { session_corr_id: this._sessionCorrId },
    });
  }

  emitAudioContextResumed(corrId: string): void {
    emitEvent({
      event_type:     "AUDIOCONTEXT_RESUMED",
      event_source:   "audio_context",
      correlation_id: corrId,
      severity:       "info",
      payload:        { session_corr_id: this._sessionCorrId },
    });
  }

  getSessionCorrelationId(): string {
    return this._sessionCorrId;
  }

  destroy(): void {
    this._destroyed = true;
  }
}

export const runtimeObservability = new RuntimeObservabilityBridge();

// Auto-start on import (browser only)
if(typeof document !== "undefined") {
  runtimeObservability.start();
}
