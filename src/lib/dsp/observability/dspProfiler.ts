/**
 * dspProfiler.ts — Lightweight DSP Telemetry Infrastructure
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Sampling-based profiling (not instrumentation-heavy)
 * - Ring-buffer metric storage — O(1) insert, bounded memory
 * - No allocations in hot paths — pre-allocated Float64Arrays
 * - Worker-safe — no DOM/window dependencies
 * - Transferable-safe — plain numeric data only
 * - Production-safe — sampling gate controls overhead
 */

const RING_SIZE                  = 128;
const RING_MASK                  = RING_SIZE - 1;
const GC_POLL_MS                 = 2000;
const DROPPED_FRAME_THRESHOLD_MS = 16.67;

export const DSP_STAGE = {
  FFT_COMPUTE:        "fft_compute",
  WIENER_FILTER:      "wiener_filter",
  LR4_CROSSOVER:      "lr4_crossover",
  LOOKAHEAD_LIMITER:  "lookahead_limiter",
  LUFS_COMPUTE:       "lufs_compute",
  WAVEFORM_RENDER:    "waveform_render",
  SPECTROGRAM_RENDER: "spectrogram_render",
  WEBGL_RENDER:       "webgl_render",
  BATCH_CHUNK:        "batch_chunk",
  EXPORT_VALIDATE:    "export_validate",
  NOISE_FINGERPRINT:  "noise_fingerprint",
  RT60_ESTIMATE:      "rt60_estimate",
  WORKLET_CALLBACK:   "worklet_callback",
  VAD_COMPUTE:        "vad_compute",
} as const;

export type DSPStage = typeof DSP_STAGE[keyof typeof DSP_STAGE];

class RingBuffer {
  private readonly buf: Float64Array;
  private head  = 0;
  private count = 0;

  constructor(size = RING_SIZE) {
    this.buf = new Float64Array(size);
  }

  push(value: number): void {
    this.buf[this.head & RING_MASK] = value;
    this.head = (this.head + 1) & RING_MASK;
    if(this.count < RING_SIZE) this.count++;
  }

  percentile(p: number): number {
    if(this.count === 0) return 0;
    const n     = this.count;
    const temp  = new Float64Array(n);
    const start = (this.head - n + RING_SIZE) & RING_MASK;
    for(let i = 0; i < n; i++)
      temp[i] = this.buf[(start + i) & RING_MASK];
    temp.sort();
    return temp[Math.floor(p * (n - 1))];
  }

  mean(): number {
    if(this.count === 0) return 0;
    let sum     = 0;
    const n     = this.count;
    const start = (this.head - n + RING_SIZE) & RING_MASK;
    for(let i = 0; i < n; i++)
      sum += this.buf[(start + i) & RING_MASK];
    return sum / n;
  }

  last(): number {
    if(this.count === 0) return 0;
    return this.buf[(this.head - 1 + RING_SIZE) & RING_MASK];
  }

  get length(): number { return this.count; }
}

export interface StageMetrics {
  readonly stage:   DSPStage;
  readonly mean:    number;
  readonly p50:     number;
  readonly p95:     number;
  readonly p99:     number;
  readonly last:    number;
  readonly count:   number;
  readonly dropped: number;
}

export interface GCPressureMetrics {
  readonly usedJSHeapMB:  number;
  readonly totalJSHeapMB: number;
  readonly heapPressure:  number;
  readonly estimated:     boolean;
}

function getGCPressure(): GCPressureMetrics {
  const mem = (performance as unknown as {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
  }).memory;

  if(mem) {
    const usedMB  = mem.usedJSHeapSize  / 1048576;
    const totalMB = mem.totalJSHeapSize / 1048576;
    const limitMB = mem.jsHeapSizeLimit / 1048576;
    return {
      usedJSHeapMB:  Math.round(usedMB  * 10) / 10,
      totalJSHeapMB: Math.round(totalMB * 10) / 10,
      heapPressure:  Math.min(1, usedMB / limitMB),
      estimated:     false,
    };
  }

  return { usedJSHeapMB:0, totalJSHeapMB:0, heapPressure:0, estimated:true };
}

class DroppedFrameTracker {
  private droppedCount = 0;
  private totalCount   = 0;

  record(durationMs: number, budgetMs = DROPPED_FRAME_THRESHOLD_MS): void {
    this.totalCount++;
    if(durationMs > budgetMs) this.droppedCount++;
  }

