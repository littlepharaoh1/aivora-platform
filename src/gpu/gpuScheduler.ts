/**
 * gpuScheduler.ts — GPU-Aware Task Scheduler
 * Aivora Platform — Phase 6A.2
 *
 * Routes compute tasks through Runtime Scheduler (Phase 5.1).
 * GPU backend selection is advisory — execution always via scheduler.
 * No direct worker spawning here.
 */

import { gpuRuntime }  from "./gpuRuntime";
import { scheduler }   from "../runtime/runtimeScheduler";
import type { RuntimeTaskType, RuntimePriority } from "../runtime/runtimeTypes";
import type { ComputeBackend } from "./gpuFallbacks";

export interface GPUTaskParams {
  task_type:      RuntimeTaskType;
  priority:       RuntimePriority;
  correlation_id: string;
  execute:        () => Promise<void>;
  onTimeout?:     () => void;
  onCancel?:      () => void;
}

/**
 * Submit a compute task.
 * Backend resolution is informational — actual execution via Runtime Scheduler.
 * Returns task id or null if scheduler rejected.
 */
export function submitGPUTask(params: GPUTaskParams): string | null {
  return scheduler.submit({
    task_type:      params.task_type,
    priority:       params.priority,
    correlation_id: params.correlation_id,
    execute:        params.execute,
    onTimeout:      params.onTimeout,
    onCancel:       params.onCancel,
  });
}

export function resolveBackend(
  taskType: "FFT" | "SPECTROGRAM" | "FORENSIC" | "INFERENCE"
): ComputeBackend {
  return gpuRuntime.resolveBackend(taskType).backend;
}

export function getGPUTier() {
  return gpuRuntime.getTier();
}

export function getActiveBackend(): ComputeBackend {
  return gpuRuntime.getState().active_backend;
}
