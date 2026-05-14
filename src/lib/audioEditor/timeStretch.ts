/**
 * timeStretch.ts — Advanced Time Stretch Engine
 * WSOLA + Transient Protection + Pitch Stability
 * Aivora Platform — Phase 10
 */

export interface StretchOptions {
  ratio:            number;    // 0.65 – 1.80
  windowSizeMs?:    number;    // ms (default 25)
  overlapMs?:       number;    // ms (default 10)
  transientProtect?: boolean;  // default true
  pitchStable?:     boolean;   // default true
  speechAware?:     boolean;   // default true
}

export interface StretchResult {
  buffer:   AudioBuffer;
  ratio:    number;
  warning?: string;
  quality:  "high" | "medium" | "low";
  processingMs: number;
}

export function validateStretchRatio(ratio: number): {
  valid: boolean; warning?: string; error?: string;
} {
  if (ratio < 0.65) return { valid:false, error:`Ratio ${ratio.toFixed(2)}x too low (min 0.65x)` };
  if (ratio > 1.80) return { valid:false, error:`Ratio ${ratio.toFixed(2)}x too high (max 1.80x)` };
  if (ratio < 0.80) return { valid:true,  warning:`Ratio ${ratio.toFixed(2)}x — compression artifacts possible` };
  if (ratio > 1.25) return { valid:true,  warning:`Ratio ${ratio.toFixed(2)}x — stretching artifacts possible` };
  return { valid:true };
}

// ── Window Functions ──────────────────────────────────────────────────────────

function hannWindow(size: number): Float32Array {
  const w=new Float32Array(size);
  for(let i=0;i<size;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(size-1)));
  return w;
}

function triangleWindow(size: number): Float32Array {
  const w=new Float32Array(size);
  const half=size/2;
  for(let i=0;i<size;i++) w[i]=1-Math.abs((i-half)/half);
  return w;
}

// ── Transient Detector ────────────────────────────────────────────────────────

function detectTransients(
  samples:    Float32Array,
  frameSize:  number,
  hopSize:    number,
  threshold   = 3.5
): boolean[] {
  const transients: boolean[]=[];
  let prevEnergy=0;

  for(let i=0;i+frameSize<=samples.length;i+=hopSize){
    let e=0;
    for(let j=0;j<frameSize;j++) e+=samples[i+j]**2;
    e/=frameSize;

    // Transient = sudden energy increase
    const ratio=prevEnergy>1e-10 ? e/prevEnergy : 1;
    transients.push(ratio>threshold);
    prevEnergy=e;
  }
  return transients;
}

// ── Pitch Stability via Autocorrelation ───────────────────────────────────────

function estimatePeriod(
  samples:    Float32Array,
  sampleRate: number
): number {
  const minP=Math.round(sampleRate/400);
  const maxP=Math.round(sampleRate/60);
  let bestCorr=0, bestPeriod=0;

  for(let p=minP;p<=Math.min(maxP,samples.length/2);p++){
    let corr=0;
    for(let i=0;i<samples.length-p;i++) corr+=samples[i]*samples[i+p];
    if(corr>bestCorr){bestCorr=corr;bestPeriod=p;}
  }
  return bestCorr>0.2 ? bestPeriod : 0;
}

// ── Cross Correlation ─────────────────────────────────────────────────────────

function crossCorrelate(
  a:      Float32Array,
  b:      Float32Array,
  maxLag: number
): number {
  let bestLag=0, bestCorr=-Infinity;

  for(let lag=-maxLag;lag<=maxLag;lag++){
    let corr=0, norm=0;
    for(let i=0;i<a.length;i++){
      const j=i+lag;
      if(j>=0&&j<b.length){
        corr+=a[i]*b[j];
        norm+=a[i]**2+b[j]**2;
      }
    }
    const normCorr=norm>0 ? corr/(Math.sqrt(norm)+1e-10) : 0;
    if(normCorr>bestCorr){bestCorr=normCorr;bestLag=lag;}
  }
  return bestLag;
}

// ── Overlap-Add with Phase Correction ────────────────────────────────────────

function overlapAdd(
  output:   Float64Array,
  frame:    Float32Array,
  window:   Float32Array,
  position: number
): void {
  for(let i=0;i<frame.length&&position+i<output.length;i++){
    output[position+i]+=frame[i]*window[i];
  }
}

// ── WSOLA Core ────────────────────────────────────────────────────────────────