  get dropRate(): number {
    return this.totalCount > 0 ? this.droppedCount / this.totalCount : 0;
  }
  get total():   number { return this.totalCount;   }
  get dropped(): number { return this.droppedCount; }
}

export class DSPProfiler {
  private readonly rings    = new Map<DSPStage, RingBuffer>();
  private readonly droppers = new Map<DSPStage, DroppedFrameTracker>();
  private readonly pending  = new Map<string, number>();
  private gcMetrics:  GCPressureMetrics | null = null;
  private gcTimer:    ReturnType<typeof setInterval> | null = null;
  private sampleRate: number;
  private enabled:    boolean;

  constructor(options: { sampleRate?: number; enabled?: boolean } = {}) {
    this.sampleRate = options.sampleRate ?? 1.0;
    this.enabled    = options.enabled    ?? true;

    for(const stage of Object.values(DSP_STAGE)) {
      this.rings.set(   stage as DSPStage, new RingBuffer());
      this.droppers.set(stage as DSPStage, new DroppedFrameTracker());
    }
  }

  start(): void {
    if(!this.enabled) return;
    this.gcTimer = setInterval(() => {
      this.gcMetrics = getGCPressure();
    }, GC_POLL_MS);
  }

  stop(): void {
    if(this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
  }

  begin(stage: DSPStage, id = "default"): number {
    if(!this.enabled) return 0;
    if(this.sampleRate < 1.0 && Math.random() > this.sampleRate) return -1;
    const t = performance.now();
    this.pending.set(`${stage}:${id}`, t);
    return t;
  }

  end(stage: DSPStage, handle: number, id = "default"): number {
    if(!this.enabled || handle <= 0) return 0;
    const startMs = this.pending.get(`${stage}:${id}`);
    if(startMs === undefined) return 0;
    this.pending.delete(`${stage}:${id}`);
    const durationMs = performance.now() - startMs;
    this.rings.get(stage)!.push(durationMs);
    this.droppers.get(stage)!.record(durationMs);
    return durationMs;
  }

  profile<T>(stage: DSPStage, fn: () => T): T {
    if(!this.enabled) return fn();
    const h = this.begin(stage);
    const result = fn();
    this.end(stage, h);
    return result;
  }

  async profileAsync<T>(stage: DSPStage, fn: () => Promise<T>): Promise<T> {
    if(!this.enabled) return fn();
    const h = this.begin(stage);
    const result = await fn();
    this.end(stage, h);
    return result;
  }

  getStageMetrics(stage: DSPStage): StageMetrics {
    const ring    = this.rings.get(stage)!;
    const dropper = this.droppers.get(stage)!;
    return {
      stage,
      mean:    Math.round(ring.mean()           * 100) / 100,
      p50:     Math.round(ring.percentile(0.50) * 100) / 100,
      p95:     Math.round(ring.percentile(0.95) * 100) / 100,
      p99:     Math.round(ring.percentile(0.99) * 100) / 100,
      last:    Math.round(ring.last()           * 100) / 100,
      count:   ring.length,
      dropped: dropper.dropped,
    };
  }

  getAllMetrics():    StageMetrics[] { return Array.from(this.rings.keys()).map(s => this.getStageMetrics(s)); }
  getActiveStages(): StageMetrics[] { return this.getAllMetrics().filter(m => m.count > 0); }
  getGCMetrics():    GCPressureMetrics { return this.gcMetrics ?? getGCPressure(); }
  getDropRate(stage: DSPStage): number { return this.droppers.get(stage)?.dropRate ?? 0; }

  exportSnapshot(): {
    timestamp:    number;
    stages:       StageMetrics[];
    gc:           GCPressureMetrics;
    totalDropped: number;
  } {
    const stages = this.getActiveStages();
    return {
      timestamp:    performance.now(),
      stages,
      gc:           this.getGCMetrics(),
      totalDropped: stages.reduce((s, m) => s + m.dropped, 0),
    };
  }

  isUnderPressure(): boolean {
    const gc = this.getGCMetrics();
    if(!gc.estimated && gc.heapPressure > 0.85) return true;
    for(const [stage] of this.rings) {
      const m = this.getStageMetrics(stage);
      if(m.count > 0 && m.p95 > DROPPED_FRAME_THRESHOLD_MS * 3) return true;
    }
    return false;
  }

  reset(): void {
    this.gcMetrics = null;
  }
}

export const dspProfiler = new DSPProfiler({ sampleRate: 1.0, enabled: true });
dspProfiler.start();
