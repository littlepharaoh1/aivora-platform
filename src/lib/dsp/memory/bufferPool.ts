/**
 * bufferPool.ts — Pre-allocated DSP Buffer Pool
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Fixed-size pool per buffer size class
 * - acquire() / release() API — O(1) both directions
 * - Size classes: power-of-2 from 256 to 65536 samples
 * - Float32Array + Float64Array pools
 * - Automatic size-class selection (next power of 2)
 * - Pool exhaustion fallback: allocate on heap
 * - Poisoning in debug mode: detect use-after-release
 * - Zero GC pressure in steady state
 *
 * Design reference:
 * - jemalloc size-class slab model
 * - JUCE AudioScratchBuffer pattern
 * - Chrome media thread buffer pool
 * - Pro Tools TDM memory architecture
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE_CLASSES_F32 = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const SIZE_CLASSES_F64 = [256, 512, 1024, 2048, 4096, 8192, 16384];
const POOL_DEPTH       = 8;   // buffers per size class
const DEBUG_POISON     = false; // set true in dev to detect UAF

// ── Buffer Types ──────────────────────────────────────────────────────────────

export type BufferType = "f32" | "f64";

export interface PooledBuffer<T extends Float32Array | Float64Array> {
  readonly data:      T;
  readonly sizeClass: number;   // actual allocated size
  readonly type:      BufferType;
  _poolRef:           BufferPool; // back-reference for release
  _released:          boolean;    // UAF guard
}

// ── Pool Slab ─────────────────────────────────────────────────────────────────

class PoolSlab<T extends Float32Array | Float64Array> {
  private readonly free:  T[];
  private readonly alloc: () => T;
  private acquireCount = 0;
  private missCount    = 0;

  constructor(size: number, factory: (n: number) => T, depth = POOL_DEPTH) {
    this.alloc = () => factory(size);
    this.free  = Array.from({ length: depth }, () => factory(size));
  }

  acquire(): T {
    this.acquireCount++;
    if(this.free.length > 0) {
      const buf = this.free.pop()!;
      if(DEBUG_POISON) buf.fill(0);
      return buf;
    }
    // Pool exhausted — heap fallback
    this.missCount++;
    return this.alloc();
  }

  release(buf: T): void {
    if(this.free.length < POOL_DEPTH) {
      if(DEBUG_POISON) buf.fill(Number.NaN); // poison to detect UAF
      this.free.push(buf);
    }
    // If pool full — let GC reclaim
  }

  get stats() {
    return {
      freeCount:    this.free.length,
      acquireCount: this.acquireCount,
      missCount:    this.missCount,
      missRate:     this.acquireCount > 0 ? this.missCount / this.acquireCount : 0,
    };
  }
}

// ── Buffer Pool ───────────────────────────────────────────────────────────────

export class BufferPool {
  private readonly f32Slabs = new Map<number, PoolSlab<Float32Array>>();
  private readonly f64Slabs = new Map<number, PoolSlab<Float64Array>>();

  constructor() {
    // Pre-warm all size classes
    for(const sz of SIZE_CLASSES_F32)
      this.f32Slabs.set(sz, new PoolSlab(sz, n => new Float32Array(n)));
    for(const sz of SIZE_CLASSES_F64)
      this.f64Slabs.set(sz, new PoolSlab(sz, n => new Float64Array(n)));
  }

  // ── Size Class Selection ────────────────────────────────────────────────────

  private static nextSizeClass(n: number, classes: number[]): number {
    for(const sz of classes) if(sz >= n) return sz;
    return n; // larger than all classes — heap alloc
  }

  // ── Acquire ─────────────────────────────────────────────────────────────────

  acquireF32(minSize: number): PooledBuffer<Float32Array> {
    const sizeClass = BufferPool.nextSizeClass(minSize, SIZE_CLASSES_F32);
    const slab      = this.f32Slabs.get(sizeClass);
    const data      = slab ? slab.acquire() : new Float32Array(sizeClass);
    return { data, sizeClass, type:"f32", _poolRef:this, _released:false };
  }

  acquireF64(minSize: number): PooledBuffer<Float64Array> {
    const sizeClass = BufferPool.nextSizeClass(minSize, SIZE_CLASSES_F64);
    const slab      = this.f64Slabs.get(sizeClass);
    const data      = slab ? slab.acquire() : new Float64Array(sizeClass);
    return { data, sizeClass, type:"f64", _poolRef:this, _released:false };
  }

  // ── Release ──────────────────────────────────────────────────────────────────

  release<T extends Float32Array | Float64Array>(buf: PooledBuffer<T>): void {
    if(buf._released) {
      if(DEBUG_POISON) throw new Error("[BufferPool] Double-release detected");
      return;
    }
    (buf as { _released: boolean })._released = true;

    if(buf.type === "f32") {
      const slab = this.f32Slabs.get(buf.sizeClass);
      slab?.release(buf.data as Float32Array);
    } else {
      const slab = this.f64Slabs.get(buf.sizeClass);
      slab?.release(buf.data as Float64Array);
    }
  }

  // ── RAII Helper ──────────────────────────────────────────────────────────────

  /**
   * Borrow a F32 buffer, use it, auto-release.
   * Prevents release() forget bugs.
   */
  withF32<R>(minSize: number, fn: (data: Float32Array) => R): R {
    const buf = this.acquireF32(minSize);
    try {
      return fn(buf.data.subarray(0, minSize));
    } finally {
      this.release(buf);
    }
  }

  withF64<R>(minSize: number, fn: (data: Float64Array) => R): R {
    const buf = this.acquireF64(minSize);
    try {
      return fn(buf.data.subarray(0, minSize));
    } finally {
      this.release(buf);
    }
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────────

  exportStats(): {
    f32: { sizeClass: number; freeCount: number; missRate: number }[];
    f64: { sizeClass: number; freeCount: number; missRate: number }[];
    totalSizeClassesF32: number;
    totalSizeClassesF64: number;
  } {
    const f32 = Array.from(this.f32Slabs.entries()).map(([sz, slab]) => ({
      sizeClass: sz, ...slab.stats,
    }));
    const f64 = Array.from(this.f64Slabs.entries()).map(([sz, slab]) => ({
      sizeClass: sz, ...slab.stats,
    }));
    return {
      f32,
      f64,
      totalSizeClassesF32: f32.length,
      totalSizeClassesF64: f64.length,
    };
  }

  /**
   * Estimated total pre-allocated memory.
   */
  estimatedMemoryKB(): number {
    let bytes = 0;
    for(const sz of SIZE_CLASSES_F32) bytes += sz * 4 * POOL_DEPTH;
    for(const sz of SIZE_CLASSES_F64) bytes += sz * 8 * POOL_DEPTH;
    return Math.round(bytes / 1024);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const bufferPool = new BufferPool();
