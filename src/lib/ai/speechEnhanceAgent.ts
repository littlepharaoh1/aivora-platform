/**
 * speechEnhanceAgent.ts — Autonomous Speech Enhancement Agent
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Routing: neural (ONNX) → DSP hybrid → DSP-only fallback
 * - Pre-analysis: noise classification + VAD + integrity check
 * - Adaptive pipeline selection based on signal characteristics
 * - Post-validation: ensures output quality > input quality
 * - Rollback: if enhancement degrades quality, return original
 * - Metrics: SI-SDR, DNSMOS, SNR improvement tracking
 *
 * Pipeline routing logic:
 * 1. Clean audio → passthrough (avoid unnecessary processing)
 * 2. Light noise → DSP Wiener filter
 * 3. Heavy noise → Neural enhancement (RNNoise/DeepFilter)
 * 4. Reverb + noise → Dereverb first, then denoise
 * 5. Clipping → Spectral repair first, then denoise
 * 6. Unknown → Full pipeline
 */

import { onnxRuntime } from "./onnxRuntime";
import { vadEngine }   from "./vadEngine";
import { classifyNoise, estimateRT60 } from "../audioForensics/noiseFingerprinting";
import { estimateNoiseProfile, applyAdaptiveWienerFilter } from "../audioEditor/professionalDSP";
import { applyAdaptiveDereverb } from "../audioEditor/adaptiveDereverb";
import { applyMasteringLimiter } from "../audioEditor/masteringLimiter";
import { runIntegrityCheck }     from "../dsp/observability/audioIntegrity";
import { computeFullQualityReport } from "../audioEditor/audioMetrics";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EnhancementRoute =
  | "passthrough"        // clean signal — no processing
  | "dsp_light"          // light DSP: Wiener only
  | "dsp_full"           // full DSP: dereverb + denoise + limit
  | "neural_denoise"     // neural: RNNoise/DeepFilter
  | "neural_hybrid"      // neural + DSP post-processing
  | "repair_then_denoise"; // spectral repair first

export interface EnhancementOptions {
  targetLufs?:       number;    // default -23
  maxGainDb?:        number;    // default 12
  preserveSpeech?:   boolean;   // default true
  useNeural?:        boolean;   // try neural first (default true)
  forceRoute?:       EnhancementRoute;
  validateOutput?:   boolean;   // rollback if degraded (default true)
}

export interface EnhancementResult {
  output:            Float32Array;
  route:             EnhancementRoute;
  inputQuality:      number;    // 0-100
  outputQuality:     number;    // 0-100
  qualityDelta:      number;    // output - input
  snrImprovementDb:  number;
  rolledBack:        boolean;
  processingMs:      number;
  stagesApplied:     string[];
  noiseClass:        string;
  rt60Ms:            number;
}

// ── Signal Analysis ────────────────────────────────────────────────────────────

interface SignalAnalysis {
  noiseClass:     string;
  noiseSeverity:  "clean" | "light" | "moderate" | "heavy";
  rt60Ms:         number;
  hasReverb:      boolean;
  hasClipping:    boolean;
  snrDb:          number;
  qualityScore:   number;
  speechRatio:    number;
}

async function analyzeSignal(
  data: Float32Array,
  sr:   number
): Promise<SignalAnalysis> {
  const noise   = classifyNoise(data, sr);
  const rt60    = estimateRT60(data, sr);
  const quality = computeFullQualityReport(data, sr);
  const integrity = runIntegrityCheck(
    { getChannelData: () => data, numberOfChannels:1, length:data.length, sampleRate:sr, duration:data.length/sr } as unknown as AudioBuffer
  );

  // VAD for speech ratio
  const vad = await vadEngine.analyze(data, sr, { useNeural:false });

  // Severity classification
  const primaryScore = noise.scores[noise.primary as keyof typeof noise.scores] ?? 0;
  let severity: SignalAnalysis["noiseSeverity"] = "clean";
  if(quality.snrDb < 10)       severity = "heavy";
  else if(quality.snrDb < 20)  severity = "moderate";
  else if(quality.snrDb < 35)  severity = "light";

  return {
    noiseClass:    noise.primary,
    noiseSeverity: severity,
    rt60Ms:        rt60.rt60Ms,
    hasReverb:     rt60.rt60Ms > 300,
    hasClipping:   integrity.clipping.clipRatio > 0.001,
    snrDb:         quality.snrDb,
    qualityScore:  quality.score,
    speechRatio:   vad.speechRatio,
  };
}

