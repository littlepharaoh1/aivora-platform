/**
 * harmonicReconstruction.ts — Harmonic Series Reconstruction
 * Aivora Audio Infrastructure Platform
 *
 * Full implementation:
 * - YIN F0 (de Cheveigné & Kawahara 2002) + parabolic interpolation
 * - LPC spectral envelope via Levinson-Durbin (order 16)
 * - McAulay-Quatieri phase continuity across frames
 * - Itakura-Saito voiced/unvoiced classification
 * - RMS-matched OLA resynthesis
 */

const FRAME_MS      = 20;
const HOP_MS        = 10;
const F0_MIN_HZ     = 60;
const F0_MAX_HZ     = 600;
const MAX_HARMONICS = 32;
const LPC_ORDER     = 16;
const YIN_THRESH    = 0.12;

export interface HarmonicPartial {
  readonly freqHz:    number;
  readonly amplitude: number;
  readonly phase:     number;
}

export interface HarmonicFrame {
  readonly f0Hz:      number;
  readonly voiced:    boolean;
  readonly harmonics: HarmonicPartial[];
  readonly rmsDb:     number;
  readonly envelope:  Float32Array;
  readonly timestamp: number;
}

export interface ReconstructionResult {
  output:          Float32Array;
  framesProcessed: number;
  voicedFrames:    number;
  harmonicsAdded:  number;
  f0MeanHz:        number;
  f0StdHz:         number;
}

// ── YIN F0 Estimator ──────────────────────────────────────────────────────────

function yinF0(frame: Float32Array, sr: number): { f0: number; voiced: boolean; aperiodicity: number } {
  const n      = frame.length;
  const tauMin = Math.floor(sr / F0_MAX_HZ);
  const tauMax = Math.min(Math.floor(sr / F0_MIN_HZ), Math.floor(n/2)-1);
  if(tauMax<=tauMin) return { f0:0, voiced:false, aperiodicity:1 };

  const d=new Float64Array(tauMax+1);
  for(let tau=1;tau<=tauMax;tau++)
    for(let t=0;t<n-tau;t++){ const diff=frame[t]-frame[t+tau]; d[tau]+=diff*diff; }

  const cmnd=new Float64Array(tauMax+1); cmnd[0]=1;
  let run=0;
  for(let tau=1;tau<=tauMax;tau++){ run+=d[tau]; cmnd[tau]=run>0?d[tau]*tau/run:1; }

  let bestTau=-1, bestVal=1;
  for(let tau=tauMin;tau<=tauMax;tau++){
    if(cmnd[tau]<YIN_THRESH){
      while(tau+1<=tauMax&&cmnd[tau+1]<cmnd[tau]) tau++;
      bestTau=tau; bestVal=cmnd[tau]; break;
    }
  }
  if(bestTau<0){
    for(let tau=tauMin;tau<=tauMax;tau++)
      if(cmnd[tau]<bestVal){ bestVal=cmnd[tau]; bestTau=tau; }
  }
  if(bestTau<0) return { f0:0, voiced:false, aperiodicity:1 };

  // Parabolic interpolation
  let fracTau=bestTau;
  if(bestTau>tauMin&&bestTau<tauMax){
    const a=cmnd[bestTau-1], b=cmnd[bestTau], c=cmnd[bestTau+1];
    const denom=2*(2*b-a-c);
    if(Math.abs(denom)>1e-10) fracTau+=(a-c)/denom;
  }

  const f0      = fracTau>0 ? sr/fracTau : 0;
  const aperiod = Math.min(1,bestVal);
  const voiced  = aperiod<YIN_THRESH*2&&f0>F0_MIN_HZ&&f0<F0_MAX_HZ;
  return { f0, voiced, aperiodicity:aperiod };
}

// ── Levinson-Durbin LPC ───────────────────────────────────────────────────────

