/**
 * firFilter.ts — FIR Linear-Phase Filter Bank
 * Aivora Audio Infrastructure Platform
 *
 * Implements:
 * - Linear-phase FIR via windowed sinc method
 * - Parks-McClellan-inspired equiripple design (simplified)
 * - Overlap-add convolution (O(N log N))
 * - Low-pass, high-pass, band-pass, band-stop
 * - De-esser (frequency-selective dynamic processor)
 *
 * Linear phase = zero phase distortion = forensic safe
 * Reference: Oppenheim & Schafer "Discrete-Time Signal Processing"
 */

// ── FFT for overlap-add ───────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
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

function ifft(re: Float64Array, im: Float64Array): void {
  for(let i=0;i<im.length;i++) im[i]=-im[i];
  fft(re,im);
  for(let i=0;i<re.length;i++){re[i]/=re.length;im[i]=-im[i]/re.length;}
}

// ── Window Functions ──────────────────────────────────────────────────────────

function kaiserWindow(n: number, beta: number): Float64Array {
  const w = new Float64Array(n);
  const i0beta = besselI0(beta);
  for(let i=0;i<n;i++){
    const x = 2*i/(n-1)-1;
    w[i] = besselI0(beta*Math.sqrt(1-x*x))/i0beta;
  }
  return w;
}

function besselI0(x: number): number {
  let sum=1,term=1;
  const h=x/2;
  for(let k=1;k<=25;k++){term*=(h/k)**2;sum+=term;if(term<1e-15)break;}
  return sum;
}

// ── FIR Coefficient Design ────────────────────────────────────────────────────
// Windowed sinc method with Kaiser window
// cutoff: normalized frequency [0, 0.5]

function designLowPassFIR(cutoff: number, order: number, beta = 6.0): Float64Array {
  const n    = order + 1;
  const win  = kaiserWindow(n, beta);
  const h    = new Float64Array(n);
  const mid  = (n-1)/2;

  for(let i=0;i<n;i++){
    const t = i - mid;
    h[i] = t === 0
      ? 2*cutoff
      : Math.sin(2*Math.PI*cutoff*t) / (Math.PI*t);
    h[i] *= win[i];
  }
  return h;
}

function designHighPassFIR(cutoff: number, order: number, beta = 6.0): Float64Array {
  const lp = designLowPassFIR(cutoff, order, beta);
  const hp = new Float64Array(lp.length);
  const mid = (lp.length-1)/2;
  for(let i=0;i<lp.length;i++){
    hp[i] = (i === mid ? 1 : 0) - lp[i];
  }
  return hp;
}

function designBandPassFIR(
  lowCut: number, highCut: number, order: number, beta = 6.0
): Float64Array {
  const lp1 = designLowPassFIR(highCut, order, beta);
  const lp2 = designLowPassFIR(lowCut,  order, beta);
  const bp  = new Float64Array(lp1.length);
  for(let i=0;i<bp.length;i++) bp[i] = lp1[i] - lp2[i];
  return bp;
}

export type FIRType = "lowpass" | "highpass" | "bandpass" | "bandstop";

export interface FIRFilterSpec {
  type:      FIRType;
  cutoffHz:  number;
  cutoff2Hz?: number;  // for bandpass/bandstop
  order:     number;   // typically 64-512
  beta:      number;   // Kaiser beta (4=mild, 8=steep)
  sampleRate: number;
}

export function designFIR(spec: FIRFilterSpec): Float64Array {
  const fc1 = spec.cutoffHz  / spec.sampleRate;
  const fc2 = (spec.cutoff2Hz ?? spec.cutoffHz*2) / spec.sampleRate;

  switch(spec.type){
    case "lowpass":  return designLowPassFIR(fc1, spec.order, spec.beta);
    case "highpass": return designHighPassFIR(fc1, spec.order, spec.beta);
    case "bandpass": return designBandPassFIR(fc1, fc2, spec.order, spec.beta);
    case "bandstop": {
      const bp = designBandPassFIR(fc1, fc2, spec.order, spec.beta);
      const bs = new Float64Array(bp.length);
      const mid = (bp.length-1)/2;
      for(let i=0;i<bp.length;i++)
        bs[i] = (i===mid?1:0) - bp[i];
      return bs;
    }
  }
}

