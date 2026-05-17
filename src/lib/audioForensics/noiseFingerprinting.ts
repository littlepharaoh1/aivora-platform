/**
 * noiseFingerprinting.ts — Forensic Noise Classification Engine
 * Aivora Audio Infrastructure Platform
 *
 * Classifies noise types using spectral fingerprinting:
 * - HVAC hum: tonal peaks at 50/60Hz harmonics
 * - Broadband hiss: flat high-frequency spectral floor
 * - Electrical hum: 50/60Hz + odd harmonics
 * - Mic self-noise: flat spectrum below -60dBFS
 * - Room ambience: low-frequency reverberant tail
 * - AI artifacts: periodic spectral patterns, metallic resonances
 *
 * RT60 estimation via Schroeder backward integration
 * Reference: Schroeder (1965) "New method of measuring reverberation time"
 */

// ── FFT Utility ───────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i=1,j=0;i<n;i++) {
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1) {
    const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
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

function buildHann(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i=0;i<size;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(size-1)));
  return w;
}

function safeDb(x: number): number {
  return isFinite(x) && x > 0 ? 20*Math.log10(x) : -120;
}

// ── Noise Type Definitions ────────────────────────────────────────────────────

export type NoiseClass =
  | "hvac_hum"
  | "electrical_hum_50hz"
  | "electrical_hum_60hz"
  | "broadband_hiss"
  | "mic_self_noise"
  | "room_ambience"
  | "ai_artifact"
  | "clean"
  | "unknown";

export interface NoiseClassification {
  primary:       NoiseClass;
  confidence:    number;        // 0-1
  scores:        Record<NoiseClass, number>;  // 0-1 per class
  evidence:      string[];      // human-readable evidence
  dominantFreqs: number[];      // Hz
  noiseFloorDb:  number;
  spectralSlope: number;        // dB/octave (negative = pink/brown noise)
}

// ── Averaged Power Spectrum ───────────────────────────────────────────────────

function computeAveragedSpectrum(
  data:    Float32Array,
  sr:      number,
  fftSize: number = 4096,
  maxFrames: number = 50
): Float64Array {
  const numBins = fftSize / 2;
  const hop     = Math.floor(data.length / Math.min(maxFrames, 100));
  const win     = buildHann(fftSize);
  const accum   = new Float64Array(numBins);
  let   count   = 0;

  for (let start=0; start+fftSize<=data.length; start+=hop) {
    // Only use low-energy frames (silence/noise)
    let ms=0;
    for (let i=0;i<fftSize;i++) ms+=data[start+i]**2;
    if (ms/fftSize > 0.01) continue; // skip speech frames

    const re=new Float64Array(fftSize), im=new Float64Array(fftSize);
    for (let i=0;i<fftSize;i++) re[i]=data[start+i]*win[i];
    fft(re,im);
    for (let k=0;k<numBins;k++) accum[k]+=Math.sqrt(re[k]**2+im[k]**2);
    count++;
    if (count >= maxFrames) break;
  }

  if (count > 0) for (let k=0;k<numBins;k++) accum[k]/=count;
  return accum;
}

// ── Harmonic Series Detector ──────────────────────────────────────────────────
// Detects presence of harmonic series at fundamental frequency

function detectHarmonicSeries(
  spectrum: Float64Array,
  sr:       number,
  fftSize:  number,
  fundamentalHz: number,
  numHarmonics:  number = 6
): { energy: number; snr: number; present: boolean } {
  const numBins  = spectrum.length;
  const avgPower = spectrum.reduce((s,v)=>s+v,0)/numBins;

  let harmonicEnergy = 0;
  let count = 0;

  for (let h=1;h<=numHarmonics;h++) {
    const hz  = fundamentalHz * h;
    const bin = Math.round(hz * fftSize / sr);
    if (bin >= numBins) break;

    // Check peak in ±2 bins (freq resolution tolerance)
    let peakMag = 0;
    for (let b=Math.max(0,bin-2);b<=Math.min(numBins-1,bin+2);b++) {
      if (spectrum[b]>peakMag) peakMag=spectrum[b];
    }
    harmonicEnergy += peakMag;
    count++;
  }

  const avgHarmonicEnergy = count > 0 ? harmonicEnergy/count : 0;
  const snr = avgPower > 1e-12 ? avgHarmonicEnergy/avgPower : 0;

  return {
    energy:  avgHarmonicEnergy,
    snr,
    present: snr > 2.5, // harmonic energy 2.5x above noise floor
  };
}

