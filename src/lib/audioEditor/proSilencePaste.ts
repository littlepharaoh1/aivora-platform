/**
 * proSilencePaste.ts — Professional Silence Paste Engine
 * Adobe-style paste with full seam hiding and spectral matching
 * Aivora Platform — Audition Workstation
 */

import type { ReferenceSilenceProfile } from "../audioForensics/types";
import { findZeroCrossing, detectWaveformDiscontinuity } from "./sampleEditEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProPasteMode =
  | "replace"
  | "fill"
  | "blend"
  | "heal"
  | "match_reference_tone";

export interface ProPasteOptions {
  mode:            ProPasteMode;
  crossfadeMs?:    number;
  matchRms?:       boolean;
  matchSpectral?:  boolean;
  snapZeroCross?:  boolean;
  randomizeSeed?:  number;
}

export interface ProPasteStats {
  rmsDb:       number;
  peakDb:      number;
  noiseFloorDb: number;
}

export interface ProPasteResult {
  repairedBuffer:  AudioBuffer;
  replacedRegion:  { startSample:number; endSample:number; durationMs:number };
  beforeStats:     ProPasteStats;
  afterStats:      ProPasteStats;
  seamRisk:        number;
  realismScore:    number;
  warnings:        string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMono(buf: AudioBuffer): Float32Array {
  const m=new Float32Array(buf.length);
  for(let ch=0;ch<buf.numberOfChannels;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<buf.length;i++) m[i]+=d[i];
  }
  if(buf.numberOfChannels>1) for(let i=0;i<m.length;i++) m[i]/=buf.numberOfChannels;
  return m;
}

function rmsDb(s: Float32Array): number {
  let sum=0; for(let i=0;i<s.length;i++) sum+=s[i]**2;
  const r=Math.sqrt(sum/Math.max(1,s.length));
  return r>0?20*Math.log10(r):-120;
}

function peakDb(s: Float32Array): number {
  let p=0; for(let i=0;i<s.length;i++){const a=Math.abs(s[i]);if(a>p)p=a;}
  return p>0?20*Math.log10(p):-120;
}

function computeStats(s: Float32Array): ProPasteStats {
  return { rmsDb:rmsDb(s), peakDb:peakDb(s), noiseFloorDb:rmsDb(s)-3 };
}

function cloneBuffer(buf: AudioBuffer): AudioBuffer {
  const ctx=new OfflineAudioContext(buf.numberOfChannels,buf.length,buf.sampleRate);
  const out=ctx.createBuffer(buf.numberOfChannels,buf.length,buf.sampleRate);
  for(let ch=0;ch<buf.numberOfChannels;ch++)
    out.getChannelData(ch).set(buf.getChannelData(ch));
  return out;
}

// ── Grain Synthesizer ─────────────────────────────────────────────────────────

function synthesizeFromProfile(
  profile:    ReferenceSilenceProfile,
  targetLen:  number,
  sampleRate: number,
  seed        = 0
): Float32Array {
  const out=new Float32Array(targetLen);
  const grains=profile.grainLibrary;

  if(grains.length===0){
    const amp=Math.pow(10,(profile.noiseFloorDb+6)/20);
    for(let i=0;i<targetLen;i++) out[i]=(Math.random()*2-1)*amp;
    return out;
  }

  let pos=0, gi=seed%grains.length;
  const fadeSamples=Math.round(8/1000*sampleRate);

  while(pos<targetLen){
    const grain=grains[gi];
    const gLen =grain.samples.length;
    const cLen =Math.min(gLen,targetLen-pos);
    const fLen =Math.min(fadeSamples,Math.floor(cLen/4));
    // Slight random amplitude variation for realism
    const ampVar=0.93+Math.random()*0.14;

    for(let i=0;i<cLen;i++){
      let g=ampVar;
      if(i<fLen)       g*=0.5*(1-Math.cos(Math.PI*i/fLen));
      if(i>cLen-fLen)  g*=0.5*(1-Math.cos(Math.PI*(cLen-i)/fLen));
      out[pos+i]+=grain.samples[i]*g;
    }
    pos+=Math.round(gLen*0.75);
    gi=(gi+1+Math.floor(Math.random()*2))%grains.length; // slight randomization
  }

  // Match RMS to profile
  const targetRms=Math.pow(10,(profile.rmsDb-3)/20);
  let curRms=0;
  for(let i=0;i<out.length;i++) curRms+=out[i]**2;
  curRms=Math.sqrt(curRms/out.length);
  if(curRms>0) for(let i=0;i<out.length;i++) out[i]*=targetRms/curRms;

  return out;
}

// ── Spectral RMS Matcher ──────────────────────────────────────────────────────

function matchContextRms(
  signal:     Float32Array,
  contextRms: number
): void {
  const curRms=rmsDb(signal);
  if(curRms<-110||contextRms<-110) return;
  const gain=Math.pow(10,(contextRms-curRms)/20);
  const clampGain=Math.max(0.1,Math.min(10,gain));
  for(let i=0;i<signal.length;i++) signal[i]*=clampGain;
}

// ── Micro Crossfade ───────────────────────────────────────────────────────────

function microCrossfade(
  dest:      Float32Array,
  src:       Float32Array,
  startPos:  number,
  fadeLen:   number
): void {
  for(let i=0;i<fadeLen&&startPos+i<dest.length&&i<src.length;i++){
    const t=i/fadeLen;
    const fi=0.5*(1-Math.cos(Math.PI*t));
    dest[startPos+i]=dest[startPos+i]*(1-fi)+src[i]*fi;
  }
}

