/**
 * resourceGovernor.ts — Deterministic Resource Governor
 * Aivora Platform — Phase 5.2
 *
 * Governance rules:
 * - Soft pressure: reduce FPS, reduce workers, reduce spectrogram density
 * - Hard pressure: stop similarity, pause analytics, block repairs, evict cache
 * - All decisions deterministic: same pressure → same action
 * - Non-blocking: governance decisions are synchronous
 * - No ML, no probabilistic balancing
 */

import { scheduler }                  from "./runtimeScheduler";
import { resourceProfiler }           from "./resourceProfiler";
import type { RuntimeExecutionMode }  from "./runtimeTypes";
import { PRESSURE_SOFT_THRESHOLD, PRESSURE_HARD_THRESHOLD } from "./runtimeConstants";

// ── Governance Policy ─────────────────────────────────────────────────────────

export interface GovernancePolicy {
  max_fps:               number;
  max_workers:           number;
  spectrogram_density:   "FULL" | "REDUCED" | "MINIMAL";
  similarity_enabled:    boolean;
  analytics_enabled:     boolean;
  repair_enabled:        boolean;
  new_file_load_enabled: boolean;
}

const POLICIES: Record<RuntimeExecutionMode, GovernancePolicy> = {
  DESKTOP_ULTRA: {
    max_fps:               60,
    max_workers:           6,
    spectrogram_density:   "FULL",
    similarity_enabled:    true,
    analytics_enabled:     true,
    repair_enabled:        true,
    new_file_load_enabled: true,
  },
  DESKTOP_BALANCED: {
    max_fps:               45,
    max_workers:           4,
    spectrogram_density:   "REDUCED",
    similarity_enabled:    true,
    analytics_enabled:     true,
    repair_enabled:        true,
    new_file_load_enabled: true,
  },
  MOBILE_SAFE: {
    max_fps:               30,
    max_workers:           2,
    spectrogram_density:   "REDUCED",
    similarity_enabled:    false,
    analytics_enabled:     false,
    repair_enabled:        true,
    new_file_load_enabled: true,
  },
  LOW_MEMORY: {
    max_fps:               20,
    max_workers:           1,
    spectrogram_density:   "MINIMAL",
    similarity_enabled:    false,
    analytics_enabled:     false,
    repair_enabled:        false,
    new_file_load_enabled: false,
  },
};

// ── Resource Governor ─────────────────────────────────────────────────────────

export class ResourceGovernor {
  private _sampleHandle: ReturnType<typeof setInterval> | null = null;
  private _evictionCallbacks: Set<() => void> = new Set();
  private _destroyed = false;

  constructor() {
    // Sample every 5 seconds — not hot path
    this._sampleHandle = setInterval(() => {
      if(this._destroyed) return;
      this._govern();
    }, 5000);
  }

  // ── Governance Tick ────────────────────────────────────────────────────────

  private _govern(): void {
    const snap    = resourceProfiler.sample();
    const pressure= scheduler.getPressure();

    // Update GPU pressure from profiler
    if(snap.webgl_context_lost) {
      scheduler.updateGpuPressure(1.0);
    }

    // Hard pressure actions
    if(snap.js_heap_used_mb >= resourceProfiler.getCeiling().hard_limit_mb) {
      this._triggerEviction("HARD_MEMORY");
    } else if(pressure.overall_pressure >= PRESSURE_HARD_THRESHOLD) {
      this._triggerEviction("HARD_PRESSURE");
    }
  }

  // ── Cache Eviction ─────────────────────────────────────────────────────────

  private _triggerEviction(reason: string): void {
    console.warn(`[ResourceGovernor] Eviction triggered: ${reason}`);
    this._evictionCallbacks.forEach(cb => {
      try { cb(); } catch {}
    });
  }

  onEviction(cb: () => void): () => void {
    this._evictionCallbacks.add(cb);
    return () => this._evictionCallbacks.delete(cb);
  }

  // ── Policy Query ───────────────────────────────────────────────────────────

  getCurrentPolicy(): GovernancePolicy {
    const state = scheduler.getState();
    return POLICIES[state.execution_mode];
  }

  canLoadNewFile(): boolean {
    return this.getCurrentPolicy().new_file_load_enabled;
  }

  canRunRepair(): boolean {
    return this.getCurrentPolicy().repair_enabled;
  }

  canRunSimilarity(): boolean {
    return this.getCurrentPolicy().similarity_enabled;
  }

  getMaxFPS(): number {
    return this.getCurrentPolicy().max_fps;
  }

  getSpectrogramDensity(): "FULL" | "REDUCED" | "MINIMAL" {
    return this.getCurrentPolicy().spectrogram_density;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy(): void {
    this._destroyed = true;
    if(this._sampleHandle) clearInterval(this._sampleHandle);
    this._evictionCallbacks.clear();
  }
}

export const resourceGovernor = new ResourceGovernor();
