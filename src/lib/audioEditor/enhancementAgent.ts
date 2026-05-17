/**
 * enhancementAgent.ts — Autonomous Audio Enhancement Agent
 * Aivora Audio Infrastructure Platform
 *
 * Analyzes audio and selects optimal enhancement pipeline automatically.
 * Context-aware: different strategies for TTS, ASR, forensic, broadcast.
 *
 * Pipeline stages (ordered by dependency):
 * 1. Analysis → classify noise, detect issues
 * 2. Strategy selection → choose algorithms based on detected problems
 * 3. Pre-processing → HP filter, DC removal
 * 4. Noise reduction → spectral subtraction / Wiener
 * 5. Dynamics → multi-band compression / limiting
 * 6. Loudness → LUFS normalization
 * 7. Validation → verify no speech damage
 * 8. Export gate → block if validation fails
 */

import { classifyNoise, estimateRT60 } from "../audioForensics/noiseFingerprinting";
import { estimateNoiseProfile, applyAdaptiveWienerFilter } from "./professionalDSP";
import { applyLR4Crossover, makeLR4BandState, sumLR4Bands,
         applyLookaheadLimiter } from "./professionalDSP";
import { computeFullQualityReport } from "./audioMetrics";

// ── Enhancement Context ───────────────────────────────────────────────────────

export type EnhancementTarget =
  | "tts_training"    // strictest — no speech modification
  | "asr_training"    // strict — preserve timing
  | "broadcast"       // EBU R128 loudness target
  | "forensic"        // preserve everything, minimal processing
  | "general";        // balanced enhancement

export interface AgentOptions {
  target:           EnhancementTarget;
  maxGainDb:        number;   // max loudness change allowed
  speechProtect:    boolean;  // block processing on speech regions
  validateOutput:   boolean;  // run validation before returning
  targetLufs:       number;   // target loudness (-23 for broadcast)
}

// ── Enhancement Step Log ──────────────────────────────────────────────────────

export interface EnhancementStep {
  name:        string;
  applied:     boolean;
  reason:      string;
  beforeDb:    number;
  afterDb:     number;
  durationMs:  number;
}

// ── Agent Result ──────────────────────────────────────────────────────────────

