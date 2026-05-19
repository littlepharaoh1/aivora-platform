/**
 * syntheticSpeechDetector.ts — Synthetic Speech & Voice Clone Detection
 * Aivora Audio Infrastructure Platform
 *
 * Detects:
 * - TTS (text-to-speech) generated audio
 * - Voice cloning artifacts
 * - Neural vocoder signatures
 * - GAN-generated speech patterns
 * - Concatenative TTS stitching artifacts
 *
 * Detection methods:
 * 1. Prosodic regularity analysis (TTS = unnaturally regular)
 * 2. Glottal pulse irregularity (human = irregular, TTS = regular)
 * 3. Spectral smoothness (neural TTS = over-smooth spectra)
 * 4. Micro-pause distribution (TTS = unnatural pause patterns)
 * 5. F0 trajectory naturalness (TTS = linear/quantized F0)
 * 6. Phase statistics (vocoders alter phase relationships)
 *
 * Reference:
 * - Reimao & Tzerpos (2019) FOR dataset detection methods
 * - Alzantot et al. (2019) deep fake detection
 * - ASVspoof challenge detection features
 */

import { detectTransients } from "../audioEditor/transientProcessor";

// ── Constants ─────────────────────────────────────────────────────────────────

const FRAME_MS          = 20;
const HOP_MS            = 10;
const F0_REGULARITY_THRESH = 0.15;  // std/mean < 0.15 = suspiciously regular
const PAUSE_REGULARITY_THRESH = 0.2;
const SPECTRAL_SMOOTH_THRESH  = 0.85;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyntheticMethod =
  | "neural_tts"
  | "concatenative_tts"
  | "voice_clone"
  | "neural_vocoder"
  | "human";

export interface SyntheticFeatures {
  f0RegularityScore:     number;   // 0-1 (1=suspicious)
  glottalIrregularity:   number;   // 0-1 (0=regular=suspicious)
  spectralSmoothness:    number;   // 0-1 (1=over-smooth=suspicious)
  pauseRegularity:       number;   // 0-1 (1=regular=suspicious)
  phaseChaos:            number;   // 0-1 (1=natural chaos)
  transientNaturalness:  number;   // 0-1 (1=natural)
}

export interface SyntheticDetectionResult {
  isSynthetic:      boolean;
  confidence:       number;    // 0-1
  method:           SyntheticMethod;
  features:         SyntheticFeatures;
  overallScore:     number;    // 0-100 (100=definitely human)
  evidence:         string[];
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cR=1,cI=0;
      for(let j=0;j<len>>1;j++){
        const uR=re[i+j],uI=im[i+j];
        const vR=re[i+j+len/2]*cR-im[i+j+len/2]*cI;
        const vI=re[i+j+len/2]*cI+im[i+j+len/2]*cR;
        re[i+j]=uR+vR;im[i+j]=uI+vI;
        re[i+j+len/2]=uR-vR;im[i+j+len/2]=uI-vI;
        const nR=cR*wR-cI*wI;cI=cR*wI+cI*wR;cR=nR;
      }
    }
  }
}

// ── YIN F0 (simplified) ───────────────────────────────────────────────────────

function estimateF0(frame: Float32Array, sr: number): number {
  const n      = frame.length;
  const tauMin = Math.floor(sr / 500);
  const tauMax = Math.floor(sr / 60);
  const d      = new Float64Array(tauMax+1);

  for(let tau=1;tau<=tauMax;tau++)
    for(let j=0;j<n-tau;j++){
      const diff=frame[j]-frame[j+tau]; d[tau]+=diff*diff;
    }

  const cmnd=new Float64Array(tauMax+1); cmnd[0]=1;
  let run=0;
  for(let tau=1;tau<=tauMax;tau++){
    run+=d[tau]; cmnd[tau]=run>0?d[tau]*tau/run:1;
  }

  for(let tau=tauMin;tau<=tauMax;tau++)
    if(cmnd[tau]<0.15) return sr/tau;

  let minV=Infinity, bestTau=tauMin;
  for(let tau=tauMin;tau<=tauMax;tau++)
    if(cmnd[tau]<minV){minV=cmnd[tau];bestTau=tau;}
  return minV<0.4 ? sr/bestTau : 0;
}

// ── F0 Regularity Analysis ────────────────────────────────────────────────────
// TTS produces unnaturally regular F0 contours

