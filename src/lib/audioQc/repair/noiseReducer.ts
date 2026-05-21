/**
 * noiseReducer.ts — Advanced Noise Reduction
 * Wiener Filter + Adaptive Estimation + Musical Noise Suppression
 * Aivora Platform — Phase 7
 */

export interface NoiseReducerOptions {
  strength:        number;   // 0.0–1.0 (default 0.7)
  noiseEstMs:      number;   // ms for noise estimation (default 500)
  wienerAlpha:     number;   // Wiener smoothing (default 0.98)
  overSubtract:    number;   // Over-subtraction (default 1.2)
  musicSuppression: boolean; // Musical noise suppression (default true)
  transientProtect: boolean; // Protect transients (default true)
  multiBand:        boolean; // Multi-band processing (default true)
}

export interface NoiseReducerResult {
  buffer:         AudioBuffer;
  changed:        boolean;
  noiseFloorDb:   number;
  reductionDb:    number;
  snrBefore:      number;
  snrAfter:       number;
  warnings:       string[];
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
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

function ifft(re: Float64Array, im: Float64Array): void {
  for(let i=0;i<im.length;i++) im[i]=-im[i];
  fft(re,im);
  for(let i=0;i<re.length;i++){re[i]/=re.length;im[i]=-im[i]/re.length;}
}

function hannWindow(size: number): Float64Array {
  const w=new Float64Array(size);
  for(let i=0;i<size;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(size-1)));
  return w;
}

// ── SNR Estimate ──────────────────────────────────────────────────────────────

function estimateSNR(samples: Float32Array, sampleRate: number): number {
  const frameSize = Math.round(0.02*sampleRate);
  const energies: number[] = [];
  for(let i=0;i+frameSize<=samples.length;i+=frameSize){
    let e=0;
    for(let j=0;j<frameSize;j++) e+=samples[i+j]**2;
    energies.push(e/frameSize);
  }
  energies.sort((a,b)=>a-b);
  const cut=Math.max(1,Math.floor(energies.length*0.1));
  const noise=energies.slice(0,cut).reduce((s,v)=>s+v,0)/cut;
  const signal=energies.slice(-cut).reduce((s,v)=>s+v,0)/cut;
  return noise>0 ? Math.min(80,10*Math.log10(signal/noise)) : 60;
}

// ── Adaptive Noise Estimator ──────────────────────────────────────────────────

class AdaptiveNoiseEstimator {
  private spectrum:    Float64Array;
  private minSpectrum: Float64Array;
  private frameCount:  number = 0;
  private updateRate:  number;
  private alpha:       number; // Smoothing

  constructor(fftSize: number, updateRate = 0.02, alpha = 0.95) {
    this.spectrum    = new Float64Array(fftSize/2).fill(1e-10);
    this.minSpectrum = new Float64Array(fftSize/2).fill(1e-10);
    this.updateRate  = updateRate;
    this.alpha       = alpha;
  }

  update(mag: Float32Array, isSpeechLikely: boolean): void {
    this.frameCount++;

    for(let i=0;i<mag.length;i++){
      const power = mag[i]**2;
      // Smooth spectrum
      this.spectrum[i] = this.alpha*this.spectrum[i] + (1-this.alpha)*power;
      // Update minimum (noise floor tracking)
      if(!isSpeechLikely || this.frameCount < 10){
        this.minSpectrum[i] = Math.min(
          this.minSpectrum[i]*1.001 + power*0.001,
          this.spectrum[i]
        );
      }
    }
  }

  getNoiseSpectrum(): Float64Array {
    // Return smoothed noise estimate with bias correction
    const noise = new Float64Array(this.minSpectrum.length);
    for(let i=0;i<noise.length;i++)
      noise[i] = this.minSpectrum[i] * 1.5; // Bias correction factor
    return noise;
  }

  get initialized(): boolean { return this.frameCount >= 10; }
}

// ── Wiener Filter ─────────────────────────────────────────────────────────────

function wienerGain(
  signalPower: number,
  noisePower:  number,
  strength:    number
): number {
  if(noisePower <= 0) return 1.0;
  const snr = signalPower / noisePower;
  // Wiener gain: H = SNR / (SNR + 1)
  const wiener = snr / (snr + 1);
  // Blend with identity based on strength
  const gain = (1-strength) + strength*wiener;
  // Spectral floor to prevent musical noise
  return Math.max(gain, 0.05);
}

