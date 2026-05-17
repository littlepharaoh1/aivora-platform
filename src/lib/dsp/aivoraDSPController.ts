/**
 * aivoraDSPController.ts — Unified DSP Pipeline Controller
 * Aivora Audio Infrastructure Platform
 *
 * Single entry point for all DSP operations.
 * Orchestrates: dspRuntime + dspQueue + audioWorklet + enhancementAgent
 *
 * Architecture:
 * UI → AivoraDSPController → dspQueue → dspRuntime → audioWorklet
 *                         ↓
 *                   enhancementAgent → exportValidator
 */

import { getHannWindow, getHammingWindow } from "./runtime/dspRuntime";
import { estimateNoiseProfile, applyAdaptiveWienerFilter,
         applyLookaheadLimiter, makeLR4BandState,
         applyLR4Crossover, sumLR4Bands } from "../audioEditor/professionalDSP";
import { computeFullQualityReport } from "../audioEditor/audioMetrics";
import { validateExport } from "../audioEditor/exportValidator";
import { classifyNoise, estimateRT60 } from "../audioForensics/noiseFingerprinting";
import { workletManager } from "../audioEditor/audioWorkletManager";

// ── Pipeline Config ───────────────────────────────────────────────────────────

export type PipelineTarget =
  | "tts_training"
  | "asr_training"
  | "broadcast"
  | "forensic"
  | "podcast"
  | "general";

export interface PipelineConfig {
  target:          PipelineTarget;
  enableDenoising: boolean;
  enableDynamics:  boolean;
  enableLimiting:  boolean;
  enableLUFS:      boolean;
  targetLufs:      number;
  maxGainDb:       number;
  validateOutput:  boolean;
}

export interface PipelineResult {
  output:         Float32Array;
  sampleRate:     number;
  metrics:        PipelineMetrics;
  validation:     ValidationSummary;
  processingMs:   number;
  stagesApplied:  string[];
}

export interface PipelineMetrics {
  inputLufs:      number;
  outputLufs:     number;
  snrDb:          number;
  rt60Ms:         number;
  noiseClass:     string;
  dnsmos:         number;
  siSdr:          number;
  qualityScore:   number;
}