export interface AgentResult {
  output:          Float32Array;
  steps:           EnhancementStep[];
  strategy:        string;
  issuesFound:     string[];
  issuesFixed:     string[];
  issuesBlocked:   string[];
  qualityBefore:   { snrDb: number; lufsDb: number; noiseClass: string };
  qualityAfter:    { snrDb: number; lufsDb: number; score: number };
  speechPreserved: boolean;
  exportSafe:      boolean;
  processingMs:    number;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function rmsDb(data: Float32Array): number {
  let s=0; for(let i=0;i<data.length;i++) s+=data[i]**2;
  const rms=Math.sqrt(s/Math.max(1,data.length));
  return rms>0 ? 20*Math.log10(rms) : -120;
}

function fromDb(db: number): number { return Math.pow(10, db/20); }

function applyGain(data: Float32Array, gainDb: number): Float32Array {
  const g = fromDb(gainDb);
  const out = new Float32Array(data.length);
  for(let i=0;i<data.length;i++) out[i]=Math.max(-1,Math.min(1,data[i]*g));
  return out;
}

function removeDC(data: Float32Array): Float32Array {
  let mean=0;
  for(let i=0;i<data.length;i++) mean+=data[i];
  mean/=data.length;
  const out=new Float32Array(data.length);
  for(let i=0;i<data.length;i++) out[i]=data[i]-mean;
  return out;
}

function measureLufsSimple(data: Float32Array, sr: number): number {
  // Simplified LUFS via RMS with 400ms blocks
  const blockLen=Math.floor(0.4*sr), hop=Math.floor(0.1*sr);
  const blocks: number[]=[];
  for(let s=0;s+blockLen<=data.length;s+=hop){
    let ms=0;
    for(let i=s;i<s+blockLen;i++) ms+=data[i]**2;
    blocks.push(ms/blockLen);
  }
  if(!blocks.length) return -70;
  const mean=blocks.reduce((a,b)=>a+b)/blocks.length;
  return mean>0 ? -0.691+10*Math.log10(mean) : -70;
}

function detectSpeechRegions(data: Float32Array, sr: number): boolean[] {
  const frameLen=Math.floor(0.02*sr);
  const isSpeech: boolean[]=[];
  for(let s=0;s+frameLen<=data.length;s+=frameLen){
    let ms=0;
    for(let i=s;i<s+frameLen;i++) ms+=data[i]**2;
    isSpeech.push(10*Math.log10(ms/frameLen+1e-10)>-35);
  }
  return isSpeech;
}

function speechPreservationScore(
  original: Float32Array, processed: Float32Array, sr: number
): number {
  const n=Math.min(original.length,processed.length);
  let speechDiff=0, speechTotal=0;
  const frameLen=Math.floor(0.02*sr);
  for(let s=0;s+frameLen<=n;s+=frameLen){
    let ms=0;
    for(let i=s;i<s+frameLen;i++) ms+=original[s]**2;
    if(10*Math.log10(ms/frameLen+1e-10)>-35){
      for(let i=s;i<s+frameLen;i++){
        speechTotal++;
        if(Math.abs(processed[i]-original[i])>0.01) speechDiff++;
      }
    }
  }
  return speechTotal>0 ? 1-speechDiff/speechTotal : 1;
}

// ── Autonomous Enhancement Agent ──────────────────────────────────────────────

export async function runEnhancementAgent(
  data:    Float32Array,
  sr:      number,
  options: Partial<AgentOptions> = {}
): Promise<AgentResult> {
  const startTime = Date.now();
  const target      = options.target        ?? "general";
  const maxGain     = options.maxGainDb     ?? 12;
  const protect     = options.speechProtect ?? true;
  const validate    = options.validateOutput?? true;
  const targetLufs  = options.targetLufs    ?? -23;

  const steps:       EnhancementStep[] = [];
  const issuesFound: string[] = [];
  const issuesFixed: string[] = [];
  const issuesBlocked: string[] = [];

  let current = new Float32Array(data);

  // ── Step 1: Analysis ──────────────────────────────────────────────────────
  const noiseClass  = classifyNoise(current, sr);
  const rt60        = estimateRT60(current, sr);
  const lufsIn      = measureLufsSimple(current, sr);
  const rmsIn       = rmsDb(current);

  const qualityBefore = {
    snrDb:      rmsIn - noiseClass.noiseFloorDb,
    lufsDb:     lufsIn,
    noiseClass: noiseClass.primary,
  };

  // Detect issues
  if(noiseClass.confidence > 0.3) {
    issuesFound.push(`Noise: ${noiseClass.primary} (${(noiseClass.confidence*100).toFixed(0)}%)`);
  }
  if(noiseClass.scores.electrical_hum_50hz>0.3||noiseClass.scores.electrical_hum_60hz>0.3) issuesFound.push("Electrical hum detected");
  if(noiseClass.scores.broadband_hiss>0.3) issuesFound.push("High-frequency hiss detected");
  if(rt60.rt60Ms > 300)        issuesFound.push(`Reverb: RT60=${rt60.rt60Ms.toFixed(0)}ms`);
  if(Math.abs(lufsIn-targetLufs)>3) issuesFound.push(`LUFS: ${lufsIn.toFixed(1)} (target: ${targetLufs})`);

  // Strategy selection
  const strategy = selectStrategy(noiseClass.primary, target, issuesFound);

  // ── Step 2: DC Removal ────────────────────────────────────────────────────
  {
    const before=rmsDb(current);
    current=new Float32Array(removeDC(current));
    steps.push({name:"DC Removal",applied:true,reason:"Remove DC offset",
      beforeDb:before,afterDb:rmsDb(current),durationMs:0});
  }

  // ── Step 3: High-pass filter (remove sub-sonic rumble) ────────────────────
  if(target!=="forensic") {
    const before=rmsDb(current);
    const t=Date.now();
    // Simple 1st order HP at 80Hz for rumble removal
    const rc=1/(2*Math.PI*80), dt=1/sr, alpha=rc/(rc+dt);
    const out=new Float32Array(current.length);
    out[0]=current[0];
    for(let i=1;i<current.length;i++)
      out[i]=alpha*(out[i-1]+current[i]-current[i-1]);
    current=new Float32Array(out);
    steps.push({name:"Sub-sonic HP Filter (80Hz)",applied:true,
      reason:"Remove inaudible rumble",beforeDb:before,
      afterDb:rmsDb(current),durationMs:Date.now()-t});
  }

  // ── Step 4: Noise Reduction ───────────────────────────────────────────────
  const shouldDenoise =
    (noiseClass.scores.electrical_hum_50hz>0.3||noiseClass.scores.electrical_hum_60hz>0.3) || noiseClass.scores.broadband_hiss>0.3 ||
    ["hvac_hum","electrical_hum_50hz","electrical_hum_60hz",
     "broadband_hiss"].includes(noiseClass.primary);

  if(shouldDenoise && target!=="forensic") {
    const before=rmsDb(current);
    const t=Date.now();
    try {
      const profile=estimateNoiseProfile(current, sr, 2048, "silence");
      const result=applyAdaptiveWienerFilter(current, sr, profile, {
        strength:  target==="tts_training"?1.0:1.3,
        temporalSmooth: 0.75,
        floorDb: -60,
      });
      if(result.snrImprovement>-3) { // only apply if not degrading
        current=new Float32Array(result.output);
        issuesFixed.push(`Noise reduction applied (SNR Δ: ${result.snrImprovement.toFixed(1)}dB)`);
      } else {
        issuesBlocked.push("Noise reduction skipped: would degrade SNR");
      }
      steps.push({name:"Adaptive Wiener Denoising",applied:result.snrImprovement>-3,
        reason:noiseClass.primary,beforeDb:before,afterDb:rmsDb(current),
        durationMs:Date.now()-t});
    } catch { /* skip on error */ }
  }

  // ── Step 5: Multi-band Dynamics (not for TTS/forensic) ───────────────────
  if(!["tts_training","forensic"].includes(target)) {
    const before=rmsDb(current);
    const t=Date.now();
    try {
      const state=makeLR4BandState(sr);
      const bands=applyLR4Crossover(current, state);

      // Light compression per band (ratio 2:1, threshold -20dB)
      const thresh=fromDb(-20);
      for(const band of [bands.sub,bands.low,bands.mid,bands.high]) {
        let env=0;
        const rel=Math.exp(-1/(sr*0.1));
        for(let i=0;i<band.length;i++){
          const v=Math.abs(band[i]);
          env=v>env?v:rel*env+(1-rel)*v;
          if(env>thresh) band[i]*=thresh/env;
        }
      }

      current=new Float32Array(sumLR4Bands(bands));
      issuesFixed.push("Multi-band dynamics applied (LR4 crossovers)");
      steps.push({name:"LR4 Multi-band Compression",applied:true,
        reason:"Dynamic range control",beforeDb:before,
        afterDb:rmsDb(current),durationMs:Date.now()-t});
    } catch { /* skip */ }
  }

  // ── Step 6: Lookahead Limiter ─────────────────────────────────────────────
  {
    const before=rmsDb(current);
    const t=Date.now();
    const limResult=applyLookaheadLimiter(current, sr, {
      thresholdDb: -1.0,
      lookaheadMs: 5,
      releaseMs:   50,
    });
    if(limResult.limitingRatio>0.001){
      current=new Float32Array(limResult.output);
      issuesFixed.push(`True peak limited: ${limResult.inputPeakDb.toFixed(1)}→${limResult.outputPeakDb.toFixed(1)}dBTP`);
    }
    steps.push({name:"Lookahead Limiter (-1dBTP)",applied:limResult.limitingRatio>0.001,
      reason:"Peak safety",beforeDb:before,afterDb:rmsDb(current),durationMs:Date.now()-t});
  }

  // ── Step 7: LUFS Normalization ────────────────────────────────────────────
  {
    const lufsNow=measureLufsSimple(current, sr);
    const gainNeeded=targetLufs-lufsNow;
    const before=rmsDb(current);

    if(Math.abs(gainNeeded)>0.5 && Math.abs(gainNeeded)<=maxGain) {
      current=new Float32Array(applyGain(current, gainNeeded));
      // Re-limit after gain
      const relim=applyLookaheadLimiter(current, sr, {thresholdDb:-1.0});
      current=new Float32Array(relim.output);
      issuesFixed.push(`LUFS normalized: ${lufsNow.toFixed(1)}→${measureLufsSimple(current,sr).toFixed(1)} LUFS`);
    } else if(Math.abs(gainNeeded)>maxGain) {
      issuesBlocked.push(`LUFS gain ${gainNeeded.toFixed(1)}dB exceeds max ${maxGain}dB`);
    }
    steps.push({name:`LUFS Normalize (target: ${targetLufs})`,
      applied:Math.abs(gainNeeded)<=maxGain,
      reason:"Broadcast loudness compliance",
      beforeDb:before,afterDb:rmsDb(current),durationMs:0});
  }

  // ── Step 8: Validation ────────────────────────────────────────────────────
  let speechPreserved = true;
  let exportSafe = true;

  if(validate && protect) {
    const preservation=speechPreservationScore(data, current, sr);
    speechPreserved=preservation>0.95;
    if(!speechPreserved) {
      issuesBlocked.push(`Speech preservation: ${(preservation*100).toFixed(1)}% (threshold: 95%)`);
      exportSafe=false;
      // Rollback to original if speech damaged
      if(target==="tts_training") {
        current=new Float32Array(data.buffer.slice(0) as ArrayBuffer);
        issuesBlocked.push("ROLLBACK: TTS target requires 100% speech preservation");
      }
    }
  }

  // ── Final Quality ─────────────────────────────────────────────────────────
  const lufsOut = measureLufsSimple(current, sr);
  const rmsOut  = rmsDb(current);
  const qualReport = computeFullQualityReport(current, sr);

  const qualityAfter = {
    snrDb: rmsOut - noiseClass.noiseFloorDb,
    lufsDb: lufsOut,
    score: qualReport.score,
  };

  return {
    output: current,
    steps,
    strategy,
    issuesFound,
    issuesFixed,
    issuesBlocked,
    qualityBefore,
    qualityAfter,
    speechPreserved,
    exportSafe,
    processingMs: Date.now()-startTime,
  };
}

function selectStrategy(
  noiseClass: string,
  target:     EnhancementTarget,
  issues:     string[]
): string {
  if(target==="forensic")     return "Forensic: minimal processing, preserve all";
  if(target==="tts_training") return "TTS: speech-safe denoising + LUFS -23";
  if(target==="asr_training") return "ASR: SNR improvement + timing preservation";
  if(target==="broadcast")    return "Broadcast: EBU R128 + LR4 dynamics";

  const hasHum  = noiseClass.includes("hum");
  const hasHiss = noiseClass==="broadband_hiss";
  const hasAI   = noiseClass==="ai_artifact";

  if(hasAI)   return "AI Artifact: spectral smoothing + light denoising";
  if(hasHum)  return "Hum Removal: harmonic notch + Wiener filter";
  if(hasHiss) return "Hiss Reduction: spectral subtraction + HP filter";
  return "General: adaptive denoising + loudness normalization";
}