// ── Noise Gate with Smooth Attack/Release Envelope ───────────────────────────
//
// Instead of binary gate (0 or 1), we use an exponential envelope:
//   τ_attack  = 1 - e^(-1 / (sr × attackSec))
//   τ_release = 1 - e^(-1 / (sr × releaseSec))
//
// When signal > threshold: envelope follows attack curve  (fast,  10ms)
// When signal < threshold: envelope follows release curve (slow, 175ms)
// This prevents abrupt cutoff at word endings.

export interface NoiseGateOptions {
  thresholdDb:  number;   // Gate open threshold (default -40dB)
  attackMs:     number;   // Attack  time ms (default 10ms)
  releaseMs:    number;   // Release time ms (default 175ms)
  kneeDb:       number;   // Soft knee width dB (default 6dB)
  floor:        number;   // Minimum gain below threshold (default 0.001)
}

export function applyNoiseGate(
  samples:  Float32Array,
  sr:       number,
  options:  Partial<NoiseGateOptions> = {}
): Float32Array {
  const threshLin = Math.pow(10, (options.thresholdDb ?? -40) / 20);
  const attackMs  = options.attackMs  ?? 10;
  const releaseMs = options.releaseMs ?? 175;
  const kneeDb    = options.kneeDb    ?? 6;
  const floor     = options.floor     ?? 0.001;

  // Exponential envelope coefficients
  // τ = 1 - e^(-1 / (sr × timeInSeconds))
  const attackCoeff  = 1 - Math.exp(-1 / (sr * attackMs  / 1000));
  const releaseCoeff = 1 - Math.exp(-1 / (sr * releaseMs / 1000));

  // Soft knee: transition zone around threshold
  const kneeLinLow  = threshLin * Math.pow(10, -kneeDb / 40);
  const kneeLinHigh = threshLin * Math.pow(10,  kneeDb / 40);

  const output   = new Float32Array(samples.length);
  let   envelope = 0;

  for(let i = 0; i < samples.length; i++){
    const abs = Math.abs(samples[i]);

    // Smooth envelope tracking
    if(abs > envelope){
      // Attack: signal rising — follow quickly
      envelope += attackCoeff * (abs - envelope);
    } else {
      // Release: signal falling — follow slowly (prevents word-end chop)
      envelope += releaseCoeff * (abs - envelope);
    }

    // Compute gate gain with soft knee
    let gateGain: number;

    if(envelope >= kneeLinHigh){
      // Above knee: fully open
      gateGain = 1.0;
    } else if(envelope <= kneeLinLow){
      // Below knee: fully closed (but not silent — use floor)
      gateGain = floor;
    } else {
      // Inside soft knee: smooth quadratic transition
      // g = floor + (1 - floor) × ((env - kneeLinLow) / (kneeLinHigh - kneeLinLow))²
      const t = (envelope - kneeLinLow) / (kneeLinHigh - kneeLinLow);
      gateGain = floor + (1 - floor) * t * t;
    }

    output[i] = samples[i] * gateGain;
  }

  return output;
}

// ── Frame-level Temporal Gain Smoothing ───────────────────────────────────────
//
// Smooths Wiener gains BETWEEN FFT frames to prevent inter-frame discontinuity.
// gainSmooth[k] = α × gainPrev[k] + (1-α) × gainCurr[k]
// α = 0.7 provides ~3-frame smoothing at hop=256/48kHz ≈ 5ms per frame

function smoothGainTemporal(
  gainCurr: Float32Array,
  gainPrev: Float32Array,
  alpha     = 0.7
): Float32Array {
  const out = new Float32Array(gainCurr.length);
  for(let i = 0; i < gainCurr.length; i++){
    out[i] = alpha * gainPrev[i] + (1 - alpha) * gainCurr[i];
  }
  return out;
}

// ── Musical Noise Suppression ─────────────────────────────────────────────────

