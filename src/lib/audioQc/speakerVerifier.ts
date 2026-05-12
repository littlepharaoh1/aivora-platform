/**
 * speakerVerifier.ts — Speaker Verification & Consistency Check
 * Aivora Audio QC Engine
 */

export interface SpeakerProfile {
  id:           string;
  fileName:     string;
  mfcc:         Float32Array;
  pitchMean:    number;
  pitchStd:     number;
  energyMean:   number;
  spectralCent: number;
  createdAt:    string;
}

export interface VerificationResult {
  similarity:   number;    // 0.0 – 1.0
  verdict:      "SAME_SPEAKER" | "LIKELY_SAME" | "UNCERTAIN" | "DIFFERENT_SPEAKER";
  confidence:   number;
  pitchMatch:   boolean;
  spectralMatch: boolean;
  warnings:     string[];
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2*Math.PI)/len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe=1, cIm=0;
      for (let j = 0; j < len>>1; j++) {
        const uRe=re[i+j],uIm=im[i+j];
        const vRe=re[i+j+len/2]*cRe-im[i+j+len/2]*cIm;
        const vIm=re[i+j+len/2]*cIm+im[i+j+len/2]*cRe;
        re[i+j]=uRe+vRe; im[i+j]=uIm+vIm;
        re[i+j+len/2]=uRe-vRe; im[i+j+len/2]=uIm-vIm;
        const nRe=cRe*wRe-cIm*wIm; cIm=cRe*wIm+cIm*wRe; cRe=nRe;
      }
    }
  }
}

// ── Mel Filterbank ────────────────────────────────────────────────────────────

function hzToMel(hz: number): number { return 2595 * Math.log10(1 + hz/700); }
function melToHz(mel: number): number { return 700 * (Math.pow(10, mel/2595) - 1); }

function melFilterbank(
  numFilters: number,
  fftSize:    number,
  sampleRate: number
): Float32Array[] {
  const lowMel  = hzToMel(80);
  const highMel = hzToMel(sampleRate/2);
  const melPoints = Array.from({length: numFilters+2}, (_,i) =>
    lowMel + (i * (highMel - lowMel)) / (numFilters+1)
  );
  const hzPoints  = melPoints.map(melToHz);
  const binPoints = hzPoints.map(hz => Math.round(hz * fftSize / sampleRate));
  const filters: Float32Array[] = [];

  for (let m = 1; m <= numFilters; m++) {
    const filter = new Float32Array(fftSize/2);
    for (let k = binPoints[m-1]; k < binPoints[m]; k++)
      filter[k] = (k - binPoints[m-1]) / (binPoints[m] - binPoints[m-1]);
    for (let k = binPoints[m]; k < binPoints[m+1]; k++)
      filter[k] = (binPoints[m+1] - k) / (binPoints[m+1] - binPoints[m]);
    filters.push(filter);
  }
  return filters;
}

// ── MFCC Extraction ───────────────────────────────────────────────────────────

function extractMFCC(
  mono:       Float32Array,
  sampleRate: number,
  numCoeffs = 13,
  fftSize   = 512,
  hopSize   = 256
): Float32Array {
  const filters  = melFilterbank(26, fftSize, sampleRate);
  const hannWin  = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++)
    hannWin[i] = 0.5 * (1 - Math.cos(2*Math.PI*i/(fftSize-1)));

  const allFrameMFCC: number[][] = [];

  for (let start = 0; start + fftSize <= mono.length; start += hopSize) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = mono[start+i] * hannWin[i];
    fft(re, im);

    const mag = new Float32Array(fftSize/2);
    for (let i = 0; i < fftSize/2; i++)
      mag[i] = Math.sqrt(re[i]*re[i]+im[i]*im[i]);

    // Apply mel filterbank
    const melEnergies = filters.map(f => {
      let e = 0;
      for (let i = 0; i < mag.length; i++) e += mag[i]*f[i];
      return Math.log(e + 1e-10);
    });

    // DCT
    const mfcc = new Array(numCoeffs).fill(0);
    for (let k = 0; k < numCoeffs; k++)
      for (let n = 0; n < melEnergies.length; n++)
        mfcc[k] += melEnergies[n] * Math.cos(Math.PI*k*(n+0.5)/melEnergies.length);

    allFrameMFCC.push(mfcc);
  }

  if (allFrameMFCC.length === 0) return new Float32Array(numCoeffs);

  // Average MFCC across frames
  const avg = new Float32Array(numCoeffs);
  for (const frame of allFrameMFCC)
    for (let i = 0; i < numCoeffs; i++) avg[i] += frame[i];
  for (let i = 0; i < numCoeffs; i++) avg[i] /= allFrameMFCC.length;

  return avg;
}

// ── Pitch Stats ───────────────────────────────────────────────────────────────