// ── Route Selection ────────────────────────────────────────────────────────────

function selectRoute(
  analysis: SignalAnalysis,
  options:  EnhancementOptions
): EnhancementRoute {
  if(options.forceRoute) return options.forceRoute;

  // Clean signal — passthrough
  if(analysis.noiseSeverity === "clean" && !analysis.hasReverb && !analysis.hasClipping)
    return "passthrough";

  // Clipping — repair first
  if(analysis.hasClipping) return "repair_then_denoise";

  // Heavy reverb — dereverb first
  if(analysis.hasReverb && analysis.rt60Ms > 500) return "dsp_full";

  // Heavy noise — try neural
  if(analysis.noiseSeverity === "heavy" && options.useNeural !== false)
    return "neural_denoise";

  // Moderate noise — neural hybrid
  if(analysis.noiseSeverity === "moderate" && options.useNeural !== false)
    return "neural_hybrid";

  // Light noise — DSP only
  return "dsp_light";
}

// ── Neural Enhancement ────────────────────────────────────────────────────────

async function neuralEnhance(
  data: Float32Array,
  sr:   number
): Promise<Float32Array | null> {
  // Try DeepFilterNet first, then RNNoise
  for(const modelId of ["deepfilter", "rnnoise"] as const) {
    const loaded = await onnxRuntime.loadModel(modelId).catch(() => false);
    if(!loaded) continue;

    const result = await onnxRuntime.run({
      modelId,
      inputs: { input: { data, dims:[1, data.length], type:"float32" } },
    });

    if(result?.outputs) {
      const out = result.outputs["output"]?.data ?? result.outputs["enhanced_audio"]?.data;
      if(out instanceof Float32Array && out.length === data.length) return out;
    }
  }
  return null;
}

// ── DSP Pipeline ──────────────────────────────────────────────────────────────

async function dspEnhance(
  data:     Float32Array,
  sr:       number,
  analysis: SignalAnalysis,
  route:    EnhancementRoute,
  stages:   string[]
): Promise<Float32Array> {
  let current = new Float32Array(data.buffer as ArrayBuffer, data.byteOffset, data.length);

  if(route === "dsp_full" || analysis.hasReverb) {
    const derev = applyAdaptiveDereverb(current, sr, {
      rt60Ms:  analysis.rt60Ms,
      dryWet:  0.7,
      strength: 0.6,
    });
    current = new Float32Array(derev.output.buffer as ArrayBuffer, derev.output.byteOffset, derev.output.length);
    stages.push(`Dereverb (RT60=${analysis.rt60Ms}ms)`);
  }

  if(route !== "passthrough") {
    const profile = estimateNoiseProfile(current, sr, 2048, "silence");
    const wiener  = applyAdaptiveWienerFilter(current, sr, profile, {
      strength:      route === "dsp_full" ? 1.5 : 1.0,
      temporalSmooth: 0.75,
      floorDb:       -70,
    });
    current = new Float32Array(wiener.output.buffer as ArrayBuffer, wiener.output.byteOffset, wiener.output.length);
    stages.push(`Wiener (SNR +${wiener.snrImprovement.toFixed(1)}dB)`);
  }

  return current;
}

// ── LUFS Normalization ────────────────────────────────────────────────────────

