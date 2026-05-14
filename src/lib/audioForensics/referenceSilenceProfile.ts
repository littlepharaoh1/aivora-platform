/**
 * referenceSilenceProfile.ts — Approved Silence Reference Engine
 * Extracts and stores reusable silence profiles from approved samples
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import type { ReferenceSilenceProfile, SilenceGrain } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_GRAIN_MS     = 50;    // Minimum grain duration
const MAX_GRAIN_MS     = 500;   // Maximum grain duration
const MAX_GRAINS       = 32;    // Max grains in library
const FFT_SIZE         = 2048;
const SILENCE_DB       = -50;   // Below this = silence

// ── FFT ───────────────────────────────────────────────────────────────────────

function runFFT(re: Float64Array, im: Float64Array): void {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=(-2*Math.PI)/len,wRe=Math.cos(ang),wIm=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cRe=1,cIm=0;
      for(let j=0;j<len>>1;j++){
        const uRe=re[i+j],uIm=im[i+j];
        const vRe=re[i+j+len/2]*cRe-im[i+j+len/2]*cIm;
        const vIm=re[i+j+len/2]*cIm+im[i+j+len/2]*cRe;
        re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;
        re[i+j+len/2]=uRe-vRe;im[i+j+len/2]=uIm-vIm;
        const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rmsDb(samples: Float32Array): number {
  let sum=0;
  for(let i=0;i<samples.length;i++) sum+=samples[i]**2;
  const rms=Math.sqrt(sum/samples.length);
  return rms>0 ? 20*Math.log10(rms) : -120;
}

function spectralSlope(mag: Float32Array, sr: number, fftSize: number): number {
  const binHz=sr/fftSize;
  let sumX=0,sumY=0,sumXY=0,sumX2=0;
  const n=mag.length;
  for(let i=1;i<n;i++){
    const x=Math.log(i*binHz+1);
    const y=Math.log(mag[i]+1e-10);
    sumX+=x;sumY+=y;sumXY+=x*y;sumX2+=x*x;
  }
  const d=n*sumX2-sumX**2;
  return d!==0?(n*sumXY-sumX*sumY)/d:0;
}

function getMag(samples: Float32Array, fftSize: number): Float32Array {
  const re=new Float64Array(fftSize);
  const im=new Float64Array(fftSize);
  const len=Math.min(fftSize,samples.length);
  for(let i=0;i<len;i++)
    re[i]=samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(len-1)));
  runFFT(re,im);
  const mag=new Float32Array(fftSize/2);
  for(let i=0;i<fftSize/2;i++) mag[i]=Math.sqrt(re[i]**2+im[i]**2);
  return mag;
}

// ── Silence Extractor ─────────────────────────────────────────────────────────

function extractSilenceSegments(
  mono:       Float32Array,
  sampleRate: number
): { start:number; end:number }[] {
  const frameSize = Math.round(0.01*sampleRate);
  const threshLin = Math.pow(10, SILENCE_DB/20);
  const regions: { start:number; end:number }[] = [];
  let inSil=false, silStart=0;

  for(let i=0;i+frameSize<=mono.length;i+=frameSize){
    let rms=0;
    for(let j=0;j<frameSize;j++) rms+=mono[i+j]**2;
    rms=Math.sqrt(rms/frameSize);

    if(rms<threshLin){
      if(!inSil){inSil=true;silStart=i;}
    } else {
      if(inSil){
        const durMs=(i-silStart)/sampleRate*1000;
        if(durMs>=MIN_GRAIN_MS) regions.push({start:silStart,end:i});
        inSil=false;
      }
    }
  }
  if(inSil){
    const durMs=(mono.length-silStart)/sampleRate*1000;
    if(durMs>=MIN_GRAIN_MS) regions.push({start:silStart,end:mono.length});
  }
  return regions;
}

// ── Purity Check ──────────────────────────────────────────────────────────────

function computeSilencePurity(
  samples:    Float32Array,
  sampleRate: number
): number {
  const db=rmsDb(samples);
  const mag=getMag(samples, FFT_SIZE);

  // Check for hum
  const binHz=sampleRate/FFT_SIZE;
  const avg=mag.reduce((s,v)=>s+v,0)/mag.length;
  const hum50=mag[Math.round(50/binHz)]||0;
  const hum60=mag[Math.round(60/binHz)]||0;
  const hasHum=hum50>avg*6||hum60>avg*6;

  let score=1.0;
  if(db>-80) score-=Math.min(0.4,(db+80)/40*0.4);
  if(hasHum) score-=0.3;

  // Spectral flatness penalty (hiss)
  let logSum=0,linSum=0;
  for(let i=1;i<mag.length;i++){logSum+=Math.log(mag[i]+1e-10);linSum+=mag[i];}
  const flat=Math.exp(logSum/mag.length)/(linSum/mag.length+1e-10);
  if(flat>0.4) score-=0.2;

  return Math.max(0,Math.min(1,score));
}

// ── RMS Distribution ──────────────────────────────────────────────────────────

function computeRMSDistribution(
  mono:       Float32Array,
  sampleRate: number
): Float32Array {
  const frameMs  = 10;
  const frameSize = Math.round(frameMs/1000*sampleRate);
  const frames: number[]=[];

  for(let i=0;i+frameSize<=mono.length;i+=frameSize){
    let rms=0;
    for(let j=0;j<frameSize;j++) rms+=mono[i+j]**2;
    rms=Math.sqrt(rms/frameSize);
    frames.push(rms>0?20*Math.log10(rms):-120);
  }
  return new Float32Array(frames);
}

// ── Spectral Fingerprint ──────────────────────────────────────────────────────

function buildSpectralFingerprint(
  segments:   { start:number; end:number }[],
  mono:       Float32Array,
  sampleRate: number
): Float32Array {
  const avgMag=new Float32Array(FFT_SIZE/2);
  let count=0;

  for(const seg of segments){
    const samples=mono.subarray(seg.start, seg.end);
    if(samples.length<FFT_SIZE) continue;
    const mag=getMag(samples, FFT_SIZE);
    for(let i=0;i<avgMag.length;i++) avgMag[i]+=mag[i];
    count++;
  }

  if(count>0) for(let i=0;i<avgMag.length;i++) avgMag[i]/=count;
  return avgMag;
}

// ── Grain Library Builder ─────────────────────────────────────────────────────

function buildGrainLibrary(
  segments:   { start:number; end:number }[],
  mono:       Float32Array,
  sampleRate: number
): SilenceGrain[] {
  const grains: SilenceGrain[]=[];
  const maxGrainSamples=Math.round(MAX_GRAIN_MS/1000*sampleRate);
  const minGrainSamples=Math.round(MIN_GRAIN_MS/1000*sampleRate);

  for(const seg of segments){
    if(grains.length>=MAX_GRAINS) break;
    const len=seg.end-seg.start;
    if(len<minGrainSamples) continue;

    // Take a chunk from the middle of the segment (avoid edges)
    const grainLen=Math.min(len, maxGrainSamples);
    const offset  =Math.floor((len-grainLen)/2);
    const samples =new Float32Array(mono.subarray(seg.start+offset, seg.start+offset+grainLen));

    // Only include if pure enough
    const purity=computeSilencePurity(samples, sampleRate);
    if(purity<0.7) continue;

    const mag=getMag(samples, FFT_SIZE);
    grains.push({
      samples,
      durationMs: grainLen/sampleRate*1000,
      rmsDb:      rmsDb(samples),
      spectralSlope: spectralSlope(mag, sampleRate, FFT_SIZE),
    });
  }

  return grains;
}

// ── Main Profile Builder ──────────────────────────────────────────────────────

export function buildReferenceSilenceProfile(
  buffer:   AudioBuffer,
  fileName: string
): ReferenceSilenceProfile {
  const sr=buffer.sampleRate;

  // Mix to mono
  const mono=new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  // Extract silence segments
  const segments=extractSilenceSegments(mono, sr);

  // Build fingerprint from all silence
  const fingerprint=buildSpectralFingerprint(segments, mono, sr);

  // Average spectral slope
  let avgSlope=0;
  for(const seg of segments){
    const s=mono.subarray(seg.start,seg.end);
    if(s.length<FFT_SIZE) continue;
    const m=getMag(s, FFT_SIZE);
    avgSlope+=spectralSlope(m, sr, FFT_SIZE);
  }
  if(segments.length>0) avgSlope/=segments.length;

  // Build grain library
  const grains=buildGrainLibrary(segments, mono, sr);

  // Global silence RMS
  const silenceSamples: Float32Array[]=[];
  for(const seg of segments)
    silenceSamples.push(new Float32Array(mono.subarray(seg.start,seg.end)));
  const allSilence=new Float32Array(
    silenceSamples.reduce((s,v)=>s+v.length,0)
  );
  let offset=0;
  for(const s of silenceSamples){allSilence.set(s,offset);offset+=s.length;}
  const globalRmsDb=allSilence.length>0?rmsDb(allSilence):-120;

  // Noise floor
  const allFrameEnergies: number[]=[];
  const fs=Math.round(0.02*sr);
  for(let i=0;i+fs<=mono.length;i+=fs){
    let e=0;
    for(let j=0;j<fs;j++) e+=mono[i+j]**2;
    allFrameEnergies.push(e/fs);
  }
  allFrameEnergies.sort((a,b)=>a-b);
  const cut=Math.max(1,Math.floor(allFrameEnergies.length*0.05));
  const noiseE=allFrameEnergies.slice(0,cut).reduce((s,v)=>s+v,0)/cut;
  const noiseFloorDb=noiseE>0?10*Math.log10(noiseE):-120;

  // Overall purity
  const purity=grains.length>0
    ? grains.reduce((s,g)=>s+computeSilencePurity(g.samples,sr),0)/grains.length
    : 0.5;

  return {
    id:                 `ref_${Date.now()}`,
    fileName,
    sampleRate:         sr,
    channels:           buffer.numberOfChannels,
    rmsDb:              globalRmsDb,
    rmsDistribution:    computeRMSDistribution(mono, sr),
    spectralFingerprint: fingerprint,
    spectralSlope:      avgSlope,
    noiseFloorDb,
    purityScore:        purity,
    grainLibrary:       grains,
    createdAt:          new Date().toISOString(),
  };
}

// ── Profile Validation ────────────────────────────────────────────────────────

export function validateReferenceProfile(
  profile: ReferenceSilenceProfile
): { valid:boolean; warnings:string[] } {
  const warnings: string[]=[];

  if(profile.grainLibrary.length<3)
    warnings.push(`Only ${profile.grainLibrary.length} grains — need more silence in reference`);

  if(profile.purityScore<0.7)
    warnings.push(`Reference purity too low (${(profile.purityScore*100).toFixed(0)}%) — upload cleaner sample`);

  if(profile.noiseFloorDb>-60)
    warnings.push(`Reference noise floor high (${profile.noiseFloorDb.toFixed(1)} dB) — room may be noisy`);

  const valid=profile.grainLibrary.length>=1&&profile.purityScore>=0.5;
  return {valid,warnings};
}