function analyzeF0Regularity(data: Float32Array, sr: number): number {
  const frameLen = Math.floor(FRAME_MS*sr/1000);
  const hopLen   = Math.floor(HOP_MS*sr/1000);
  const f0s:     number[] = [];

  for(let s=0;s+frameLen<=data.length;s+=hopLen){
    const f0=estimateF0(data.slice(s,s+frameLen) as Float32Array, sr);
    if(f0>60&&f0<500) f0s.push(f0);
  }

  if(f0s.length<10) return 0.5; // insufficient data

  const mean=f0s.reduce((a,b)=>a+b)/f0s.length;
  const std=Math.sqrt(f0s.reduce((s,v)=>s+(v-mean)**2,0)/f0s.length);
  const cv=std/(mean+1e-10); // coefficient of variation

  // Human speech: cv typically 0.15-0.35
  // TTS: cv < 0.10 (too regular)
  const regularity = Math.max(0, 1 - cv/0.20);
  return Math.min(1, regularity);
}

// ── Spectral Smoothness ───────────────────────────────────────────────────────
// Neural TTS produces over-smooth spectra (no natural roughness)

function analyzeSpectralSmoothness(data: Float32Array, sr: number): number {
  const FFT_N = 1024;
  const hop   = FFT_N/2;
  const win   = new Float64Array(FFT_N);
  for(let i=0;i<FFT_N;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(FFT_N-1)));

  let smoothScores:number[] = [];

  for(let s=0;s+FFT_N<=data.length;s+=hop){
    const re=new Float64Array(FFT_N), im=new Float64Array(FFT_N);
    for(let i=0;i<FFT_N;i++) re[i]=data[s+i]*win[i];
    fft(re,im);

    const mag=new Float64Array(FFT_N/2);
    for(let k=0;k<FFT_N/2;k++) mag[k]=Math.sqrt(re[k]**2+im[k]**2);

    // Measure spectral roughness via adjacent bin correlation
    let corr=0,n=0;
    for(let k=1;k<mag.length-1;k++){
      const diff=Math.abs(mag[k]-mag[k-1])/(mag[k]+1e-10);
      corr+=diff; n++;
    }
    const roughness=n>0?corr/n:0;
    smoothScores.push(roughness);
  }

  if(smoothScores.length===0) return 0.5;
  const meanRoughness=smoothScores.reduce((a,b)=>a+b)/smoothScores.length;

  // Low roughness = over-smooth = suspicious
  const smoothness=Math.max(0,1-meanRoughness/0.3);
  return Math.min(1,smoothness);
}

// ── Pause Distribution Analysis ───────────────────────────────────────────────
// TTS has unnaturally regular pause lengths

function analyzePauseRegularity(data: Float32Array, sr: number): number {
  const frameLen  = Math.floor(10*sr/1000); // 10ms frames
  const threshold = 0.001;
  const pauses:   number[] = [];
  let   inPause   = false;
  let   pauseLen  = 0;

  for(let s=0;s+frameLen<=data.length;s+=frameLen){
    let ms=0;
    for(let i=s;i<s+frameLen;i++) ms+=data[i]**2;
    const rms=Math.sqrt(ms/frameLen);

    if(rms<threshold){
      if(!inPause){inPause=true;pauseLen=0;}
      pauseLen++;
    } else {
      if(inPause&&pauseLen>2) pauses.push(pauseLen);
      inPause=false;
    }
  }

  if(pauses.length<5) return 0.3;

  const mean=pauses.reduce((a,b)=>a+b)/pauses.length;
  const std=Math.sqrt(pauses.reduce((s,v)=>s+(v-mean)**2,0)/pauses.length);
  const cv=std/(mean+1e-10);

  // Regular pauses = suspicious
  return Math.max(0,Math.min(1,1-cv/0.5));
}

// ── Phase Chaos Analysis ──────────────────────────────────────────────────────
// Human speech has natural phase randomness; vocoders alter this

function analyzePhaseNaturalness(data: Float32Array, sr: number): number {
  const FFT_N=512, hop=256;
  const phases:number[]=[];

  for(let s=0;s+FFT_N<=data.length;s+=hop){
    const re=new Float64Array(FFT_N), im=new Float64Array(FFT_N);
    for(let i=0;i<FFT_N;i++) re[i]=data[s+i];
    fft(re,im);
    // Phase of a few representative bins
    for(let k=5;k<20;k++) phases.push(Math.atan2(im[k],re[k]));
  }

  if(phases.length<20) return 0.5;

  // Natural speech = high phase variance (chaotic)
  const mean=phases.reduce((a,b)=>a+b)/phases.length;
  const var_=phases.reduce((s,v)=>s+(v-mean)**2,0)/phases.length;
  const normalizedVar=Math.min(1,var_/(Math.PI**2/3));

  return normalizedVar; // high=natural, low=vocoder-processed
}

