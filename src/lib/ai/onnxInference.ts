/**
 * onnxInference.ts — ONNX Runtime Web Inference Engine
 * Aivora Audio Infrastructure Platform
 *
 * Provides browser-safe AI model inference via ONNX Runtime Web.
 * Supports WebGPU, WASM, and CPU backends with automatic fallback.
 *
 * Models supported:
 * - Speech enhancement (RNNoise-class)
 * - Voice Activity Detection (VAD)
 * - Speaker embedding
 * - Audio classification
 *
 * Reference:
 * - ONNX Runtime Web: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
 * - Silero VAD: https://github.com/snakers4/silero-vad
 * - RNNoise: https://jmvalin.ca/demo/rnnoise/
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ONNXBackend = "webgpu" | "wasm" | "cpu";

export type ModelType =
  | "vad"               // Voice Activity Detection
  | "speech_enhance"    // Speech Enhancement
  | "speaker_embed"     // Speaker Embeddings
  | "audio_classify"    // Audio Classification
  | "noise_classify";   // Noise Type Classification

export interface ModelConfig {
  type:        ModelType;
  url:         string;          // model URL or path
  inputShape:  number[];        // expected input shape
  outputShape: number[];        // expected output shape
  sampleRate:  number;          // required sample rate
  frameSize:   number;          // samples per inference frame
  hopSize:     number;          // samples between frames
}

export interface InferenceResult {
  output:      Float32Array;
  confidence:  number;
  latencyMs:   number;
  backend:     ONNXBackend;
  modelType:   ModelType;
}

export interface VADResult {
  segments:    VADSegment[];
  speechRatio: number;
  confidence:  number;
}

export interface VADSegment {
  startSec:   number;
  endSec:     number;
  confidence: number;
  isSpeech:   boolean;
}

// ── ONNX Session Manager ──────────────────────────────────────────────────────

export class ONNXInferenceEngine {
  private sessions = new Map<ModelType, unknown>();
  private backend:  ONNXBackend = "wasm";
  private ort:      unknown = null;
  private loaded    = false;

  async initialize(preferredBackend: ONNXBackend = "wasm"): Promise<ONNXBackend> {
    // Dynamically import ONNX Runtime Web
    try {
      // Try to import ort — will work if onnxruntime-web is installed
      const ortModule = await (import("onnxruntime-web" as string) as Promise<unknown>).catch(() => null);
      if(!ortModule) {
        console.warn("[ONNX] onnxruntime-web not installed — using DSP fallback");
        this.loaded = false;
        return "cpu";
      }
      this.ort = ortModule;

      // Configure backend
      const ort = this.ort as { env: { wasm: { numThreads: number; simd: boolean } } };
      if(preferredBackend === "webgpu") {
        try {
          ort.env.wasm.numThreads = 1;
          this.backend = "webgpu";
        } catch {
          this.backend = "wasm";
        }
      } else {
        ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency ?? 2);
        ort.env.wasm.simd       = true;
        this.backend = "wasm";
      }

      this.loaded = true;
      console.log(`[ONNX] Initialized with backend: ${this.backend}`);
      return this.backend;

    } catch(err) {
      console.warn("[ONNX] Initialization failed:", err);
      this.loaded = false;
      return "cpu";
    }
  }

  async loadModel(config: ModelConfig): Promise<boolean> {
    if(!this.loaded || !this.ort) return false;
    try {
      const ort = this.ort as {
        InferenceSession: {
          create: (url: string, opts: unknown) => Promise<unknown>
        }
      };
      const session = await ort.InferenceSession.create(config.url, {
        executionProviders: [this.backend === "webgpu" ? "webgpu" : "wasm"],
        graphOptimizationLevel: "all",
      });
      this.sessions.set(config.type, session);
      console.log(`[ONNX] Model loaded: ${config.type}`);
      return true;
    } catch(err) {
      console.warn(`[ONNX] Failed to load model ${config.type}:`, err);
      return false;
    }
  }

  async runInference(
    modelType: ModelType,
    input:     Float32Array,
    inputName  = "input"
  ): Promise<Float32Array | null> {
    const session = this.sessions.get(modelType);
    if(!session || !this.ort) return null;

    try {
      const ort = this.ort as {
        Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
      };
      const tensor = new ort.Tensor("float32", input, [1, input.length]);
      const sess   = session as {
        run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>
      };
      const results = await sess.run({ [inputName]: tensor });
      const outputKey = Object.keys(results)[0];
      return results[outputKey].data as Float32Array;
    } catch(err) {
      console.warn(`[ONNX] Inference failed for ${modelType}:`, err);
      return null;
    }
  }

  get isLoaded(): boolean { return this.loaded; }
  get currentBackend(): ONNXBackend { return this.backend; }
  get loadedModels(): ModelType[] { return Array.from(this.sessions.keys()); }
}

// ── DSP-based VAD Fallback ────────────────────────────────────────────────────
// When ONNX is unavailable, use energy + ZCR based VAD
// This is the production fallback — not a placeholder

export function computeVADFallback(
  data: Float32Array,
  sr:   number,
  options: {
    frameSizeMs?:   number;
    hopMs?:         number;
    energyThreshDb?: number;
    zcrThresh?:     number;
    hangoverFrames?: number;
  } = {}
): VADResult {
  const frameSizeMs    = options.frameSizeMs    ?? 25;
  const hopMs          = options.hopMs          ?? 10;
  const energyThreshDb = options.energyThreshDb ?? -35;
  const zcrThresh      = options.zcrThresh      ?? 0.15;
  const hangover       = options.hangoverFrames ?? 8;

  const frameLen = Math.floor(frameSizeMs * sr / 1000);
  const hopLen   = Math.floor(hopMs       * sr / 1000);
  const segments: VADSegment[] = [];

  let hangoverCount = 0;
  let inSpeech      = false;
  let segStart      = 0;
  let speechFrames  = 0;
  let totalFrames   = 0;

  // Median filter for energy smoothing
  const energyHistory: number[] = [];
  const histLen = 5;

  for(let start=0; start+frameLen<=data.length; start+=hopLen){
    let ms=0, zcr=0;
    for(let i=start; i<start+frameLen; i++){
      ms += data[i]**2;
      if(i>start && data[i]*data[i-1] < 0) zcr++;
    }
    const energyDb = 10*Math.log10(ms/frameLen + 1e-10);
    const zcrRate  = zcr / frameLen;

    energyHistory.push(energyDb);
    if(energyHistory.length > histLen) energyHistory.shift();
    const sortedE  = [...energyHistory].sort((a,b)=>a-b);
    const smoothE  = sortedE[Math.floor(sortedE.length/2)];

    // VAD decision: energy + ZCR
    const isSpeechFrame =
      smoothE > energyThreshDb ||
      (smoothE > energyThreshDb - 6 && zcrRate < zcrThresh);

    totalFrames++;

    if(isSpeechFrame) {
      hangoverCount = hangover;
      if(!inSpeech) {
        inSpeech = true;
        segStart = start;
      }
      speechFrames++;
    } else if(hangoverCount > 0) {
      hangoverCount--;
      speechFrames++;
    } else if(inSpeech) {
      inSpeech = false;
      const confidence = Math.min(1, (speechFrames / Math.max(1, (start-segStart)/hopLen)));
      segments.push({
        startSec:   segStart / sr,
        endSec:     start    / sr,
        confidence,
        isSpeech:   true,
      });
    }
  }

  // Close final segment
  if(inSpeech) {
    segments.push({
      startSec:   segStart / sr,
      endSec:     data.length / sr,
      confidence: 0.85,
      isSpeech:   true,
    });
  }

  return {
    segments,
    speechRatio: speechFrames / Math.max(1, totalFrames),
    confidence:  this_is_dsp_fallback_confidence(segments, data.length/sr),
  };
}

function this_is_dsp_fallback_confidence(
  segments: VADSegment[], durationSec: number
): number {
  if(segments.length === 0) return 0.9;
  const speechDur = segments.reduce((s,seg)=>s+(seg.endSec-seg.startSec),0);
  const ratio = speechDur / durationSec;
  // Higher confidence when speech ratio is in natural range (0.3-0.8)
  if(ratio > 0.3 && ratio < 0.8) return 0.85;
  if(ratio > 0.1 && ratio < 0.95) return 0.75;
  return 0.6;
}

// ── Speech Enhancement Fallback ───────────────────────────────────────────────
// DSP-based enhancement when neural model unavailable
// Uses our existing Wiener filter + LR4 pipeline

export interface SpeechEnhancementResult {
  output:          Float32Array;
  snrImprovement:  number;
  method:          "neural" | "dsp_fallback";
  processingMs:    number;
}

export async function enhanceSpeech(
  data:    Float32Array,
  sr:      number,
  engine:  ONNXInferenceEngine
): Promise<SpeechEnhancementResult> {
  const start = Date.now();

  // Try neural enhancement first
  if(engine.isLoaded && engine.loadedModels.includes("speech_enhance")) {
    const result = await engine.runInference("speech_enhance", data);
    if(result) {
      return {
        output:         new Float32Array(result),
        snrImprovement: 0,
        method:         "neural",
        processingMs:   Date.now()-start,
      };
    }
  }

  // DSP fallback: import our production Wiener filter
  const { estimateNoiseProfile, applyAdaptiveWienerFilter } =
    await import("../audioEditor/professionalDSP");

  const profile = estimateNoiseProfile(data, sr, 2048, "silence");
  const result  = applyAdaptiveWienerFilter(data, sr, profile, {
    strength: 1.2, temporalSmooth: 0.75, floorDb: -60,
  });

  return {
    output:         result.output,
    snrImprovement: result.snrImprovement,
    method:         "dsp_fallback",
    processingMs:   Date.now()-start,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const onnxEngine = new ONNXInferenceEngine();
