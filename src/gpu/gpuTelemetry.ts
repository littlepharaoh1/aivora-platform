/**
 * gpuTelemetry.ts — GPU Observability
 * Aivora Platform — Phase 6A.2
 *
 * Fire-and-forget. No recursive telemetry. Payloads < 2KB.
 * _corrId: lazy init — crypto.randomUUID not available in Node.js
 */

import { emitEvent } from "../lib/telemetry/emitter";
import type { GPUTier }        from "./gpuCapabilities";
import type { ComputeBackend } from "./gpuFallbacks";

let _corrId: string | null = null;
function corrId(): string {
  if(!_corrId) {
    _corrId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      ? crypto.randomUUID()
      : `gpu-${Date.now()}`;
  }
  return _corrId;
}

export const gpuTelemetry = {

  contextCreated(tier: GPUTier, adapter: string | null): void {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: corrId(), severity:"info",
      payload: { action:"GPU_CONTEXT_CREATED", tier, adapter_name: adapter ?? "unknown" },
    });
  },

  contextLost(tier: GPUTier): void {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: corrId(), severity:"error",
      payload: { action:"GPU_CONTEXT_LOST", tier },
    });
  },

  shaderFailed(name: string, error: string): void {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: corrId(), severity:"error",
      payload: { action:"GPU_SHADER_COMPILE_FAILED", shader_name:name, error:error.slice(0,200) },
    });
  },

  fallback(from: ComputeBackend, to: ComputeBackend, reason: string): void {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: corrId(), severity:"warn",
      payload: { action:"GPU_FALLBACK_TRIGGERED", from, to, reason },
    });
  },

  pressureSoft(mb: number): void {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: corrId(), severity:"warn",
      payload: { action:"GPU_PRESSURE_SOFT", vram_mb: mb },
    });
  },

  pressureHard(mb: number): void {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: corrId(), severity:"error",
      payload: { action:"GPU_PRESSURE_HARD", vram_mb: mb },
    });
  },
};
