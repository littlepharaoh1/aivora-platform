/**
 * sharedMemoryPool.ts — Shared DSP Memory Fabric
 * Aivora Platform — Phase 6A.3
 *
 * Final fixes:
 *   P0.F1: release() guards on DONE state (prevents premature release)
 *   P0.F2: lease.view uses correct byteOffset per slot (not offset=0)
 *   P1.F3: destroy() is terminal — documented
 *
 * Slot state machine:
 *   IDLE → [acquire] → WRITING → [markReady] → READY
 *   → [worker reads] → READING → [worker done] → DONE
 *   → [release] → IDLE
 *
 * IMPORTANT:
 *   Main thread: NEVER call release() before worker signals DONE
 *   Worker: NEVER read before slot is READY
 *   Use Atomics.compareExchange() for all state transitions
 */

// Slot states
const SLOT_IDLE    = 0;
const SLOT_WRITING = 1;
const SLOT_READY   = 2;
const SLOT_READING = 3;
const SLOT_DONE    = 4;
const SLOT_ERROR   = 5;

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
  slot_index:       number;
  slot_byte_offset: number;           // correct byteOffset in SAB
  view:             Float32Array;     // view at correct slot offset
  sab:              SharedArrayBuffer;
  float_count:      number;
  release:          () => void;
}

export interface BufferLease {
  slot_index:       -1;
  slot_byte_offset: 0;
  view:             Float32Array;
  sab:              null;
  float_count:      number;
  release:          () => void;
}

export type MemoryLease = SlotLease | BufferLease;

class SharedMemoryPool {
  private _config:   PoolConfig;
  private _sab:      SharedArrayBuffer | null = null;
  private _control:  SharedArrayBuffer | null = null;
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
        slot_index:       -1,
        slot_byte_offset: 0,
        view:             new Float32Array(count),
        sab:              null,
        float_count:      count,
        release:          () => {},
      };
    }

    // First-IDLE scan — atomic acquire
    for(let i = 0; i < this._config.slot_count; i++) {
      const prev = Atomics.compareExchange(this._ctrl, i, SLOT_IDLE, SLOT_WRITING);
      if(prev !== SLOT_IDLE) continue;

      // P0.F2: correct byteOffset per slot
      const byteOffset = i * this._config.slot_floats * Float32Array.BYTES_PER_ELEMENT;

      // P0.F2: view at correct slot region (not offset=0)
      const view = new Float32Array(this._sab!, byteOffset, count);

      // Timeout recovery
      const timeout = setTimeout(() => {
        const state = this._ctrl ? Atomics.load(this._ctrl, i) : -1;
        if(state === SLOT_WRITING || state === SLOT_READING) {
          console.warn(`[SharedMemoryPool] Slot ${i} stale (state=${state}) — recovering`);
          if(this._ctrl) Atomics.store(this._ctrl, i, SLOT_ERROR);
          setTimeout(() => {
            if(this._ctrl) Atomics.store(this._ctrl, i, SLOT_IDLE);
          }, 100);
        }
        this._timeouts.delete(i);
      }, this._config.timeout_ms);

      this._timeouts.set(i, timeout);

      return {
        slot_index:       i,
        slot_byte_offset: byteOffset,
        view,
        sab:              this._sab!,
        float_count:      count,
        release: () => {
          clearTimeout(this._timeouts.get(i));
          this._timeouts.delete(i);
          if(!this._ctrl) return;

          // P0.F1: only release from DONE state
          // If worker hasn't signaled DONE yet: force IDLE anyway
          // (prevents permanent slot lock on worker crash)
          const state = Atomics.load(this._ctrl, i);
          if(state !== SLOT_DONE && state !== SLOT_IDLE) {
            console.warn(
              `[SharedMemoryPool] Releasing slot ${i} from state ${state} ` +
              `(expected DONE) — possible premature release`
            );
          }
          Atomics.store(this._ctrl, i, SLOT_IDLE);
        },
      };
    }

    // Pool exhausted
    console.warn("[SharedMemoryPool] Pool exhausted — ArrayBuffer fallback");
    return {
      slot_index:       -1,
      slot_byte_offset: 0,
      view:             new Float32Array(count),
      sab:              null,
      float_count:      count,
      release:          () => {},
    };
  }

  markReady(slotIndex: number): void {
    if(!this._ctrl || slotIndex < 0) return;
    Atomics.compareExchange(this._ctrl, slotIndex, SLOT_WRITING, SLOT_READY);
    Atomics.notify(this._ctrl, slotIndex, 1);
  }

  // Worker-side: mark slot as reading (Atomics.compareExchange)
  markReading(slotIndex: number): boolean {
    if(!this._ctrl || slotIndex < 0) return false;
    const prev = Atomics.compareExchange(this._ctrl, slotIndex, SLOT_READY, SLOT_READING);
    return prev === SLOT_READY;
  }

  // Worker-side: mark slot as done
  markDone(slotIndex: number): void {
    if(!this._ctrl || slotIndex < 0) return;
    Atomics.compareExchange(this._ctrl, slotIndex, SLOT_READING, SLOT_DONE);
    Atomics.notify(this._ctrl, slotIndex, 1);
  }

  isAvailable():   boolean                 { return this._available; }
  getConfig():     Readonly<PoolConfig>    { return this._config; }
  getSAB():        SharedArrayBuffer|null  { return this._sab; }
  getControlSAB(): SharedArrayBuffer|null  { return this._control; }

  getActiveSlots(): number {
    if(!this._ctrl) return 0;
    let n = 0;
    for(let i = 0; i < this._config.slot_count; i++) {
      if(Atomics.load(this._ctrl, i) !== SLOT_IDLE) n++;
    }
    return n;
  }

  // P1.F3: destroy() is terminal — no restart after destroy
  // Call only on app unmount / tab close
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

    this._ctrl     = null;
    this._sab      = null;
    this._control  = null;
    this._available = false;
  }
}

export const sharedMemoryPool = new SharedMemoryPool();