// ── Spectral Slope ────────────────────────────────────────────────────────────
// Fit line to log-magnitude spectrum — negative = pink/brown noise

function computeSpectralSlope(
  spectrum: Float64Array,
  sr:       number,
  fftSize:  number
): number {
  const numBins = spectrum.length;
  let sumX=0,sumY=0,sumXY=0,sumX2=0,n=0;

  for (let k=1;k<numBins;k++) {
    const hz = k*sr/fftSize;
    if (hz < 100 || hz > sr/2-100) continue;
    const x = Math.log2(hz);
    const y = safeDb(spectrum[k]);
    if (y <= -120) continue;
    sumX+=x; sumY+=y; sumXY+=x*y; sumX2+=x*x; n++;
  }

  if (n < 10) return 0;
  return (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX);
}

// ── AI Artifact Detector ──────────────────────────────────────────────────────
// Detects periodic spectral artifacts from neural audio codecs/denoisers
// AI artifacts: comb-like spectral patterns, metallic resonances

function detectAiArtifacts(
  spectrum: Float64Array,
  sr:       number,
  fftSize:  number
): { score: number; evidence: string[] } {
  const numBins = spectrum.length;
  const evidence: string[] = [];
  let score = 0;

  // 1. Comb filter detection: periodic nulls in spectrum
  const COMB_PERIODS = [8, 16, 32, 64];
  for (const period of COMB_PERIODS) {
    let nullCount = 0;
    for (let k=period;k<numBins-period;k+=period) {
      const avg = (spectrum[k-1]+spectrum[k+1])/2;
      if (avg > 1e-10 && spectrum[k]/avg < 0.3) nullCount++;
    }
    const nullRatio = nullCount / (numBins/period);
    if (nullRatio > 0.4) {
      score += 0.3;
      evidence.push(`Comb nulls at period ${period} bins (ratio: ${(nullRatio*100).toFixed(0)}%)`);
    }
  }

  // 2. Metallic resonance: narrow peaks in 2-8kHz
  const res2k = Math.floor(2000*fftSize/sr);
  const res8k = Math.floor(8000*fftSize/sr);
  let resonancePeaks = 0;
  for (let k=res2k+2;k<Math.min(res8k,numBins-2);k++) {
    const peak = spectrum[k];
    const ctx  = (spectrum[k-2]+spectrum[k-1]+spectrum[k+1]+spectrum[k+2])/4;
    if (ctx > 1e-10 && peak/ctx > 4) resonancePeaks++;
  }
  if (resonancePeaks > 5) {
    score += 0.25;
    evidence.push(`${resonancePeaks} metallic resonance peaks in 2-8kHz`);
  }

  // 3. Spectral floor discontinuity (codec artifacts)
  let discontinuities = 0;
  for (let k=1;k<numBins-1;k++) {
    const delta = Math.abs(safeDb(spectrum[k]) - safeDb(spectrum[k-1]));
    if (delta > 15) discontinuities++;
  }
  if (discontinuities > numBins * 0.05) {
    score += 0.2;
    evidence.push(`${discontinuities} spectral discontinuities detected`);
  }

  return { score: Math.min(1, score), evidence };
}

// ── RT60 Estimation — Schroeder Backward Integration ─────────────────────────
// Reference: Schroeder (1965) "New method of measuring reverberation time"
// Uses energy decay curve from impulse response estimate

export interface RT60Result {
  rt60Ms:      number;       // reverberation time in ms
  edt:         number;       // early decay time (0 to -10dB) ms
  clarity:     number;       // C80 clarity metric (dB)
  confidence:  number;       // 0-1
  decayCurve:  Float32Array; // energy decay in dB over time
}

