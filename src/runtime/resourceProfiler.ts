/**
 * resourceProfiler.ts — Browser Resource Profiler
 * Aivora Platform — Phase 5.2
 *
 * Samples resource usage deterministically.
 * No ML. No probabilistic estimation.
 * All metrics derived from browser APIs only.
 */

export interface ResourceSnapshot {
  timestamp_ms:       number;
  js_heap_used_mb:    number;
  js_heap_limit_mb:   number;
  memory_pressure:    number;   // 0→1
  worker_count:       number;
  audio_context_count:number;
  webgl_context_lost: boolean;
  estimated_total_mb: number;
}

export interface ResourceCeiling {
  soft_limit_mb: number;
  hard_limit_mb: number;
}

// ── Ceilings ──────────────────────────────────────────────────────────────────

const DESKTOP_CEILING: ResourceCeiling = {
  soft_limit_mb: 1536,   // 1.5GB
  hard_limit_mb: 2048,   // 2GB
};

const MOBILE_CEILING: ResourceCeiling = {
  soft_limit_mb: 250,
  hard_limit_mb: 400,
};

function isMobile(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 2 && window.innerWidth < 1024)
  );
}

// ── ResourceProfiler ──────────────────────────────────────────────────────────

export class ResourceProfiler {
  private _ceiling: ResourceCeiling;
  private _lastSnapshot: ResourceSnapshot | null = null;
  private _glContextLost = false;

  constructor() {
    this._ceiling = isMobile() ? MOBILE_CEILING : DESKTOP_CEILING;
    this._listenForGLContextLoss();
  }

  // ── GL Context Loss Listener ──────────────────────────────────────────────

  private _listenForGLContextLoss(): void {
    // Track canvas context loss events globally
    document.addEventListener("webglcontextlost", () => {
      this._glContextLost = true;
    }, { capture: true, passive: true });
    document.addEventListener("webglcontextrestored", () => {
      this._glContextLost = false;
    }, { capture: true, passive: true });
  }

  // ── Sample ────────────────────────────────────────────────────────────────

  sample(): ResourceSnapshot {
    const mem    = (performance as any).memory;
    const heapUsed  = mem ? mem.usedJSHeapSize  / (1024 * 1024) : 0;
    const heapLimit = mem ? mem.jsHeapSizeLimit  / (1024 * 1024) : this._ceiling.hard_limit_mb;

    // Memory pressure relative to ceiling
    const memPressure = Math.max(0, Math.min(1,
      heapUsed / this._ceiling.soft_limit_mb
    ));

    const snapshot: ResourceSnapshot = {
      timestamp_ms:       Date.now(),
      js_heap_used_mb:    Math.round(heapUsed * 10) / 10,
      js_heap_limit_mb:   Math.round(heapLimit * 10) / 10,
      memory_pressure:    Math.round(memPressure * 10000) / 10000,
      worker_count:       0,   // updated by WorkerPool in Phase 5.4
      audio_context_count:0,   // updated by caller
      webgl_context_lost: this._glContextLost,
      estimated_total_mb: Math.round(heapUsed * 10) / 10,
    };

    this._lastSnapshot = snapshot;
    return snapshot;
  }

  getLastSnapshot(): ResourceSnapshot | null {
    return this._lastSnapshot;
  }

  getCeiling(): ResourceCeiling {
    return this._ceiling;
  }

  isSoftPressure(): boolean {
    const s = this.sample();
    return s.js_heap_used_mb >= this._ceiling.soft_limit_mb;
  }

  isHardPressure(): boolean {
    const s = this.sample();
    return s.js_heap_used_mb >= this._ceiling.hard_limit_mb;
  }
}

export const resourceProfiler = new ResourceProfiler();
