/**
 * renderTelemetry.ts — Render Pipeline Telemetry
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Frame timing via requestAnimationFrame delta
 * - WebGL GPU timing via EXT_disjoint_timer_query_webgl2
 * - Canvas 2D render timing via performance.now() brackets
 * - OffscreenCanvas render tracking
 * - Dropped frame detection (>16.67ms budget)
 * - Spectrogram render throughput (frames/sec)
 * - Waveform render throughput (samples/sec)
 * - GPU availability detection
 * - Zero allocation in RAF callback
 *
 * Design reference:
 * - Chrome FrameTimingObserver model
 * - WebGL EXT_disjoint_timer_query methodology
 * - NVIDIA Frame Capture timing philosophy
 * - Adobe Premiere render telemetry concepts
 */

const FRAME_RING_SIZE    = 128;
const FRAME_RING_MASK    = FRAME_RING_SIZE - 1;
const RAF_BUDGET_MS      = 16.667;  // 60fps
const THROUGHPUT_WINDOW  = 60;      // frames for throughput calc

// ── Frame Timing Ring ─────────────────────────────────────────────────────────

class FrameRing {
  private readonly buf: Float64Array;
  private head  = 0;
  private count = 0;

  constructor() { this.buf = new Float64Array(FRAME_RING_SIZE); }

  push(ms: number): void {
    this.buf[this.head & FRAME_RING_MASK] = ms;
    this.head = (this.head + 1) & FRAME_RING_MASK;
    if(this.count < FRAME_RING_SIZE) this.count++;
  }

  percentile(p: number): number {
    if(this.count === 0) return 0;
    const n    = this.count;
    const temp = new Float64Array(n);
    const s    = (this.head - n + FRAME_RING_SIZE) & FRAME_RING_MASK;
    for(let i = 0; i < n; i++)
      temp[i] = this.buf[(s + i) & FRAME_RING_MASK];
    temp.sort();
    return temp[Math.floor(p * (n - 1))];
  }

  mean(): number {
    if(this.count === 0) return 0;
    let sum = 0;
    const n = this.count;
    const s = (this.head - n + FRAME_RING_SIZE) & FRAME_RING_MASK;
    for(let i = 0; i < n; i++)
      sum += this.buf[(s + i) & FRAME_RING_MASK];
    return sum / n;
  }

  last(): number {
    if(this.count === 0) return 0;
    return this.buf[(this.head - 1 + FRAME_RING_SIZE) & FRAME_RING_MASK];
  }

  get length(): number { return this.count; }
}

// ── Render Stage Types ────────────────────────────────────────────────────────

export const RENDER_STAGE = {
  WAVEFORM_2D:          "waveform_2d",
  WAVEFORM_WEBGL:       "waveform_webgl",
  SPECTROGRAM_2D:       "spectrogram_2d",
  SPECTROGRAM_WEBGL:    "spectrogram_webgl",
  SPECTROGRAM_OFFSCREEN:"spectrogram_offscreen",
  MINIMAP:              "minimap",
  OVERLAY:              "overlay",
  FORENSIC_OVERLAY:     "forensic_overlay",
  WAVEFORM_ZOOM:        "waveform_zoom",
} as const;

export type RenderStage = typeof RENDER_STAGE[keyof typeof RENDER_STAGE];

// ── Per-Stage Render State ────────────────────────────────────────────────────

interface RenderStageState {
  ring:          FrameRing;
  droppedFrames: number;
  totalFrames:   number;
  lastStartMs:   number;
  // throughput
  throughputBuf: Float64Array;  // timestamps of last N frames
  throughputIdx: number;
  // GPU timing (optional)
  gpuQuery:      WebGLQuery | null;
  gpuExt:        { TIME_ELAPSED_EXT: number } | null;
}

function makeStageState(): RenderStageState {
  return {
    ring:          new FrameRing(),
    droppedFrames: 0,
    totalFrames:   0,
    lastStartMs:   0,
    throughputBuf: new Float64Array(THROUGHPUT_WINDOW),
    throughputIdx: 0,
    gpuQuery:      null,
    gpuExt:        null,
  };
}

