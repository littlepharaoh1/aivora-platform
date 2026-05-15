/**
 * regionReplace.ts — Manual Silence Replace Engine
 * Adobe-style paste/replace/heal/blend workflow
 * Aivora Platform — Audition Workstation
 */

import { reconstructSilenceWithReference } from "../audioForensics/silenceReconstructor";
import type { SilenceRegion, ReferenceSilenceProfile } from "../audioForensics/types";
import { findZeroCrossing, detectWaveformDiscontinuity } from "./sampleEditEngine";
import type { ClipboardEntry } from "./silenceClipboard";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReplaceMode =
  | "replace"    // Hard replace with crossfade
  | "fill"       // Fill using grain synthesis
  | "blend"      // Blend clipboard into target
  | "heal"       // Auto-heal using reference profile
  | "match_tone"; // Match room tone from reference

export interface RegionReplaceOptions {
  mode:         ReplaceMode;
  crossfadeMs?: number;      // Default 8ms
  snapZeroCross?: boolean;   // Default true
  matchRms?:    boolean;     // Default true
}

export interface RegionStats {
  rmsDb:        number;
  peakDb:       number;
  noiseFloorDb: number;
}

export interface ReplaceResult {
  repairedBuffer:  AudioBuffer;
  replacedRegion: {
    startSample: number;
    endSample:   number;
    durationMs:  number;
  };
  beforeStats:    RegionStats;
  afterStats:     RegionStats;
  seamRisk:       number;
  realismScore:   number;
  warnings:       string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for(let ch=0; ch<buffer.numberOfChannels; ch++){
    const d = buffer.getChannelData(ch);
    for(let i=0; i<buffer.length; i++) mono[i] += d[i];
  }
  if(buffer.numberOfChannels > 1)
    for(let i=0; i<mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

function computeStats(samples: Float32Array): RegionStats {
  let rmsSum=0, peak=0;
  for(let i=0; i<samples.length; i++){
    rmsSum += samples[i]**2;
    const a = Math.abs(samples[i]);
    if(a > peak) peak = a;
  }
  const rms = Math.sqrt(rmsSum / Math.max(1, samples.length));
  return {
    rmsDb:        rms > 0 ? 20*Math.log10(rms) : -120,
    peakDb:       peak > 0 ? 20*Math.log10(peak) : -120,
    noiseFloorDb: rms > 0 ? 10*Math.log10(rmsSum/Math.max(1,samples.length)) : -120,
  };
}

function matchRmsGain(targetRms: number, sourceRms: number): number {
  if(sourceRms <= -118) return 1;
  const diff = targetRms - sourceRms;
  return Math.pow(10, diff/20);
}

function cloneBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for(let ch=0; ch<buffer.numberOfChannels; ch++)
    out.getChannelData(ch).set(buffer.getChannelData(ch));
  return out;
}

// ── Grain Filler (from clipboard profile) ────────────────────────────────────

function fillFromGrains(
  profile:   ReferenceSilenceProfile,
  targetLen: number,
  sampleRate: number,
  seed:      number = 0
): Float32Array {
  const output = new Float32Array(targetLen);
  const grains = profile.grainLibrary;
  if(grains.length === 0){
    const amp = Math.pow(10, (profile.noiseFloorDb+6)/20);
    for(let i=0; i<targetLen; i++) output[i] = (Math.random()*2-1)*amp;
    return output;
  }

  let pos=0, gi=seed%grains.length;
  while(pos < targetLen){
    const grain  = grains[gi];
    const gLen   = grain.samples.length;
    const copyLen= Math.min(gLen, targetLen-pos);
    const fadeLen= Math.min(Math.round(8/1000*sampleRate), Math.floor(copyLen/4));
    const amp    = 0.95 + Math.random()*0.10;

    for(let i=0; i<copyLen; i++){
      let g = amp;
      if(i < fadeLen)            g *= 0.5*(1-Math.cos(Math.PI*i/fadeLen));
      if(i > copyLen-fadeLen)    g *= 0.5*(1-Math.cos(Math.PI*(copyLen-i)/fadeLen));
      output[pos+i] += grain.samples[i] * g;
    }

    pos += Math.round(gLen * 0.75);
    gi  = (gi+1) % grains.length;
  }

  // Normalize to profile RMS
  const targetLin = Math.pow(10, (profile.rmsDb-3)/20);
  let curRms = 0;
  for(let i=0; i<output.length; i++) curRms += output[i]**2;
  curRms = Math.sqrt(curRms/output.length);
  if(curRms > 0){
    const gain = targetLin/curRms;
    for(let i=0; i<output.length; i++) output[i] *= gain;
  }

  return output;
}

// ── Main Replace Engine ───────────────────────────────────────────────────────

export function replaceRegionWithClipboard(
  targetBuffer: AudioBuffer,
  startSample:  number,
  endSample:    number,
  clipboard:    ClipboardEntry,
  options:      RegionReplaceOptions = { mode: "fill" }
): ReplaceResult {
  const sr       = targetBuffer.sampleRate;
  const crossMs  = options.crossfadeMs ?? 8;
  const fadeLen  = Math.round(crossMs/1000*sr);
  const warnings: string[] = [];

  const mono = getMono(targetBuffer);

  // Snap to zero crossings
  let s = startSample, e = endSample;
  if(options.snapZeroCross !== false){
    s = findZeroCrossing(mono, startSample, 5, sr, "nearest");
    e = findZeroCrossing(mono, endSample,   5, sr, "nearest");
  }

  const targetLen = Math.max(1, e-s);
  const durationMs = (targetLen/sr)*1000;

  // Before stats
  const beforeStats = computeStats(mono.subarray(s,e));

  // Clone target
  const out = cloneBuffer(targetBuffer);

  // Context RMS for matching
  const contextBefore = mono.subarray(Math.max(0,s-256),s);
  const contextStats  = computeStats(contextBefore);

  // Generate replacement
  let replacement: Float32Array;

  switch(options.mode){
    case "replace":
    case "fill":
    case "heal": {
      replacement = fillFromGrains(clipboard.profile, targetLen, sr, s);
      // Match RMS to context
      if(options.matchRms !== false && contextStats.rmsDb > -100){
        const repStats = computeStats(replacement);
        const gain = matchRmsGain(contextStats.rmsDb, repStats.rmsDb);
        for(let i=0; i<replacement.length; i++) replacement[i] *= gain;
      }
      break;
    }

    case "blend": {
      // Blend clipboard samples with grain synthesis
      const grains = fillFromGrains(clipboard.profile, targetLen, sr, s);
      const clipMono = getMono(clipboard.buffer);
      replacement = new Float32Array(targetLen);
      for(let i=0; i<targetLen; i++){
        const t = i/targetLen;
        const blend = Math.sin(Math.PI*t); // Peak blend in middle
        const clipSample = i < clipMono.length ? clipMono[i] : grains[i];
        replacement[i] = grains[i]*(1-blend*0.5) + clipSample*(blend*0.5);
      }
      break;
    }

    case "match_tone": {
      replacement = fillFromGrains(clipboard.profile, targetLen, sr, s+7);
      break;
    }

    default:
      replacement = fillFromGrains(clipboard.profile, targetLen, sr, s);
  }

  // Write to all channels
  for(let ch=0; ch<out.numberOfChannels; ch++){
    const dst = out.getChannelData(ch);

    for(let i=0; i<targetLen && s+i<dst.length; i++){
      let gain = 1.0;
      if(i < fadeLen)           gain = 0.5*(1-Math.cos(Math.PI*i/fadeLen));
      if(i > targetLen-fadeLen) gain = 0.5*(1-Math.cos(Math.PI*(targetLen-i)/fadeLen));

      const origGain = 1-gain;
      dst[s+i] = dst[s+i]*origGain + replacement[i]*gain;
    }
  }

  // After stats
  const outMono = getMono(out);
  const afterStats = computeStats(outMono.subarray(s,e));

  // Seam risk
  const discStart = detectWaveformDiscontinuity(outMono, s);
  const discEnd   = detectWaveformDiscontinuity(outMono, e);
  const seamRisk  = Math.max(discStart.risk, discEnd.risk);

  if(seamRisk > 0.5) warnings.push(`Elevated seam risk: ${(seamRisk*100).toFixed(0)}%`);
  if(clipboard.purityScore < 0.70) warnings.push("Clipboard purity is low — result may contain noise");

  // Realism score
  const rmsImprovement = beforeStats.rmsDb - afterStats.rmsDb;
  const realismScore = Math.min(1, Math.max(0,
    clipboard.purityScore * 0.6 +
    (1-seamRisk) * 0.3 +
    (rmsImprovement > 0 ? 0.1 : 0)
  ));

  return {
    repairedBuffer: out,
    replacedRegion: { startSample:s, endSample:e, durationMs },
    beforeStats, afterStats, seamRisk, realismScore, warnings,
  };
}

// ── Heal Region (using forensics + reconstructor) ─────────────────────────────

export function healRegion(
  targetBuffer: AudioBuffer,
  startSample:  number,
  endSample:    number,
  profile:      ReferenceSilenceProfile
): ReplaceResult {
  const sr      = targetBuffer.sampleRate;
  const mono    = getMono(targetBuffer);
  const beforeStats = computeStats(mono.subarray(startSample, endSample));
  const warnings: string[] = [];

  // Build a fake SilenceRegion
  const region: SilenceRegion = {
    startMs:           (startSample/sr)*1000,
    endMs:             (endSample/sr)*1000,
    durationMs:        ((endSample-startSample)/sr)*1000,
    startSample,
    endSample,
    contaminationType: "unknown",
    noiseFloorDb:      beforeStats.rmsDb,
    humHz:             null,
    seamRisk:          0.3,
    spectralMatchRisk: 0.2,
    purityScore:       0.4,
    confidence:        0.8,
    suggestedAction:   "replace_with_reference",
    rmsDb:             beforeStats.rmsDb,
    peakDb:            beforeStats.peakDb,
    spectralSlope:     -0.5,
  };

  const result = reconstructSilenceWithReference(targetBuffer, [region], profile);
  const outMono = getMono(result.buffer);
  const afterStats = computeStats(outMono.subarray(startSample, endSample));
  const discS = detectWaveformDiscontinuity(outMono, startSample);
  const discE = detectWaveformDiscontinuity(outMono, endSample);

  return {
    repairedBuffer:  result.buffer,
    replacedRegion: { startSample, endSample, durationMs:region.durationMs },
    beforeStats, afterStats,
    seamRisk:     Math.max(discS.risk, discE.risk),
    realismScore: profile.purityScore * 0.8,
    warnings:     [...warnings, ...result.warnings],
  };
}