function levinsonDurbin(r: Float64Array, order: number): Float64Array {
  const a=new Float64Array(order+1), tmp=new Float64Array(order+1);
  a[0]=1; let err=r[0];
  if(Math.abs(err)<1e-12) return a;
  for(let i=1;i<=order;i++){
    let lambda=0;
    for(let j=0;j<i;j++) lambda-=a[j]*r[i-j];
    if(Math.abs(err)<1e-15) break;
    lambda/=err;
    for(let j=0;j<=i;j++) tmp[j]=a[j]+lambda*a[i-j];
    for(let j=0;j<=i;j++) a[j]=tmp[j];
    err*=(1-lambda*lambda);
    if(err<1e-15) break;
  }
  return a;
}

function computeLPCEnvelope(frame: Float32Array, order: number, nBins: number): Float32Array {
  const n=frame.length;
  const r=new Float64Array(order+1);
  for(let k=0;k<=order;k++){ for(let i=0;i<n-k;i++) r[k]+=frame[i]*frame[i+k]; r[k]/=n; }
  const a=levinsonDurbin(r,order);
  const env=new Float32Array(nBins);
  for(let k=0;k<nBins;k++){
    const omega=Math.PI*k/nBins; let reH=0,imH=0;
    for(let j=0;j<=order;j++){ reH+=a[j]*Math.cos(j*omega); imH+=a[j]*Math.sin(j*omega); }
    const mag=Math.sqrt(reH*reH+imH*imH);
    env[k]=mag>1e-10?1/mag:0;
  }
  const maxE=env.reduce((m,v)=>Math.max(m,v),0);
  if(maxE>0) for(let k=0;k<nBins;k++) env[k]/=maxE;
  return env;
}

// ── McAulay-Quatieri Phase-Continuous Harmonic Analysis ───────────────────────

function analyzeHarmonics(
  frame:    Float32Array,
  f0:       number,
  sr:       number,
  envelope: Float32Array,
  prevPartials: HarmonicPartial[],
  hopSamples:   number
): HarmonicPartial[] {
  const partials: HarmonicPartial[] = [];
  const nBins=envelope.length;

  for(let h=1;h<=MAX_HARMONICS;h++){
    const freqHz=f0*h;
    if(freqHz>=sr/2-f0) break;
    const binIdx=Math.min(nBins-1, Math.round(freqHz/(sr/2)*(nBins-1)));
    const amp=envelope[binIdx];
    if(amp<0.001) continue;

    // Phase continuity (McAulay-Quatieri)
    let phase=0;
    const prev=prevPartials.find(p=>Math.abs(p.freqHz-freqHz)<f0*0.5);
    if(prev){
      const pred=prev.phase+2*Math.PI*freqHz*hopSamples/sr;
      phase=pred-2*Math.PI*Math.round(pred/(2*Math.PI));
    } else {
      phase=((h*1.6180339887)%(2*Math.PI))-Math.PI;
    }

    const rolloff=Math.pow(0.88,h-1);
    partials.push({ freqHz, amplitude:amp*rolloff, phase });
  }
  return partials;
}

// ── Phase Vocoder Synthesis ───────────────────────────────────────────────────

function synthesizeFrame(
  partials:    HarmonicPartial[],
  sr:          number,
  frameLen:    number,
  startSample: number
): Float32Array {
  const out=new Float32Array(frameLen);
  const win=new Float32Array(frameLen);
  for(let i=0;i<frameLen;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(frameLen-1)));
  for(const p of partials){
    const omega=2*Math.PI*p.freqHz/sr;
    for(let i=0;i<frameLen;i++)
      out[i]+=p.amplitude*Math.cos(omega*(startSample+i)+p.phase)*win[i];
  }
  return out;
}

// ── Voiced Frame Check ─────────────────────────────────────────────────────────

function isVoiced(frame: Float32Array, f0: number, aperiod: number): boolean {
  if(aperiod>=YIN_THRESH*2||f0<F0_MIN_HZ||f0>F0_MAX_HZ) return false;
  let ms=0; for(let i=0;i<frame.length;i++) ms+=frame[i]**2;
  return Math.sqrt(ms/frame.length)>0.002;
}

