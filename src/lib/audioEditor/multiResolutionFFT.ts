/**
 * multiResolutionFFT.ts — Multi-Resolution FFT System
 * Aivora Audio Infrastructure Platform
 *
 * Implements simultaneous analysis at 3 resolutions:
 * - Short FFT  (256)  — transient precision, 5ms time resolution
 * - Medium FFT (1024) — speech clarity, 21ms time resolution
 * - Large FFT  (4096) — forensic frequency precision, 85ms
 *
 * Scale support: Linear, Mel, Bark, Log
 * Window functions: Hann, Hamming, Blackman, Kaiser
 *
 * References:
 * - Traunmüller (1990) "Analytical expressions for the tonotopic sensory scale"
 * - O'Shaughnessy (1987) "Speech Communication" — Mel scale
 * - Harris (1978) "On the use of windows for harmonic analysis"
 */

// ── Cooley-Tukey Radix-2 FFT ──────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i=1,j=0;i<n;i++) {
    let bit=n>>1;
    for(;j&bit;bit>>=1) j^=bit;
    j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1) {
    const ang=-2*Math.PI/len, wR=Math.cos(ang), wI=Math.sin(ang);
    for(let i=0;i<n;i+=len) {
      let cR=1,cI=0;
      for(let j=0;j<len>>1;j++) {
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

// ── Window Functions ──────────────────────────────────────────────────────────

export type WindowType = "hann" | "hamming" | "blackman" | "kaiser" | "blackman-harris";

export function buildWindow(size: number, type: WindowType, alpha = 3.0): Float64Array {
  const w = new Float64Array(size);
  const N = size - 1;

  switch (type) {
    case "hann":
      for (let i=0;i<size;i++) w[i] = 0.5*(1-Math.cos(2*Math.PI*i/N));
      break;
    case "hamming":
      for (let i=0;i<size;i++) w[i] = 0.54-0.46*Math.cos(2*Math.PI*i/N);
      break;
    case "blackman":
      for (let i=0;i<size;i++)
        w[i] = 0.42-0.5*Math.cos(2*Math.PI*i/N)+0.08*Math.cos(4*Math.PI*i/N);
      break;
    case "blackman-harris":
      for (let i=0;i<size;i++)
        w[i] = 0.35875-0.48829*Math.cos(2*Math.PI*i/N)
              +0.14128*Math.cos(4*Math.PI*i/N)
              -0.01168*Math.cos(6*Math.PI*i/N);
      break;
    case "kaiser": {
      // Kaiser window using I0 Bessel function approximation
      const piAlpha = Math.PI * alpha;
      const i0denom = besselI0(piAlpha);
      for (let i=0;i<size;i++) {
        const x = 2*i/N - 1;
        w[i] = besselI0(piAlpha*Math.sqrt(1-x*x)) / i0denom;
      }
      break;
    }
    default:
      w.fill(1.0);
  }
  return w;
}

function besselI0(x: number): number {
  // Modified Bessel function I0 via polynomial approximation
  let sum = 1.0, term = 1.0;
  const half = x / 2;
  for (let k=1;k<=20;k++) {
    term *= (half/k)**2;
    sum  += term;
    if (term < 1e-12) break;
  }
  return sum;
}

// ── Frequency Scale Conversions ───────────────────────────────────────────────

export type FrequencyScale = "linear" | "mel" | "bark" | "log";

// Mel scale: O'Shaughnessy (1987)
export function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}
export function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

// Bark scale: Traunmüller (1990)
// z = 26.81 * f / (1960 + f) - 0.53
export function hzToBark(hz: number): number {
  return 26.81 * hz / (1960 + hz) - 0.53;
}
export function barkToHz(bark: number): number {
  const b = bark + 0.53;
  return 1960 * b / (26.28 - b);
}

// Log scale
export function hzToLog(hz: number, minHz = 20): number {
  return Math.log2(hz / minHz);
}

export function mapBinsToScale(
  magnitudes: Float32Array,
  sr:         number,
  fftSize:    number,
  scale:      FrequencyScale,
  numBands:   number
): Float32Array {
  const numBins = fftSize / 2;
  const output  = new Float32Array(numBands);
  const minHz   = 20, maxHz = sr / 2;

  let scaleMin: number, scaleMax: number;
  let toScale: (hz: number) => number;

  switch (scale) {
    case "mel":
      scaleMin = hzToMel(minHz); scaleMax = hzToMel(maxHz);
      toScale  = hzToMel; break;
    case "bark":
      scaleMin = hzToBark(minHz); scaleMax = hzToBark(maxHz);
      toScale  = hzToBark; break;
    case "log":
      scaleMin = hzToLog(minHz); scaleMax = hzToLog(maxHz);
      toScale  = (hz) => hzToLog(hz, minHz); break;
    default:
      scaleMin = minHz; scaleMax = maxHz;
      toScale  = (hz) => hz; break;
  }

  const scaleRange = scaleMax - scaleMin;
  const binCounts  = new Uint32Array(numBands);

  for (let k = 1; k < numBins; k++) {
    const hz  = k * sr / fftSize;
    const sc  = toScale(hz);
    const idx = Math.floor((sc - scaleMin) / scaleRange * numBands);
    if (idx >= 0 && idx < numBands) {
      output[idx] += magnitudes[k];
      binCounts[idx]++;
    }
  }

  // Average per band
  for (let b = 0; b < numBands; b++) {
    if (binCounts[b] > 0) output[b] /= binCounts[b];
  }
  return output;
}

// ── Single FFT Frame Analysis ─────────────────────────────────────────────────

export interface FFTFrame {
  magnitudes:  Float32Array;   // linear magnitude per bin
  phases:      Float32Array;   // phase per bin (radians)
  powerDb:     Float32Array;   // power in dB per bin
  centroid:    number;         // spectral centroid (Hz)
  flatness:    number;         // 0-1
  rolloff:     number;         // 85% rolloff Hz
  entropy:     number;         // 0-1 spectral entropy
  rmsDb:       number;
  fftSize:     number;
  sr:          number;
}

export function analyzeFrame(
  data:    Float32Array | Float64Array,
  offset:  number,
  fftSize: number,
  sr:      number,
  window:  Float64Array
): FFTFrame {
  const numBins = fftSize / 2;
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let i = 0; i < fftSize; i++) {
    re[i] = (data[offset + i] ?? 0) * window[i];
  }
  fft(re, im);

  const magnitudes = new Float32Array(numBins);
  const phases     = new Float32Array(numBins);
  const powerDb    = new Float32Array(numBins);
  let totalMag = 0, rmsSum = 0;

  for (let k = 0; k < numBins; k++) {
    const mag = Math.sqrt(re[k]**2 + im[k]**2);
    magnitudes[k] = mag;
    phases[k]     = Math.atan2(im[k], re[k]);
    powerDb[k]    = mag > 0 ? 20*Math.log10(mag/fftSize) : -120;
    totalMag     += mag;
    rmsSum       += mag**2;
  }

  // Spectral centroid
  let weightedSum = 0;
  for (let k=0;k<numBins;k++) weightedSum += (k*sr/fftSize)*magnitudes[k];
  const centroid = totalMag > 0 ? weightedSum/totalMag : 0;

  // Spectral flatness
  let logSum = 0;
  for (let k=1;k<numBins;k++) logSum += Math.log(magnitudes[k]+1e-10);
  const geomMean  = Math.exp(logSum/numBins);
  const arithMean = totalMag/numBins;
  const flatness  = arithMean > 0 ? Math.min(1, geomMean/arithMean) : 0;

  // Spectral rolloff (85%)
  const target = totalMag * 0.85;
  let cumsum = 0, rolloff = 0;
  for (let k=0;k<numBins;k++) {
    cumsum += magnitudes[k];
    if (cumsum >= target) { rolloff = k*sr/fftSize; break; }
  }

  // Spectral entropy
  let entropy = 0;
  for (let k=0;k<numBins;k++) {
    const p = totalMag > 0 ? magnitudes[k]/totalMag : 0;
    if (p > 0) entropy -= p*Math.log2(p);
  }
  entropy = Math.min(1, entropy/Math.log2(numBins));

  const rmsDb = rmsSum > 0 ? 10*Math.log10(rmsSum/numBins) : -120;

  return { magnitudes, phases, powerDb, centroid, flatness, rolloff,
    entropy, rmsDb, fftSize, sr };
}

// ── Multi-Resolution Analysis ─────────────────────────────────────────────────

export interface MultiResFrame {
  timeSec:  number;
  short:    FFTFrame;   // 256  — transient precision
  medium:   FFTFrame;   // 1024 — speech clarity
  large:    FFTFrame;   // 4096 — forensic precision
  // Fused analysis
  dominantHz:     number;
  isTransient:    boolean;
  isSpeech:       boolean;
  noiseFloorDb:   number;
}

export interface MultiResAnalysis {
  frames:      MultiResFrame[];
  sampleRate:  number;
  durationSec: number;
  summary: {
    transientFrames:  number;
    speechFrames:     number;
    noiseFrames:      number;
    avgNoiseFloorDb:  number;
    avgCentroid:      number;
    dynamicRange:     number;
  };
}

export function analyzeMultiResolution(
  data:       Float32Array,
  sr:         number,
  windowType: WindowType = "hann",
  hopMs:      number = 10
): MultiResAnalysis {
  const FFT_SHORT  = 256;
  const FFT_MEDIUM = 1024;
  const FFT_LARGE  = 4096;
  const hopSize    = Math.floor(hopMs * sr / 1000);

  const winShort  = buildWindow(FFT_SHORT,  windowType);
  const winMedium = buildWindow(FFT_MEDIUM, windowType);
  const winLarge  = buildWindow(FFT_LARGE,  windowType);

  const frames: MultiResFrame[] = [];
  let   transientCount = 0, speechCount = 0, noiseCount = 0;
  let   noiseFloorSum = 0, centroidSum = 0;
  let   minRms = Infinity, maxRms = -Infinity;

  // Use large FFT as the stride reference
  for (let start = 0; start + FFT_LARGE <= data.length; start += hopSize) {
    // Center alignment for smaller FFTs
    const midShort  = start + (FFT_LARGE - FFT_SHORT)  / 2;
    const midMedium = start + (FFT_LARGE - FFT_MEDIUM) / 2;

    const short  = analyzeFrame(data, Math.floor(midShort),  FFT_SHORT,  sr, winShort);
    const medium = analyzeFrame(data, Math.floor(midMedium), FFT_MEDIUM, sr, winMedium);
    const large  = analyzeFrame(data, start,                 FFT_LARGE,  sr, winLarge);

    // Fused features
    const dominantBin = large.magnitudes.indexOf(
      Math.max(...Array.from(large.magnitudes))
    );
    const dominantHz = dominantBin * sr / FFT_LARGE;

    // Transient: short FFT centroid >> medium (sudden high-freq energy)
    const isTransient = short.centroid > medium.centroid * 1.5
                     && short.rmsDb    > medium.rmsDb + 3;

    // Speech: 80-3000 Hz dominant, entropy 0.3-0.7
    const isSpeech = dominantHz > 80 && dominantHz < 3000
                  && large.entropy > 0.25 && large.entropy < 0.75
                  && large.rmsDb > -50;

    // Noise floor estimate from large FFT lowest percentile
    const sortedDb = Array.from(large.powerDb).sort((a,b)=>a-b);
    const noiseFloorDb = sortedDb[Math.floor(sortedDb.length * 0.1)];

    frames.push({
      timeSec: start / sr,
      short, medium, large,
      dominantHz, isTransient, isSpeech, noiseFloorDb,
    });

    if (isTransient) transientCount++;
    else if (isSpeech) speechCount++;
    else noiseCount++;
    noiseFloorSum += noiseFloorDb;
    centroidSum   += large.centroid;
    if (large.rmsDb > maxRms) maxRms = large.rmsDb;
    if (large.rmsDb < minRms && large.rmsDb > -120) minRms = large.rmsDb;
  }

  const n = Math.max(1, frames.length);
  return {
    frames,
    sampleRate:  sr,
    durationSec: data.length / sr,
    summary: {
      transientFrames:  transientCount,
      speechFrames:     speechCount,
      noiseFrames:      noiseCount,
      avgNoiseFloorDb:  noiseFloorSum / n,
      avgCentroid:      centroidSum   / n,
      dynamicRange:     maxRms - minRms,
    },
  };
}

// ── Formant Detection ─────────────────────────────────────────────────────────
// LPC-based formant estimation for vowel analysis
// Reference: Markel & Gray (1976) "Linear Prediction of Speech"

export interface FormantResult {
  f1: number;   // Hz — first formant (vowel height)
  f2: number;   // Hz — second formant (vowel frontness)
  f3: number;   // Hz — third formant (voice quality)
  f4: number;   // Hz — fourth formant
  confidence: number;  // 0-1
}

export function detectFormants(
  data:  Float32Array,
  sr:    number,
  order: number = 12   // LPC order (typically 2 + sr/1000)
): FormantResult[] {
  const frameLen  = Math.floor(0.025 * sr); // 25ms frames
  const hopLen    = Math.floor(0.010 * sr); // 10ms hop
  const results:  FormantResult[] = [];

  const win = buildWindow(frameLen, "hamming");

  for (let start = 0; start + frameLen <= data.length; start += hopLen) {
    // Apply window
    const frame = new Float64Array(frameLen);
    for (let i=0;i<frameLen;i++) frame[i] = data[start+i] * win[i];

    // LPC via autocorrelation method (Levinson-Durbin)
    const lpc = computeLPC(frame, order);
    if (!lpc) continue;

    // Find roots of LPC polynomial → formant frequencies
    const formants = lpcToFormants(lpc, sr);
    if (formants.length >= 4) {
      results.push({
        f1: formants[0], f2: formants[1],
        f3: formants[2], f4: formants[3],
        confidence: 0.8,
      });
    }
  }
  return results;
}

function computeLPC(frame: Float64Array, order: number): Float64Array | null {
  const n = frame.length;

  // Autocorrelation
  const r = new Float64Array(order + 1);
  for (let lag=0;lag<=order;lag++) {
    let sum = 0;
    for (let i=0;i<n-lag;i++) sum += frame[i]*frame[i+lag];
    r[lag] = sum;
  }
  if (r[0] < 1e-10) return null;

  // Levinson-Durbin recursion
  const a   = new Float64Array(order + 1);
  const tmp = new Float64Array(order + 1);
  a[0] = 1.0;
  let E = r[0];

  for (let m=1;m<=order;m++) {
    let lambda = 0;
    for (let j=1;j<=m;j++) lambda -= a[j]*r[m-j];
    lambda /= E;

    for (let j=0;j<=m;j++) tmp[j] = a[j] + lambda*a[m-j];
    for (let j=0;j<=m;j++) a[j] = tmp[j];
    E *= (1 - lambda*lambda);
    if (E < 1e-10) break;
  }
  return a;
}

function lpcToFormants(lpc: Float64Array, sr: number): number[] {
  // Find roots of LPC polynomial using companion matrix eigenvalues
  // Simplified: use angle of complex roots
  const order = lpc.length - 1;
  const formants: number[] = [];

  // Root finding via Durand-Kerner method (simplified)
  // For production: would use full companion matrix eigen-decomposition
  // Here: extract peaks from LPC frequency response as formant proxy
  const fftSize = 512;
  const H = new Float64Array(fftSize/2);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  re[0] = 1.0;
  for (let k=1;k<=order && k<fftSize;k++) re[k] = lpc[k];
  fft(re, im);

  // LPC spectrum = 1/|A(z)|^2
  for (let k=0;k<fftSize/2;k++) {
    const mag = Math.sqrt(re[k]**2+im[k]**2);
    H[k] = mag > 1e-10 ? 1/mag : 0;
  }

  // Find peaks in LPC spectrum
  for (let k=2;k<fftSize/2-2;k++) {
    if (H[k]>H[k-1]&&H[k]>H[k-2]&&H[k]>H[k+1]&&H[k]>H[k+2]) {
      const hz = k*sr/fftSize;
      if (hz > 200 && hz < 4000) formants.push(hz);
      if (formants.length >= 4) break;
    }
  }

  return formants.sort((a,b)=>a-b);
}

// ── Bark Scale Filter Bank ────────────────────────────────────────────────────
// 24 critical bands per Bark scale for psychoacoustic analysis

export function computeBarkFilterBank(
  magnitudes: Float32Array,
  sr:         number,
  fftSize:    number
): Float32Array {
  const NUM_BARK_BANDS = 24;
  const output = new Float32Array(NUM_BARK_BANDS);
  const counts = new Uint32Array(NUM_BARK_BANDS);
  const numBins = fftSize / 2;

  const maxBark = hzToBark(sr / 2);

  for (let k = 1; k < numBins; k++) {
    const hz   = k * sr / fftSize;
    const bark = hzToBark(hz);
    const band = Math.floor(bark / maxBark * NUM_BARK_BANDS);
    if (band >= 0 && band < NUM_BARK_BANDS) {
      output[band] += magnitudes[k];
      counts[band]++;
    }
  }

  for (let b = 0; b < NUM_BARK_BANDS; b++) {
    if (counts[b] > 0) output[b] /= counts[b];
  }
  return output;
}