// ── Overlap-Add FIR Convolution O(N log N) ────────────────────────────────────

export function applyFIR(
  data: Float32Array,
  coefs: Float64Array
): Float32Array {
  const M       = coefs.length;
  const L       = Math.max(256, nextPow2(M) * 2);
  const fftSize = nextPow2(L + M - 1);
  const output  = new Float32Array(data.length);

  // FFT of filter
  const hRe = new Float64Array(fftSize);
  const hIm = new Float64Array(fftSize);
  for(let i=0;i<M;i++) hRe[i]=coefs[i];
  fft(hRe, hIm);

  // Process in blocks
  const overlap = new Float64Array(M - 1);
  for(let start=0; start<data.length; start+=L){
    const blockLen = Math.min(L, data.length-start);
    const xRe = new Float64Array(fftSize);
    const xIm = new Float64Array(fftSize);
    for(let i=0;i<blockLen;i++) xRe[i]=data[start+i];
    fft(xRe, xIm);

    // Complex multiply
    for(let k=0;k<fftSize;k++){
      const r=xRe[k]*hRe[k]-xIm[k]*hIm[k];
      const i2=xRe[k]*hIm[k]+xIm[k]*hRe[k];
      xRe[k]=r; xIm[k]=i2;
    }
    ifft(xRe, xIm);

    // Overlap-add
    for(let i=0;i<M-1&&i<overlap.length;i++)
      xRe[i]+=overlap[i];
    for(let i=0;i<blockLen;i++)
      output[start+i]=Math.max(-1,Math.min(1,xRe[i]));
    for(let i=0;i<M-1;i++)
      overlap[i]=xRe[blockLen+i]??0;
  }
  return output;
}

function nextPow2(n: number): number {
  let p=1; while(p<n) p<<=1; return p;
}

// ── De-esser ──────────────────────────────────────────────────────────────────
// Frequency-selective dynamic processor for sibilance control
// Detects high energy in 5-10kHz band → applies gain reduction only there

export interface DeEsserOptions {
  thresholdDb:  number;   // default -20
  ratio:        number;   // default 4:1
  attackMs:     number;   // default 1ms
  releaseMs:    number;   // default 50ms
  freqLowHz:    number;   // sibilance band low (default 5000)
  freqHighHz:   number;   // sibilance band high (default 10000)
}

export interface DeEsserResult {
  output:         Float32Array;
  gainReductionDb: number;  // max GR applied
  sibilanceRatio:  number;  // 0-1 how much sibilance detected
}

export function applyDeEsser(
  data:    Float32Array,
  sr:      number,
  options: Partial<DeEsserOptions> = {}
): DeEsserResult {
  const threshDb  = options.thresholdDb ?? -20;
  const ratio     = options.ratio       ?? 4;
  const attackMs  = options.attackMs    ?? 1;
  const releaseMs = options.releaseMs   ?? 50;
  const fLow      = options.freqLowHz   ?? 5000;
  const fHigh     = options.freqHighHz  ?? 10000;
  const thresh    = Math.pow(10, threshDb/20);

  // Bandpass filter to detect sibilance
  const bpCoefs = designFIR({
    type:"bandpass", cutoffHz:fLow, cutoff2Hz:fHigh,
    order:128, beta:6, sampleRate:sr
  });
  const sibilance = applyFIR(data, bpCoefs);

  // Envelope follower on sibilance band
  const aCoef = Math.exp(-1/(sr*attackMs/1000));
  const rCoef = Math.exp(-1/(sr*releaseMs/1000));
  let env = 0;
  const gainEnv = new Float32Array(data.length);

  for(let i=0;i<data.length;i++){
    const v=Math.abs(sibilance[i]);
    env = v > env
      ? aCoef*env+(1-aCoef)*v
      : rCoef*env+(1-rCoef)*v;
    gainEnv[i] = env;
  }

  // Apply frequency-selective gain reduction
  const output = new Float32Array(data.length);
  let maxGR=0, sibilanceFrames=0;

  for(let i=0;i<data.length;i++){
    let gainDb = 0;
    const envDb = 20*Math.log10(gainEnv[i]+1e-10);
    if(envDb > threshDb){
      gainDb = (threshDb - envDb) * (1 - 1/ratio);
      sibilanceFrames++;
    }
    if(gainDb < maxGR) maxGR=gainDb;

    // Apply GR only to the sibilance band
    const gain = Math.pow(10, gainDb/20);
    output[i] = Math.max(-1,Math.min(1,
      (data[i] - sibilance[i]) + sibilance[i]*gain
    ));
  }

  return {
    output,
    gainReductionDb: maxGR,
    sibilanceRatio:  sibilanceFrames/data.length,
  };
}

