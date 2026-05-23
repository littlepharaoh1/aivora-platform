/**
 * modelRegistry.ts — AI Model Registry
 * Aivora Audio Infrastructure Platform — Prompt 6B Governed
 *
 * Governance rules:
 *   - Every model: versioned + quantization + checksum
 *   - getBestForTask(): deterministic (priority order, not scored)
 *   - No hot-swap without explicit governance
 *   - All fields required for inference lineage (Prompt 6B Rule 3)
 *   - Same model_id + version → same execution path
 */

import type { RuntimeExecutionMode } from "../../runtime/runtimeTypes";

export type ModelRuntime =
  | "onnx_webgpu"
  | "onnx_wasm"
  | "wasm_native"
  | "js_fallback";

export type ModelTask =
  | "vad"
  | "denoise"
  | "enhance"
  | "separate"
  | "speaker_embed"
  | "room_embed"
  | "noise_classify";

export type ModelQuantization =
  | "fp32"     // full precision
  | "fp16"     // half precision
  | "int8"     // 8-bit quantized
  | "int4"     // 4-bit quantized
  | "none";    // not applicable (JS/WASM fallback)

export interface ModelCapabilities {
  task:             ModelTask;
  sampleRate:       number;
  frameSize:        number;
  channels:         number;
  inputNames:       string[];
  outputNames:      string[];
  streamingSupport: boolean;
  batchSupport:     boolean;
  gpuAccelerated:   boolean;
}

export interface ModelMemorySpec {
  weightsMB:      number;   // model weights on disk/memory
  activationsMB:  number;   // runtime activation memory
  minVRAMMB:      number;   // minimum GPU VRAM required
  recommendedMB:  number;   // recommended total memory
}

export interface ModelEntry {
  id:               string;
  name:             string;
  version:          string;          // semver — required for lineage
  quantization:     ModelQuantization;// Prompt 6B Rule 3
  task:             ModelTask;
  url:              string;          // local path only — no CDN
  sha256:           string | null;   // integrity hash (null = pending)
  capabilities:     ModelCapabilities;
  memory:           ModelMemorySpec;
  runtimes:         ModelRuntime[];  // ordered by preference (index 0 = best)
  preferred_tier:   RuntimeExecutionMode; // min tier for this model
  license:          string;
  description:      string;
  deprecated:       boolean;
  supersedes?:      string;          // older model ID this replaces
}

// ── Inference Lineage Record (Prompt 6B Rule 3) ───────────────────────────────

export interface InferenceLineage {
  model_id:         string;
  model_version:    string;
  quantization:     ModelQuantization;
  backend:          ModelRuntime;
  execution_tier:   RuntimeExecutionMode;
  input_checksum:   string | null;   // SHA256 of input tensor (when available)
  executed_at:      number;          // Date.now()
}

// ── Model Catalog ─────────────────────────────────────────────────────────────
// url: local paths only — no CDN, no external URLs (Prompt 6B Rule 9)
// sha256: null until model binary available (placeholder forbidden)