function wsolaChannel(
  input:       Float32Array,
  ratio:       number,
  sampleRate:  number,
  windowSize:  number,
  hopOut:      number,
  transientProtect: boolean,
  pitchStable: boolean
): Float32Array {
  const hopIn    = Math.round(hopOut/ratio);
  const maxLag   = Math.round(windowSize/4);
  const window   = hannWindow(windowSize);
  const outLen   = Math.round(input.length*ratio);
  const output   = new Float64Array(outLen+windowSize*2);
  const normBuf  = new Float64Array(outLen+windowSize*2);

  // Detect transients
  const transients = transientProtect
    ? detectTransients(input, windowSize, hopIn)
    : [];

  let inPos    = 0;
  let outPos   = 0;
  let prevFrame: Float32Array | null = null;

  while(inPos+windowSize<=input.length && outPos+windowSize<=output.length){
    // Current frame
    const frame=new Float32Array(windowSize);
    for(let i=0;i<windowSize;i++)
      frame[i]=input[Math.min(inPos+i,input.length-1)];

    // WSOLA: find best overlap position
    let bestShift=0;
    if(prevFrame!==null){
      // For transients, skip WSOLA search to preserve attack
      const frameIdx=Math.floor(inPos/hopIn);
      const isTransient=transientProtect && frameIdx<transients.length && transients[frameIdx];

      if(!isTransient){
        bestShift=crossCorrelate(
          prevFrame.subarray(hopOut,Math.min(hopOut+maxLag*2,prevFrame.length)),
          frame.subarray(0,Math.min(maxLag*2,frame.length)),
          maxLag
        );
      }
    }

    // Pitch-stabilized position
    if(pitchStable && inPos+windowSize<=input.length){
      const period=estimatePeriod(frame.subarray(0,Math.min(256,frame.length)),sampleRate);
      if(period>0){
        // Snap to nearest pitch period boundary
        const nearestPeriod=Math.round(bestShift/period)*period;
        if(Math.abs(nearestPeriod-bestShift)<period/2)
          bestShift=nearestPeriod;
      }
    }

    // Clamp shift
    const adjustedInPos=Math.max(0,Math.min(input.length-windowSize,inPos+bestShift));
    const adjustedFrame=new Float32Array(windowSize);
    for(let i=0;i<windowSize;i++)
      adjustedFrame[i]=input[Math.min(adjustedInPos+i,input.length-1)];

    // OLA with window
    overlapAdd(output, adjustedFrame, window, outPos);
    for(let i=0;i<windowSize&&outPos+i<normBuf.length;i++)
      normBuf[outPos+i]+=window[i]**2;

    prevFrame=adjustedFrame;
    inPos  +=hopIn;
    outPos +=hopOut;
  }

  // Normalize by overlap
  const result=new Float32Array(outLen);
  for(let i=0;i<outLen;i++){
    result[i]=normBuf[i]>0.001
      ? Math.max(-1,Math.min(1,output[i]/normBuf[i]))
      : 0;
  }
  return result;
}

// ── Region Stretch ────────────────────────────────────────────────────────────

export function stretchRegion(
  buffer:    AudioBuffer,
  startSec:  number,
  endSec:    number,
  targetSec: number,
  options:   StretchOptions = { ratio:1.0 }
): StretchResult {
  const startMs  = Date.now();
  const sr       = buffer.sampleRate;
  const startSmp = Math.round(startSec*sr);
  const endSmp   = Math.round(endSec*sr);
  const regionLen = endSmp-startSmp;
  const targetLen = Math.round(targetSec*sr);
  const ratio     = targetLen/regionLen;

  const validation = validateStretchRatio(ratio);
  const quality: StretchResult["quality"] =
    ratio>=0.80&&ratio<=1.25 ? "high" :
    ratio>=0.65&&ratio<=1.50 ? "medium" : "low";

  // Window + hop sizes based on ratio
  const windowMs  = options.windowSizeMs ?? (ratio<0.80||ratio>1.25 ? 40 : 25);
  const overlapMs = options.overlapMs    ?? 10;
  const windowSize = Math.round(windowMs/1000*sr);
  const hopOut    = Math.round(overlapMs/1000*sr);

  const numCh  = buffer.numberOfChannels;
  const totalLen = (buffer.length-regionLen)+targetLen;

  const ctx    = new OfflineAudioContext(numCh, Math.max(1,totalLen), sr);
  const outBuf = ctx.createBuffer(numCh, Math.max(1,totalLen), sr);

  for(let ch=0;ch<numCh;ch++){
    const src  = buffer.getChannelData(ch);
    const dest = outBuf.getChannelData(ch);

    // Copy pre-region
    for(let i=0;i<startSmp&&i<dest.length;i++) dest[i]=src[i];

    // Stretch region
    const region=src.slice(startSmp,endSmp);
    const stretched=wsolaChannel(
      region, ratio, sr, windowSize, hopOut,
      options.transientProtect ?? true,
      options.pitchStable      ?? true
    );

    // Copy stretched
    for(let i=0;i<targetLen&&startSmp+i<dest.length;i++)
      dest[startSmp+i]=i<stretched.length ? stretched[i] : 0;

    // Copy post-region
    const postStart=endSmp;
    const destPost =startSmp+targetLen;
    for(let i=0;i+postStart<src.length&&destPost+i<dest.length;i++)
      dest[destPost+i]=src[postStart+i];
  }

  return {
    buffer:  outBuf,
    ratio,
    warning: validation.warning,
    quality,
    processingMs: Date.now()-startMs,
  };
}

// ── Full Buffer Stretch ───────────────────────────────────────────────────────

export function stretchBuffer(
  buffer:  AudioBuffer,
  ratio:   number,
  options: Partial<StretchOptions> = {}
): StretchResult {
  return stretchRegion(
    buffer, 0, buffer.duration,
    buffer.duration*ratio,
    { ratio, ...options }
  );
}
