/**
 * vadAnalyzer.ts — Advanced VAD Engine
 * Multi-feature + Adaptive Thresholding + Hangover + Confidence
 * Aivora Platform — Phase 6
 */

import { makeProblem } from "./qcTypes";
import type { AudioProblem } from "./qcTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VADFrame {
  timeSec:       number;
  energy:        number;
  zcr:           number;
  spectralFlat:  number;
  spectralCent:  number;
  pitchHz:       number;
  bandRatio:     number;   // Speech band energy ratio
  isSpeech:      boolean;
  confidence:    number;   // 0.0 – 1.0
  probability:   number;   // Speech probability
}

export interface SilenceRegion {
  startSec:  number;
  endSec:    number;
  durationMs: number;
  type:      "leading" | "trailing" | "internal";
}

export interface SpeechRegion {
  startSec:   number;
  endSec:     number;
  durationMs: number;
  avgConfidence: number;
  avgPitch:   number;
}

export interface VADResult {
  speechRatio:    number;
  speechRegions:  SpeechRegion[];
  silenceRegions: SilenceRegion[];
  silenceMetrics: {
    leadingSec:       number;
    trailingSec:      number;
    totalSilenceSec:  number;
    speechRatio:      number;
    longestGapSec:    number;
  };
  frames:         VADFrame[];
  confidence:     number;
  dominantPitch:  number;
  isMusicDominant: boolean;
  problems:       AudioProblem[];
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function fftMagnitude(samples: Float32Array, fftSize: number): Float32Array {
  const re  = new Float64Array(fftSize);
  const im  = new Float64Array(fftSize);
  const len = Math.min(fftSize, samples.length);

  // Hann window
  for (let i = 0; i < len; i++)
    re[i] = samples[i] * 0.5*(1-Math.cos(2*Math.PI*i/(len-1)));

  // FFT
  const n = re.length;
  for (let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len2=2;len2<=n;len2<<=1){
    const ang=(-2*Math.PI)/len2,wRe=Math.cos(ang),wIm=Math.sin(ang);
    for(let i=0;i<n;i+=len2){
      let cRe=1,cIm=0;
      for(let j=0;j<len2>>1;j++){
        const uRe=re[i+j],uIm=im[i+j];
        const vRe=re[i+j+len2/2]*cRe-im[i+j+len2/2]*cIm;
        const vIm=re[i+j+len2/2]*cIm+im[i+j+len2/2]*cRe;
        re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;
        re[i+j+len2/2]=uRe-vRe;im[i+j+len2/2]=uIm-vIm;
        const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;
      }
    }
  }

  const mag = new Float32Array(fftSize/2);
  for (let i=0;i<fftSize/2;i++)
    mag[i] = Math.sqrt(re[i]**2+im[i]**2);
  return mag;
}

// ── Frame Feature Extraction ──────────────────────────────────────────────────

function extractFrameFeatures(
  samples:    Float32Array,
  sampleRate: number,
  fftSize     = 512
): Omit<VADFrame, "timeSec" | "isSpeech" | "confidence" | "probability"> {
  const n = samples.length;

  // Energy (RMS)
  let energy = 0;
  for (let i=0;i<n;i++) energy += samples[i]**2;
  energy = Math.sqrt(energy/n);

  // ZCR
  let zcr = 0;
  for (let i=1;i<n;i++) if (samples[i]*samples[i-1]<0) zcr++;
  zcr /= n;

  // Spectral features
  const mag  = fftMagnitude(samples, fftSize);
  const binHz = sampleRate/fftSize;

  // Spectral Flatness
  let logSum=0, linSum=0;
  for (let i=1;i<mag.length;i++){
    logSum += Math.log(mag[i]+1e-10);
    linSum += mag[i];
  }
  const spectralFlat = Math.exp(logSum/mag.length)/(linSum/mag.length+1e-10);

  // Spectral Centroid
  let num=0, den=0;
  for (let i=0;i<mag.length;i++){num+=i*binHz*mag[i];den+=mag[i];}
  const spectralCent = den>0 ? num/den : 0;

  // Speech band ratio (300-3400 Hz)
  let speechE=0, totalE=0;
  for (let i=0;i<mag.length;i++){
    const hz = i*binHz;
    totalE += mag[i]**2;
    if (hz>=300 && hz<=3400) speechE += mag[i]**2;
  }
  const bandRatio = totalE>0 ? speechE/totalE : 0;

  // Pitch (autocorrelation)
  const minPeriod = Math.round(sampleRate/400);
  const maxPeriod = Math.round(sampleRate/60);
  let bestCorr=0, bestPeriod=0;
  for (let p=minPeriod;p<=Math.min(maxPeriod,n/2);p++){
    let corr=0;
    for (let i=0;i<n-p;i++) corr+=samples[i]*samples[i+p];
    if (corr>bestCorr){bestCorr=corr;bestPeriod=p;}
  }
  const pitchHz = bestPeriod>0 && bestCorr>0.2 ? sampleRate/bestPeriod : 0;

  return { energy, zcr, spectralFlat, spectralCent, pitchHz, bandRatio };
}

// ── Adaptive Threshold ────────────────────────────────────────────────────────

class AdaptiveThreshold {
  private noiseEst:   number;
  private signalEst:  number;
  private alpha       = 0.05;  // Slow adaptation
  private betaNoise   = 0.02;  // Noise tracking
  private initialized = false;

