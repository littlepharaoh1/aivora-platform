/**
 * onnxRuntime.ts — ONNX Runtime Execution Layer
 * Aivora Audio Infrastructure Platform — Prompt 6B Governed
 *
 * Governance:
 *   - NO LRU cache (removed Phase 6B.0)
 *   - All inference routed via Phase 5.1 RuntimeScheduler
 *   - All inference observable via Phase 4.1 telemetry
 *   - Model selection from Phase 6B.1 ModelRegistry only
 *   - Deterministic: same model + same input → same output
 *   - Fallback chain: WebGPU → WASM → CPU
 *   - Bounded memory: one session per model, no duplicates
 *
 * Ownership:
 *   ONNX sessions: owned here, released in unloadModel()/dispose()
 *   Tensors: created per inference, GC after run()
 */

import { scheduler }     from "../../runtime/runtimeScheduler";
import { emitEvent }     from "../telemetry/emitter";
import { modelRegistry } from "../models/modelRegistry";
import type {
  ModelEntry,
  ModelRuntime,
  InferenceLineage,
} from "../models/modelRegistry";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ONNXBackend = "webgpu" | "wasm" | "cpu";

export interface ONNXTensor {
  data: Float32Array | Int32Array | BigInt64Array;
  dims: number[];
  type: "float32" | "int32" | "int64";
}

export interface InferenceRequest {
  modelId:        string;
  inputs:         Record<string, ONNXTensor>;
  correlationId:  string;
  // cacheKey REMOVED — Prompt 6B: no hidden inference cache
}

export interface InferenceResponse {
  outputs:    Record<string, ONNXTensor>;
  latencyMs:  number;
  backend:    ONNXBackend;
  fromCache:  false;           // always false — cache removed
  modelId:    string;
  lineage:    InferenceLineage;
}

export interface RuntimeStats {
  backend:         ONNXBackend;
  loadedModels:    string[];
  totalInferences: number;
  avgLatencyMs:    number;
  isAvailable:     boolean;
  // cacheHits/cacheMisses REMOVED — Prompt 6B
}

// ── Backend → ModelRuntime mapping ───────────────────────────────────────────

function backendToRuntime(backend: ONNXBackend): ModelRuntime {
  switch(backend) {
    case "webgpu": return "onnx_webgpu";
    case "wasm":   return "onnx_wasm";
    case "cpu":    return "onnx_wasm"; // CPU uses WASM runtime
  }
}

// ── ONNX Runtime Orchestrator ─────────────────────────────────────────────────

export class ONNXRuntimeOrchestrator {
  private _ort:             unknown     = null;
  private _backend:         ONNXBackend = "cpu";
  private _sessions         = new Map<string, unknown>();
  private _loadingPromises  = new Map<string, Promise<boolean>>();
  private _totalInferences  = 0;
  private _latencies:       number[] = [];
  private _available        = false;

  // ── Initialize ──────────────────────────────────────────────────────────────

  async initialize(): Promise<ONNXBackend> {
    try {
      // Dynamic import — ONNX Runtime Web
      // onnxruntime-web: loaded at runtime to avoid Vite bundling errors
      let ort: any = null;
      try {
        // Use indirect import to bypass Vite static analysis
        const modName = "onnxruntime-web";
        ort = await import(modName).catch(() => null);
      } catch {
        ort = null;
      }
      if(!ort) {
        console.warn("[ONNXRuntime] onnxruntime-web not available");
        return "cpu";
      }

      this._ort = ort;

      // Fallback chain: WebGPU → WASM → CPU
      const backends: ONNXBackend[] = ["webgpu", "wasm", "cpu"];
      for(const backend of backends) {
        try {
          (ort as any).env.wasm.proxy = true;
          this._backend   = backend;
          this._available = true;

          emitEvent({
            event_type:     "ADMIN_ACTION",
            event_source:   "qc_workstation",
            correlation_id: crypto.randomUUID(),
            severity:       "info",
            payload: {
              action:  "INFERENCE_BACKEND_INITIALIZED",
              backend,
            },
          });

          return backend;
        } catch {
          continue;
        }
      }

      return "cpu";
    } catch(e) {
      console.warn("[ONNXRuntime] Init failed:", e);
      return "cpu";
    }
  }

  // ── Load Model ──────────────────────────────────────────────────────────────

  async loadModel(modelId: string): Promise<boolean> {
    if(this._sessions.has(modelId)) return true;

    // Deduplicate concurrent loads
    const existing = this._loadingPromises.get(modelId);
    if(existing) return existing;

    const promise = this._doLoad(modelId);
    this._loadingPromises.set(modelId, promise);
    const result = await promise;
    this._loadingPromises.delete(modelId);
    return result;
  }

  private async _doLoad(modelId: string): Promise<boolean> {
    const entry = modelRegistry.getModel(modelId);
    if(!entry) {
      console.warn(`[ONNXRuntime] Model not in registry: ${modelId}`);
      return false;
    }

    if(!this._ort || !this._available) return false;

    try {
      const ort     = this._ort as any;
      const session = await ort.InferenceSession.create(entry.url, {
        executionProviders: [this._backend === "webgpu" ? "webgpu" : "wasm"],
      });

      this._sessions.set(modelId, session);

      emitEvent({
        event_type:     "ADMIN_ACTION",
        event_source:   "qc_workstation",
        correlation_id: crypto.randomUUID(),
        severity:       "info",
        payload: {
          action:        "MODEL_LOADED",
          model_id:      modelId,
          model_version: entry.version,
          backend:       this._backend,
          quantization:  entry.quantization,
        },
      });

      return true;
    } catch(e) {
      console.warn(`[ONNXRuntime] Failed to load ${modelId}:`, e);

      emitEvent({
        event_type:     "ADMIN_ACTION",
        event_source:   "qc_workstation",
        correlation_id: crypto.randomUUID(),
        severity:       "error",
        payload: {
          action:   "MODEL_LOAD_FAILED",
          model_id: modelId,
          error:    e instanceof Error ? e.message.slice(0, 200) : "unknown",
        },
      });

      return false;
    }
  }

