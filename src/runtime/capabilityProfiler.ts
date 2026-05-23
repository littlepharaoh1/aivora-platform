/**
 * capabilityProfiler.ts — Deterministic Browser Capability Profiler
 * Aivora Platform — Phase 5.3
 *
 * Detects browser capabilities once at session start.
 * Outputs deterministic CapabilityProfile.
 * No ML. No probabilistic estimation.
 * Same browser → same profile.
 */

import type { RuntimeExecutionMode } from "./runtimeTypes";
import {
  MAX_WORKERS_DESKTOP,
  MAX_WORKERS_MOBILE,
  MAX_WORKERS_LOW_MEM,
} from "./runtimeConstants";

// ── Capability Profile ────────────────────────────────────────────────────────

export interface CapabilityProfile {
  execution_mode:        RuntimeExecutionMode;
  max_workers:           number;
  recommended_fft_size:  number;
  max_parallel_repairs:  number;
  spectrogram_quality:   "ULTRA" | "HIGH" | "MEDIUM" | "LOW";
  safe_batch_limit:      number;

  // Raw capabilities
  device_memory_gb:      number;
  hardware_concurrency:  number;
  has_webgl2:            boolean;
  has_webgpu:            boolean;
  has_offscreen_canvas:  boolean;
  has_shared_array_buf:  boolean;
  indexeddb_available:   boolean;
  is_mobile:             boolean;
  is_ios:                boolean;
  is_safari:             boolean;
  is_android:            boolean;
  estimated_ram_mb:      number;
}

// ── Detection Helpers ─────────────────────────────────────────────────────────

function detectWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch { return false; }
}

async function detectWebGPU(): Promise<boolean> {
  try {
    if(!(navigator as any).gpu) return false;
    const adapter = await (navigator as any).gpu.requestAdapter();
    return !!adapter;
  } catch { return false; }
}

function detectOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== "undefined";
}

function detectSharedArrayBuffer(): boolean {
  return typeof SharedArrayBuffer !== "undefined";
}

function detectIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function detectMobile(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 2 && window.innerWidth < 1024)
  );
}

function detectIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function detectSafari(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

function detectAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

// ── Profile Builder ───────────────────────────────────────────────────────────

async function buildProfile(): Promise<CapabilityProfile> {
  const mem       = (navigator as any).deviceMemory ?? 4;  // GB
  const cores     = navigator.hardwareConcurrency   ?? 2;
  const mobile    = detectMobile();
  const ios       = detectIOS();
  const safari    = detectSafari();
  const android   = detectAndroid();
  const webgl2    = detectWebGL2();
  const webgpu    = await detectWebGPU();
  const offscreen = detectOffscreenCanvas();
  const sab       = detectSharedArrayBuffer();
  const idb       = detectIndexedDB();

  const memMb = mem * 1024;

  // ── Execution mode (deterministic) ──────────────────────────────────────
  let mode: RuntimeExecutionMode;
  if(mobile || ios || memMb <= 512) {
    mode = "MOBILE_SAFE";
  } else if(memMb <= 1024 || cores <= 2) {
    mode = "DESKTOP_BALANCED";
  } else if(memMb >= 8192 && cores >= 6) {
    mode = "DESKTOP_ULTRA";
  } else {
    mode = "DESKTOP_BALANCED";
  }

  // ── Worker ceiling ────────────────────────────────────────────────────────
  let maxWorkers: number;
  if(mobile)        maxWorkers = MAX_WORKERS_MOBILE;
  else if(cores >= 6) maxWorkers = MAX_WORKERS_DESKTOP;
  else              maxWorkers = Math.max(2, Math.min(4, cores - 1));

  // ── FFT size ──────────────────────────────────────────────────────────────
  let fftSize: number;
  if(mobile || memMb <= 512)  fftSize = 512;
  else if(memMb <= 2048)       fftSize = 1024;
  else                         fftSize = 4096;

  // ── Spectrogram quality ───────────────────────────────────────────────────
  let specQuality: CapabilityProfile["spectrogram_quality"];
  if(mobile || !webgl2)      specQuality = "LOW";
  else if(memMb <= 2048)      specQuality = "MEDIUM";
  else if(webgpu)             specQuality = "ULTRA";
  else                        specQuality = "HIGH";

  // ── Batch limit ───────────────────────────────────────────────────────────
  let batchLimit: number;
  if(mobile)             batchLimit = 5;
  else if(memMb <= 2048) batchLimit = 20;
  else                   batchLimit = 50;

  // ── Parallel repairs ──────────────────────────────────────────────────────
  const maxRepairs = mobile ? 1 : Math.min(2, Math.floor(cores / 2));

  return {
    execution_mode:        mode,
    max_workers:           maxWorkers,
    recommended_fft_size:  fftSize,
    max_parallel_repairs:  maxRepairs,
    spectrogram_quality:   specQuality,
    safe_batch_limit:      batchLimit,
    device_memory_gb:      mem,
    hardware_concurrency:  cores,
    has_webgl2:            webgl2,
    has_webgpu:            webgpu,
    has_offscreen_canvas:  offscreen,
    has_shared_array_buf:  sab,
    indexeddb_available:   idb,
    is_mobile:             mobile,
    is_ios:                ios,
    is_safari:             safari,
    is_android:            android,
    estimated_ram_mb:      memMb,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _profile: CapabilityProfile | null = null;
let _building = false;
let _waiters:  Array<(p: CapabilityProfile) => void> = [];

export async function getCapabilityProfile(): Promise<CapabilityProfile> {
  if(_profile) return _profile;

  if(_building) {
    return new Promise(resolve => _waiters.push(resolve));
  }

  _building = true;
  _profile  = await buildProfile();
  _waiters.forEach(w => w(_profile!));
  _waiters  = [];
  _building = false;

  return _profile;
}

// Sync version — returns null if not yet built
export function getCapabilityProfileSync(): CapabilityProfile | null {
  return _profile;
}

// Pre-warm on import
getCapabilityProfile().catch(() => {});
