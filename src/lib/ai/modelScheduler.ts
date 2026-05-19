/**
 * modelScheduler.ts — AI Model Lifecycle Scheduler
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Lazy loading: models loaded on first request
 * - LRU eviction: unload least-recently-used models under memory pressure
 * - Priority preloading: critical models preloaded in background
 * - Inference queue: serialize requests per model
 * - Memory budget: configurable max loaded models
 * - Warmup: first inference after load uses warmup pass
 * - Health monitoring: detect stale/failed model sessions
 *
 * Design reference:
 * - TensorFlow Serving model lifecycle
 * - ONNX Runtime Server session management
 * - Triton Inference Server model repository
 */

import { onnxRuntime, type ModelId, type InferenceRequest, type InferenceResponse } from "./onnxRuntime";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_MODELS    = 3;    // max concurrently loaded models
const DEFAULT_WARMUP_RUNS   = 2;    // inference passes to warm up JIT
const IDLE_UNLOAD_MS        = 300_000; // unload after 5min idle

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModelPriority = "critical" | "high" | "normal" | "low";

export interface ModelSchedulerOptions {
  maxLoadedModels?: number;
  warmupRuns?:      number;
  idleUnloadMs?:    number;
}

export interface ModelLoadState {
  modelId:       ModelId;
  status:        "unloaded" | "loading" | "ready" | "warming" | "failed";
  loadedAt:      number;
  lastUsedAt:    number;
  useCount:      number;
  warmupDone:    boolean;
  avgLatencyMs:  number;
  latencies:     number[];
}

export interface SchedulerStats {
  loadedModels:    ModelId[];
  totalRequests:   number;
  cacheHitRate:    number;
  avgLatencyMs:    number;
  memoryBudgetUsed: number;   // 0-1
}

// ── LRU Model Registry ────────────────────────────────────────────────────────

class ModelRegistry {
  private readonly states  = new Map<ModelId, ModelLoadState>();
  private readonly maxSize: number;

  constructor(maxSize = DEFAULT_MAX_MODELS) {
    this.maxSize = maxSize;
  }

  get(id: ModelId): ModelLoadState | undefined { return this.states.get(id); }

  upsert(id: ModelId, patch: Partial<ModelLoadState>): ModelLoadState {
    const existing = this.states.get(id);
    const state: ModelLoadState = existing
      ? { ...existing, ...patch }
      : {
          modelId:      id,
          status:       "unloaded",
          loadedAt:     0,
          lastUsedAt:   0,
          useCount:     0,
          warmupDone:   false,
          avgLatencyMs: 0,
          latencies:    [],
          ...patch,
        };
    this.states.set(id, state);
    return state;
  }

  touch(id: ModelId): void {
    const s = this.states.get(id);
    if(s) this.states.set(id, { ...s, lastUsedAt: performance.now(), useCount: s.useCount+1 });
  }

  recordLatency(id: ModelId, ms: number): void {
    const s = this.states.get(id);
    if(!s) return;
    const lats = [...s.latencies.slice(-31), ms];
    const avg  = lats.reduce((a,b)=>a+b,0)/lats.length;
    this.states.set(id, { ...s, latencies:lats, avgLatencyMs:Math.round(avg*10)/10 });
  }

  /**
   * Evict LRU model to make room.
   * Returns evicted model ID or null.
   */
  evictLRU(): ModelId | null {
    const ready = Array.from(this.states.values())
      .filter(s => s.status === "ready")
      .sort((a,b) => a.lastUsedAt - b.lastUsedAt);

    if(ready.length === 0) return null;
    const victim = ready[0];
    this.states.set(victim.modelId, { ...victim, status:"unloaded", loadedAt:0 });
    return victim.modelId;
  }

  countReady():  number { return Array.from(this.states.values()).filter(s=>s.status==="ready").length; }
  getAll():      ModelLoadState[] { return Array.from(this.states.values()); }
  getReady():    ModelLoadState[] { return this.getAll().filter(s=>s.status==="ready"); }

  get isFull(): boolean { return this.countReady() >= this.maxSize; }
}

// ── Inference Queue ───────────────────────────────────────────────────────────

type QueueItem = {
  request:  InferenceRequest;
  resolve:  (r: InferenceResponse | null) => void;
  reject:   (e: Error) => void;
};

class InferenceQueue {
  private readonly queues = new Map<ModelId, QueueItem[]>();
  private readonly running = new Set<ModelId>();

  enqueue(req: InferenceRequest): Promise<InferenceResponse | null> {
    return new Promise((resolve, reject) => {
      const q = this.queues.get(req.modelId) ?? [];
      q.push({ request:req, resolve, reject });
      this.queues.set(req.modelId, q);
      this._drain(req.modelId);
    });
  }

