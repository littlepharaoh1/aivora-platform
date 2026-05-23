/**
 * tensorMemory.ts — Tensor Memory Governance
 * Aivora Platform — Phase 6B.3
 *
 * Rules:
 *   - MAX tensor size: 64MB per allocation
 *   - MAX concurrent tensors: 8
 *   - Tensors ephemeral — never cached
 *   - Counter incremented AFTER successful allocation (no leak on OOM)
 *   - release() safe to call multiple times (Math.max guard)
 */

const MAX_TENSOR_BYTES  = 64 * 1024 * 1024;
const MAX_TENSOR_COUNT  = 8;
const MAX_FRAME_SAMPLES = 48000 * 300;  // 5min at 48kHz
const MAX_BATCH_SIZE    = 32;

let _activeTensorCount = 0;

export interface TensorSpec {
  dims:        number[];
  dtype:       "float32" | "int32" | "int64";
  description: string;
}

export interface TensorCheckResult {
  allowed:  boolean;
  reason:   string | null;
  byteSize: number;
}

export function checkTensorAllocation(spec: TensorSpec): TensorCheckResult {
  const elementCount = spec.dims.reduce((a, b) => a * b, 1);
  const bytesPerElem = spec.dtype === "int64" ? 8 : 4;
  const byteSize     = elementCount * bytesPerElem;

  if(byteSize > MAX_TENSOR_BYTES)
    return { allowed:false, reason:`tensor_too_large: ${(byteSize/1024/1024).toFixed(1)}MB > 64MB`, byteSize };
  if(_activeTensorCount >= MAX_TENSOR_COUNT)
    return { allowed:false, reason:`too_many_tensors: ${_activeTensorCount}/${MAX_TENSOR_COUNT}`, byteSize };
  if(spec.dims.some(d => d <= 0 || !isFinite(d)))
    return { allowed:false, reason:`invalid_dims: ${JSON.stringify(spec.dims)}`, byteSize };

  return { allowed:true, reason:null, byteSize };
}

export interface TensorLease {
  data:    Float32Array | Int32Array;
  dims:    number[];
  dtype:   "float32" | "int32";
  release: () => void;
}

export function allocateTensor(spec: TensorSpec): TensorLease | null {
  const check = checkTensorAllocation(spec);
  if(!check.allowed) {
    console.warn(`[TensorMemory] Rejected: ${check.reason}`);
    return null;
  }

  const count = spec.dims.reduce((a, b) => a * b, 1);

  // Allocate FIRST — increment counter only on success
  let data: Float32Array | Int32Array;
  try {
    data = spec.dtype === "int32" ? new Int32Array(count) : new Float32Array(count);
  } catch {
    console.warn("[TensorMemory] Allocation failed (OOM)");
    return null;
  }

  _activeTensorCount++;

  return {
    data: data as Float32Array | Int32Array,
    dims: spec.dims,
    dtype: spec.dtype === "int64" ? "float32" : spec.dtype,
    release: () => {
      _activeTensorCount = Math.max(0, _activeTensorCount - 1);
    },
  };
}

export function validateFrameSize(samples: number): boolean {
  return samples > 0 && samples <= MAX_FRAME_SAMPLES && isFinite(samples);
}

export function validateBatchSize(size: number): boolean {
  return size > 0 && size <= MAX_BATCH_SIZE;
}

export function getActiveTensorCount(): number { return _activeTensorCount; }

export const TENSOR_LIMITS = {
  MAX_TENSOR_BYTES,
  MAX_TENSOR_COUNT,
  MAX_FRAME_SAMPLES,
  MAX_BATCH_SIZE,
} as const;
