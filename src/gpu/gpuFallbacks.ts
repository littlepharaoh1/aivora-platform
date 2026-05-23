/**
 * gpuFallbacks.ts — Deterministic GPU Fallback Chain
 * Aivora Platform — Phase 6A.2
 *
 * Pure functions — no side effects, no state.
 * Deterministic: same tier + same taskType → same backend.
 * Fallback chain: WebGPU → WebGL2 → WASM_SIMD → CPU_WORKER
 */

import type { GPUTier } from "./gpuCapabilities";

export type ComputeBackend =
  | "WEBGPU"
  | "WEBGL2"
  | "WASM_SIMD"
  | "CPU_WORKER";

export interface FallbackDecision {
  backend:   ComputeBackend;
  reason:    string;
  degraded:  boolean;
  gpu_tier:  GPUTier;
}

export function resolveComputeBackend(
  gpuTier:        GPUTier,
  taskType:       "FFT" | "SPECTROGRAM" | "FORENSIC" | "INFERENCE",
  contextLost:    boolean = false,
): FallbackDecision {

  // Context lost → immediate CPU fallback regardless of tier
  if(contextLost) {
    return { backend:"CPU_WORKER", reason:"gpu_context_lost", degraded:true, gpu_tier:gpuTier };
  }

  // FORENSIC: always CPU — math must be deterministic, not GPU-float-dependent
  if(taskType === "FORENSIC") {
    return { backend:"CPU_WORKER", reason:"forensic_deterministic_cpu", degraded:false, gpu_tier:gpuTier };
  }

  // INFERENCE: WebGPU preferred (ONNX Runtime Web)
  if(taskType === "INFERENCE") {
    if(gpuTier === "WEBGPU_FULL")    return { backend:"WEBGPU",     reason:"inference_webgpu",      degraded:false, gpu_tier:gpuTier };
    if(gpuTier === "WEBGPU_LIMITED") return { backend:"CPU_WORKER", reason:"inference_cpu_limited",  degraded:true,  gpu_tier:gpuTier };
    return                                  { backend:"CPU_WORKER", reason:"inference_cpu_fallback", degraded:true,  gpu_tier:gpuTier };
  }

  // FFT + SPECTROGRAM: GPU compute preferred
  switch(gpuTier) {
    case "WEBGPU_FULL":    return { backend:"WEBGPU",     reason:"fft_webgpu_compute",  degraded:false, gpu_tier:gpuTier };
    case "WEBGPU_LIMITED": return { backend:"WEBGL2",     reason:"fft_webgl2_fallback", degraded:false, gpu_tier:gpuTier };
    case "WEBGL2":         return { backend:"WEBGL2",     reason:"fft_webgl2",          degraded:false, gpu_tier:gpuTier };
    case "WEBGL1":         return { backend:"WASM_SIMD",  reason:"fft_wasm_simd",       degraded:true,  gpu_tier:gpuTier };
    case "CPU_ONLY":       return { backend:"CPU_WORKER", reason:"fft_cpu_only",         degraded:true,  gpu_tier:gpuTier };
  }
}

export function getFallbackChain(gpuTier: GPUTier): ComputeBackend[] {
  switch(gpuTier) {
    case "WEBGPU_FULL":    return ["WEBGPU", "WEBGL2", "WASM_SIMD", "CPU_WORKER"];
    case "WEBGPU_LIMITED": return ["WEBGL2", "WASM_SIMD", "CPU_WORKER"];
    case "WEBGL2":         return ["WEBGL2", "WASM_SIMD", "CPU_WORKER"];
    case "WEBGL1":         return ["WASM_SIMD", "CPU_WORKER"];
    case "CPU_ONLY":       return ["CPU_WORKER"];
  }
}
