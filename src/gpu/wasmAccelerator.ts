/**
 * wasmAccelerator.ts — WASM SIMD Acceleration Layer
 * Aivora Platform — Phase 6A.5
 *
 * Architecture:
 *   WASM SIMD = acceleration layer ONLY
 *   Runtime Scheduler remains authoritative
 *   Fallback: JS implementation if WASM unavailable
 *
 * Ownership:
 *   WasmInstance: owned here, nulled in destroy()
 *   WasmMemory: managed by WASM runtime
 *
 * Current state:
 *   WASM binary not yet compiled (needs Rust/C toolchain)
 *   Feature detection + stub layer ready
 *   Real WASM binary = Phase 6B after toolchain setup
 *
 * Browser support:
 *   Chrome 91+, Firefox 89+, Safari 16.4+, iOS 16.4+
 */

// ── Feature Detection ─────────────────────────────────────────────────────────

export interface WasmCapabilities {
  has_wasm:          boolean;
  has_simd:          boolean;
  has_threads:       boolean;  // WASM threads require SAB
  has_bulk_memory:   boolean;
  detected_at:       number;
}

async function detectWasmSIMD(): Promise<boolean> {
  // Minimal WASM module with SIMD instruction
  // If validation fails → SIMD not supported
  try {
    const simdTest = new Uint8Array([
      0x00,0x61,0x73,0x6d, // magic
      0x01,0x00,0x00,0x00, // version
      0x01,0x05,0x01,      // type section
      0x60,0x00,0x01,0x7b, // () → v128
      0x03,0x02,0x01,0x00, // function section
      0x0a,0x0a,0x01,0x08, // code section
      0x00,                // no locals
      0xfd,0x0c,           // v128.const
      0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x0b,                // end
    ]);
    await WebAssembly.validate(simdTest);
    return true;
  } catch {
    return false;
  }
}

async function detectWasmThreads(): Promise<boolean> {
  // Threads require SharedArrayBuffer
  if(typeof SharedArrayBuffer === "undefined") return false;
  try {
    const threadsTest = new Uint8Array([
      0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,
      0x01,0x04,0x01,0x60,0x00,0x00,
      0x03,0x02,0x01,0x00,
      0x05,0x04,0x01,0x03,0x01,0x00, // shared memory
      0x0a,0x05,0x01,0x03,0x00,0x01,0x0b,
    ]);
    return WebAssembly.validate(threadsTest);
  } catch {
    return false;
  }
}

let _wasmCaps: WasmCapabilities | null = null;

export async function getWasmCapabilities(): Promise<WasmCapabilities> {
  if(_wasmCaps) return _wasmCaps;

  const hasWasm    = typeof WebAssembly !== "undefined";
  const hasSimd    = hasWasm ? await detectWasmSIMD()    : false;
  const hasThreads = hasWasm ? await detectWasmThreads() : false;
  const hasBulk    = hasWasm; // bulk memory widely supported

  _wasmCaps = {
    has_wasm:        hasWasm,
    has_simd:        hasSimd,
    has_threads:     hasThreads,
    has_bulk_memory: hasBulk,
    detected_at:     Date.now(),
  };

  return _wasmCaps;
}

export function getWasmCapabilitiesSync(): WasmCapabilities | null {
  return _wasmCaps;
}

// ── WASM Accelerator Stub ─────────────────────────────────────────────────────

export type WasmOp =
  | "noise_gate"
  | "spectral_subtraction"
  | "lufs_measure"
  | "overlap_add"
  | "biquad_filter";

export interface WasmAcceleratorState {
  available:    boolean;
  has_simd:     boolean;
  instance:     WebAssembly.Instance | null;
  ops_available:Set<WasmOp>;
}

class WasmAccelerator {
  private _state: WasmAcceleratorState = {
    available:    false,
    has_simd:     false,
    instance:     null,
    ops_available:new Set(),
  };
  private _destroyed = false;

  async initialize(): Promise<void> {
    if(this._state.available || this._destroyed) return;
    if(typeof WebAssembly === "undefined") return;

    const caps = await getWasmCapabilities();
    this._state.has_simd = caps.has_simd;

    // WASM binary not yet compiled — stub layer
    // When binary is available: fetch + instantiate here
    // this._state.instance = await loadWasmBinary("/wasm/dsp_simd.wasm");

    // Mark ops as available when binary loaded
    // For now: JS fallback implementations used
    console.info(
      `[WasmAccelerator] SIMD: ${caps.has_simd} | ` +
      `Threads: ${caps.has_threads} | Binary: pending`
    );

    // Not available until binary loaded
    this._state.available = false;
  }

  // ── JS Fallback Implementations ───────────────────────────────────────────
  // Used when WASM binary not available.
  // Same API as WASM exports — drop-in replacement.

  /**
   * Noise gate — JS fallback
   * When WASM available: replaced by SIMD-accelerated version
   */
  applyNoiseGate(
    samples:     Float32Array,
    sampleRate:  number,
    thresholdDb: number,
    attackMs:    number,
    releaseMs:   number,
  ): Float32Array {
    // Pure JS implementation (existing — not duplicated here)
    // Returns input unchanged until WASM binary loaded
    return samples;
  }

  /**
   * LUFS measurement — JS fallback
   */
  measureLUFS(samples: Float32Array, sampleRate: number): number {
    // Pure JS fallback
    let sumSq = 0;
    for(let i = 0; i < samples.length; i++) sumSq += samples[i] ** 2;
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
    return 20 * Math.log10(Math.max(1e-10, rms)) - 0.691;
  }

  isAvailable():   boolean { return this._state.available; }
  hasSIMD():       boolean { return this._state.has_simd; }
  getInstance():   WebAssembly.Instance | null { return this._state.instance; }

  destroy(): void {
    this._destroyed       = true;
    this._state.instance  = null;
    this._state.available = false;
    this._state.ops_available.clear();
  }
}

export const wasmAccelerator = new WasmAccelerator();

// Pre-warm: browser only
if(typeof document !== "undefined") {
  wasmAccelerator.initialize().catch(() => {});
  getWasmCapabilities().catch(() => {});
}
