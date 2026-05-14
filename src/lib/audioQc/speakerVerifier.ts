/**
 * speakerVerifier.ts — Advanced Speaker Verification
 * Delta MFCC + CMVN + Confidence Scoring
 * Aivora Platform — Phase 9
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpeakerEmbedding {
  mfcc:         Float32Array;
  deltaMfcc:    Float32Array;
  delta2Mfcc:   Float32Array;
  pitchMean:    number;
  pitchStd:     number;
  pitchRange:   number;
  energyMean:   number;
  energyStd:    number;
  spectralCent: number;
  spectralFlat: number;
  frameCount:   number;
  speechFrames: number;
  fileName:     string;
  createdAt:    string;
}

export interface VerificationResult {
  similarity:      number;
  verdict:         "SAME_SPEAKER"|"LIKELY_SAME"|"UNCERTAIN"|"DIFFERENT_SPEAKER";
  confidence:      number;
  mfccSim:         number;
  deltaSim:        number;
  pitchSim:        number;
  spectralSim:     number;
  pitchMatch:      boolean;
  spectralMatch:   boolean;
  suspiciousMatch: boolean;
  warnings:        string[];
}

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

// ── Mel Filterbank ────────────────────────────────────────────────────────────

function hzToMel(hz: number): number { return 2595*Math.log10(1+hz/700); }
function melToHz(mel: number): number { return 700*(Math.pow(10,mel/2595)-1); }

function melFilterbank(numFilters: number, fftSize: number, sr: number): Float32Array[] {
  const lowMel  = hzToMel(80);
  const highMel = hzToMel(sr/2);
  const pts     = Array.from({length:numFilters+2},(_,i)=>lowMel+i*(highMel-lowMel)/(numFilters+1));
  const hzPts   = pts.map(melToHz);
  const binPts  = hzPts.map(hz=>Math.round(hz*fftSize/sr));

  return Array.from({length:numFilters},(_,m)=>{
    const f=new Float32Array(fftSize/2);
    for(let k=binPts[m];k<binPts[m+1]&&k<f.length;k++)
      f[k]=(k-binPts[m])/(binPts[m+1]-binPts[m]+1e-10);
    for(let k=binPts[m+1];k<binPts[m+2]&&k<f.length;k++)
      f[k]=(binPts[m+2]-k)/(binPts[m+2]-binPts[m+1]+1e-10);
    return f;
  });
}

// ── MFCC Extraction ───────────────────────────────────────────────────────────

function extractFrameMFCC(
  samples:    Float32Array,
  sr:         number,
  filters:    Float32Array[],
  numCoeffs:  number,
  fftSize:    number
): Float32Array {
  const re=new Float64Array(fftSize);
  const im=new Float64Array(fftSize);
  const len=Math.min(fftSize,samples.length);
  for(let i=0;i<len;i++)
    re[i]=samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(len-1)));
  runFFT(re,im);

  const mag=new Float32Array(fftSize/2);
  for(let i=0;i<fftSize/2;i++) mag[i]=Math.sqrt(re[i]**2+im[i]**2);

  const mel=filters.map(f=>{
    let e=0;
    for(let i=0;i<mag.length;i++) e+=mag[i]*f[i];
    return Math.log(e+1e-10);
  });

  const mfcc=new Float32Array(numCoeffs);
  for(let k=0;k<numCoeffs;k++)
    for(let n=0;n<mel.length;n++)
      mfcc[k]+=mel[n]*Math.cos(Math.PI*k*(n+0.5)/mel.length);

  return mfcc;
}

// ── CMVN Normalization ────────────────────────────────────────────────────────

function applyCMVN(frames: Float32Array[]): Float32Array[] {
  if(frames.length===0) return frames;
  const numCoeffs=frames[0].length;

  // Compute mean and variance
  const mean=new Float32Array(numCoeffs);
  const variance=new Float32Array(numCoeffs);

  for(const frame of frames)
    for(let i=0;i<numCoeffs;i++) mean[i]+=frame[i];
  for(let i=0;i<numCoeffs;i++) mean[i]/=frames.length;

  for(const frame of frames)
    for(let i=0;i<numCoeffs;i++) variance[i]+=(frame[i]-mean[i])**2;
  for(let i=0;i<numCoeffs;i++) variance[i]=Math.sqrt(variance[i]/frames.length+1e-10);

  // Normalize
  return frames.map(frame=>{
    const norm=new Float32Array(numCoeffs);
    for(let i=0;i<numCoeffs;i++)
      norm[i]=(frame[i]-mean[i])/variance[i];
    return norm;
  });
}

// ── Delta Coefficients ────────────────────────────────────────────────────────

function computeDelta(frames: Float32Array[], window=2): Float32Array[] {
  const n=frames.length;
  if(n===0) return [];
  const numCoeffs=frames[0].length;
  const deltas: Float32Array[]=[];

  for(let i=0;i<n;i++){
    const delta=new Float32Array(numCoeffs);
    let denom=0;
    for(let t=1;t<=window;t++) denom+=2*t*t;

    for(let k=0;k<numCoeffs;k++){
      let num=0;
      for(let t=1;t<=window;t++){
        const fwd=i+t<n ? frames[i+t][k] : frames[n-1][k];
        const bwd=i-t>=0 ? frames[i-t][k] : frames[0][k];
        num+=t*(fwd-bwd);
      }
      delta[k]=denom>0 ? num/denom : 0;
    }
    deltas.push(delta);
  }
  return deltas;
}

// ── Average Frames ────────────────────────────────────────────────────────────

function averageFrames(frames: Float32Array[]): Float32Array {
  if(frames.length===0) return new Float32Array(0);
  const numCoeffs=frames[0].length;
  const avg=new Float32Array(numCoeffs);
  for(const f of frames)
    for(let i=0;i<numCoeffs;i++) avg[i]+=f[i];
  for(let i=0;i<numCoeffs;i++) avg[i]/=frames.length;
  return avg;
}

// ── Pitch Extraction ──────────────────────────────────────────────────────────

function extractPitchStats(mono: Float32Array, sr: number): {
  mean:number; std:number; range:number;
} {
  const frameSize=Math.round(0.02*sr);
  const hopSize=Math.round(0.01*sr);
  const minP=Math.round(sr/400);
  const maxP=Math.round(sr/60);
  const pitches: number[]=[];

  for(let i=0;i+frameSize<=mono.length;i+=hopSize){
    let bestCorr=0,bestPeriod=0;
    for(let p=minP;p<=Math.min(maxP,frameSize/2);p++){
      let corr=0;
      for(let j=0;j<frameSize-p;j++) corr+=mono[i+j]*mono[i+j+p];
      if(corr>bestCorr){bestCorr=corr;bestPeriod=p;}
    }
    if(bestPeriod>0&&bestCorr>0.25) pitches.push(sr/bestPeriod);
  }

  if(pitches.length===0) return {mean:0,std:0,range:0};
  const mean=pitches.reduce((s,v)=>s+v,0)/pitches.length;
  const std=Math.sqrt(pitches.reduce((s,v)=>s+(v-mean)**2,0)/pitches.length);
  const range=Math.max(...pitches)-Math.min(...pitches);
  return {mean,std,range};
}

// ── Cosine Similarity ─────────────────────────────────────────────────────────

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot=0,magA=0,magB=0;
  const len=Math.min(a.length,b.length);
  for(let i=0;i<len;i++){dot+=a[i]*b[i];magA+=a[i]**2;magB+=b[i]**2;}
  const denom=Math.sqrt(magA)*Math.sqrt(magB);
  return denom>0 ? Math.max(-1,Math.min(1,dot/denom)) : 0;
}

// ── Speaker Embedding Extractor ───────────────────────────────────────────────

export function extractSpeakerEmbedding(
  buffer:   AudioBuffer,
  fileName: string
): SpeakerEmbedding {
  const sr         = buffer.sampleRate;
  const NUM_COEFFS = 13;
  const NUM_FILTERS = 26;
  const FFT_SIZE   = 512;
  const HOP_SIZE   = 256;

  // Mono mix
  const mono=new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  const filters=melFilterbank(NUM_FILTERS,FFT_SIZE,sr);

  // VAD — speech frames only
  const frameSize=Math.round(0.02*sr);
  const energies: number[]=[];
  for(let i=0;i+frameSize<=mono.length;i+=HOP_SIZE){
    let e=0;
    for(let j=0;j<frameSize;j++) e+=mono[i+j]**2;
    energies.push(e/frameSize);
  }
  const sorted=[...energies].sort((a,b)=>a-b);
  const cut=Math.max(1,Math.floor(sorted.length*0.1));
  const noiseFloor=sorted.slice(0,cut).reduce((s,v)=>s+v,0)/cut;
  const thresh=noiseFloor*5;

  // Extract MFCC from speech frames
  const allFrames: Float32Array[]=[];
  let speechFrames=0;

  for(let i=0;i+FFT_SIZE<=mono.length;i+=HOP_SIZE){
    const frame=mono.subarray(i,i+FFT_SIZE);
    let e=0;
    for(let j=0;j<frame.length;j++) e+=frame[j]**2;
    e/=frame.length;

    if(e>thresh){
      speechFrames++;
      allFrames.push(extractFrameMFCC(frame,sr,filters,NUM_COEFFS,FFT_SIZE));
    }
  }

  // Apply CMVN normalization
  const normalized = applyCMVN(allFrames);

  // Delta + Delta-Delta
  const deltas  = computeDelta(normalized,2);
  const delta2s = computeDelta(deltas,2);

  // Average embeddings
  const mfcc      = averageFrames(normalized);
  const deltaMfcc = averageFrames(deltas);
  const delta2Mfcc = averageFrames(delta2s);

  // Pitch
  const pitch=extractPitchStats(mono,sr);

  // Energy stats
  const speechEnergies=energies.filter(e=>e>thresh);
  const energyMean=speechEnergies.length>0
    ? speechEnergies.reduce((s,v)=>s+v,0)/speechEnergies.length : 0;
  const energyStd=speechEnergies.length>1
    ? Math.sqrt(speechEnergies.reduce((s,v)=>s+(v-energyMean)**2,0)/speechEnergies.length) : 0;

  // Spectral features
  const fftSize2=512;
  const re=new Float64Array(fftSize2);
  const im=new Float64Array(fftSize2);
  const len=Math.min(fftSize2,mono.length);
  for(let i=0;i<len;i++) re[i]=mono[i];
  runFFT(re,im);
  const mag=new Float32Array(fftSize2/2);
  for(let i=0;i<fftSize2/2;i++) mag[i]=Math.sqrt(re[i]**2+im[i]**2);

  let num=0,den=0,logSum=0,linSum=0;
  const binHz=sr/fftSize2;
  for(let i=0;i<mag.length;i++){
    num+=i*binHz*mag[i]; den+=mag[i];
    logSum+=Math.log(mag[i]+1e-10); linSum+=mag[i];
  }
  const spectralCent=den>0?num/den:0;
  const spectralFlat=Math.exp(logSum/mag.length)/(linSum/mag.length+1e-10);

  return {
    mfcc,deltaMfcc,delta2Mfcc,
    pitchMean:pitch.mean,pitchStd:pitch.std,pitchRange:pitch.range,
    energyMean,energyStd,spectralCent,spectralFlat,
    frameCount:allFrames.length+energies.length-speechFrames,
    speechFrames,fileName,
    createdAt:new Date().toISOString(),
  };
}

// ── Speaker Verification ──────────────────────────────────────────────────────

export function verifySpeaker(
  a: SpeakerEmbedding,
  b: SpeakerEmbedding
): VerificationResult {
  const warnings: string[]=[];

  // MFCC cosine similarity (primary)
  const mfccSim  = a.mfcc.length>0&&b.mfcc.length>0
    ? (cosineSim(a.mfcc,b.mfcc)+1)/2 : 0.5;

  // Delta MFCC similarity
  const deltaSim = a.deltaMfcc.length>0&&b.deltaMfcc.length>0
    ? (cosineSim(a.deltaMfcc,b.deltaMfcc)+1)/2 : 0.5;

  // Delta-Delta similarity
  const delta2Sim = a.delta2Mfcc.length>0&&b.delta2Mfcc.length>0
    ? (cosineSim(a.delta2Mfcc,b.delta2Mfcc)+1)/2 : 0.5;

  // Pitch similarity
  const pitchDiff    = Math.abs(a.pitchMean-b.pitchMean);
  const pitchSim     = Math.max(0,1-pitchDiff/150);
  const pitchMatch   = pitchDiff<40;

  // Spectral similarity
  const centDiff     = Math.abs(a.spectralCent-b.spectralCent);
  const spectralSim  = Math.max(0,1-centDiff/2000);
  const spectralMatch = centDiff<600;

  // Weighted combination
  // MFCC 40% + Delta 25% + Delta2 15% + Pitch 12% + Spectral 8%
  const similarity =
    mfccSim  * 0.40 +
    deltaSim * 0.25 +
    delta2Sim * 0.15 +
    pitchSim * 0.12 +
    spectralSim * 0.08;

  // Confidence — how far from decision boundary (0.75)
  const confidence = Math.min(1, Math.abs(similarity-0.75)*4);

  // Suspicious match (too similar — possible duplicate recording)
  const suspiciousMatch = similarity > 0.97 && mfccSim > 0.98;

  const verdict: VerificationResult["verdict"] =
    similarity > 0.90 ? "SAME_SPEAKER"      :
    similarity > 0.75 ? "LIKELY_SAME"        :
    similarity > 0.55 ? "UNCERTAIN"          : "DIFFERENT_SPEAKER";

  if(verdict==="DIFFERENT_SPEAKER")
    warnings.push(`Speaker mismatch: ${(similarity*100).toFixed(1)}% similarity`);
  if(verdict==="UNCERTAIN")
    warnings.push(`Uncertain speaker match: ${(similarity*100).toFixed(1)}%`);
  if(suspiciousMatch)
    warnings.push("Suspicious: recordings may be identical or duplicated");
  if(!pitchMatch&&a.pitchMean>0&&b.pitchMean>0)
    warnings.push(`Pitch mismatch: ${a.pitchMean.toFixed(0)}Hz vs ${b.pitchMean.toFixed(0)}Hz`);

  return {
    similarity,verdict,confidence,
    mfccSim,deltaSim,pitchSim,spectralSim,
    pitchMatch,spectralMatch,suspiciousMatch,warnings,
  };
}