function extractPitchStats(
  mono:       Float32Array,
  sampleRate: number
): { mean: number; std: number } {
  const frameSize  = Math.round(0.02 * sampleRate);
  const hopSize    = Math.round(0.01 * sampleRate);
  const minPeriod  = Math.round(sampleRate / 400);
  const maxPeriod  = Math.round(sampleRate / 60);
  const pitches: number[] = [];

  for (let i = 0; i + frameSize <= mono.length; i += hopSize) {
    let bestCorr = 0, bestPeriod = 0;
    for (let p = minPeriod; p <= Math.min(maxPeriod, frameSize/2); p++) {
      let corr = 0;
      for (let j = 0; j < frameSize-p; j++) corr += mono[i+j]*mono[i+j+p];
      if (corr > bestCorr) { bestCorr = corr; bestPeriod = p; }
    }
    if (bestPeriod > 0 && bestCorr > 0.3) pitches.push(sampleRate/bestPeriod);
  }

  if (pitches.length === 0) return { mean: 0, std: 0 };
  const mean = pitches.reduce((s,v) => s+v, 0) / pitches.length;
  const std  = Math.sqrt(pitches.reduce((s,v) => s+(v-mean)**2, 0) / pitches.length);
  return { mean, std };
}

// ── Cosine Similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot=0, magA=0, magB=0;
  for (let i = 0; i < Math.min(a.length,b.length); i++) {
    dot  += a[i]*b[i];
    magA += a[i]*a[i];
    magB += b[i]*b[i];
  }
  const denom = Math.sqrt(magA)*Math.sqrt(magB);
  return denom > 0 ? dot/denom : 0;
}

// ── Public Interface ──────────────────────────────────────────────────────────

export function extractSpeakerProfile(
  buffer:   AudioBuffer,
  fileName: string
): SpeakerProfile {
  const sr   = buffer.sampleRate;
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  const mfcc   = extractMFCC(mono, sr);
  const pitch  = extractPitchStats(mono, sr);
  const energy = Math.sqrt(mono.reduce((s,v) => s+v*v, 0) / mono.length);

  // Spectral centroid
  const fftSize = 512;
  const re = new Float64Array(Math.min(fftSize, mono.length));
  const im = new Float64Array(Math.min(fftSize, mono.length));
  for (let i = 0; i < re.length; i++) re[i] = mono[i];
  fft(re, im);
  let num=0, den=0;
  const binHz = sr / fftSize;
  for (let i = 0; i < re.length/2; i++) {
    const mag = Math.sqrt(re[i]*re[i]+im[i]*im[i]);
    num += i*binHz*mag; den += mag;
  }
  const spectralCent = den > 0 ? num/den : 0;

  return {
    id:          `${fileName}_${Date.now()}`,
    fileName,
    mfcc,
    pitchMean:   pitch.mean,
    pitchStd:    pitch.std,
    energyMean:  energy,
    spectralCent,
    createdAt:   new Date().toISOString(),
  };
}

export function verifySpeaker(
  profileA: SpeakerProfile,
  profileB: SpeakerProfile
): VerificationResult {
  const warnings: string[] = [];

  // MFCC cosine similarity (primary feature)
  const mfccSim = cosineSimilarity(profileA.mfcc, profileB.mfcc);

  // Pitch similarity
  const pitchDiff = Math.abs(profileA.pitchMean - profileB.pitchMean);
  const pitchMatch = pitchDiff < 30; // within 30Hz

  // Spectral centroid similarity
  const spectralDiff = Math.abs(profileA.spectralCent - profileB.spectralCent);
  const spectralMatch = spectralDiff < 500; // within 500Hz

  // Combined similarity score
  const pitchScore    = pitchMatch ? 1.0 : Math.max(0, 1 - pitchDiff/100);
  const spectralScore = spectralMatch ? 1.0 : Math.max(0, 1 - spectralDiff/2000);
  const similarity    = mfccSim*0.6 + pitchScore*0.25 + spectralScore*0.15;

  // Verdict
  const verdict: VerificationResult["verdict"] =
    similarity > 0.90 ? "SAME_SPEAKER"       :
    similarity > 0.75 ? "LIKELY_SAME"         :
    similarity > 0.55 ? "UNCERTAIN"           : "DIFFERENT_SPEAKER";

  if (verdict === "DIFFERENT_SPEAKER")
    warnings.push(`Speaker mismatch detected (similarity: ${(similarity*100).toFixed(1)}%)`);
  if (verdict === "UNCERTAIN")
    warnings.push(`Speaker consistency uncertain (similarity: ${(similarity*100).toFixed(1)}%)`);

  return {
    similarity,
    verdict,
    confidence: Math.abs(similarity - 0.75) * 4,
    pitchMatch,
    spectralMatch,
    warnings,
  };
}