export interface ValidationSummary {
  safe:        boolean;
  score:       number;
  failures:    string[];
  exportReady: boolean;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function measureLufs(data: Float32Array, sr: number): number {
  const blockLen = Math.floor(0.4 * sr);
  const hop      = Math.floor(0.1 * sr);
  const blocks: number[] = [];
  for(let s=0; s+blockLen<=data.length; s+=hop) {
    let ms=0;
    for(let i=s;i<s+blockLen;i++) ms+=data[i]**2;
    blocks.push(ms/blockLen);
  }
  if(!blocks.length) return -70;
  const thresh=Math.pow(10,(-70-0.691)/10);
  const gated=blocks.filter(b=>b>thresh);
  if(!gated.length) return -70;
  const mean=gated.reduce((a,b)=>a+b)/gated.length;
  return -0.691+10*Math.log10(mean);
}

function fromDb(db: number): number { return Math.pow(10, db/20); }

function safeClamp(x: number): number {
  return Math.max(-1, Math.min(1, isFinite(x) ? x : 0));
}

// ── Default Configs per Target ────────────────────────────────────────────────

export const PIPELINE_PRESETS: Record<PipelineTarget, PipelineConfig> = {
  tts_training: {
    target:"tts_training", enableDenoising:true, enableDynamics:false,
    enableLimiting:true, enableLUFS:true, targetLufs:-23,
    maxGainDb:12, validateOutput:true,
  },
  asr_training: {
    target:"asr_training", enableDenoising:true, enableDynamics:true,
    enableLimiting:true, enableLUFS:true, targetLufs:-23,
    maxGainDb:12, validateOutput:true,
  },
  broadcast: {
    target:"broadcast", enableDenoising:true, enableDynamics:true,
    enableLimiting:true, enableLUFS:true, targetLufs:-23,
    maxGainDb:20, validateOutput:true,
  },
  forensic: {
    target:"forensic", enableDenoising:false, enableDynamics:false,
    enableLimiting:true, enableLUFS:false, targetLufs:-23,
    maxGainDb:6, validateOutput:true,
  },
  podcast: {
    target:"podcast", enableDenoising:true, enableDynamics:true,
    enableLimiting:true, enableLUFS:true, targetLufs:-19,
    maxGainDb:20, validateOutput:true,
  },
  general: {
    target:"general", enableDenoising:true, enableDynamics:true,
    enableLimiting:true, enableLUFS:true, targetLufs:-23,
    maxGainDb:20, validateOutput:true,
  },
};

// ── Main Pipeline ─────────────────────────────────────────────────────────────

export async function runUnifiedPipeline(
  buffer:  AudioBuffer,
  config:  Partial<PipelineConfig> = {},
  onProgress?: (pct: number, stage: string) => void
): Promise<PipelineResult> {
  const startTime    = Date.now();
  const stagesApplied: string[] = [];
  const sr           = buffer.sampleRate;

  // Merge config with preset
  const target  = config.target ?? "general";
  const preset  = PIPELINE_PRESETS[target];
  const cfg     = { ...preset, ...config };

  // Get mono
  const mono = new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  onProgress?.(5, "Analyzing...");

  // ── Analysis ──────────────────────────────────────────────────────────────
  const inputLufs  = measureLufs(mono, sr);
  const noiseClass = classifyNoise(mono, sr);
  const rt60       = estimateRT60(mono, sr);
  const qualIn     = computeFullQualityReport(mono, sr);

  let current = new Float32Array(mono);
  onProgress?.(15, "Analysis complete");

  // ── Stage 1: Noise Reduction ──────────────────────────────────────────────
  if(cfg.enableDenoising &&
     (noiseClass.scores.electrical_hum_50hz > 0.3 || noiseClass.scores.broadband_hiss > 0.3 ||
      
      noiseClass.scores.electrical_hum_50hz > 0.3)) {
    onProgress?.(25, "Denoising...");
    const profile = estimateNoiseProfile(current, sr, 2048, "silence");
    const result  = applyAdaptiveWienerFilter(current, sr, profile, {
      strength:       cfg.target==="tts_training" ? 1.0 : 1.3,
      temporalSmooth: 0.75,
      floorDb:        -60,
    });
    if(result.snrImprovement > -3) {
      current = new Float32Array(result.output);
      stagesApplied.push(`Wiener denoising (+${result.snrImprovement.toFixed(1)}dB SNR)`);
    }
  }

  // ── Stage 2: Multi-band Dynamics (LR4) ───────────────────────────────────
  if(cfg.enableDynamics && cfg.target !== "forensic") {
    onProgress?.(45, "LR4 dynamics...");
    try {
      const state = makeLR4BandState(sr);
      const bands = applyLR4Crossover(current, state);

      // Light compression per band (2:1, -20dB threshold)
      const thresh = fromDb(-20);
      const rel    = Math.exp(-1/(sr*0.1));
      for(const band of [bands.sub, bands.low, bands.mid, bands.high]) {
        let env=0;
        for(let i=0;i<band.length;i++){
          const v=Math.abs(band[i]);
          env=v>env?v:rel*env+(1-rel)*v;
          if(env>thresh) band[i]*=thresh/env;
        }
      }
      current = new Float32Array(sumLR4Bands(bands));
      stagesApplied.push("LR4 multi-band compression");
    } catch {}
  }

  // ── Stage 3: Lookahead Limiter ────────────────────────────────────────────
  if(cfg.enableLimiting) {
    onProgress?.(60, "Limiting...");
    const limResult = applyLookaheadLimiter(current, sr, {
      thresholdDb: -1.0,
      lookaheadMs: 5,
      releaseMs:   50,
    });
    if(limResult.limitingRatio > 0.0001) {
      current = new Float32Array(limResult.output);
      stagesApplied.push(
        `Lookahead limiter (${limResult.peakReductionDb.toFixed(1)}dB GR)`
      );
    }
  }

  // ── Stage 4: LUFS Normalization ───────────────────────────────────────────
  if(cfg.enableLUFS) {
    onProgress?.(75, "LUFS normalization...");
    const measuredLufs = measureLufs(current, sr);
    const gainDb       = cfg.targetLufs - measuredLufs;
    if(Math.abs(gainDb) > 0.5 && Math.abs(gainDb) <= cfg.maxGainDb) {
      const gain = fromDb(gainDb);
      for(let i=0;i<current.length;i++) current[i]=safeClamp(current[i]*gain);
      // Re-limit after gain
      const relim = applyLookaheadLimiter(current, sr, {thresholdDb:-1.0});
      current = new Float32Array(relim.output);
      stagesApplied.push(`LUFS ${measuredLufs.toFixed(1)}→${cfg.targetLufs} LUFS`);
    }
  }

  onProgress?.(85, "Validating...");

  // ── Validation ────────────────────────────────────────────────────────────
  const validation = cfg.validateOutput
    ? validateExport(current, sr, {
        expectedSampleRate: 48000,
        maxTruePeakDb:      -1.0,
        minLufs:            cfg.targetLufs - 10,
        maxLufs:            cfg.targetLufs + 10,
      })
    : { safe:true, score:100, failures:[], exportBlocked:false };

  // ── Final Metrics ─────────────────────────────────────────────────────────
  const outputLufs  = measureLufs(current, sr);
  const qualOut     = computeFullQualityReport(current, sr);

  onProgress?.(100, "Complete");

  return {
    output:       current,
    sampleRate:   sr,
    stagesApplied,
    processingMs: Date.now()-startTime,
    metrics: {
      inputLufs,
      outputLufs,
      snrDb:      qualOut.snrDb,
      rt60Ms:     rt60.rt60Ms,
      noiseClass: noiseClass.primary,
      dnsmos:     qualOut.dnsmos.ovrl,
      siSdr:      qualOut.siSdr,
      qualityScore: qualOut.score,
    },
    validation: {
      safe:        validation.safe,
      score:       validation.score,
      failures:    validation.failures.map((f: {message:string}) => f.message),
      exportReady: !validation.exportBlocked,
    },
  };
}

// ── Singleton Controller ──────────────────────────────────────────────────────

export const dspController = {
  presets: PIPELINE_PRESETS,
  run:     runUnifiedPipeline,
};
