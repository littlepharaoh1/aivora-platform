/**
 * onnxRuntime.ts — ONNX Runtime Orchestrator
 * Aivora Audio Infrastructure Platform — Prompt 6B Governed
 *
 * Governance rules (Prompt 6B):
 * - NO LRU cache (removed) — hidden state violates determinism
 * - NO adaptive routing — routes must be explicit + versioned
 * - Same input + same model version → same output (deterministic)
 * - All inference observable via Phase 4.1 telemetry
 * - Bounded memory — no unbounded tensor buffers
 * - Resource governed — Phase 5.1 scheduler authoritative
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ONNXBackend   = "webgpu" | "wasm" | "cpu";
export type ModelId       =
  | "silero_vad"
  | "rnnoise"
  | "deepfilter"
  | "speaker_embed"
  | "noise_classify"
  | "speech_enhance";

export interface ONNXTensor {
  data:  Float32Array | Int32Array | BigInt64Array;
  dims:  number[];
  type:  "float32" | "int32" | "int64";
}

export interface InferenceRequest {
  modelId:   ModelId;
  inputs:    Record<string, ONNXTensor>;
  // cacheKey REMOVED — Prompt 6B: no hidden inference cache
}

export interface InferenceResponse {
  outputs:     Record<string, ONNXTensor>;
  latencyMs:   number;
  backend:     ONNXBackend;
  fromCache:   boolean;
  modelId:     ModelId;
}

export interface ModelConfig {
  id:           ModelId;
  url:          string;
  inputNames:   string[];
  outputNames:  string[];
  sampleRate:   number;
  frameSize:    number;
  description:  string;
}

// LRU Cache REMOVED — Prompt 6B: hidden state violates determinism
// Use deterministic execution paths only

export const MODEL_REGISTRY: Record<ModelId, ModelConfig> = {
  silero_vad: {
    id:          "silero_vad",
    url:         "/models/silero_vad.onnx",
    inputNames:  ["input", "sr", "h", "c"],
    outputNames: ["output", "hn", "cn"],
    sampleRate:  16000,
    frameSize:   512,
    description: "Silero VAD — voice activity detection",
  },
  rnnoise: {
    id:          "rnnoise",
    url:         "/models/rnnoise.onnx",
    inputNames:  ["input"],
    outputNames: ["output"],
    sampleRate:  48000,
    frameSize:   480,
    description: "RNNoise — neural noise suppression",
  },
  deepfilter: {
    id:          "deepfilter",
    url:         "/models/deepfilter.onnx",
    inputNames:  ["noisy_audio"],
    outputNames: ["enhanced_audio"],
    sampleRate:  48000,
    frameSize:   960,
    description: "DeepFilterNet — speech enhancement",
  },
  speaker_embed: {
    id:          "speaker_embed",
    url:         "/models/speaker_embed.onnx",
    inputNames:  ["audio"],
    outputNames: ["embedding"],
    sampleRate:  16000,
    frameSize:   16000,
    description: "Speaker embedding extraction",
  },
  noise_classify: {
    id:          "noise_classify",
    url:         "/models/noise_classify.onnx",
    inputNames:  ["spectrogram"],
    outputNames: ["class_probs"],
    sampleRate:  48000,
    frameSize:   2048,
    description: "Noise type classification",
  },
  speech_enhance: {
    id:          "speech_enhance",
    url:         "/models/speech_enhance.onnx",
    inputNames:  ["noisy"],
    outputNames: ["enhanced"],
    sampleRate:  48000,
    frameSize:   2048,
    description: "Speech enhancement",
  },
};

// ── Runtime Stats ─────────────────────────────────────────────────────────────

export interface RuntimeStats {
  backend:          ONNXBackend;
  loadedModels:     ModelId[];
  // cacheHits/cacheMisses REMOVED — Prompt 6B
  totalInferences:  number;
  avgLatencyMs:     number;
  isAvailable:      boolean;
}

// ── ONNX Runtime Orchestrator ─────────────────────────────────────────────────

export class ONNXRuntimeOrchestrator {
  private ort:            unknown     = null;
  private backend:        ONNXBackend = "cpu";
  private sessions        = new Map<ModelId, unknown>();
  private loadingPromises = new Map<ModelId, Promise<boolean>>();
  private totalInferences = 0;
  private latencies:      number[] = [];
  private available       = false;

  // ── Initialization ────────────────────────────────────────────────────────

  async initialize(): Promise<ONNXBackend> {
    if(this.available) return this.backend;

    try {
      // Dynamic import — graceful if not installed
      const ortMod = await import(/* @vite-ignore */ "onnxruntime-web" as string)
        .catch(() => null);

      if(!ortMod) {
        this.available = false;
        return "cpu";
      }

      this.ort = ortMod;
      const ort = this.ort as {
        env: {
          wasm: { numThreads: number; simd: boolean; proxy: boolean };
        };
      };

      // Try WebGPU first
      if(typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          const gpu = (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu;
          const adapter = await gpu.requestAdapter();
          if(adapter) {
            this.backend  = "webgpu";
            this.available = true;
            return "webgpu";
          }
        } catch { /* WebGPU unavailable */ }
      }

      // WASM fallback
      ort.env.wasm.numThreads = Math.min(4, navigator?.hardwareConcurrency ?? 2);
      ort.env.wasm.simd       = true;
      ort.env.wasm.proxy      = false;
      this.backend  = "wasm";
      this.available = true;
      return "wasm";

    } catch {
      this.available = false;
      return "cpu";
    }
  }

  // ── Model Loading ─────────────────────────────────────────────────────────

  async loadModel(modelId: ModelId): Promise<boolean> {
    if(this.sessions.has(modelId)) return true;
    if(!this.available || !this.ort) return false;

    // Deduplicate concurrent loads
    if(this.loadingPromises.has(modelId)) {
      return this.loadingPromises.get(modelId)!;
    }

    const promise = this._doLoad(modelId);
    this.loadingPromises.set(modelId, promise);
    const result = await promise;
    this.loadingPromises.delete(modelId);
    return result;
  }

  private async _doLoad(modelId: ModelId): Promise<boolean> {
    const config = MODEL_REGISTRY[modelId];
    if(!config) return false;

    try {
      const ort = this.ort as {
        InferenceSession: {
          create(url: string, opts: unknown): Promise<unknown>
        }
      };

      const session = await ort.InferenceSession.create(config.url, {
        executionProviders:     [this.backend === "webgpu" ? "webgpu" : "wasm"],
        graphOptimizationLevel: "all",
        enableCpuMemArena:      true,
        enableMemPattern:       true,
      });

      this.sessions.set(modelId, session);
      return true;
    } catch {
      return false;
    }
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  async run(request: InferenceRequest): Promise<InferenceResponse | null> {
    if(!this.available) return null;

    // Cache removed — Prompt 6B: deterministic execution only

    // Ensure model is loaded
    const loaded = await this.loadModel(request.modelId);
    if(!loaded) return null;

    const session = this.sessions.get(request.modelId);
    if(!session) return null;

    try {
      const ort = this.ort as {
        Tensor: new (type: string, data: unknown, dims: number[]) => unknown
      };

      // Build feeds
      const feeds: Record<string, unknown> = {};
      for(const [name, tensor] of Object.entries(request.inputs)) {
        feeds[name] = new ort.Tensor(tensor.type, tensor.data, tensor.dims);
      }

      const startMs = performance.now();
      const sess    = session as {
        run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: number[] }>>
      };
      const rawOut  = await sess.run(feeds);
      const latencyMs = performance.now() - startMs;

      // Convert outputs
      const outputs: Record<string, ONNXTensor> = {};
      for(const [name, val] of Object.entries(rawOut)) {
        outputs[name] = {
          data: val.data as Float32Array,
          dims: val.dims,
          type: "float32",
        };
      }

      // Update stats
      this.totalInferences++;
      if(this.latencies.length >= 64) this.latencies.shift();
      this.latencies.push(latencyMs);

      return { outputs, latencyMs, backend:this.backend, fromCache:false, modelId:request.modelId };

    } catch {
      return null;
    }
  }

  // ── Streaming Inference ───────────────────────────────────────────────────

  async *runStreaming(
    modelId:   ModelId,
    frames:    Iterable<Record<string, ONNXTensor>>,
  ): AsyncGenerator<InferenceResponse | null> {
    for(const frame of frames) {
      yield this.run({ modelId, inputs: frame });
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): RuntimeStats {
    const avg = this.latencies.length > 0
      ? this.latencies.reduce((a,b)=>a+b,0) / this.latencies.length : 0;
    return {
      backend:         this.backend,
      loadedModels:    Array.from(this.sessions.keys()) as ModelId[],
      // cacheHits/cacheMisses removed — Prompt 6B
      totalInferences: this.totalInferences,
      avgLatencyMs:    Math.round(avg * 10) / 10,
      isAvailable:     this.available,
    };
  }

  unloadModel(modelId: ModelId): void { this.sessions.delete(modelId); }

  dispose(): void {
    this.sessions.clear();
    this.ort = null;
    this.available = false;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const onnxRuntime = new ONNXRuntimeOrchestrator();