function suppressMusicalNoise(
  gainCurr: Float32Array,
  gainPrev: Float32Array,
  gainPrev2: Float32Array
): Float32Array {
  const smoothed: Float32Array = new Float32Array(gainCurr.length);
  for(let i=0;i<gainCurr.length;i++){
    // Median of 3 frames + neighboring bins
    const left  = i>0 ? gainCurr[i-1] : gainCurr[i];
    const right = i<gainCurr.length-1 ? gainCurr[i+1] : gainCurr[i];
    const vals  = [gainCurr[i], gainPrev[i], gainPrev2[i], left, right].sort((a,b)=>a-b);
    smoothed[i] = vals[2]; // Median
  }
  return smoothed;
}

// ── Transient Detector ────────────────────────────────────────────────────────

function detectTransient(
  energy:      number,
  prevEnergy:  number,
  threshold    = 4.0
): boolean {
  return prevEnergy > 0 && energy/prevEnergy > threshold;
}

// ── Multi-band Noise Estimation ───────────────────────────────────────────────

function getMultiBandStrength(
  binIndex:   number,
  fftSize:    number,
  sampleRate: number,
  strength:   number
): number {
  const hz = binIndex * sampleRate / fftSize;
  // Stronger reduction in noise bands, preserve speech bands
  if (hz < 100)  return Math.min(1.0, strength*1.3);  // Sub-bass: aggressive
  if (hz < 300)  return Math.min(1.0, strength*1.1);  // Low: slightly aggressive
  if (hz < 3400) return strength*0.85;                 // Speech: gentler
  if (hz < 8000) return Math.min(1.0, strength*1.1);  // High-mid
  return Math.min(1.0, strength*1.2);                  // High: aggressive
}

// ── Main Noise Reducer ────────────────────────────────────────────────────────