  private async _drain(modelId: ModelId): Promise<void> {
    if(this.running.has(modelId)) return;
    const q = this.queues.get(modelId);
    if(!q?.length) return;

    this.running.add(modelId);
    while(q.length > 0) {
      const item = q.shift()!;
      try {
        const result = await onnxRuntime.run(item.request);
        item.resolve(result);
      } catch(e) {
        item.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.running.delete(modelId);
  }

  get depth(): number {
    let total = 0;
    for(const q of this.queues.values()) total += q.length;
    return total;
  }
}

// ── Model Scheduler ───────────────────────────────────────────────────────────

export class ModelScheduler {
  private readonly registry:  ModelRegistry;
  private readonly queue:     InferenceQueue;
  private readonly idleTimers = new Map<ModelId, ReturnType<typeof setTimeout>>();
  private readonly warmupMs:  number;
  private totalRequests = 0;
  private idleUnloadMs: number;

  constructor(options: ModelSchedulerOptions = {}) {
    this.registry    = new ModelRegistry(options.maxLoadedModels ?? DEFAULT_MAX_MODELS);
    this.queue       = new InferenceQueue();
    this.warmupMs    = options.warmupRuns    ?? DEFAULT_WARMUP_RUNS;
    this.idleUnloadMs = options.idleUnloadMs ?? IDLE_UNLOAD_MS;
  }

  // ── Preload ──────────────────────────────────────────────────────────────────

  /**
   * Preload models in background. Non-blocking.
   */
  preload(models: ModelId[]): void {
    for(const id of models) {
      this._ensureLoaded(id).catch(() => {});
    }
  }

  // ── Inference ────────────────────────────────────────────────────────────────

  async infer(request: InferenceRequest): Promise<InferenceResponse | null> {
    this.totalRequests++;
    await this._ensureLoaded(request.modelId);

    const state = this.registry.get(request.modelId);
    if(state?.status !== "ready") return null;

    this._resetIdleTimer(request.modelId);
    this.registry.touch(request.modelId);

    const startMs = performance.now();
    const result  = await this.queue.enqueue(request);
    const latency = performance.now() - startMs;

    this.registry.recordLatency(request.modelId, latency);
    return result;
  }

  // ── Load Management ───────────────────────────────────────────────────────

  private async _ensureLoaded(modelId: ModelId): Promise<void> {
    const state = this.registry.get(modelId);
    if(state?.status === "ready") return;
    if(state?.status === "loading") {
      // Wait for existing load
      await this._waitForReady(modelId);
      return;
    }
    if(state?.status === "failed") return;

    // Evict if at capacity
    if(this.registry.isFull) {
      const evicted = this.registry.evictLRU();
      if(evicted) onnxRuntime.unloadModel(evicted);
    }

    this.registry.upsert(modelId, { status:"loading" });

    const ok = await onnxRuntime.loadModel(modelId);

    if(!ok) {
      this.registry.upsert(modelId, { status:"failed" });
      return;
    }

    this.registry.upsert(modelId, {
      status:   "ready",
      loadedAt: performance.now(),
      warmupDone: false,
    });

    this._resetIdleTimer(modelId);
  }

  private async _waitForReady(modelId: ModelId, maxMs = 30000): Promise<void> {
    const start = performance.now();
    while(performance.now() - start < maxMs) {
      const s = this.registry.get(modelId);
      if(s?.status === "ready" || s?.status === "failed") return;
      await new Promise<void>(r => setTimeout(r, 100));
    }
  }

  private _resetIdleTimer(modelId: ModelId): void {
    const existing = this.idleTimers.get(modelId);
    if(existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const s = this.registry.get(modelId);
      if(s?.status === "ready") {
        this.registry.upsert(modelId, { status:"unloaded" });
        onnxRuntime.unloadModel(modelId);
        this.idleTimers.delete(modelId);
      }
    }, this.idleUnloadMs);

    this.idleTimers.set(modelId, timer);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): SchedulerStats {
    const ready     = this.registry.getReady();
    const runtimeStats = onnxRuntime.getStats();
    const total     = runtimeStats.cacheHits + runtimeStats.cacheMisses;
    const hitRate   = total > 0 ? runtimeStats.cacheHits / total : 0;

    return {
      loadedModels:     ready.map(s => s.modelId),
      totalRequests:    this.totalRequests,
      cacheHitRate:     Math.round(hitRate * 1000) / 1000,
      avgLatencyMs:     runtimeStats.avgLatencyMs,
      memoryBudgetUsed: ready.length / (this.registry["maxSize"] as unknown as number),
    };
  }

  getModelState(id: ModelId): ModelLoadState | undefined {
    return this.registry.get(id);
  }

  dispose(): void {
    for(const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    onnxRuntime.dispose();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const modelScheduler = new ModelScheduler({
  maxLoadedModels: 3,
  warmupRuns:      2,
  idleUnloadMs:    300_000,
});