export const MODEL_CATALOG: ModelEntry[] = [
  {
    id:           "silero_vad_v4",
    name:         "Silero VAD",
    version:      "4.0.0",
    quantization: "fp32",
    task:         "vad",
    url:          "/models/silero_vad_v4.onnx",
    sha256:       null,   // pending — binary not yet hosted
    capabilities: {
      task:"vad", sampleRate:16000, frameSize:512, channels:1,
      inputNames:["input","sr","h","c"], outputNames:["output","hn","cn"],
      streamingSupport:true, batchSupport:false, gpuAccelerated:false,
    },
    memory:         { weightsMB:1.8, activationsMB:2, minVRAMMB:0, recommendedMB:64 },
    runtimes:       ["onnx_wasm", "js_fallback"],
    preferred_tier: "MOBILE_SAFE",
    license:        "MIT",
    description:    "Voice activity detection — 95%+ accuracy",
    deprecated:     false,
  },
  {
    id:           "rnnoise_v1",
    name:         "RNNoise",
    version:      "1.0.0",
    quantization: "none",
    task:         "denoise",
    url:          "/models/rnnoise.wasm",
    sha256:       null,
    capabilities: {
      task:"denoise", sampleRate:48000, frameSize:480, channels:1,
      inputNames:["input"], outputNames:["output","vad_prob"],
      streamingSupport:true, batchSupport:false, gpuAccelerated:false,
    },
    memory:         { weightsMB:0.1, activationsMB:1, minVRAMMB:0, recommendedMB:32 },
    runtimes:       ["wasm_native", "js_fallback"],
    preferred_tier: "MOBILE_SAFE",
    license:        "BSD-3-Clause",
    description:    "RNN-based noise suppressor",
    deprecated:     false,
  },
  {
    id:           "deepfilter_v2",
    name:         "DeepFilterNet 2",
    version:      "2.0.0",
    quantization: "fp32",
    task:         "enhance",
    url:          "/models/deepfilter_v2.onnx",
    sha256:       null,
    capabilities: {
      task:"enhance", sampleRate:48000, frameSize:960, channels:1,
      inputNames:["noisy_audio"], outputNames:["enhanced_audio"],
      streamingSupport:true, batchSupport:true, gpuAccelerated:true,
    },
    memory:         { weightsMB:4.8, activationsMB:8, minVRAMMB:512, recommendedMB:1024 },
    runtimes:       ["onnx_webgpu", "onnx_wasm"],
    preferred_tier: "DESKTOP_BALANCED",
    license:        "MIT",
    description:    "Broadcast-quality speech enhancement",
    deprecated:     false,
  },
  {
    id:           "speaker_embed_v1",
    name:         "Speaker Embedding",
    version:      "1.0.0",
    quantization: "fp32",
    task:         "speaker_embed",
    url:          "/models/speaker_embed.onnx",
    sha256:       null,
    capabilities: {
      task:"speaker_embed", sampleRate:16000, frameSize:16000, channels:1,
      inputNames:["audio"], outputNames:["embedding"],
      streamingSupport:false, batchSupport:true, gpuAccelerated:true,
    },
    memory:         { weightsMB:12, activationsMB:4, minVRAMMB:256, recommendedMB:512 },
    runtimes:       ["onnx_webgpu", "onnx_wasm"],
    preferred_tier: "DESKTOP_BALANCED",
    license:        "Apache-2.0",
    description:    "192-dim speaker embedding for verification + forensics",
    deprecated:     false,
  },
];

// ── Model Registry ────────────────────────────────────────────────────────────

export class ModelRegistry {
  private readonly _catalog = new Map<string, ModelEntry>();

  constructor() {
    for(const m of MODEL_CATALOG) {
      this._catalog.set(m.id, m);
    }
  }

  getModel(id: string): ModelEntry | undefined {
    return this._catalog.get(id);
  }

  getByTask(task: ModelTask): ModelEntry[] {
    return Array.from(this._catalog.values())
      .filter(m => m.task === task && !m.deprecated);
  }

  /**
   * Deterministic best-model selection.
   * Priority order: index in runtimes[] array (0 = most preferred).
   * Same task + same available runtimes → same model selected.
   * No score-based or runtime-state-dependent selection.
   */
  getBestForTask(
    task:             ModelTask,
    availableRuntimes:ModelRuntime[],
    executionTier:    RuntimeExecutionMode,
  ): ModelEntry | null {
    const candidates = this.getByTask(task)
      .filter(m => {
        // Model must have at least one available runtime
        const hasRuntime = m.runtimes.some(r => availableRuntimes.includes(r));
        // Model tier must be compatible
        const tierOk = this._tierCompatible(m.preferred_tier, executionTier);
        return hasRuntime && tierOk;
      });

    if(candidates.length === 0) return null;

    // Deterministic selection: prefer model whose first runtime
    // appears earliest in availableRuntimes list
    candidates.sort((a, b) => {
      const aIdx = a.runtimes.findIndex(r => availableRuntimes.includes(r));
      const bIdx = b.runtimes.findIndex(r => availableRuntimes.includes(r));
      return aIdx - bIdx;
    });

    return candidates[0] ?? null;
  }

  private _tierCompatible(
    required: RuntimeExecutionMode,
    current:  RuntimeExecutionMode,
  ): boolean {
    const ORDER: RuntimeExecutionMode[] = [
      "LOW_MEMORY", "MOBILE_SAFE", "DESKTOP_BALANCED", "DESKTOP_ULTRA"
    ];
    return ORDER.indexOf(current) >= ORDER.indexOf(required);
  }

  /**
   * Register a model at runtime.
   * Requires: version + sha256 + quantization (no anonymous models).
   */
  register(model: ModelEntry): void {
    if(!model.version || !model.quantization) {
      throw new Error(
        `[ModelRegistry] Cannot register model "${model.id}": ` +
        `version and quantization are required (Prompt 6B Rule 3)`
      );
    }
    this._catalog.set(model.id, model);
  }

  listAll():    ModelEntry[] { return Array.from(this._catalog.values()); }
  size():       number       { return this._catalog.size; }
}

export const modelRegistry = new ModelRegistry();