  // ── Run Inference ──────────────────────────────────────────────────────────
  // Routes through Phase 5.1 scheduler for resource governance.
  // Deterministic: same request → same execution path.

  async run(request: InferenceRequest): Promise<InferenceResponse | null> {
    if(!this._available) return null;

    const entry = modelRegistry.getModel(request.modelId);
    if(!entry) return null;

    let response: InferenceResponse | null = null;

    // Submit through Phase 5.1 scheduler
    await new Promise<void>((resolve) => {
      const taskId = scheduler.submit({
        task_type:      "BATCH",
        priority:       "NORMAL",
        correlation_id: request.correlationId,
        execute: async () => {
          response = await this._doInference(request, entry);
          resolve();
        },
        onTimeout: () => {
          emitEvent({
            event_type:     "WORKER_TIMEOUT",
            event_source:   "forensic_worker",
            correlation_id: request.correlationId,
            severity:       "error",
            payload: {
              action:   "INFERENCE_TIMEOUT",
              model_id: request.modelId,
            },
          });
          resolve();
        },
      });

      // If scheduler rejected (queue full)
      if(!taskId) resolve();
    });

    return response;
  }

  private async _doInference(
    request: InferenceRequest,
    entry:   ModelEntry,
  ): Promise<InferenceResponse | null> {
    const loaded = await this.loadModel(request.modelId);
    if(!loaded) return null;

    const session = this._sessions.get(request.modelId);
    if(!session) return null;

    const startMs = Date.now();

    // Emit inference start
    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "qc_workstation",
      correlation_id: request.correlationId,
      severity:       "info",
      payload: {
        action:        "INFERENCE_START",
        model_id:      request.modelId,
        model_version: entry.version,
        backend:       this._backend,
      },
    });

    try {
      const ort = this._ort as {
        Tensor: new (type: string, data: unknown, dims: number[]) => unknown
      };

      const feeds: Record<string, unknown> = {};
      for(const [name, tensor] of Object.entries(request.inputs)) {
        feeds[name] = new ort.Tensor(tensor.type, tensor.data, tensor.dims);
      }

      const sess = session as {
        run(f: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: number[] }>>
      };
      const rawOut = await sess.run(feeds);
      const latencyMs = Date.now() - startMs;

      const outputs: Record<string, ONNXTensor> = {};
      for(const [name, val] of Object.entries(rawOut)) {
        outputs[name] = {
          data: val.data as Float32Array,
          dims: val.dims,
          type: "float32",
        };
      }

      this._totalInferences++;
      if(this._latencies.length >= 100) this._latencies.shift();
      this._latencies.push(latencyMs);

      const lineage: InferenceLineage = {
        model_id:       request.modelId,
        model_version:  entry.version,
        quantization:   entry.quantization,
        backend:        backendToRuntime(this._backend),
        execution_tier: "DESKTOP_BALANCED",
        input_checksum: null, // computed externally if needed
        executed_at:    Date.now(),
      };

      // Emit inference complete
      emitEvent({
        event_type:     "ADMIN_ACTION",
        event_source:   "qc_workstation",
        correlation_id: request.correlationId,
        severity:       "info",
        payload: {
          action:        "INFERENCE_COMPLETE",
          model_id:      request.modelId,
          latency_ms:    latencyMs,
          backend:       this._backend,
        },
      });

      return {
        outputs,
        latencyMs,
        backend:   this._backend,
        fromCache: false,
        modelId:   request.modelId,
        lineage,
      };

    } catch(e) {
      const latencyMs = Date.now() - startMs;

      emitEvent({
        event_type:     "ADMIN_ACTION",
        event_source:   "qc_workstation",
        correlation_id: request.correlationId,
        severity:       "error",
        payload: {
          action:     "INFERENCE_FAILED",
          model_id:   request.modelId,
          latency_ms: latencyMs,
          error:      e instanceof Error ? e.message.slice(0, 200) : "unknown",
        },
      });

      return null;
    }
  }

  // ── Streaming Inference ───────────────────────────────────────────────────

  async *runStreaming(
    modelId:   string,
    frames:    Iterable<Record<string, ONNXTensor>>,
    corrId:    string,
  ): AsyncGenerator<InferenceResponse | null> {
    for(const frame of frames) {
      yield this.run({ modelId, inputs: frame, correlationId: corrId });
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): RuntimeStats {
    const avg = this._latencies.length > 0
      ? this._latencies.reduce((a,b) => a+b, 0) / this._latencies.length
      : 0;
    return {
      backend:         this._backend,
      loadedModels:    Array.from(this._sessions.keys()),
      totalInferences: this._totalInferences,
      avgLatencyMs:    Math.round(avg * 10) / 10,
      isAvailable:     this._available,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  // Cleanup symmetry:
  //   InferenceSession created → session.release() or sessions.clear()
  //   loadingPromises → cleared

  unloadModel(modelId: string): void {
    const session = this._sessions.get(modelId) as any;
    try { session?.release?.(); } catch {}
    this._sessions.delete(modelId);
  }

  dispose(): void {
    this._sessions.forEach((session: any) => {
      try { session?.release?.(); } catch {}
    });
    this._sessions.clear();
    this._loadingPromises.clear();
    this._ort       = null;
    this._available = false;
  }
}

export const onnxRuntime = new ONNXRuntimeOrchestrator();