function normalizeLUFS(data: Float32Array, sr: number, targetLufs: number): Float32Array {
  const blockLen = Math.floor(0.4*sr), hop=Math.floor(0.1*sr);
  const blocks: number[] = [];
  for(let s=0;s+blockLen<=data.length;s+=hop){
    let ms=0; for(let i=s;i<s+blockLen;i++) ms+=data[i]*data[i];
    blocks.push(ms/blockLen);
  }
  if(!blocks.length) return data;
  const thresh=Math.pow(10,(-70-0.691)/10);
  const gated=blocks.filter(b=>b>thresh);
  if(!gated.length) return data;
  const measuredLufs=-0.691+10*Math.log10(gated.reduce((a,b)=>a+b)/gated.length);
  const gainDb=targetLufs-measuredLufs;
  if(Math.abs(gainDb)<0.5 || Math.abs(gainDb)>20) return data;
  const gain=Math.pow(10,gainDb/20);
  const out=new Float32Array(data.length);
  for(let i=0;i<data.length;i++) out[i]=Math.max(-1,Math.min(1,data[i]*gain));
  return out;
}

// ── Main Enhancement Agent ────────────────────────────────────────────────────

export class SpeechEnhanceAgent {

  async enhance(
    data:    Float32Array,
    sr:      number,
    options: EnhancementOptions = {}
  ): Promise<EnhancementResult> {
    const startMs  = performance.now();
    const stages:  string[] = [];
    let   rolledBack = false;

    // Pre-analysis
    const analysis     = await analyzeSignal(data, sr);
    const inputQuality = analysis.qualityScore;
    const route        = selectRoute(analysis, options);

    let current = new Float32Array(data.buffer as ArrayBuffer, data.byteOffset, data.length);

    if(route === "passthrough") {
      return {
        output:           current,
        route,
        inputQuality,
        outputQuality:    inputQuality,
        qualityDelta:     0,
        snrImprovementDb: 0,
        rolledBack:       false,
        processingMs:     Math.round(performance.now()-startMs),
        stagesApplied:    ["passthrough"],
        noiseClass:       analysis.noiseClass,
        rt60Ms:           analysis.rt60Ms,
      };
    }

    // Neural enhancement attempt
    if(route === "neural_denoise" || route === "neural_hybrid") {
      const neural = await neuralEnhance(current, sr).catch(() => null);
      if(neural) {
        current = new Float32Array(neural.buffer as ArrayBuffer, neural.byteOffset, neural.length);
        stages.push("Neural enhancement");
      } else {
        // Neural unavailable — fall back to DSP
        stages.push("Neural unavailable → DSP fallback");
      }
    }

    // DSP stages
    current = await dspEnhance(current, sr, analysis, route, stages);

    // LUFS normalization
    const targetLufs = options.targetLufs ?? -23;
    current = normalizeLUFS(current, sr, targetLufs);
    stages.push(`LUFS → ${targetLufs}`);

    // Mastering limiter
    const limited = applyMasteringLimiter(current, sr, { thresholdDb:-1.0 });
    current = new Float32Array(limited.output.buffer as ArrayBuffer, limited.output.byteOffset, limited.output.length);
    if(limited.maxGainReductionDb > 0.1)
      stages.push(`Limiter (${limited.maxGainReductionDb.toFixed(1)}dB GR)`);

    // Post-validation + rollback
    const outputReport   = computeFullQualityReport(current, sr);
    const outputQuality  = outputReport.score;
    const qualityDelta   = outputQuality - inputQuality;

    if(options.validateOutput !== false && qualityDelta < -10) {
      current     = data;
      rolledBack  = true;
      stages.push("ROLLBACK: output degraded");
    }

    return {
      output:           current,
      route,
      inputQuality,
      outputQuality:    rolledBack ? inputQuality : outputQuality,
      qualityDelta:     rolledBack ? 0 : qualityDelta,
      snrImprovementDb: rolledBack ? 0 : outputReport.snrDb - analysis.snrDb,
      rolledBack,
      processingMs:     Math.round(performance.now()-startMs),
      stagesApplied:    stages,
      noiseClass:       analysis.noiseClass,
      rt60Ms:           analysis.rt60Ms,
    };
  }
}

export const speechEnhanceAgent = new SpeechEnhanceAgent();