export function estimateRT60(
  data: Float32Array,
  sr:   number,
): RT60Result {
  // Find loudest region (approximate impulse location)
  let peakIdx = 0, peakVal = 0;
  for (let i=0;i<data.length;i++) {
    if (Math.abs(data[i])>peakVal) { peakVal=Math.abs(data[i]); peakIdx=i; }
  }

  if (peakIdx >= data.length - sr*0.1) {
    return { rt60Ms:0, edt:0, clarity:0, confidence:0,
      decayCurve: new Float32Array(0) };
  }

  // Schroeder backward integration from peak
  const tail   = data.slice(peakIdx);
  const energy = new Float64Array(tail.length);
  let cumE = 0;
  for (let i=tail.length-1;i>=0;i--) {
    cumE += tail[i]**2;
    energy[i] = cumE;
  }

  // Convert to dB
  const maxE = energy[0];
  const decayDb = new Float32Array(tail.length);
  for (let i=0;i<tail.length;i++) {
    decayDb[i] = maxE > 0 ? 10*Math.log10(energy[i]/maxE+1e-10) : -60;
  }

  // Find -5dB and -35dB points for T20 extrapolation to RT60
  let idx5  = -1, idx35 = -1;
  for (let i=0;i<decayDb.length;i++) {
    if (idx5  < 0 && decayDb[i] <= -5)  idx5  = i;
    if (idx35 < 0 && decayDb[i] <= -35) idx35 = i;
  }

  let rt60Ms = 0, confidence = 0;
  if (idx5 > 0 && idx35 > idx5) {
    const t20sec = (idx35 - idx5) / sr;
    rt60Ms = t20sec * 3 * 1000; // T20 × 3 = RT60
    confidence = Math.min(1, idx35 / (sr * 2)); // confidence from data length
  }

  // EDT: early decay time (0 to -10dB)
  let idxEdt = 0;
  for (let i=0;i<decayDb.length;i++) {
    if (decayDb[i] <= -10) { idxEdt=i; break; }
  }
  const edt = idxEdt > 0 ? (idxEdt/sr)*6*1000 : 0; // EDT extrapolated to 60dB

  // C80 clarity: ratio of early (0-80ms) to late energy
  const early80 = Math.floor(0.08 * sr);
  let earlyE=0, lateE=0;
  for (let i=0;i<tail.length;i++) {
    if (i < early80) earlyE += tail[i]**2;
    else              lateE  += tail[i]**2;
  }
  const clarity = lateE > 1e-10 ? 10*Math.log10(earlyE/lateE) : 0;

  return {
    rt60Ms:     Math.min(rt60Ms, 5000),
    edt:        Math.min(edt, 3000),
    clarity,
    confidence,
    decayCurve: decayDb.slice(0, Math.min(decayDb.length, sr*3)),
  };
}

// ── Main Classifier ───────────────────────────────────────────────────────────

