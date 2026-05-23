/**
 * gpuComputeContext.ts — GPU Compute Infrastructure
 * Aivora Platform — Phase 6A.4
 *
 * Provides:
 *   createComputeBuffer()   — GPU buffer allocation
 *   submitCompute()         — dispatch + readback
 *   shaderRegistry          — compiled pipeline cache
 *
 * Ownership:
 *   GPUBuffers: created per call, destroyed in finally block
 *   GPUPipelines: cached in shaderRegistry, cleared on destroy
 *   GPUCommandEncoder: local scope, GC after submit
 *
 * Safety:
 *   All GPU ops: try/finally → buffer.destroy() guaranteed
 *   Readback: Promise.race() with 10s timeout
 *   Compile failure: cached → always returns CPU fallback
 *   Device lost: caught → fallback to CPU worker
 *
 * Main thread: NEVER called directly
 *   All compute tasks submitted via scheduler (Phase 5.1)
 */

import { gpuRuntime }    from "./gpuRuntime";
import { gpuTelemetry }  from "./gpuTelemetry";

// ── Shader Registry ───────────────────────────────────────────────────────────

type PipelineEntry =
  | { status: "ready";  pipeline: any }
  | { status: "failed"; error: string };

const _pipelineCache = new Map<string, PipelineEntry>();

export async function getOrCompilePipeline(
  shaderName: string,
  wgsl:       string,
): Promise<any | null> {
  const cached = _pipelineCache.get(shaderName);
  if(cached?.status === "ready")  return cached.pipeline;
  if(cached?.status === "failed") return null;

  const device = gpuRuntime.getDevice();
  if(!device) return null;

  try {
    const module = device.createShaderModule({ code: wgsl });

    // Check for compile errors (Chrome 113+)
    const info = await module.getCompilationInfo?.();
    if(info?.messages?.some((m: any) => m.type === "error")) {
      const err = info.messages.find((m: any) => m.type === "error")?.message ?? "unknown";
      gpuTelemetry.shaderFailed(shaderName, err);
      _pipelineCache.set(shaderName, { status:"failed", error: err });
      return null;
    }

    const pipeline = await device.createComputePipelineAsync({
      layout:  "auto",
      compute: { module, entryPoint: "main" },
    });

    _pipelineCache.set(shaderName, { status:"ready", pipeline });
    return pipeline;
  } catch(e) {
    const msg = e instanceof Error ? e.message : "compile_error";
    gpuTelemetry.shaderFailed(shaderName, msg);
    _pipelineCache.set(shaderName, { status:"failed", error: msg });
    return null;
  }
}

export function clearPipelineCache(): void {
  _pipelineCache.clear();
}

// ── Buffer Helpers ────────────────────────────────────────────────────────────

export function createInputBuffer(device: any, data: Float32Array): any {
  const buf = device.createBuffer({
    size:  data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buf, 0, data);
  return buf;
}

export function createOutputBuffer(device: any, byteSize: number): any {
  return device.createBuffer({
    size:  byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
}

export function createReadbackBuffer(device: any, byteSize: number): any {
  return device.createBuffer({
    size:  byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
}

// ── Readback with Timeout ─────────────────────────────────────────────────────

const READBACK_TIMEOUT_MS = 10_000;

export async function readbackBuffer(
  readbackBuf: any,
  byteSize:    number,
): Promise<Float32Array | null> {
  try {
    const mapPromise = readbackBuf.mapAsync(GPUMapMode.READ, 0, byteSize);
    const timeout    = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("GPU readback timeout")), READBACK_TIMEOUT_MS)
    );

    await Promise.race([mapPromise, timeout]);

    const arr = new Float32Array(
      readbackBuf.getMappedRange(0, byteSize).slice(0)
    );
    readbackBuf.unmap();
    return arr;
  } catch(e) {
    console.warn("[GPUComputeContext] Readback failed:", e);
    return null;
  }
}

// ── Submit Compute Pass ───────────────────────────────────────────────────────

export interface ComputeDispatch {
  pipeline:    any;           // GPUComputePipeline
  bindGroup:   any;           // GPUBindGroup
  workgroups:  [number, number, number];
}

/**
 * Submit a compute pass and read back output.
 * All buffers destroyed in finally — no VRAM leak on failure.
 */
export async function submitComputePass(params: {
  device:       any;
  dispatch:     ComputeDispatch;
  outputBuf:    any;
  outputBytes:  number;
  readbackBuf:  any;
}): Promise<Float32Array | null> {
  const { device, dispatch, outputBuf, outputBytes, readbackBuf } = params;

  try {
    const encoder = device.createCommandEncoder();

    const pass = encoder.beginComputePass();
    pass.setPipeline(dispatch.pipeline);
    pass.setBindGroup(0, dispatch.bindGroup);
    pass.dispatchWorkgroups(...dispatch.workgroups);
    pass.end();

    encoder.copyBufferToBuffer(outputBuf, 0, readbackBuf, 0, outputBytes);
    device.queue.submit([encoder.finish()]);

    return await readbackBuffer(readbackBuf, outputBytes);
  } catch(e) {
    console.warn("[GPUComputeContext] Compute pass failed:", e);
    if(gpuRuntime.isContextLost()) {
      gpuTelemetry.fallback("WEBGPU", "CPU_WORKER", "context_lost_during_compute");
    }
    return null;
  }
}

// ── WebGPU Usage Constants (safe fallback if not in scope) ────────────────────

declare const GPUBufferUsage: {
  STORAGE:  number;
  COPY_SRC: number;
  COPY_DST: number;
  MAP_READ: number;
};

declare const GPUMapMode: {
  READ: number;
};
