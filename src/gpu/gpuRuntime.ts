/**
 * gpuRuntime.ts — GPU Runtime Orchestration
 * Aivora Platform — Phase 6A.2
 *
 * Ownership map:
 *   GPUDevice      → owned by this class, destroyed in destroy()
 *   Canvas         → retained in _canvas, listeners removed in destroy()
 *   WebGL context  → tied to _canvas lifetime
 *   visibilitychange → registered in initialize(), removed in destroy()
 *
 * Lifecycle:
 *   initialize() → ACTIVE → [context loss] → DEGRADED → destroy() → DESTROYED
 *   [background/sleep] → visibilitychange → re-check device state
 *
 * Determinism:
 *   tier cached after first init — not re-detected on power state change
 *   Same init conditions → same backend selection
 *
 * VRAM note:
 *   Browser cannot measure VRAM directly.
 *   reportVRAMPressure() is called by subsystems tracking GPU texture allocations.
 *   Thresholds: soft=3GB, hard=6GB (typical discrete desktop GPU)
 */

import { getGPUCapabilities }              from "./gpuCapabilities";
import { resolveComputeBackend }            from "./gpuFallbacks";
import { gpuTelemetry }                     from "./gpuTelemetry";
import { scheduler }                        from "../runtime/runtimeScheduler";
import type { GPUTier }                     from "./gpuCapabilities";
import type { ComputeBackend, FallbackDecision } from "./gpuFallbacks";

interface GPURuntimeState {
  tier:             GPUTier;
  active_backend:   ComputeBackend;
  context_lost:     boolean;
  device:           any | null;
  gl2:              WebGL2RenderingContext | null;
  initialized:      boolean;
  vram_estimate_mb: number;
}

class GPURuntime {
  private _state: GPURuntimeState = {
    tier:"CPU_ONLY", active_backend:"CPU_WORKER",
    context_lost:false, device:null, gl2:null,
    initialized:false, vram_estimate_mb:0,
  };

  // Retained for cleanup symmetry
  private _canvas:                  HTMLCanvasElement | null    = null;
  private _onContextLost:           ((e:Event)=>void) | null   = null;
  private _onContextRestored:       ((e:Event)=>void) | null   = null;
  private _onVisibilityChange:      (()=>void) | null          = null;

  private _destroyed  = false;
  private _listeners: Set<(s: Readonly<GPURuntimeState>) => void> = new Set();

  // ── Initialize ────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if(this._state.initialized || this._destroyed) return;
    if(typeof document === "undefined") return;

    const caps = await getGPUCapabilities();
    this._state.tier = caps.tier;

    // ── WebGPU ───────────────────────────────────────────────────────────────
    if(caps.has_webgpu && !caps.is_software_rasterizer) {
      try {
        const adapter = await (navigator as any).gpu?.requestAdapter({
          powerPreference: "high-performance",
        });
        if(adapter) {
          const device = await adapter.requestDevice({
            requiredFeatures: caps.supports_f16 ? ["shader-f16"] : [],
          });

          // P0: .catch() on device.lost — unhandled rejection otherwise
          device.lost
            .then((info: any) => {
              if(this._destroyed) return;
              console.warn("[GPURuntime] Device lost:", info.reason);
              this._state.context_lost   = true;
              this._state.device         = null;
              this._state.active_backend = "CPU_WORKER";
              scheduler.updateGpuPressure(1.0);
              gpuTelemetry.contextLost(this._state.tier);
              this._notify();
            })
            .catch((e: unknown) => {
              console.warn("[GPURuntime] device.lost rejection:", e);
            });

          this._state.device         = device;
          this._state.active_backend = "WEBGPU";
          gpuTelemetry.contextCreated(caps.tier, caps.adapter_name);
        }
      } catch(e) {
        console.warn("[GPURuntime] WebGPU init failed:", e);
        gpuTelemetry.fallback("WEBGPU", "WEBGL2", "init_failed");
      }
    }