  constructor(initialNoise: number) {
    this.noiseEst  = initialNoise;
    this.signalEst = initialNoise * 10;
  }

  update(energy: number, isSpeech: boolean): number {
    if (!this.initialized) {
      this.noiseEst  = energy;
      this.signalEst = energy * 5;
      this.initialized = true;
    }

    if (!isSpeech) {
      // Update noise estimate (faster for noise)
      this.noiseEst = (1-this.betaNoise)*this.noiseEst + this.betaNoise*energy;
    } else {
      // Update signal estimate
      this.signalEst = (1-this.alpha)*this.signalEst + this.alpha*energy;
    }

    return Math.max(this.noiseEst * 4, this.noiseEst + 1e-8);
  }

  get threshold(): number { return this.noiseEst * 4; }
  get snrEst():    number {
    return this.noiseEst > 0
      ? 20*Math.log10(this.signalEst/this.noiseEst)
      : 0;
  }
}

// ── Speech Probability ────────────────────────────────────────────────────────

function computeSpeechProbability(
  f:             Omit<VADFrame, "timeSec"|"isSpeech"|"confidence"|"probability">,
  energyThresh:  number,
  noiseFloor:    number
): number {
  let score = 0;

  // 1. Energy above noise (weight 3)
  const energyRatio = f.energy / (noiseFloor + 1e-10);
  if (energyRatio > 4.0)      score += 3.0;
  else if (energyRatio > 2.0) score += 1.5;
  else if (energyRatio > 1.2) score += 0.5;

  // 2. ZCR in speech range 0.01–0.20 (weight 2)
  if (f.zcr > 0.01 && f.zcr < 0.15)      score += 2.0;
  else if (f.zcr > 0.005 && f.zcr < 0.25) score += 1.0;

  // 3. Low spectral flatness → tonal/speech (weight 2)
  if (f.spectralFlat < 0.10)      score += 2.0;
  else if (f.spectralFlat < 0.25) score += 1.0;
  else if (f.spectralFlat < 0.40) score += 0.3;

  // 4. Spectral centroid in speech range (weight 2)
  if (f.spectralCent > 300 && f.spectralCent < 3500)     score += 2.0;
  else if (f.spectralCent > 150 && f.spectralCent < 5000) score += 1.0;

  // 5. Speech band ratio > 0.4 (weight 1.5)
  if (f.bandRatio > 0.50)      score += 1.5;
  else if (f.bandRatio > 0.35) score += 0.8;

  // 6. Pitch in voice range (weight 1.5)
  if (f.pitchHz > 70 && f.pitchHz < 350) score += 1.5;

  const maxScore = 3+2+2+2+1.5+1.5;
  return Math.min(1.0, score/maxScore);
}

// ── Hangover Logic ────────────────────────────────────────────────────────────

function applyHangover(
  frames:      VADFrame[],
  hangoverMs   = 200,
  hopMs        = 10
): void {
  const hangoverFrames = Math.round(hangoverMs/hopMs);

  // Forward pass — extend speech forward
  let countdown = 0;
  for (let i=0;i<frames.length;i++){
    if (frames[i].isSpeech) countdown = hangoverFrames;
    else if (countdown > 0) {
      frames[i].isSpeech = true;
      countdown--;
    }
  }
}

// ── Gap Filling ───────────────────────────────────────────────────────────────

function fillShortGaps(
  frames:   VADFrame[],
  maxGapMs  = 150,
  hopMs     = 10
): void {
  const maxGapFrames = Math.round(maxGapMs/hopMs);
  let gapStart = -1;

  for (let i=0;i<frames.length;i++){
    if (!frames[i].isSpeech){
      if (gapStart<0) gapStart=i;
    } else {
      if (gapStart>=0){
        const gapLen = i-gapStart;
        if (gapLen <= maxGapFrames)
          for (let j=gapStart;j<i;j++) frames[j].isSpeech=true;
        gapStart=-1;
      }
    }
  }
}

// ── Remove Short Bursts ───────────────────────────────────────────────────────

function removeShortBursts(
  frames:      VADFrame[],
  minBurstMs   = 80,
  hopMs        = 10
): void {
  const minFrames = Math.round(minBurstMs/hopMs);
  let burstStart  = -1;

  for (let i=0;i<=frames.length;i++){
    const isSpeech = i<frames.length && frames[i].isSpeech;
    if (isSpeech){
      if (burstStart<0) burstStart=i;
    } else {
      if (burstStart>=0){
        if (i-burstStart < minFrames)
          for (let j=burstStart;j<i;j++) frames[j].isSpeech=false;
        burstStart=-1;
      }
    }
  }
}

// ── Speech/Music Discrimination ───────────────────────────────────────────────

function isMusicLike(frames: VADFrame[]): boolean {
  const speechFrames = frames.filter(f=>f.isSpeech);
  if (speechFrames.length<10) return false;

  // Music tends to have consistent spectral flatness + high band ratio
  const avgFlat = speechFrames.reduce((s,f)=>s+f.spectralFlat,0)/speechFrames.length;
  const avgBand = speechFrames.reduce((s,f)=>s+f.bandRatio,0)/speechFrames.length;
  const pitchVariance = (() => {
    const pitches = speechFrames.filter(f=>f.pitchHz>0).map(f=>f.pitchHz);
    if (pitches.length<5) return 0;
    const mean = pitches.reduce((s,v)=>s+v,0)/pitches.length;
    return pitches.reduce((s,v)=>s+(v-mean)**2,0)/pitches.length;
  })();

  // Music: high flatness, consistent pitch, wide band
  return avgFlat > 0.3 && avgBand > 0.6 && pitchVariance < 2000;
}

// ── Extract Regions ───────────────────────────────────────────────────────────

function extractSpeechRegions(frames: VADFrame[], hopSec: number): SpeechRegion[] {
  const regions: SpeechRegion[] = [];
  let start = -1, confSum = 0, confCount = 0, pitchSum = 0, pitchCount = 0;

  for (let i=0;i<=frames.length;i++){
    const isSpeech = i<frames.length && frames[i].isSpeech;
    if (isSpeech && start<0) { start=i; confSum=0; confCount=0; pitchSum=0; pitchCount=0; }
    if (isSpeech) {
      confSum  += frames[i].confidence; confCount++;
      if (frames[i].pitchHz>0){ pitchSum+=frames[i].pitchHz; pitchCount++; }
    }
    if (!isSpeech && start>=0) {
      const startSec = start*hopSec;
      const endSec   = i*hopSec;
      regions.push({
        startSec, endSec,
        durationMs:    Math.round((endSec-startSec)*1000),
        avgConfidence: confCount>0 ? confSum/confCount : 0,
        avgPitch:      pitchCount>0 ? pitchSum/pitchCount : 0,
      });
      start=-1;
    }
  }
  return regions;
}

function extractSilenceRegions(frames: VADFrame[], hopSec: number, duration: number): SilenceRegion[] {
  const regions: SilenceRegion[] = [];
  let start = -1;

  for (let i=0;i<=frames.length;i++){
    const isSilence = i>=frames.length || !frames[i].isSpeech;
    if (isSilence && start<0) start=i;
    if (!isSilence && start>=0) {
      const startSec = start*hopSec;
      const endSec   = i*hopSec;
      regions.push({
        startSec, endSec,
        durationMs: Math.round((endSec-startSec)*1000),
        type: startSec<0.1 ? "leading"
            : endSec>duration-0.1 ? "trailing"
            : "internal",
      });
      start=-1;
    }
  }
  return regions;
}

// ── Main VAD ──────────────────────────────────────────────────────────────────

export function analyzeVAD(
  buffer:  AudioBuffer,
  profile: "wakeword"|"asr"|"tts"|"conversation" = "asr"
): VADResult {
  const sr        = buffer.sampleRate;
  const duration  = buffer.duration;
  const FRAME_MS  = 20;
  const HOP_MS    = 10;
  const frameSize = Math.round(FRAME_MS/1000*sr);
  const hopSize   = Math.round(HOP_MS/1000*sr);
  const hopSec    = hopSize/sr;

  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for (let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if (buffer.numberOfChannels>1)
    for (let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  // Estimate noise floor from quietest 10% of energy frames
  const quickEnergies: number[] = [];
  for (let i=0;i+frameSize<=mono.length;i+=hopSize){
    let e=0;
    for (let j=0;j<frameSize;j++) e+=mono[i+j]**2;
    quickEnergies.push(e/frameSize);
  }
  quickEnergies.sort((a,b)=>a-b);
  const cutoff    = Math.max(1,Math.floor(quickEnergies.length*0.10));
  const noiseFloor = quickEnergies.slice(0,cutoff).reduce((s,v)=>s+v,0)/cutoff;
  const energyThresh = noiseFloor*5;

  const adaptThresh = new AdaptiveThreshold(noiseFloor);

  // Extract frames
  const frames: VADFrame[] = [];
  for (let i=0;i+frameSize<=mono.length;i+=hopSize){
    const frame    = mono.subarray(i,i+frameSize);
    const features = extractFrameFeatures(frame, sr);
    const prob     = computeSpeechProbability(features, energyThresh, noiseFloor);
    const isSpeech = prob > 0.52;
    const threshold = adaptThresh.update(features.energy, isSpeech);
    const confidence = Math.min(1, Math.abs(prob-0.5)*4);

    frames.push({
      timeSec:  i/sr,
      isSpeech: features.energy > threshold * 0.5 && prob > 0.50,
      confidence,
      probability: prob,
      ...features,
    });
  }

  // Post-processing
  applyHangover(frames, 200, HOP_MS);
  fillShortGaps(frames, 150, HOP_MS);
  removeShortBursts(frames, 80, HOP_MS);

  // Results
  const speechFrames  = frames.filter(f=>f.isSpeech);
  const speechRatio   = frames.length>0 ? speechFrames.length/frames.length : 0;
  const speechRegions = extractSpeechRegions(frames, hopSec);
  const silenceRegions = extractSilenceRegions(frames, hopSec, duration);

  const leadingRegion = silenceRegions.find(r=>r.type==="leading");
  const leadingSec  = leadingRegion ? leadingRegion.durationMs/1000 : 0;
  const trailingRegion = silenceRegions.find(r=>r.type==="trailing");
  const trailingSec = trailingRegion ? trailingRegion.durationMs/1000 : 0;
  const internalGaps = silenceRegions.filter(r=>r.type==="internal");
  const longestGapSec = internalGaps.length>0
    ? Math.max(...internalGaps.map(r=>r.durationMs))/1000 : 0;
  const totalSilenceSec = silenceRegions.reduce((s,r)=>s+r.durationMs/1000,0);

  const avgConf = speechFrames.length>0
    ? speechFrames.reduce((s,f)=>s+f.confidence,0)/speechFrames.length : 0;

  const pitchFrames = speechFrames.filter(f=>f.pitchHz>0);
  const dominantPitch = pitchFrames.length>0
    ? pitchFrames.reduce((s,f)=>s+f.pitchHz,0)/pitchFrames.length : 0;

  const isMusicDominant = isMusicLike(frames);

  // Profile thresholds
  const minRatios = { wakeword:0.30, asr:0.20, tts:0.40, conversation:0.10 };
  const maxLeading = { wakeword:0.5, asr:1.0, tts:0.3, conversation:2.0 };
  const maxTrailing = { wakeword:0.5, asr:1.0, tts:0.3, conversation:2.0 };

  const problems: AudioProblem[] = [];

  if (speechRatio < minRatios[profile])
    problems.push(makeProblem("SILENCE_ABUSE","warning",
      `Speech ratio ${(speechRatio*100).toFixed(1)}% below minimum ${(minRatios[profile]*100).toFixed(0)}%`,
      { confidence:0.88 }));

  if (leadingSec > maxLeading[profile])
    problems.push(makeProblem("LEADING_SILENCE","medium",
      `Leading silence ${(leadingSec*1000).toFixed(0)}ms exceeds limit (${maxLeading[profile]*1000}ms)`,
      { confidence:0.75 }));

  if (trailingSec > maxTrailing[profile])
    problems.push(makeProblem("TRAILING_SILENCE","medium",
      `Trailing silence ${(trailingSec*1000).toFixed(0)}ms exceeds limit (${maxTrailing[profile]*1000}ms)`,
      { confidence:0.75 }));

  if (longestGapSec > 0.3)
    problems.push(makeProblem("SILENCE_GAP","warning",
      `Internal silence gap ${(longestGapSec*1000).toFixed(0)}ms exceeds limit (300ms)`,
      { confidence:0.75 }));

  if (isMusicDominant)
    problems.push(makeProblem("BACKGROUND_NOISE","warning",
      "Background music detected — may affect speech recognition",
      { confidence:0.75 }));

  return {
    speechRatio, speechRegions, silenceRegions,
    silenceMetrics: { leadingSec, trailingSec, totalSilenceSec, speechRatio, longestGapSec },
    frames, confidence: avgConf,
    dominantPitch, isMusicDominant, problems,
  };
}