export function reduceNoise(
  buffer:  AudioBuffer,
  options: Partial<NoiseReducerOptions> = {}
): NoiseReducerResult {
  const opts: NoiseReducerOptions = {
    strength:         options.strength         ?? 0.7,
    noiseEstMs:       options.noiseEstMs       ?? 500,
    wienerAlpha:      options.wienerAlpha      ?? 0.98,
    overSubtract:     options.overSubtract     ?? 1.2,
    musicSuppression: options.musicSuppression ?? true,
    transientProtect: options.transientProtect ?? true,
    multiBand:        options.multiBand        ?? true,
  };

  const warnings: string[] = [];
  const sr       = buffer.sampleRate;
  const FFT_SIZE = 1024;
  const HOP_SIZE = FFT_SIZE/4;
  const window   = hannWindow(FFT_SIZE);

  if(opts.strength > 0.9)
    warnings.push("High strength may cause artifacts in complex audio");

  const ctx    = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sr);
  const outBuf = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);

  let noiseFloorDb = -120;
  let snrBefore    = 0;
  let snrAfter     = 0;
  let maxBefore    = 0;
  let maxAfter     = 0;

  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const src  = buffer.getChannelData(ch);
    const dest = outBuf.getChannelData(ch);

    // Measure before SNR
    if(ch===0) snrBefore = estimateSNR(src, sr);

    // ── Pass 1: Noise Spectrum Estimation ──────────────────────────────────

    const noiseEstFrames = Math.round((opts.noiseEstMs/1000)*sr/HOP_SIZE);
    const adaptEst       = new AdaptiveNoiseEstimator(FFT_SIZE, 0.02, opts.wienerAlpha);

    // First pass — estimate noise from full signal
    for(let i=0;i+FFT_SIZE<=src.length;i+=HOP_SIZE){
      const re=new Float64Array(FFT_SIZE);
      const im=new Float64Array(FFT_SIZE);
      for(let j=0;j<FFT_SIZE;j++) re[j]=src[i+j]*window[j];
      fft(re,im);
      const mag=new Float32Array(FFT_SIZE/2);
      for(let j=0;j<FFT_SIZE/2;j++) mag[j]=Math.sqrt(re[j]**2+im[j]**2);

      // Energy-based speech detection for adaptive estimator
      const energy=mag.reduce((s,v)=>s+v**2,0)/mag.length;
      const isSpeech = i/HOP_SIZE > noiseEstFrames*2;
      adaptEst.update(mag, isSpeech);
    }

    const noiseSpectrum = adaptEst.getNoiseSpectrum();

    if(ch===0){
      const avgNoise = noiseSpectrum.reduce((s,v)=>s+v,0)/noiseSpectrum.length;
      noiseFloorDb   = avgNoise>0 ? 10*Math.log10(avgNoise) : -120;
    }

    // ── Pass 2: Wiener Filtering ────────────────────────────────────────────

    const output  = new Float64Array(src.length+FFT_SIZE);
    const overlap = new Float64Array(src.length+FFT_SIZE);

    let gainPrev: Float32Array  = new Float32Array(FFT_SIZE/2).fill(1);
    let gainPrev2: Float32Array = new Float32Array(FFT_SIZE/2).fill(1);
    let prevEnergy = 0;

    for(let i=0;i+FFT_SIZE<=src.length;i+=HOP_SIZE){
      const re=new Float64Array(FFT_SIZE);
      const im=new Float64Array(FFT_SIZE);
      for(let j=0;j<FFT_SIZE;j++) re[j]=src[i+j]*window[j];
      fft(re,im);

      const mag   = new Float32Array(FFT_SIZE/2);
      const phase = new Float32Array(FFT_SIZE/2);
      for(let j=0;j<FFT_SIZE/2;j++){
        mag[j]   = Math.sqrt(re[j]**2+im[j]**2);
        phase[j] = Math.atan2(im[j],re[j]);
      }

      // Frame energy for transient detection
      const energy = mag.reduce((s,v)=>s+v**2,0)/mag.length;
      const isTransient = opts.transientProtect && detectTransient(energy, prevEnergy);
      prevEnergy = energy;

      // Compute Wiener gains per bin
      const gainCurr = new Float32Array(FFT_SIZE/2);
      for(let j=0;j<FFT_SIZE/2;j++){
        const signalPower = mag[j]**2;
        const noisePower  = noiseSpectrum[j]*opts.overSubtract;
        const bandStrength = opts.multiBand
          ? getMultiBandStrength(j, FFT_SIZE, sr, opts.strength)
          : opts.strength;

        gainCurr[j] = isTransient
          ? 1.0  // No reduction on transients
          : wienerGain(signalPower, noisePower, bandStrength);
      }

      // Musical noise suppression
      let finalGain: Float32Array = gainCurr;
      if(opts.musicSuppression && !isTransient){
        finalGain = suppressMusicalNoise(gainCurr, gainPrev, gainPrev2);
      }

      // Temporal smoothing between frames (prevents inter-frame chopping)
      // α=0.7 → smooth over ~3 frames, eliminating gain discontinuities
      finalGain = smoothGainTemporal(finalGain, gainPrev, 0.7);

      gainPrev2 = gainPrev;
      gainPrev  = gainCurr;

      // Apply gains
      for(let j=0;j<FFT_SIZE/2;j++){
        const newMag = mag[j]*finalGain[j];
        re[j] = newMag*Math.cos(phase[j]);
        im[j] = newMag*Math.sin(phase[j]);
        if(j>0&&j<FFT_SIZE/2){
          re[FFT_SIZE-j] = re[j];
          im[FFT_SIZE-j] = -im[j];
        }
      }

      ifft(re,im);

      // OLA
      for(let j=0;j<FFT_SIZE;j++){
        output[i+j]  += re[j]*window[j];
        overlap[i+j] += window[j]**2;
      }
    }

    // Normalize
    for(let i=0;i<src.length;i++){
      const s = Math.abs(src[i]);
      if(s>maxBefore) maxBefore=s;
    }

    for(let i=0;i<src.length;i++){
      dest[i] = overlap[i]>0.001
        ? Math.max(-1,Math.min(1,output[i]/overlap[i]))
        : src[i];
      const d=Math.abs(dest[i]);
      if(d>maxAfter) maxAfter=d;
    }

    if(ch===0) snrAfter = estimateSNR(dest, sr);
  }

  const reductionDb = maxBefore>0&&maxAfter>0
    ? 20*Math.log10(maxBefore/maxAfter) : 0;

  return {
    buffer:  outBuf,
    changed: true,
    noiseFloorDb,
    reductionDb,
    snrBefore,
    snrAfter,
    warnings,
  };
}