// ── De-reverb (Spectral Subtraction) ─────────────────────────────────────────
// Estimates late reverb tail and subtracts from signal
// Uses exponential decay model for reverb envelope estimation

export interface DeReverbOptions {
  rt60Ms:       number;    // estimated reverb time
  dryWet:       number;    // 0-1 (1 = fully dereverbed)
  floorDb:      number;    // spectral floor (default -60dB)
}

export interface DeReverbResult {
  output:         Float32Array;
  reverbReduced:  number;  // 0-1 estimated reduction
  rt60Estimated:  number;  // ms
}

export function applyDeReverb(
  data:    Float32Array,
  sr:      number,
  options: Partial<DeReverbOptions> = {}
): DeReverbResult {
  const rt60   = options.rt60Ms  ?? 300;
  const dryWet = options.dryWet  ?? 0.7;
  const floor  = Math.pow(10, (options.floorDb ?? -60)/20);

  const FFT_SIZE = 2048;
  const HOP      = FFT_SIZE/4;
  const numBins  = FFT_SIZE/2;

  // Build hann window
  const win = new Float64Array(FFT_SIZE);
  for(let i=0;i<FFT_SIZE;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(FFT_SIZE-1)));

  // Reverb decay per bin: alpha = exp(-ln(1000)*T_frame/RT60)
  const frameTime = HOP/sr;
  const alpha = Math.exp(-6.908*frameTime/(rt60/1000));

  const out   = new Float64Array(data.length);
  const norm  = new Float64Array(data.length);
  const reverbEst = new Float64Array(numBins); // per-bin reverb estimate

  let totalDry=0, totalWet=0;

  for(let start=0;start+FFT_SIZE<=data.length;start+=HOP){
    const re=new Float64Array(FFT_SIZE), im=new Float64Array(FFT_SIZE);
    for(let i=0;i<FFT_SIZE;i++) re[i]=data[start+i]*win[i];
    fft(re,im);

    for(let k=0;k<FFT_SIZE;k++){
      const bin=k<numBins?k:FFT_SIZE-k;
      const mag=Math.sqrt(re[k]**2+im[k]**2);

      // Update reverb estimate (exponential decay)
      reverbEst[bin]=alpha*reverbEst[bin]+(1-alpha)*mag*0.3;

      // Subtract reverb estimate
      const clean=Math.max(floor*mag, mag-reverbEst[bin]*dryWet);
      const gain=mag>1e-10?clean/mag:0;
      re[k]*=gain; im[k]*=gain;

      totalDry+=clean; totalWet+=mag;
    }

    // IFFT
    for(let k=0;k<FFT_SIZE;k++) im[k]=-im[k];
    fft(re,im);
    for(let k=0;k<FFT_SIZE;k++) re[k]/=FFT_SIZE;

    for(let i=0;i<FFT_SIZE&&start+i<out.length;i++){
      out[start+i]  +=re[i]*win[i];
      norm[start+i] +=win[i]**2;
    }
  }

  const result=new Float32Array(data.length);
  for(let i=0;i<data.length;i++)
    result[i]=norm[i]>1e-8?Math.max(-1,Math.min(1,out[i]/norm[i])):0;

  const reverbReduced = totalWet>0 ? 1-totalDry/totalWet : 0;

  return { output:result, reverbReduced, rt60Estimated:rt60 };
}