// ── Transient Naturalness ─────────────────────────────────────────────────────
// Human speech has irregular transients; TTS is too uniform

function analyzeTransientNaturalness(data: Float32Array, sr: number): number {
  const result = detectTransients(data, sr, 0.4);
  if(result.length < 3) return 0.5;

  // Check inter-onset intervals (IOIs)
  const iois:number[]=[];
  for(let i=1;i<result.length;i++)
    iois.push(result[i].samplePos-result[i-1].samplePos);

  if(iois.length<2) return 0.5;

  const mean=iois.reduce((a,b)=>a+b)/iois.length;
  const std=Math.sqrt(iois.reduce((s,v)=>s+(v-mean)**2,0)/iois.length);
  const cv=std/(mean+1e-10);

  // High CV = irregular = natural
  return Math.min(1, cv/0.5);
}

// ── Glottal Irregularity ──────────────────────────────────────────────────────
// Real voices have micro-variations in glottal pulses (jitter/shimmer)

function analyzeGlottalIrregularity(data: Float32Array, sr: number): number {
  const frameLen=Math.floor(FRAME_MS*sr/1000);
  const f0s:number[]=[];

  for(let s=0;s+frameLen<=data.length;s+=Math.floor(frameLen/2)){
    const f0=estimateF0(data.slice(s,s+frameLen) as Float32Array,sr);
    if(f0>60&&f0<500) f0s.push(f0);
  }

  if(f0s.length<5) return 0.5;

  // Jitter: frame-to-frame F0 variation
  let jitter=0;
  for(let i=1;i<f0s.length;i++)
    jitter+=Math.abs(f0s[i]-f0s[i-1])/(f0s[i-1]+1e-10);
  jitter/=(f0s.length-1);

  // High jitter = natural human voice
  // Low jitter = synthetic
  return Math.min(1,jitter/0.05);
}

// ── Main Detector ─────────────────────────────────────────────────────────────

export function detectSyntheticSpeech(
  data: Float32Array,
  sr:   number
): SyntheticDetectionResult {
  const features: SyntheticFeatures = {
    f0RegularityScore:    analyzeF0Regularity(data, sr),
    glottalIrregularity:  analyzeGlottalIrregularity(data, sr),
    spectralSmoothness:   analyzeSpectralSmoothness(data, sr),
    pauseRegularity:      analyzePauseRegularity(data, sr),
    phaseChaos:           analyzePhaseNaturalness(data, sr),
    transientNaturalness: analyzeTransientNaturalness(data, sr),
  };

  // Weighted synthetic score
  const syntheticScore =
    features.f0RegularityScore    * 0.25 +
    (1-features.glottalIrregularity) * 0.20 +
    features.spectralSmoothness   * 0.20 +
    features.pauseRegularity      * 0.15 +
    (1-features.phaseChaos)       * 0.10 +
    (1-features.transientNaturalness) * 0.10;

  const confidence   = Math.min(1, Math.abs(syntheticScore - 0.5) * 2);
  const isSynthetic  = syntheticScore > 0.55;
  const overallScore = Math.round((1-syntheticScore)*100);

  // Classify method
  let method: SyntheticMethod = "human";
  if(isSynthetic){
    if(features.spectralSmoothness>0.8)      method="neural_tts";
    else if(features.f0RegularityScore>0.8)  method="concatenative_tts";
    else if(1-features.phaseChaos>0.7)       method="neural_vocoder";
    else                                      method="voice_clone";
  }

  // Evidence
  const evidence: string[] = [];
  if(features.f0RegularityScore>0.6)
    evidence.push(`F0 too regular (score=${features.f0RegularityScore.toFixed(2)})`);
  if(features.glottalIrregularity<0.3)
    evidence.push(`Low glottal jitter (natural voices have more)`);
  if(features.spectralSmoothness>0.7)
    evidence.push(`Over-smooth spectrum (neural TTS signature)`);
  if(features.pauseRegularity>0.6)
    evidence.push(`Unnatural pause regularity`);
  if(1-features.phaseChaos>0.6)
    evidence.push(`Phase statistics suggest vocoder processing`);
  if(!isSynthetic && evidence.length===0)
    evidence.push("Natural prosody, glottal variation, and phase statistics");

  return {
    isSynthetic,
    confidence: Math.round(confidence*1000)/1000,
    method,
    features,
    overallScore,
    evidence,
  };
}