    // ── WebGL2 fallback ───────────────────────────────────────────────────────
    if(this._state.active_backend !== "WEBGPU" && caps.has_webgl2) {
      try {
        // P0: retain canvas in field — listeners require retained reference
        const canvas  = document.createElement("canvas");
        canvas.width  = 1;
        canvas.height = 1;
        const gl2 = canvas.getContext("webgl2");

        if(gl2) {
          this._canvas = canvas;
          this._state.gl2            = gl2;
          this._state.active_backend = "WEBGL2";
          gpuTelemetry.contextCreated(caps.tier, "webgl2");

          // P0: store handlers — removed in destroy()
          this._onContextLost = () => {
            if(this._destroyed) return;
            this._state.context_lost   = true;
            this._state.active_backend = "CPU_WORKER";
            scheduler.updateGpuPressure(1.0);
            gpuTelemetry.contextLost(this._state.tier);
            this._notify();
          };
          this._onContextRestored = () => {
            if(this._destroyed) return;
            this._state.context_lost   = false;
            this._state.active_backend = "WEBGL2";
            scheduler.updateGpuPressure(0.0);
            this._notify();
          };

          canvas.addEventListener("webglcontextlost",     this._onContextLost,     false);
          canvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
        }
      } catch(e) {
        console.warn("[GPURuntime] WebGL2 init failed:", e);
      }
    }

    // ── P1: visibilitychange — GPU recovery on wake ───────────────────────────
    this._onVisibilityChange = () => {
      if(this._destroyed || document.visibilityState !== "visible") return;
      if(this._state.context_lost && !this._state.device) {
        console.info("[GPURuntime] Visible again — attempting GPU recovery");
        this._state.initialized = false;
        this.initialize().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    this._state.initialized = true;
    this._notify();
  }

  // ── Backend Resolution ────────────────────────────────────────────────────

  resolveBackend(
    taskType: "FFT" | "SPECTROGRAM" | "FORENSIC" | "INFERENCE"
  ): FallbackDecision {
    return resolveComputeBackend(
      this._state.tier, taskType, this._state.context_lost
    );
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getDevice(): any | null          { return this._state.device; }
  getGL2(): WebGL2RenderingContext | null { return this._state.gl2; }
  isContextLost(): boolean         { return this._state.context_lost; }
  getTier(): GPUTier               { return this._state.tier; }
  getState(): Readonly<GPURuntimeState> { return { ...this._state }; }

  // ── VRAM Pressure ─────────────────────────────────────────────────────────

  reportVRAMPressure(usedMb: number): void {
    this._state.vram_estimate_mb = usedMb;
    const SOFT = 3000, HARD = 6000;
    if     (usedMb >= HARD) { scheduler.updateGpuPressure(1.0); gpuTelemetry.pressureHard(usedMb); }
    else if(usedMb >= SOFT) { scheduler.updateGpuPressure(0.7); gpuTelemetry.pressureSoft(usedMb); }
    else                    { scheduler.updateGpuPressure(Math.max(0, usedMb / HARD)); }
  }

  // ── State Listeners ───────────────────────────────────────────────────────

  onStateChange(cb: (s: Readonly<GPURuntimeState>) => void): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
  private _notify(): void {
    const s = this.getState();
    this._listeners.forEach(cb => { try { cb(s); } catch {} });
  }

  // ── Destroy (cleanup symmetry) ────────────────────────────────────────────
  // Every CREATE has matching DESTROY:
  //   requestDevice()          → device.destroy()
  //   canvas created           → canvas listeners removed
  //   addEventListener(vis)    → removeEventListener(vis)
  //   WebGL context            → WEBGL_lose_context.loseContext()

  destroy(): void {
    if(this._destroyed) return;
    this._destroyed = true;

    // Remove visibilitychange
    if(this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }

    // Remove canvas listeners + force context loss
    if(this._canvas) {
      if(this._onContextLost)
        this._canvas.removeEventListener("webglcontextlost",     this._onContextLost,     false);
      if(this._onContextRestored)
        this._canvas.removeEventListener("webglcontextrestored", this._onContextRestored, false);
      // Free GPU memory explicitly
      this._state.gl2?.getExtension("WEBGL_lose_context")?.loseContext();
      this._canvas             = null;
      this._onContextLost      = null;
      this._onContextRestored  = null;
    }

    // Destroy WebGPU device
    try { this._state.device?.destroy(); } catch {}
    this._state.device      = null;
    this._state.gl2         = null;
    this._state.initialized = false;
    this._listeners.clear();
  }
}

export const gpuRuntime = new GPURuntime();

// Auto-initialize in browser — non-blocking
if(typeof document !== "undefined") {
  gpuRuntime.initialize().catch(e =>
    console.warn("[GPURuntime] Init error:", e)
  );
}