export function classifyNoise(
  data:    Float32Array,
  sr:      number,
  fftSize: number = 4096
): NoiseClassification {
  const spectrum    = computeAveragedSpectrum(data, sr, fftSize);
  const numBins     = spectrum.length;
  const evidence:   string[] = [];
  const scores      = {} as Record<NoiseClass, number>;

  // Initialize scores
  const classes: NoiseClass[] = [
    "hvac_hum","electrical_hum_50hz","electrical_hum_60hz",
    "broadband_hiss","mic_self_noise","room_ambience","ai_artifact","clean","unknown"
  ];
  for (const c of classes) scores[c] = 0;

  // ── 50Hz Electrical Hum ────────────────────────────────────────────────
  const hum50 = detectHarmonicSeries(spectrum, sr, fftSize, 50, 8);
  if (hum50.present) {
    scores.electrical_hum_50hz = Math.min(1, hum50.snr / 10);
    evidence.push(`50Hz hum detected (SNR: ${hum50.snr.toFixed(1)}x)`);
  }

  // ── 60Hz Electrical Hum ────────────────────────────────────────────────
  const hum60 = detectHarmonicSeries(spectrum, sr, fftSize, 60, 8);
  if (hum60.present) {
    scores.electrical_hum_60hz = Math.min(1, hum60.snr / 10);
    evidence.push(`60Hz hum detected (SNR: ${hum60.snr.toFixed(1)}x)`);
  }

  // ── HVAC Hum (low-freq tonal + broadband) ─────────────────────────────
  const hvacBins = [Math.floor(120*fftSize/sr), Math.floor(240*fftSize/sr)];
  const avgLow   = spectrum.slice(0, Math.floor(500*fftSize/sr))
    .reduce((s,v)=>s+v,0) / Math.floor(500*fftSize/sr);
  const hvacEnergy = hvacBins.reduce((s,b)=>s+(spectrum[b]??0),0)/hvacBins.length;
  if (hvacEnergy > avgLow * 2 && (hum50.present || hum60.present)) {
    scores.hvac_hum = Math.min(1, hvacEnergy/avgLow/5);
    evidence.push("HVAC signature: low-freq tonal + harmonic hum");
  }

  // ── Broadband Hiss ─────────────────────────────────────────────────────
  const hfStart = Math.floor(4000*fftSize/sr);
  const lfEnd   = Math.floor(1000*fftSize/sr);
  const hfEnergy = spectrum.slice(hfStart).reduce((s,v)=>s+v,0)/(numBins-hfStart);
  const lfEnergy = spectrum.slice(0,lfEnd).reduce((s,v)=>s+v,0)/lfEnd;
  const hissRatio = lfEnergy > 1e-12 ? hfEnergy/lfEnergy : 0;
  if (hissRatio > 0.3) {
    scores.broadband_hiss = Math.min(1, hissRatio);
    evidence.push(`Broadband hiss: HF/LF ratio = ${hissRatio.toFixed(2)}`);
  }

  // ── Mic Self-Noise ─────────────────────────────────────────────────────
  const overallLevel = spectrum.reduce((s,v)=>s+v,0)/numBins;
  const overallDb    = safeDb(overallLevel);
  if (overallDb < -70 && hissRatio < 0.5) {
    scores.mic_self_noise = Math.min(1, Math.abs(overallDb+70)/20);
    evidence.push(`Mic self-noise: floor at ${overallDb.toFixed(1)}dB`);
  }

  // ── Room Ambience ──────────────────────────────────────────────────────
  const slope = computeSpectralSlope(spectrum, sr, fftSize);
  if (slope < -3 && slope > -12) {
    scores.room_ambience = Math.min(1, Math.abs(slope+3)/6);
    evidence.push(`Room ambience: spectral slope ${slope.toFixed(1)}dB/oct`);
  }

  // ── AI Artifacts ──────────────────────────────────────────────────────
  const aiResult = detectAiArtifacts(spectrum, sr, fftSize);
  if (aiResult.score > 0.1) {
    scores.ai_artifact = aiResult.score;
    evidence.push(...aiResult.evidence);
  }

  // ── Clean Detection ────────────────────────────────────────────────────
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore < 0.2 && overallDb < -55) {
    scores.clean = 1 - maxScore;
    evidence.push("No significant noise artifacts detected");
  }

  // Noise floor
  const sortedMags = Array.from(spectrum).sort((a,b)=>a-b);
  const noiseFloorDb = safeDb(sortedMags[Math.floor(sortedMags.length*0.05)]);

  // Dominant frequencies
  const dominantFreqs: number[] = [];
  for (let k=2;k<numBins-2;k++) {
    if (spectrum[k]>spectrum[k-1]&&spectrum[k]>spectrum[k+1]&&
        spectrum[k]>sortedMags[Math.floor(sortedMags.length*0.9)]) {
      dominantFreqs.push(k*sr/fftSize);
      if (dominantFreqs.length>=5) break;
    }
  }

  // Primary classification
  const sorted = Object.entries(scores).sort(([,a],[,b])=>b-a);
  const primary = sorted[0][0] as NoiseClass;
  const confidence = sorted[0][1];

  return {
    primary,
    confidence,
    scores,
    evidence,
    dominantFreqs,
    noiseFloorDb,
    spectralSlope: slope,
  };
}

// ── Noise Similarity ──────────────────────────────────────────────────────────
// Compare two noise profiles — useful for room tone matching

export function compareNoiseProfiles(
  profile1: Float64Array,
  profile2: Float64Array
): number {
  if (profile1.length !== profile2.length) return 0;
  const n = profile1.length;
  let dot=0, mag1=0, mag2=0;
  for (let i=0;i<n;i++) {
    dot  += profile1[i]*profile2[i];
    mag1 += profile1[i]**2;
    mag2 += profile2[i]**2;
  }
  const denom = Math.sqrt(mag1*mag2);
  return denom > 1e-12 ? dot/denom : 0;
}