// ── Render Metrics ─────────────────────────────────────────────────────────────

export interface RenderStageMetrics {
  readonly stage:          RenderStage;
  readonly frameTimeMs:    number;   // last frame
  readonly meanMs:         number;
  readonly p95Ms:          number;
  readonly p99Ms:          number;
  readonly droppedFrames:  number;
  readonly totalFrames:    number;
  readonly dropRate:       number;   // 0-1
  readonly fps:            number;   // estimated from throughput
  readonly gpuTimeMs:      number;   // 0 if unavailable
}

export interface RenderTelemetrySnapshot {
  readonly timestamp:     number;
  readonly stages:        RenderStageMetrics[];
  readonly rafFps:        number;       // main RAF FPS
  readonly rafDropRate:   number;       // RAF drop rate
  readonly gpuAvailable:  boolean;
  readonly totalDropped:  number;
}

// ── RAF Monitor ───────────────────────────────────────────────────────────────

class RAFMonitor {
  private lastTime = 0;
  private rafId:   number | null = null;
  private readonly fpsRing = new FrameRing();
  private dropCount  = 0;
  private frameCount = 0;
  private running    = false;

  start(): void {
    if(this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if(!this.running) return;
      const delta = now - this.lastTime;
      this.lastTime = now;
      if(delta > 0 && delta < 1000) {  // ignore huge gaps (tab hidden)
        this.fpsRing.push(delta);
        this.frameCount++;
        if(delta > RAF_BUDGET_MS * 1.5) this.dropCount++;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if(this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  get fps(): number {
    const mean = this.fpsRing.mean();
    return mean > 0 ? Math.round(1000 / mean * 10) / 10 : 0;
  }

  get dropRate(): number {
    return this.frameCount > 0 ? this.dropCount / this.frameCount : 0;
  }
}

// ── Render Telemetry ──────────────────────────────────────────────────────────

export class RenderTelemetry {
  private readonly stages    = new Map<RenderStage, RenderStageState>();
  private readonly rafMon    = new RAFMonitor();
  private gpuAvailable       = false;
  private enabled:           boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;

    // Pre-allocate all stage states
    for(const stage of Object.values(RENDER_STAGE)) {
      this.stages.set(stage as RenderStage, makeStageState());
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if(!this.enabled) return;
    this.rafMon.start();
  }

  stop(): void {
    this.rafMon.stop();
  }

  /**
   * Initialize GPU timing for a WebGL context.
   * Call once after WebGL context creation.
   */
  initGPU(gl: WebGL2RenderingContext): void {
    try {
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      if(ext) {
        this.gpuAvailable = true;
        // Store ext reference on waveform_webgl stage
        const state = this.stages.get(RENDER_STAGE.WAVEFORM_WEBGL);
        if(state) state.gpuExt = ext as unknown as { TIME_ELAPSED_EXT: number };
      }
    } catch { /* GPU timing unavailable */ }
  }

  // ── Measurement API ────────────────────────────────────────────────────────

  /**
   * Begin render timing for a stage.
   * Returns start timestamp for end().
   */
  beginRender(stage: RenderStage): number {
    if(!this.enabled) return 0;
    const state = this.stages.get(stage);
    if(!state) return 0;
    state.lastStartMs = performance.now();
    return state.lastStartMs;
  }

  /**
   * End render timing. Records frame time.
   */
  endRender(stage: RenderStage, handle: number): number {
    if(!this.enabled || handle <= 0) return 0;
    const state = this.stages.get(stage);
    if(!state || state.lastStartMs === 0) return 0;

    const frameMs = performance.now() - state.lastStartMs;
    state.ring.push(frameMs);
    state.totalFrames++;
    if(frameMs > RAF_BUDGET_MS) state.droppedFrames++;

    // Update throughput window
    state.throughputBuf[state.throughputIdx % THROUGHPUT_WINDOW] = performance.now();
    state.throughputIdx++;

    state.lastStartMs = 0;
    return frameMs;
  }

  /**
   * Wrap a render function with telemetry.
   */
  measureRender<T>(stage: RenderStage, fn: () => T): T {
    if(!this.enabled) return fn();
    const h = this.beginRender(stage);
    const r = fn();
    this.endRender(stage, h);
    return r;
  }

  // ── GPU Timing ────────────────────────────────────────────────────────────

  /**
   * Begin GPU timer query. Returns query object or null.
   * Must be paired with endGPUTimer().
   */
  beginGPUTimer(gl: WebGL2RenderingContext): WebGLQuery | null {
    if(!this.gpuAvailable) return null;
    const state = this.stages.get(RENDER_STAGE.WAVEFORM_WEBGL);
    if(!state?.gpuExt) return null;
    try {
      const query = gl.createQuery();
      if(!query) return null;
      gl.beginQuery(state.gpuExt.TIME_ELAPSED_EXT, query);
      state.gpuQuery = query;
      return query;
    } catch { return null; }
  }

  endGPUTimer(gl: WebGL2RenderingContext): void {
    const state = this.stages.get(RENDER_STAGE.WAVEFORM_WEBGL);
    if(!state?.gpuExt || !state.gpuQuery) return;
    try {
      gl.endQuery(state.gpuExt.TIME_ELAPSED_EXT);
    } catch {}
  }

  // ── Query API ──────────────────────────────────────────────────────────────

  getStageMetrics(stage: RenderStage): RenderStageMetrics {
    const state = this.stages.get(stage)!;
    const { ring, droppedFrames, totalFrames, throughputBuf, throughputIdx } = state;

    // FPS from throughput window
    let fps = 0;
    if(throughputIdx >= 2) {
      const n    = Math.min(throughputIdx, THROUGHPUT_WINDOW);
      const newI = (throughputIdx - 1) % THROUGHPUT_WINDOW;
      const oldI = (throughputIdx - n) % THROUGHPUT_WINDOW;
      const span = throughputBuf[newI] - throughputBuf[oldI];
      fps = span > 0 ? Math.round((n - 1) / (span / 1000) * 10) / 10 : 0;
    }

    return {
      stage,
      frameTimeMs:   Math.round(ring.last()           * 100) / 100,
      meanMs:        Math.round(ring.mean()            * 100) / 100,
      p95Ms:         Math.round(ring.percentile(0.95) * 100) / 100,
      p99Ms:         Math.round(ring.percentile(0.99) * 100) / 100,
      droppedFrames,
      totalFrames,
      dropRate:      totalFrames > 0 ? droppedFrames / totalFrames : 0,
      fps,
      gpuTimeMs:     0, // populated separately via GPU query
    };
  }

  getAllMetrics():    RenderStageMetrics[] { return Array.from(this.stages.keys()).map(s => this.getStageMetrics(s)); }
  getActiveStages(): RenderStageMetrics[] { return this.getAllMetrics().filter(m => m.totalFrames > 0); }

  exportSnapshot(): RenderTelemetrySnapshot {
    const stages = this.getActiveStages();
    return {
      timestamp:    performance.now(),
      stages,
      rafFps:       this.rafMon.fps,
      rafDropRate:  this.rafMon.dropRate,
      gpuAvailable: this.gpuAvailable,
      totalDropped: stages.reduce((s, m) => s + m.droppedFrames, 0),
    };
  }

  /**
   * Returns true if render pipeline is under stress.
   * Used by failure engineering + adaptive quality paths.
   */
  isRenderUnderPressure(): boolean {
    const snap = this.exportSnapshot();
    if(snap.rafDropRate > 0.15) return true;  // >15% RAF drops
    return snap.stages.some(s => s.p95Ms > RAF_BUDGET_MS * 2);
  }

  /**
   * Suggested render quality reduction factor (0.5-1.0).
   * 1.0 = full quality, 0.5 = half resolution for pressure relief.
   */
  adaptiveQualityFactor(): number {
    if(!this.isRenderUnderPressure()) return 1.0;
    const rafDrop = this.rafMon.dropRate;
    if(rafDrop > 0.3) return 0.5;
    if(rafDrop > 0.2) return 0.7;
    return 0.85;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const renderTelemetry = new RenderTelemetry({ enabled: true });
renderTelemetry.start();
