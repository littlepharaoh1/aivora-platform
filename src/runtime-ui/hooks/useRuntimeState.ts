/**
 * useRuntimeState.ts — Runtime State Bridge
 * Aivora Platform — Phase 9.1
 *
 * Bridges Tier 5 + 6A + 6B into React state.
 * Polling: 1s minimum interval.
 * Event-driven where possible.
 * READ-ONLY — never controls scheduling.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { scheduler }           from "../../runtime/runtimeScheduler";
import { resourceProfiler }    from "../../runtime/resourceProfiler";
import { workerPool }          from "../../runtime/workerPool";
import { workerRegistry }      from "../../runtime/workerRegistry";
import { policyManager }       from "../../runtime/executionPolicies";
import { sessionSurvivability } from "../../runtime/sessionSurvivability";
import { gpuRuntime }          from "../../gpu/gpuRuntime";
import { sharedMemoryPool }    from "../../gpu/sharedMemoryPool";
import { getGPUCapabilitiesSync } from "../../gpu/gpuCapabilities";
import type { SchedulerState } from "../../runtime/runtimeTypes";

export interface RuntimeSnapshot {
  // Scheduler
  execution_mode:    string;
  active_workers:    number;
  max_workers:       number;
  queue_depth:       number;
  overall_pressure:  number;
  memory_pressure:   number;
  worker_pressure:   number;
  gpu_pressure:      number;

  // Memory
  heap_used_mb:      number;
  heap_limit_mb:     number;
  memory_ceiling_mb: number;

  // GPU
  gpu_tier:          string;
  gpu_backend:       string;
  gpu_context_lost:  boolean;
  gpu_adapter:       string | null;

  // SAB
  sab_available:     boolean;
  sab_active_slots:  number;
  sab_total_slots:   number;

  // Policy
  policy_mode:       string;
  target_fps:        number;
  similarity_enabled:boolean;
  analytics_enabled: boolean;

  // Session health
  session_health:    number;
  session_degraded:  boolean;

  // Timestamp
  sampled_at:        number;
}

function buildSnapshot(): RuntimeSnapshot {
  const state    = scheduler.getState();
  const pressure = state.pressure;
  const snap     = resourceProfiler.sample();
  const ceil     = resourceProfiler.getCeiling();
  const policy   = policyManager.getCurrent();
  const gpuState = gpuRuntime.getState();
  const gpuCaps  = getGPUCapabilitiesSync();
  const sabConf  = sharedMemoryPool.getConfig();
  const health   = sessionSurvivability.getLastScore();

  return {
    execution_mode:    state.execution_mode,
    active_workers:    state.active_workers,
    max_workers:       state.max_workers,
    queue_depth:       state.queue_depth,
    overall_pressure:  Math.round(pressure.overall_pressure  * 1000) / 1000,
    memory_pressure:   Math.round(pressure.memory_pressure   * 1000) / 1000,
    worker_pressure:   Math.round(pressure.worker_pressure   * 1000) / 1000,
    gpu_pressure:      Math.round(pressure.gpu_pressure      * 1000) / 1000,

    heap_used_mb:      snap.js_heap_used_mb,
    heap_limit_mb:     snap.js_heap_limit_mb,
    memory_ceiling_mb: ceil.soft_limit_mb,

    gpu_tier:          gpuState.initialized ? gpuState.tier : "CPU_ONLY",
    gpu_backend:       gpuState.active_backend,
    gpu_context_lost:  gpuState.context_lost,
    gpu_adapter:       gpuCaps?.adapter_name ?? null,

    sab_available:     sharedMemoryPool.isAvailable(),
    sab_active_slots:  sharedMemoryPool.getActiveSlots(),
    sab_total_slots:   sabConf.slot_count,

    policy_mode:       policy.mode,
    target_fps:        policy.target_fps,
    similarity_enabled:policy.similarity_enabled,
    analytics_enabled: policy.analytics_enabled,

    session_health:    health?.overall    ?? 1,
    session_degraded:  health?.degraded   ?? false,

    sampled_at:        Date.now(),
  };
}

export function useRuntimeState(intervalMs = 1000) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(buildSnapshot);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    setSnapshot(buildSnapshot());
  }, []);

  useEffect(() => {
    // Subscribe to scheduler state changes (event-driven)
    const unsub = scheduler.onStateChange(() => refresh());

    // Fallback polling at 1s (minimum)
    timerRef.current = setInterval(refresh, Math.max(1000, intervalMs));

    return () => {
      unsub();
      if(timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs, refresh]);

  return snapshot;
}