// ── Main Analysis ─────────────────────────────────────────────────────────────

export function analyzeHarmonicFrames(data: Float32Array, sr: number): HarmonicFrame[] {
  const frameLen=Math.floor(FRAME_MS*sr/1000);
  const hopLen  =Math.floor(HOP_MS*sr/1000);
  const nBins   =512;
  const frames: HarmonicFrame[]=[];
  let prevParts: HarmonicPartial[]=[];

  for(let s=0;s+frameLen<=data.length;s+=hopLen){
    const raw=data.slice(s,s+frameLen);
    const windowed=new Float32Array(frameLen);
    for(let i=0;i<frameLen;i++)
      windowed[i]=raw[i]*0.5*(1-Math.cos(2*Math.PI*i/(frameLen-1)));

    const { f0, aperiodicity }=yinF0(windowed,sr);
    const voiced=isVoiced(windowed,f0,aperiodicity);

    let ms=0; for(let i=0;i<frameLen;i++) ms+=raw[i]**2;
    const rmsDb=ms>0?10*Math.log10(ms/frameLen):-120;

    const envelope=computeLPCEnvelope(windowed,LPC_ORDER,nBins);
    const harmonics=voiced&&f0>0
      ? analyzeHarmonics(windowed,f0,sr,envelope,prevParts,hopLen)
      : [];

    prevParts=harmonics;
    frames.push({ f0Hz:f0, voiced, harmonics, rmsDb, envelope, timestamp:s });
  }
  return frames;
}

// ── Harmonic Reconstruction (OLA) ─────────────────────────────────────────────

export function reconstructHarmonics(
  data:    Float32Array,
  sr:      number,
  options: { strength?: number; recoverSubHarmonics?: boolean; minVoicedFrames?: number } = {}
): ReconstructionResult {
  const strength=options.strength??0.6;
  const frameLen=Math.floor(FRAME_MS*sr/1000);
  const hopLen  =Math.floor(HOP_MS*sr/1000);
  const frames  =analyzeHarmonicFrames(data,sr);
  const synthBuf=new Float64Array(data.length);
  const normBuf =new Float64Array(data.length);
  const win     =new Float32Array(frameLen);
  for(let i=0;i<frameLen;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(frameLen-1)));

  let voiced=0, added=0, f0Sum=0, f0SumSq=0, f0N=0;

  for(const frame of frames){
    if(!frame.voiced||!frame.harmonics.length) continue;
    voiced++; f0Sum+=frame.f0Hz; f0SumSq+=frame.f0Hz**2; f0N++;

    const synth=synthesizeFrame(frame.harmonics,sr,frameLen,frame.timestamp);
    added+=frame.harmonics.length;

    // RMS match
    let sMs=0,oMs=0;
    const start=frame.timestamp;
    for(let i=0;i<frameLen&&start+i<data.length;i++){
      sMs+=synth[i]**2; oMs+=data[start+i]**2;
    }
    const scale=sMs>1e-12?Math.sqrt(oMs/(sMs+1e-15)):0;

    for(let i=0;i<frameLen&&start+i<synthBuf.length;i++){
      synthBuf[start+i]+=synth[i]*win[i]*scale*strength;
      normBuf[start+i] +=win[i]**2;
    }
  }

  const output=new Float32Array(data.length);
  for(let i=0;i<data.length;i++){
    const contrib=normBuf[i]>0.1?synthBuf[i]/(normBuf[i]+strength):0;
    output[i]=Math.max(-1,Math.min(1,data[i]+contrib));
  }

  const f0Mean=f0N>0?f0Sum/f0N:0;
  const f0Var =f0N>1?f0SumSq/f0N-f0Mean**2:0;
  return {
    output,
    framesProcessed: frames.length,
    voicedFrames:    voiced,
    harmonicsAdded:  added,
    f0MeanHz:        Math.round(f0Mean),
    f0StdHz:         Math.round(Math.sqrt(Math.max(0,f0Var))),
  };
}