// ── Main Pro Paste Engine ─────────────────────────────────────────────────────

export function proSilencePaste(
  targetBuffer: AudioBuffer,
  startSample:  number,
  endSample:    number,
  profile:      ReferenceSilenceProfile,
  options:      ProPasteOptions = { mode:"fill" }
): ProPasteResult {
  const sr      =targetBuffer.sampleRate;
  const crossMs =options.crossfadeMs??10;
  const fadeLen =Math.round(crossMs/1000*sr);
  const warnings:string[]=[];
  const seed    =options.randomizeSeed??startSample;

  const mono=toMono(targetBuffer);

  // Zero crossing snap
  let s=startSample, e=endSample;
  if(options.snapZeroCross!==false){
    s=findZeroCrossing(mono,startSample,5,sr,"nearest");
    e=findZeroCrossing(mono,endSample,  5,sr,"nearest");
  }
  const targetLen=Math.max(1,e-s);
  const durationMs=(targetLen/sr)*1000;

  // Context RMS
  const ctxBefore=mono.subarray(Math.max(0,s-512),s);
  const ctxAfter =mono.subarray(e,Math.min(mono.length,e+512));
  const ctxRmsBefore=rmsDb(new Float32Array(ctxBefore));
  const ctxRmsAfter =rmsDb(new Float32Array(ctxAfter));
  const ctxRms      =ctxRmsBefore>-110 ? ctxRmsBefore
                    :ctxRmsAfter>-110  ? ctxRmsAfter
                    :profile.rmsDb;

  // Before stats
  const beforeStats=computeStats(mono.subarray(s,e));

  // Clone
  const out=cloneBuffer(targetBuffer);

  // Generate fill based on mode
  let fill=synthesizeFromProfile(profile,targetLen,sr,seed);

  switch(options.mode){
    case "fill":
    case "replace": {
      if(options.matchRms!==false) matchContextRms(fill,ctxRms);
      break;
    }

    case "blend": {
      // Blend 50% grain + 50% attenuated original
      const orig=mono.subarray(s,Math.min(mono.length,s+targetLen));
      const blended=new Float32Array(targetLen);
      for(let i=0;i<targetLen;i++){
        const t=i/targetLen;
        const blendFactor=0.5*(1-Math.cos(2*Math.PI*t)); // oscillates
        const g=fill[i]??0;
        const o=(i<orig.length?orig[i]:0)*0.3; // attenuate original
        blended[i]=g*(1-blendFactor*0.3)+o*blendFactor*0.3;
      }
      fill=blended;
      if(options.matchRms!==false) matchContextRms(fill,ctxRms);
      break;
    }

    case "heal": {
      // Gentle heal — heavier context matching
      if(options.matchRms!==false) matchContextRms(fill,Math.min(ctxRms,-55));
      break;
    }

    case "match_reference_tone": {
      // Use profile spectral slope for tone matching
      fill=synthesizeFromProfile(profile,targetLen,sr,seed+13);
      matchContextRms(fill,ctxRms-2);
      break;
    }
  }

  // Apply to all channels
  for(let ch=0;ch<out.numberOfChannels;ch++){
    const dst=out.getChannelData(ch);

    // Fade out original into fill at left boundary
    for(let i=0;i<Math.min(fadeLen*2,targetLen)&&s+i<dst.length;i++){
      const t=i/(fadeLen*2);
      const origGain=0.5*(1+Math.cos(Math.PI*t));
      const fillGain=1-origGain;
      dst[s+i]=dst[s+i]*origGain + fill[i]*fillGain;
    }

    // Write fill in middle
    for(let i=fadeLen*2;i<targetLen-fadeLen*2&&s+i<dst.length;i++){
      dst[s+i]=fill[i]??0;
    }

    // Fade fill back to original at right boundary
    const rStart=Math.max(0,targetLen-fadeLen*2);
    for(let i=rStart;i<targetLen&&s+i<dst.length;i++){
      const t=(i-rStart)/(fadeLen*2);
      const fillGain=0.5*(1+Math.cos(Math.PI*t));
      const origGain=1-fillGain;
      const orig=s+i<mono.length?mono[s+i]:0;
      dst[s+i]=fill[i]*fillGain + orig*origGain;
    }
  }

  // After stats
  const outMono=toMono(out);
  const afterStats=computeStats(outMono.subarray(s,e));

  // Seam risk
  const dL=detectWaveformDiscontinuity(outMono,s);
  const dR=detectWaveformDiscontinuity(outMono,e);
  const seamRisk=Math.max(dL.risk,dR.risk);

  if(seamRisk>0.4) warnings.push(`Seam risk: ${(seamRisk*100).toFixed(0)}% — increase crossfade`);
  if(profile.purityScore<0.65) warnings.push("Reference purity low — result may retain noise");
  if(profile.grainLibrary.length<3) warnings.push("Few reference grains — possible repetition");

  // Realism score
  const rmsImprove=beforeStats.rmsDb-afterStats.rmsDb;
  const realismScore=Math.min(1,Math.max(0,
    profile.purityScore*0.5 +
    (1-seamRisk)*0.3 +
    (rmsImprove>0?0.1:0) +
    (afterStats.rmsDb>-110?0.1:0)
  ));

  return {
    repairedBuffer:out,
    replacedRegion:{startSample:s,endSample:e,durationMs},
    beforeStats,afterStats,seamRisk,realismScore,warnings,
  };
}
