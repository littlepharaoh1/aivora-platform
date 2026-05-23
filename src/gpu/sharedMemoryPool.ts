/**
 * sharedMemoryPool.ts — Shared DSP Memory Fabric
 * Aivora Platform — Phase 6A.3
 *
 * Ownership:
 *   SAB: owned by pool singleton (session lifetime)
 *   Slots: leased to callers, released after use
 *   Views: Float32Array on SAB — GC when lease released
 *
 * Safety:
 *   Atomics.compareExchange() → slot acquisition (no race)
 *   Slot status: IDLE/WRITING/READY/ERROR (Int32Array)
 *   Timeout recovery: crashed writer → slot reset to IDLE
 *   NEVER Atomics.wait() on main thread (blocks Chrome)
 *   Fallback: plain ArrayBuffer if SAB unavailable
 *
 * Determinism:
 *   Slot scan: first IDLE (deterministic)
 *   Atomics: sequentially consistent
 *   Float32/IEEE 754: identical across platforms
 *
 * Memory:
 *   Desktop: 8 slots × 4MB = 32MB SAB
 *   Mobile:  4 slots × 2MB = 8MB SAB
 */

const SLOT_IDLE    = 0;
const SLOT_WRITING = 1;
const SLOT_READY   = 2;
const SLOT_ERROR   = 3;

interface PoolConfig {
  slot_count:  number;
  slot_floats: number;
  timeout_ms:  number;
}

const DESKTOP_CONFIG: PoolConfig = {
  slot_count:  8,
  slot_floats: 1_048_576,  // 4MB per slot
  timeout_ms:  5_000,
};

const MOBILE_CONFIG: PoolConfig = {
  slot_count:  4,
  slot_floats: 524_288,    // 2MB per slot
  timeout_ms:  5_000,
};

function isMobile(): boolean {
  return typeof navigator !== "undefined" && (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 2 && window.innerWidth < 1024)
  );
}

export interface SlotLease {
  slot_index:  number;
  view:        Float32Array;
  sab:         SharedArrayBuffer;
  float_count: number;
  release:     () => void;
}

export interface BufferLease {
  slot_index:  -1;
  view:        Float32Array;
  sab:         null;
  float_count: number;
  release:     () => void;
}

export type MemoryLease = SlotLease | BufferLease;

class SharedMemoryPool {
  private _config:   PoolConfig;
  private _sab:      SharedArrayBuffer | null = null;
  private _control:  SharedArrayBuffer | null = null;
  private _data:     Float32Array      | null = null;
  private _ctrl:     Int32Array        | null = null;
  private _timeouts: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private _available = false;
  private _destroyed = false;

  constructor() {
    this._config = isMobile() ? MOBILE_CONFIG : DESKTOP_CONFIG;
    this._init();
  }

  private _init(): void {
    if(typeof SharedArrayBuffer === "undefined") {
      console.warn("[SharedMemoryPool] SAB unavailable — fallback mode");
      return;
    }
    try {
      const dataBytes    = this._config.slot_count
        * this._config.slot_floats * Float32Array.BYTES_PER_ELEMENT;
      const controlBytes = this._config.slot_count * Int32Array.BYTES_PER_ELEMENT;

      this._sab     = new SharedArrayBuffer(dataBytes);
      this._control = new SharedArrayBuffer(controlBytes);
      this._data    = new Float32Array(this._sab);
      this._ctrl    = new Int32Array(this._control);

      for(let i = 0; i < this._config.slot_count; i++) {
        Atomics.store(this._ctrl, i, SLOT_IDLE);
      }
      this._available = true;
    } catch(e) {
      console.warn("[SharedMemoryPool] Init failed:", e);
    }
  }

  acquire(floatCount?: number): MemoryLease | null {
    if(this._destroyed) return null;
    const count = Math.min(
      floatCount ?? this._config.slot_floats,
      this._config.slot_floats
    );

    // Fallback path
    if(!this._available || !this._sab || !this._ctrl) {
      return {
        slot_index: -1,
        view:       new Float32Array(count),
        sab:        null,
        float_count:count,
        release:    () => {},
      };
    }

    // First-IDLE scan with compareExchange (atomic — no race)
    for(let i = 0; i < this._config.slot_count; i++) {
      const prev = Atomics.compareExchange(this._ctrl, i, SLOT_IDLE, SLOT_WRITING);
      if(prev !== SLOT_IDLE) continue;

      const byteOffset = i * this._config.slot_floats * Float32Array.BYTES_PER_ELEMENT;
      const view       = new Float32Array(this._sab!, byteOffset, count);

      // Timeout recovery — writer crash protection
      const timeout = setTimeout(() => {
        if(this._ctrl && Atomics.load(this._ctrl, i) === SLOT_WRITING) {
          console.warn(`[SharedMemoryPool] Slot ${i} timeout — recovering`);
          Atomics.store(this._ctrl, i, SLOT_ERROR);
          setTimeout(() => {
            if(this._ctrl) Atomics.store(this._ctrl, i, SLOT_IDLE);
          }, 100);
        }
        this._timeouts.delete(i);
      }, this._config.timeout_ms);

      this._timeouts.set(i, timeout);

      return {
        slot_index:  i,
        view,
        sab:         this._sab!,
        float_count: count,
        release: () => {
          clearTimeout(this._timeouts.get(i));
          this._timeouts.delete(i);
          if(this._ctrl) Atomics.store(this._ctrl, i, SLOT_IDLE);
        },
      };
    }

    // Pool exhausted → ArrayBuffer fallback
    console.warn("[SharedMemoryPool] Pool exhausted — ArrayBuffer fallback");
    return {
      slot_index: -1,
      view:       new Float32Array(count),
      sab:        null,
      float_count:count,
      release:    () => {},
    };
  }

  markReady(slotIndex: number): void {
    if(!this._ctrl || slotIndex < 0) return;
    Atomics.store(this._ctrl, slotIndex, SLOT_READY);
    Atomics.notify(this._ctrl, slotIndex, 1);
  }

  isAvailable():   boolean                       { return this._available; }
  getConfig():     Readonly<PoolConfig>           { return this._config; }
  getSAB():        SharedArrayBuffer | null       { return this._sab; }
  getControlSAB(): SharedArrayBuffer | null       { return this._control; }

  getActiveSlots(): number {
    if(!this._ctrl) return 0;
    let n = 0;
    for(let i = 0; i < this._config.slot_count; i++) {
      if(Atomics.load(this._ctrl, i) !== SLOT_IDLE) n++;
    }
    return n;
  }

  // Cleanup symmetry:
  //   new SharedArrayBuffer() → refs nulled (GC)
  //   Timeouts created        → cleared
  //   Atomics locks acquired  → reset to IDLE

  destroy(): void {
    if(this._destroyed) return;
    this._destroyed = true;

    this._timeouts.forEach(t => clearTimeout(t));
    this._timeouts.clear();

    if(this._ctrl) {
      for(let i = 0; i < this._config.slot_count; i++) {
        Atomics.store(this._ctrl, i, SLOT_IDLE);
      }
    }

    this._data    = null;
    this._ctrl    = null;
    this._sab     = null;
    this._control = null;
    this._available = false;
  }
}

export const sharedMemoryPool = new SharedMemoryPool();
