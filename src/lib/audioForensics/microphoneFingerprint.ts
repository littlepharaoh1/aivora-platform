/**
 * microphoneFingerprint.ts — Microphone Acoustic Fingerprinting
 * Aivora Audio Infrastructure Platform
 *
 * Extracts acoustic signature of recording device from audio:
 * - Frequency response fingerprint (mic coloration)
 * - Self-noise floor profile (thermal noise signature)
 * - Non-linearity signature (harmonic distortion pattern)
 * - Resonance peaks (physical resonance of mic capsule)
 * - High-frequency rolloff curve (capsule bandwidth)
 *
 * Applications:
 * - Device verification (same mic across sessions)
 * - Cloned audio detection (mic mismatch)
 * - Dataset provenance validation
 * - Forensic speaker authentication support
 *
 * Reference:
 * - Esquef et al. (2011) microphone identification
 * - Kraetzer et al. (2007) audio source identification
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MicFingerprint {
  readonly frequencyResponse: Float32Array;  // normalized 0-1 per band
  readonly noiseFloor:        Float32Array;  // dB per band
  readonly resonancePeaks:    ResonancePeak[];
  readonly rolloffHz:         number;        // -3dB high-freq rolloff
  readonly noiseColorSlope:   number;        // dB/octave noise slope
  readonly overallSignature:  Float32Array;  // compact 32-dim signature
}

export interface ResonancePeak {
  freqHz:    number;
  magnitudeDb: number;
  qFactor:   number;    // sharpness of peak
}

export interface FingerprintMatch {
  similarity:  number;   // 0-1 cosine similarity
  isMatch:     boolean;  // > threshold
  confidence:  number;
  freqMatch:   number;   // frequency response similarity
  noiseMatch:  number;   // noise floor similarity
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NUM_BANDS     = 32;
const FFT_SIZE      = 8192;   // high resolution for fingerprinting
const HOP_SIZE      = FFT_SIZE / 2;
const MATCH_THRESH  = 0.85;

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

// ── Mel-spaced Band Centers ───────────────────────────────────────────────────

function getMelBandEdges(numBands: number, sr: number): number[] {
  const fMin = 20, fMax = sr/2;
  const mMin = 2595*Math.log10(1+fMin/700);
  const mMax = 2595*Math.log10(1+fMax/700);
  const edges: number[] = [];
  for(let i=0;i<=numBands+1;i++){
    const m  = mMin + (mMax-mMin)*i/(numBands+1);
    edges.push(700*(Math.pow(10,m/2595)-1));
  }
  return edges;
}

// ── Average Spectrum ──────────────────────────────────────────────────────────

function computeAverageSpectrum(
  data: Float32Array,
  sr:   number
): Float64Array {
  const win = new Float64Array(FFT_SIZE);
  for(let i=0;i<FFT_SIZE;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(FFT_SIZE-1)));

  const avgSpec = new Float64Array(FFT_SIZE/2);
  let   count   = 0;

  for(let s=0;s+FFT_SIZE<=data.length;s+=HOP_SIZE){
    const re=new Float64Array(FFT_SIZE), im=new Float64Array(FFT_SIZE);
    for(let i=0;i<FFT_SIZE;i++) re[i]=data[s+i]*win[i];
    fft(re,im);
    for(let k=0;k<FFT_SIZE/2;k++)
      avgSpec[k]+=Math.sqrt(re[k]**2+im[k]**2);
    count++;
  }

  if(count>0) for(let k=0;k<avgSpec.length;k++) avgSpec[k]/=count;
  return avgSpec;
}

// ── Frequency Response Fingerprint ───────────────────────────────────────────

function extractFrequencyResponse(
  spectrum: Float64Array,
  sr:       number
): Float32Array {
  const edges    = getMelBandEdges(NUM_BANDS, sr);
  const response = new Float32Array(NUM_BANDS);
  const nBins    = spectrum.length;

  for(let b=0;b<NUM_BANDS;b++){
    const fLow  = edges[b];
    const fHigh = edges[b+1];
    const kLow  = Math.floor(fLow  /(sr/2)*nBins);
    const kHigh = Math.ceil (fHigh /(sr/2)*nBins);

    let   energy=0, count=0;
    for(let k=Math.max(1,kLow);k<Math.min(nBins,kHigh);k++){
      energy+=spectrum[k]; count++;
    }
    response[b]=count>0 ? energy/count : 0;
  }

  // Normalize to 0-1
  const maxR=response.reduce((m,v)=>Math.max(m,v),0);
  if(maxR>0) for(let b=0;b<NUM_BANDS;b++) response[b]/=maxR;

  return response;
}

// ── Noise Floor Profile ───────────────────────────────────────────────────────

function extractNoiseFloor(
  data:     Float32Array,
  sr:       number,
  spectrum: Float64Array
): Float32Array {
  const edges    = getMelBandEdges(NUM_BANDS, sr);
  const floor    = new Float32Array(NUM_BANDS);
  const nBins    = spectrum.length;

  for(let b=0;b<NUM_BANDS;b++){
    const fLow  = edges[b];
    const fHigh = edges[b+1];
    const kLow  = Math.floor(fLow  /(sr/2)*nBins);
    const kHigh = Math.ceil (fHigh /(sr/2)*nBins);

    const vals: number[]=[];
    for(let k=Math.max(1,kLow);k<Math.min(nBins,kHigh);k++)
      if(spectrum[k]>0) vals.push(20*Math.log10(spectrum[k]));

    if(vals.length>0){
      vals.sort((a,b)=>a-b);
      floor[b]=vals[Math.floor(vals.length*0.1)]; // 10th percentile = noise floor
    } else {
      floor[b]=-120;
    }
  }

  return floor;
}

// ── Resonance Peak Detection ──────────────────────────────────────────────────

function detectResonancePeaks(
  spectrum: Float64Array,
  sr:       number
): ResonancePeak[] {
  const peaks:   ResonancePeak[] = [];
  const nBins    = spectrum.length;
  const logSpec  = new Float64Array(nBins);

  for(let k=1;k<nBins;k++)
    logSpec[k]=spectrum[k]>0?20*Math.log10(spectrum[k]):-120;

  // Find local maxima in smoothed log spectrum
  const smooth=new Float64Array(nBins);
  const half=5;
  for(let k=half;k<nBins-half;k++){
    let s=0; for(let j=-half;j<=half;j++) s+=logSpec[k+j]; smooth[k]=s/(2*half+1);
  }

  for(let k=half+1;k<nBins-half-1;k++){
    if(smooth[k]>smooth[k-1]&&smooth[k]>smooth[k+1]&&smooth[k]>-60){
      const freqHz=k*sr/(2*nBins);
      const mag=smooth[k];

      // Q factor: peak width at -3dB
      let qLow=k, qHigh=k;
      const target=mag-3;
      while(qLow>0  && smooth[qLow]>target)  qLow--;
      while(qHigh<nBins-1 && smooth[qHigh]>target) qHigh++;
      const bwHz=(qHigh-qLow)*sr/(2*nBins);
      const q=bwHz>0?freqHz/bwHz:1;

      if(freqHz>100&&freqHz<sr/2*0.9&&peaks.length<10){
        peaks.push({ freqHz, magnitudeDb:Math.round(mag*10)/10, qFactor:Math.round(q*10)/10 });
      }
    }
  }

  return peaks.sort((a,b)=>b.magnitudeDb-a.magnitudeDb).slice(0,6);
}

// ── High-Freq Rolloff ─────────────────────────────────────────────────────────

function detectRolloff(spectrum: Float64Array, sr: number): number {
  const nBins  = spectrum.length;
  let   maxMag = 0;
  for(let k=0;k<nBins;k++) if(spectrum[k]>maxMag) maxMag=spectrum[k];
  const thresh = maxMag * 0.707; // -3dB

  for(let k=nBins-1;k>0;k--)
    if(spectrum[k]>=thresh) return Math.round(k*sr/(2*nBins));

  return sr/2;
}

// ── Noise Color Slope ─────────────────────────────────────────────────────────

function computeNoiseSlope(floor: Float32Array): number {
  const n=floor.length;
  let   sumX=0,sumY=0,sumXY=0,sumX2=0;
  for(let i=0;i<n;i++){
    sumX+=i; sumY+=floor[i]; sumXY+=i*floor[i]; sumX2+=i*i;
  }
  const denom=n*sumX2-sumX*sumX;
  return denom!==0?(n*sumXY-sumX*sumY)/denom:0;
}

// ── Compact Signature ─────────────────────────────────────────────────────────

function buildSignature(
  freqResp: Float32Array,
  noiseFlr: Float32Array
): Float32Array {
  const sig=new Float32Array(32);
  // First 16: frequency response
  for(let i=0;i<16;i++) sig[i]=freqResp[Math.floor(i*NUM_BANDS/16)];
  // Last 16: noise floor (normalized)
  const minF=noiseFlr.reduce((m,v)=>Math.min(m,v),0);
  const maxF=noiseFlr.reduce((m,v)=>Math.max(m,v),-120);
  const range=maxF-minF+1e-10;
  for(let i=0;i<16;i++) sig[16+i]=(noiseFlr[Math.floor(i*NUM_BANDS/16)]-minF)/range;
  return sig;
}

// ── Main API ──────────────────────────────────────────────────────────────────

export function extractMicFingerprint(
  data: Float32Array,
  sr:   number
): MicFingerprint {
  const spectrum = computeAverageSpectrum(data, sr);
  const freqResp = extractFrequencyResponse(spectrum, sr);
  const noiseFlr = extractNoiseFloor(data, sr, spectrum);
  const resonance= detectResonancePeaks(spectrum, sr);
  const rolloffHz= detectRolloff(spectrum, sr);
  const noiseSlope=computeNoiseSlope(noiseFlr);
  const signature= buildSignature(freqResp, noiseFlr);

  return {
    frequencyResponse: freqResp,
    noiseFloor:        noiseFlr,
    resonancePeaks:    resonance,
    rolloffHz,
    noiseColorSlope:   Math.round(noiseSlope*100)/100,
    overallSignature:  signature,
  };
}

export function compareMicFingerprints(
  a: MicFingerprint,
  b: MicFingerprint
): FingerprintMatch {
  // Cosine similarity on compact signatures
  let dot=0, normA=0, normB=0;
  for(let i=0;i<32;i++){
    dot+=a.overallSignature[i]*b.overallSignature[i];
    normA+=a.overallSignature[i]**2;
    normB+=b.overallSignature[i]**2;
  }
  const similarity=Math.sqrt(normA*normB)>0?dot/Math.sqrt(normA*normB):0;

  // Frequency response match
  let freqDot=0,fnA=0,fnB=0;
  for(let i=0;i<NUM_BANDS;i++){
    freqDot+=a.frequencyResponse[i]*b.frequencyResponse[i];
    fnA+=a.frequencyResponse[i]**2; fnB+=b.frequencyResponse[i]**2;
  }
  const freqMatch=Math.sqrt(fnA*fnB)>0?freqDot/Math.sqrt(fnA*fnB):0;

  // Noise floor match
  let noiseDot=0,nnA=0,nnB=0;
  for(let i=0;i<NUM_BANDS;i++){
    const na=a.noiseFloor[i]+120, nb=b.noiseFloor[i]+120;
    noiseDot+=na*nb; nnA+=na**2; nnB+=nb**2;
  }
  const noiseMatch=Math.sqrt(nnA*nnB)>0?noiseDot/Math.sqrt(nnA*nnB):0;

  const confidence=Math.min(1,Math.abs(similarity-0.5)*2);

  return {
    similarity:  Math.round(similarity*1000)/1000,
    isMatch:     similarity>=MATCH_THRESH,
    confidence:  Math.round(confidence*1000)/1000,
    freqMatch:   Math.round(freqMatch*1000)/1000,
    noiseMatch:  Math.round(noiseMatch*1000)/1000,
  };
}
