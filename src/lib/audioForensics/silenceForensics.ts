/**
 * silenceForensics.ts — Silence Forensics Engine
 * Detects contaminated silence regions with professional precision
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import type {
  SilenceRegion, SilenceForensicsResult,
  ContaminationType, SuggestedAction,
} from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const SILENCE_THRESHOLD_DB   = -50;   // Below this = silence candidate
const MIN_SILENCE_DURATION_MS = 20;   // Min silence region to analyze
const FFT_SIZE               = 2048;
const HOP_SIZE               = 512;
const MIN_PURITY_SCORE       = 0.85;  // Below this = contaminated

// ── FFT ───────────────────────────────────────────────────────────────────────

function runFFT(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i=1,j=0;i<n;i++){
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

function getMagnitudeSpectrum(
  samples: Float32Array,
  fftSize: number
): Float32Array {
  const re  = new Float64Array(fftSize);
  const im  = new Float64Array(fftSize);
  const len = Math.min(fftSize, samples.length);
  for(let i=0;i<len;i++)
    re[i] = samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(len-1)));
  runFFT(re, im);
  const mag = new Float32Array(fftSize/2);
  for(let i=0;i<fftSize/2;i++)
    mag[i] = Math.sqrt(re[i]**2+im[i]**2);
  return mag;
}

// ── RMS / Peak ────────────────────────────────────────────────────────────────

function computeRMS(samples: Float32Array): number {
  let sum=0;
  for(let i=0;i<samples.length;i++) sum+=samples[i]**2;
  const rms=Math.sqrt(sum/samples.length);
  return rms>0 ? 20*Math.log10(rms) : -120;
}

function computePeak(samples: Float32Array): number {
  let peak=0;
  for(let i=0;i<samples.length;i++){
    const a=Math.abs(samples[i]);
    if(a>peak) peak=a;
  }
  return peak>0 ? 20*Math.log10(peak) : -120;
}

// ── Hum Detection ─────────────────────────────────────────────────────────────

function detectHumInRegion(
  mag:        Float32Array,
  sampleRate: number,
  fftSize:    number
): { detected:boolean; freqHz:number|null; strength:number } {
  const binHz = sampleRate/fftSize;
  const avg   = mag.reduce((s,v)=>s+v,0)/mag.length;

  const check = (hz: number) => {
    const bin = Math.round(hz/binHz);
    if(bin>=mag.length) return 0;
    let harmStrength=0;
    for(let h=1;h<=4;h++){
      const hbin=Math.round(hz*h/binHz);
      if(hbin<mag.length) harmStrength+=mag[hbin];
    }
    return harmStrength/4;
  };

  const str50 = check(50);
  const str60 = check(60);
  const threshold = avg*6;

  if(str50>threshold&&str50>str60)
    return {detected:true,freqHz:50,strength:str50/avg};
  if(str60>threshold)
    return {detected:true,freqHz:60,strength:str60/avg};
  return {detected:false,freqHz:null,strength:0};
}

// ── Spectral Slope ────────────────────────────────────────────────────────────

function computeSpectralSlope(
  mag:        Float32Array,
  sampleRate: number,
  fftSize:    number
): number {
  const binHz = sampleRate/fftSize;
  let sumX=0,sumY=0,sumXY=0,sumX2=0;
  const n = mag.length;
  for(let i=1;i<n;i++){
    const x = Math.log(i*binHz+1);
    const y = Math.log(mag[i]+1e-10);
    sumX+=x;sumY+=y;sumXY+=x*y;sumX2+=x*x;
  }
  const denom = n*sumX2-sumX**2;
  return denom!==0 ? (n*sumXY-sumX*sumY)/denom : 0;
}

// ── Spectral Flatness ─────────────────────────────────────────────────────────

function computeSpectralFlatness(mag: Float32Array): number {
  let logSum=0,linSum=0;
  for(let i=1;i<mag.length;i++){
    logSum+=Math.log(mag[i]+1e-10);
    linSum+=mag[i];
  }
  return Math.exp(logSum/mag.length)/(linSum/mag.length+1e-10);
}

// ── Seam Detector ─────────────────────────────────────────────────────────────

function detectSeam(
  before: Float32Array,
  after:  Float32Array,
  windowSize = 64
): number {
  if(before.length<windowSize||after.length<windowSize) return 0;

  // Compare last samples of before with first samples of after
  const endBefore  = before.slice(-windowSize);
  const startAfter = after.slice(0, windowSize);

  // Energy discontinuity
  const rmsBefore = computeRMS(endBefore);
  const rmsAfter  = computeRMS(startAfter);
  const energyJump = Math.abs(rmsBefore-rmsAfter);

  // Phase discontinuity (zero crossing rate change)
  let zcrBefore=0, zcrAfter=0;
  for(let i=1;i<windowSize;i++){
    if(endBefore[i]*endBefore[i-1]<0) zcrBefore++;
    if(startAfter[i]*startAfter[i-1]<0) zcrAfter++;
  }
  const zcrJump = Math.abs(zcrBefore-zcrAfter)/windowSize;

  return Math.min(1, energyJump/20+zcrJump*5);
}

// ── Repeated Pattern Detector ─────────────────────────────────────────────────

function detectRepeatedPattern(
  segments: Float32Array[],
  threshold = 0.95
): boolean {
  if(segments.length<2) return false;

  for(let i=0;i<segments.length-1;i++){
    for(let j=i+1;j<segments.length;j++){
      const a=segments[i], b=segments[j];
      const len=Math.min(a.length,b.length,1024);
      let dot=0,magA=0,magB=0;
      for(let k=0;k<len;k++){
        dot+=a[k]*b[k];magA+=a[k]**2;magB+=b[k]**2;
      }
      const sim=dot/(Math.sqrt(magA)*Math.sqrt(magB)+1e-10);
      if(sim>threshold) return true;
    }
  }
  return false;
}

// ── Contamination Classifier ──────────────────────────────────────────────────

function classifyContamination(
  rmsDb:          number,
  spectralFlat:   number,
  spectralSlope:  number,
  humDetected:    boolean,
  humFreqHz:      number|null,
  isDigitalSilence: boolean,
  seamRisk:       number
): { type:ContaminationType; action:SuggestedAction; confidence:number } {

  if(isDigitalSilence)
    return { type:"digital_silence", action:"replace_with_reference", confidence:0.99 };

  if(seamRisk>0.7)
    return { type:"waveform_seam", action:"crossfade_repair", confidence:0.90 };

  if(humDetected&&humFreqHz===50)
    return { type:"hum_50hz", action:"hum_notch", confidence:0.95 };

  if(humDetected&&humFreqHz===60)
    return { type:"hum_60hz", action:"hum_notch", confidence:0.95 };

  // Hiss — high flatness, high frequency content
  if(spectralFlat>0.4&&rmsDb>-70)
    return { type:"hiss", action:"denoise", confidence:0.80 };

  // Fan noise — low frequency dominated, consistent
  if(spectralSlope<-1.5&&spectralFlat<0.3&&rmsDb>-75)
    return { type:"fan_noise", action:"spectral_repair", confidence:0.75 };

  // AC noise — tonal but not hum frequency
  if(spectralFlat<0.2&&rmsDb>-72)
    return { type:"ac_noise", action:"spectral_repair", confidence:0.70 };

  // Room tone leak — natural slope but too much energy
  if(spectralSlope<-0.5&&rmsDb>-65&&spectralFlat>0.15)
    return { type:"room_tone_leak", action:"replace_with_reference", confidence:0.72 };

  // Mouth click / pop — short duration handled elsewhere
  if(rmsDb>-45&&spectralFlat>0.5)
    return { type:"mouth_click", action:"spectral_repair", confidence:0.68 };

  return { type:"unknown", action:"manual_review", confidence:0.50 };
}

// ── Purity Score ──────────────────────────────────────────────────────────────

function computePurityScore(
  rmsDb:        number,
  humStrength:  number,
  spectralFlat: number,
  seamRisk:     number
): number {
  let score = 1.0;

  // Penalize noise level
  if(rmsDb>-80) score -= Math.min(0.4, (rmsDb+80)/40*0.4);

  // Penalize hum
  score -= Math.min(0.3, humStrength*0.1);

  // Penalize tonal contamination (high flatness = noisy)
  if(spectralFlat>0.3) score -= Math.min(0.2, (spectralFlat-0.3)*0.5);

  // Penalize seams
  score -= seamRisk*0.3;

  return Math.max(0, Math.min(1, score));
}

// ── Silence Region Extractor ──────────────────────────────────────────────────

function extractSilenceRegions(
  mono:       Float32Array,
  sampleRate: number
): { start:number; end:number }[] {
  const frameSize = Math.round(0.01*sampleRate); // 10ms frames
  const regions: { start:number; end:number }[] = [];
  const thresholdLin = Math.pow(10, SILENCE_THRESHOLD_DB/20);
  let inSilence = false;
  let silStart  = 0;

  for(let i=0;i+frameSize<=mono.length;i+=frameSize){
    let rms=0;
    for(let j=0;j<frameSize;j++) rms+=mono[i+j]**2;
    rms=Math.sqrt(rms/frameSize);

    if(rms<thresholdLin){
      if(!inSilence){ inSilence=true; silStart=i; }
    } else {
      if(inSilence){
        const durMs=(i-silStart)/sampleRate*1000;
        if(durMs>=MIN_SILENCE_DURATION_MS)
          regions.push({start:silStart,end:i});
        inSilence=false;
      }
    }
  }
  if(inSilence){
    const durMs=(mono.length-silStart)/sampleRate*1000;
    if(durMs>=MIN_SILENCE_DURATION_MS)
      regions.push({start:silStart,end:mono.length});
  }
  return regions;
}

// ── Main Forensics Engine ─────────────────────────────────────────────────────

export function analyzeSilenceForensics(
  buffer: AudioBuffer
): SilenceForensicsResult {
  const startMs   = Date.now();
  const sr        = buffer.sampleRate;
  const duration  = buffer.duration;

  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  // Extract silence regions
  const rawRegions = extractSilenceRegions(mono, sr);

  // Global noise floor
  const allEnergies: number[]=[];
  const frameSize=Math.round(0.02*sr);
  for(let i=0;i+frameSize<=mono.length;i+=frameSize){
    let e=0;
    for(let j=0;j<frameSize;j++) e+=mono[i+j]**2;
    allEnergies.push(e/frameSize);
  }
  allEnergies.sort((a,b)=>a-b);
  const cutoff=Math.max(1,Math.floor(allEnergies.length*0.05));
  const noiseFloorLin=allEnergies.slice(0,cutoff).reduce((s,v)=>s+v,0)/cutoff;
  const noiseFloorDb=noiseFloorLin>0?10*Math.log10(noiseFloorLin):-120;

  // Analyze each silence region
  const silenceRegions: SilenceRegion[]=[];
  const silenceSegments: Float32Array[]=[];
  let globalHumHz: number|null=null;
  let hasSeams=false;
  let hasHum=false;

  for(let ri=0;ri<rawRegions.length;ri++){
    const {start,end}=rawRegions[ri];
    const samples=mono.subarray(start,end);
    const durMs=(end-start)/sr*1000;

    // Compute metrics
    const rmsDb  = computeRMS(samples);
    const peakDb = computePeak(samples);

    // FFT analysis
    const mag=getMagnitudeSpectrum(samples, FFT_SIZE);
    const spectralSlope=computeSpectralSlope(mag,sr,FFT_SIZE);
    const spectralFlat =computeSpectralFlatness(mag);
    const humResult    =detectHumInRegion(mag,sr,FFT_SIZE);

    if(humResult.detected){
      hasHum=true;
      globalHumHz=humResult.freqHz;
    }

    // Seam detection
    let seamRisk=0;
    if(ri>0){
      const prevEnd=rawRegions[ri-1].end;
      const beforeSamples=mono.subarray(Math.max(0,prevEnd-256),prevEnd);
      seamRisk=detectSeam(beforeSamples,samples);
      if(seamRisk>0.5) hasSeams=true;
    }

    // Digital silence check
    const isDigitalSilence=samples.every(s=>s===0)||(rmsDb<-110);

    // Spectral match risk
    silenceSegments.push(new Float32Array(samples));
    const spectralMatchRisk=silenceSegments.length>1
      ? detectRepeatedPattern(silenceSegments.slice(-3))
        ? 0.85 : 0.20
      : 0.10;

    // Classify
    const {type,action,confidence}=classifyContamination(
      rmsDb,spectralFlat,spectralSlope,
      humResult.detected,humResult.freqHz,
      isDigitalSilence,seamRisk
    );

    // Purity score
    const purityScore=computePurityScore(
      rmsDb,humResult.strength,spectralFlat,seamRisk
    );

    silenceRegions.push({
      startMs:           start/sr*1000,
      endMs:             end/sr*1000,
      durationMs:        durMs,
      startSample:       start,
      endSample:         end,
      contaminationType: type,
      noiseFloorDb:      rmsDb,
      humHz:             humResult.freqHz,
      seamRisk,
      spectralMatchRisk,
      purityScore,
      confidence,
      suggestedAction:   action,
      rmsDb,
      peakDb,
      spectralSlope,
    });
  }

  // Separate clean vs contaminated
  const contaminated = silenceRegions.filter(r=>r.purityScore<MIN_PURITY_SCORE);
  const clean        = silenceRegions.filter(r=>r.purityScore>=MIN_PURITY_SCORE);

  const overallPurity = silenceRegions.length>0
    ? silenceRegions.reduce((s,r)=>s+r.purityScore,0)/silenceRegions.length
    : 1.0;

  // Dominant contamination type
  const typeCounts=new Map<ContaminationType,number>();
  for(const r of contaminated)
    typeCounts.set(r.contaminationType,(typeCounts.get(r.contaminationType)??0)+1);
  let dominant: ContaminationType|null=null;
  let maxCount=0;
  for(const [type,count] of typeCounts)
    if(count>maxCount){maxCount=count;dominant=type;}

  const hasRepeatedPattern=detectRepeatedPattern(silenceSegments);

  return {
    totalRegions:          silenceRegions.length,
    contaminatedRegions:   contaminated,
    cleanRegions:          clean,
    overallPurityScore:    overallPurity,
    dominantContamination: dominant,
    noiseFloorDb,
    hasDigitalSilence:     contaminated.some(r=>r.contaminationType==="digital_silence"),
    hasRepeatedPattern,
    hasSeams,
    hasHum,
    humFrequencyHz:        globalHumHz,
    processingMs:          Date.now()-startMs,
    sampleRate:            sr,
    duration,
  };
}
