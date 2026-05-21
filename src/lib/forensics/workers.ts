/**
 * workers.ts — Forensic Analysis Web Worker Source Strings
 * All 4 workers with correct Float32Array transfer + all fixes applied
 */

// ── Shared FFT (injected into each worker) ────────────────────────────────────

const FFT_SRC = `
function fft(re, im) {
  const n = re.length;
  for(let i=1,j=0;i<n;i++){
    let b=n>>1; for(;j&b;b>>=1)j^=b; j^=b;
    if(i<j){
      let t=re[i];re[i]=re[j];re[j]=t;
      t=im[i];im[i]=im[j];im[j]=t;
    }
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len;
    const wR=Math.cos(ang), wI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cR=1, cI=0;
      for(let j=0;j<len>>1;j++){
        const uR=re[i+j], uI=im[i+j];
        const vR=re[i+j+len/2]*cR - im[i+j+len/2]*cI;
        const vI=re[i+j+len/2]*cI + im[i+j+len/2]*cR;
        re[i+j]=uR+vR; im[i+j]=uI+vI;
        re[i+j+len/2]=uR-vR; im[i+j+len/2]=uI-vI;
        const nR=cR*wR-cI*wI; cI=cR*wI+cI*wR; cR=nR;
      }
    }
  }
}
`;

// ── Worker 1: Synthetic Speech Detection ─────────────────────────────────────

export const SYNTHETIC_WORKER_SRC = FFT_SRC + `
self.onmessage = function(e) {
  // Fix 1: always reconstruct Float32Array from transferred ArrayBuffer
  const samples = new Float32Array(e.data.samples);
  const sr = e.data.sr;
  const id = e.data.id;
  const n  = samples.length;

  // ── RAP Jitter (YIN normalized autocorrelation) ───────────────────────────
  const frameLen = Math.floor(0.025 * sr);
  const hopLen   = Math.floor(0.010 * sr);
  const f0s = [];

  for(let s = 0; s + frameLen <= n; s += hopLen) {
    const minP = Math.floor(sr / 500);
    const maxP = Math.min(Math.floor(sr / 60), frameLen >> 1);
    let bestP = 0, bestAC = -1;
    for(let tau = minP; tau < maxP; tau++) {
      let ac=0, e0=0, e1=0;
      for(let i = 0; i < frameLen - tau; i++) {
        ac += samples[s+i] * samples[s+i+tau];
        e0 += samples[s+i] ** 2;
        e1 += samples[s+i+tau] ** 2;
      }
      const norm = ac / Math.sqrt(e0 * e1 + 1e-20);
      if(norm > bestAC) { bestAC = norm; bestP = tau; }
    }
    if(bestP > 0 && bestAC > 0.3) f0s.push(sr / bestP);
  }

  let jitter = 0;
  if(f0s.length > 4) {
    for(let i = 1; i < f0s.length - 1; i++) {
      const avg = (f0s[i-1] + f0s[i] + f0s[i+1]) / 3;
      jitter += Math.abs(f0s[i] - avg) / (avg + 1e-10);
    }
    jitter /= (f0s.length - 2);
  }
  const jitterScore = Math.min(1, jitter / 0.015);

  // ── Shimmer APQ-3 ─────────────────────────────────────────────────────────
  const amps = [];
  for(let s = 0; s + frameLen <= n; s += hopLen) {
    let ms = 0;
    for(let i = 0; i < frameLen; i++) ms += samples[s+i] ** 2;
    amps.push(Math.sqrt(ms / frameLen));
  }
  let shimmer = 0;
  if(amps.length > 3) {
    for(let i = 1; i < amps.length - 1; i++) {
      const avg = (amps[i-1] + amps[i] + amps[i+1]) / 3;
      shimmer += Math.abs(amps[i] - avg) / (avg + 1e-10);
    }
    shimmer /= (amps.length - 2);
  }
  const shimmerScore = Math.min(1, shimmer / 0.03);

  // ── Bispectrum diagonal entropy ────────────────────────────────────────────
  // B(k,k) = |X(k)|² · X(2k) — phase coupling
  const BN = 512;
  const bRe = new Float64Array(BN), bIm = new Float64Array(BN);
  const bOff = Math.floor(n / 2);
  for(let i = 0; i < BN; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (BN - 1)));
    bRe[i] = (samples[bOff + i] || 0) * w;
  }
  fft(bRe, bIm);
  const halfBN = BN >> 1;
  let biEnt = 0, biTotal = 0;
  for(let k = 1; k < halfBN >> 1; k++) {
    const magK  = Math.sqrt(bRe[k]**2 + bIm[k]**2);
    const magK2 = Math.sqrt(bRe[2*k]**2 + bIm[2*k]**2);
    const biMag = magK * magK * magK2;
    if(biMag > 1e-15) {
      biEnt   += -biMag * Math.log2(biMag + 1e-15);
      biTotal += biMag;
    }
  }
  const normEnt = biTotal > 0
    ? biEnt / (biTotal * Math.log2((halfBN >> 1) + 1))
    : 0;
  const bispectrumScore = Math.min(1, normEnt * 2.0);

  // ── CPP with liftering + linear regression (correct) ──────────────────────
  const CN = 1024;
  const cRe = new Float64Array(CN), cIm = new Float64Array(CN);
  const cOff = Math.floor(n / 4);
  for(let i = 0; i < CN; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (CN - 1)));
    cRe[i] = (samples[cOff + i] || 0) * w;
  }
  fft(cRe, cIm);

  // Log power spectrum
  const logPow = new Float64Array(CN);
  for(let k = 0; k < CN; k++) {
    const p = cRe[k]**2 + cIm[k]**2;
    logPow[k] = p > 0 ? Math.log(p + 1e-20) : -46;
  }

  // Real cepstrum via IFFT of log power
  const cpRe = new Float64Array(CN), cpIm = new Float64Array(CN);
  for(let k = 0; k < CN; k++) cpRe[k] = logPow[k];
  // Conjugate for IFFT
  for(let k = 1; k < CN; k++) cpIm[k] = -cpIm[k];
  fft(cpRe, cpIm);
  for(let k = 0; k < CN; k++) cpRe[k] /= CN;

  // Lifter: keep only pitch quefrency range (2ms-16ms)
  const liftLow  = Math.max(1, Math.floor(0.002 * sr));
  const liftHigh = Math.min(CN >> 1, Math.floor(0.016 * sr));
  const cepSlice = [], qSlice = [];
  for(let q = liftLow; q < liftHigh; q++) {
    cepSlice.push(Math.abs(cpRe[q]));
    qSlice.push(q);
  }

  // Linear regression baseline
  const qMean = qSlice.reduce((a,b)=>a+b,0) / qSlice.length;
  const yMean = cepSlice.reduce((a,b)=>a+b,0) / cepSlice.length;
  let num=0, den=0;
  for(let i = 0; i < qSlice.length; i++) {
    num += (qSlice[i] - qMean) * (cepSlice[i] - yMean);
    den += (qSlice[i] - qMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = yMean - slope * qMean;

  // Peak vs regression — Fix 3: ensure >= 0
  let cppPeak = 0, cppPeakQ = liftLow;
  for(let i = 0; i < cepSlice.length; i++) {
    if(cepSlice[i] > cppPeak) { cppPeak = cepSlice[i]; cppPeakQ = qSlice[i]; }
  }
  const regAtPeak = slope * cppPeakQ + intercept;
  const cpp = Math.max(0, cppPeak - Math.max(0, regAtPeak));
  const cppScore = Math.min(1, cpp * 12);

  // ── Modulation Spectrum via FFT (O(N log N)) ───────────────────────────────
  const envFrameLen = Math.floor(0.010 * sr);
  const envHopLen   = Math.floor(0.005 * sr);
  const envList = [];
  for(let s = 0; s + envFrameLen <= n; s += envHopLen) {
    let ms = 0;
    for(let i = 0; i < envFrameLen; i++) ms += samples[s+i] ** 2;
    envList.push(Math.sqrt(ms / envFrameLen));
  }

  // Pad to power of 2
  let modN = 1;
  while(modN < envList.length) modN <<= 1;
  const modRe = new Float64Array(modN);
  const modIm = new Float64Array(modN);
  const envMean = envList.reduce((a,b)=>a+b,0) / envList.length;

  // Fix 5: Hann window + detrend to reduce spectral leakage
  for(let i = 0; i < envList.length; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (envList.length - 1)));
    modRe[i] = (envList[i] - envMean) * w;
  }
  fft(modRe, modIm);

  const modSR = 1.0 / (envHopLen / sr);
  let modBandE = 0, modTotalE = 0;
  for(let k = 1; k < modN >> 1; k++) {
    const freq = k * modSR / modN;
    const mag  = modRe[k]**2 + modIm[k]**2;
    modTotalE += mag;
    if(freq >= 3.0 && freq <= 9.0) modBandE += mag;
  }
  const modRatio = modTotalE > 0 ? modBandE / modTotalE : 0;
  const modScore = Math.min(1, modRatio * 8);

  // ── Ensemble ──────────────────────────────────────────────────────────────
  const naturalness =
    jitterScore    * 0.22 +
    shimmerScore   * 0.20 +
    bispectrumScore* 0.20 +
    cppScore       * 0.22 +
    modScore       * 0.16;

  const isSynthetic = naturalness < 0.42;
  const confidence  = Math.round(
    (isSynthetic ? 1 - naturalness : naturalness) * 1000
  ) / 1000;

  self.postMessage({
    id, type: "synthetic",
    result: {
      isSynthetic, confidence,
      naturalness: Math.round(naturalness * 1000) / 1000,
      scores: {
        jitter:     Math.round(jitterScore    * 100),
        shimmer:    Math.round(shimmerScore   * 100),
        bispectrum: Math.round(bispectrumScore* 100),
        cpp:        Math.round(cppScore       * 100),
        modulation: Math.round(modScore       * 100),
      }
    }
  });
};
`;

// ── Worker 2: Microphone Fingerprint ─────────────────────────────────────────

export const MIC_WORKER_SRC = FFT_SRC + `
self.onmessage = function(e) {
  const samples = new Float32Array(e.data.samples);
  const sr = e.data.sr;
  const id = e.data.id;
  const n  = samples.length;

  const FFT  = 512;
  const nMel = 32;
  const fMin = 80, fMax = Math.min(8000, sr / 2);
  const melMin = 2595 * Math.log10(1 + fMin / 700);
  const melMax = 2595 * Math.log10(1 + fMax / 700);

  // Mel filter bank centers
  const melHz = new Float32Array(nMel + 2);
  for(let i = 0; i < nMel + 2; i++) {
    const mel = melMin + i * (melMax - melMin) / (nMel + 1);
    melHz[i] = 700 * (Math.pow(10, mel / 2595) - 1);
  }
  const bins = Array.from(melHz).map(f => Math.floor(f / (sr / 2) * (FFT / 2)));

  const signature = new Float64Array(nMel).fill(0);
  const nFrames   = Math.max(1, Math.min(30, Math.floor(n / FFT)));
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  let lastRe = new Float64Array(FFT), lastIm = new Float64Array(FFT);

  for(let fr = 0; fr < nFrames; fr++) {
    const off = Math.floor(fr * (n - FFT) / Math.max(1, nFrames - 1));
    re.fill(0); im.fill(0);
    for(let i = 0; i < FFT; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT - 1)));
      re[i] = (samples[off + i] || 0) * w;
    }
    fft(re, im);
    lastRe = re.slice(); lastIm = im.slice();

    for(let m = 0; m < nMel; m++) {
      const f1=bins[m], f2=bins[m+1]!=null?bins[m+1]:f1+1, f3=bins[m+2]!=null?bins[m+2]:f2+1;
      let energy = 0;
      for(let k=f1;k<f2&&k<FFT/2;k++)
        energy += (re[k]**2+im[k]**2) * (k-f1)/(f2-f1+1e-10);
      for(let k=f2;k<f3&&k<FFT/2;k++)
        energy += (re[k]**2+im[k]**2) * (f3-k)/(f3-f2+1e-10);
      signature[m] += Math.log(energy + 1e-20);
    }
  }
  for(let m = 0; m < nMel; m++) signature[m] /= nFrames;

  // Z-score normalize
  const mean = signature.reduce((a,b)=>a+b,0) / nMel;
  const std  = Math.sqrt(signature.reduce((s,v)=>s+(v-mean)**2,0) / nMel);
  const norm = new Float32Array(nMel);
  for(let m = 0; m < nMel; m++)
    norm[m] = std > 1e-10 ? (signature[m] - mean) / std : 0;

  // Noise floor (10th percentile)
  const mags = [];
  for(let k=1;k<FFT/2;k++) mags.push(lastRe[k]**2 + lastIm[k]**2);
  mags.sort((a,b)=>a-b);
  const noiseFloor  = mags[Math.floor(mags.length * 0.10)];
  const noiseFloorDb= noiseFloor > 0 ? 10*Math.log10(noiseFloor) : -120;

  // Rolloff 95% energy
  let totalE=0;
  for(let k=0;k<FFT/2;k++) totalE += lastRe[k]**2 + lastIm[k]**2;
  let cumE=0, rolloffHz=sr/2;
  for(let k=0;k<FFT/2;k++){
    cumE += lastRe[k]**2 + lastIm[k]**2;
    if(cumE >= 0.95 * totalE){ rolloffHz = k * sr / FFT; break; }
  }

  self.postMessage({
    id, type: "mic",
    result: {
      signature:    Array.from(norm),
      noiseFloorDb: Math.round(noiseFloorDb * 10) / 10,
      rolloffHz:    Math.round(rolloffHz),
    }
  });
};
`;

// ── Worker 3: Room Fingerprint ────────────────────────────────────────────────

export const ROOM_WORKER_SRC = `
self.onmessage = function(e) {
  const samples = new Float32Array(e.data.samples);
  const sr = e.data.sr;
  const id = e.data.id;
  const n  = samples.length;

  // Fix 4: stability check + Q=1.5
  function biquadBP(data, freq, Q) {
    // Skip unstable frequencies
    if(freq >= sr / 2 * 0.40) return new Float32Array(data.length);
    const w0    = 2 * Math.PI * freq / sr;
    const sinW  = Math.sin(w0), cosW = Math.cos(w0);
    const alpha = sinW / (2 * Q);
    const b0=alpha, b2=-alpha;
    const a0=1+alpha, a1=-2*cosW, a2=1-alpha;
    const B0=b0/a0, B2=b2/a0, A1=a1/a0, A2=a2/a0;
    const out = new Float32Array(data.length);
    let x1=0,x2=0,y1=0,y2=0;
    for(let i=0;i<data.length;i++){
      const x = data[i];
      const y = B0*x + B2*x2 - A1*y1 - A2*y2;
      x2=x1; x1=x; y2=y1; y1=y;
      out[i] = isFinite(y) ? y : 0;
    }
    return out;
  }

  // Schroeder backward integration → EDT
  function computeRT60(filtered) {
    let total = 0;
    for(let i=0;i<filtered.length;i++) total += filtered[i]**2;
    if(total < 1e-20) return 0.30;

    const edc = new Float64Array(filtered.length);
    let cumFromEnd = total;
    for(let i=0;i<filtered.length;i++){
      edc[i]      = cumFromEnd;
      cumFromEnd -= filtered[i]**2;
    }

    // EDT: -5dB to -35dB → extrapolate to RT60
    let t5=-1, t35=-1;
    for(let i=0;i<filtered.length;i++){
      const db = 10 * Math.log10(edc[i] / edc[0] + 1e-20);
      if(db <= -5  && t5  < 0) t5  = i / sr;
      if(db <= -35 && t35 < 0){ t35 = i / sr; break; }
    }
    if(t5 >= 0 && t35 > t5) return (t35 - t5) * (60 / 30); // extrapolate
    return 0.30;
  }

  // Analyze first 4s only (avoids processing entire long file)
  const maxLen  = Math.min(n, Math.floor(4 * sr));
  const slice   = samples.subarray(0, maxLen);
  const bands   = [125, 250, 500, 1000, 2000, 4000];
  const rt60s   = {};

  for(const f of bands) {
    const filtered = biquadBP(slice, f, 1.5);
    rt60s[f]       = Math.round(computeRT60(filtered) * 1000) / 1000;
  }

  const rt60Overall = rt60s[1000] || rt60s[500] || 0.30;
  const roomCategory =
    rt60Overall < 0.15 ? "anechoic"     :
    rt60Overall < 0.30 ? "studio"       :
    rt60Overall < 0.50 ? "treated_room" :
    rt60Overall < 0.80 ? "office"       :
    rt60Overall < 1.50 ? "room"         : "hall";

  // Sabine: RT60 = 0.161 V / (α·S) → α ∝ 0.161/RT60 (normalized)
  const absorptionCoeff = Math.min(1, 0.161 / (rt60Overall + 1e-10));

  self.postMessage({
    id, type: "room",
    result: {
      rt60s,
      rt60Overall:      Math.round(rt60Overall * 1000) / 1000,
      roomCategory,
      absorptionCoeff:  Math.round(absorptionCoeff * 1000) / 1000,
    }
  });
};
`;

// ── Worker 4: AI Artifact Detection ──────────────────────────────────────────

export const ARTIFACT_WORKER_SRC = FFT_SRC + `
self.onmessage = function(e) {
  const samples = new Float32Array(e.data.samples);
  const sr = e.data.sr;
  const id = e.data.id;
  const n  = samples.length;

  // Average 3 segments for robustness
  const FFT   = 1024;
  const mag   = new Float32Array(FFT / 2).fill(0);
  const nSeg  = 3;
  const re    = new Float64Array(FFT);
  const im    = new Float64Array(FFT);

  for(let seg = 0; seg < nSeg; seg++) {
    const off = Math.floor(seg * (n - FFT) / Math.max(1, nSeg - 1));
    re.fill(0); im.fill(0);
    for(let i=0;i<FFT;i++){
      const w = 0.5*(1-Math.cos(2*Math.PI*i/(FFT-1)));
      re[i] = (samples[off+i]||0)*w;
    }
    fft(re, im);
    for(let k=0;k<FFT/2;k++)
      mag[k] += Math.sqrt(re[k]**2 + im[k]**2) / nSeg;
  }

  // 1. Spectral holes (3-bin context, threshold 8%)
  let holes = 0;
  for(let k=3;k<FFT/2-3;k++){
    const ctx = (mag[k-3]+mag[k-2]+mag[k-1]+mag[k+1]+mag[k+2]+mag[k+3])/6;
    if(ctx > 1e-6 && mag[k] < ctx * 0.08) holes++;
  }
  const holeRatio = holes / (FFT / 2);

  // 2. Comb filter (periodic peaks, spacing scan 4-40 bins)
  let maxComb = 0;
  for(let sp=4;sp<=40;sp++){
    let match=0, total=0;
    for(let k=sp;k<FFT/2-sp;k++){
      const nbr = (mag[k-sp]+mag[k+sp])/2 + 1e-10;
      if(mag[k]/nbr > 1.6) match++;
      total++;
    }
    maxComb = Math.max(maxComb, match/total);
  }

  // 3. Shannon spectral entropy
  let totalE=0;
  for(let k=0;k<FFT/2;k++) totalE+=mag[k]**2;
  let entropy=0;
  if(totalE>0){
    for(let k=0;k<FFT/2;k++){
      const p=mag[k]**2/totalE;
      if(p>1e-12) entropy -= p*Math.log2(p);
    }
  }
  const maxEnt  = Math.log2(FFT/2);
  const entScore= totalE>0 ? entropy/maxEnt : 0.5;

  // 4. Bandwidth (95th percentile, TTS cuts at 8-16kHz)
  let bwTop=0;
  for(let k=FFT/2-1;k>0;k--){
    if(mag[k]>1e-6){ bwTop=k*sr/FFT; break; }
  }
  const bwScore = Math.min(1, bwTop / Math.min(16000, sr/2*0.95));

  // 5. Phase discontinuity (energy jump detection)
  const fLen   = Math.floor(0.020*sr);
  const frameE = [];
  for(let s=0;s+fLen<=n;s+=fLen){
    let energy=0;
    for(let i=0;i<fLen;i++) energy+=samples[s+i]**2;
    frameE.push(energy/fLen);
  }
  let jumps=0;
  for(let i=1;i<frameE.length;i++){
    const hi=Math.max(frameE[i],frameE[i-1]);
    const lo=Math.min(frameE[i],frameE[i-1]);
    if(lo>1e-10 && hi/lo>6) jumps++;
  }
  const jumpRatio = frameE.length>0 ? jumps/frameE.length : 0;

  // Ensemble
  const artifactScore =
    holeRatio  * 0.28 +
    maxComb    * 0.25 +
    (1-entScore)* 0.22 +
    (1-bwScore) * 0.15 +
    jumpRatio   * 0.10;

  const clean = artifactScore < 0.20;
  const dominantType =
    holeRatio>0.10 ? "over_suppression"   :
    maxComb>0.25   ? "comb_filter"        :
    entScore<0.50  ? "low_entropy"        :
    jumpRatio>0.05 ? "phase_discontinuity": "none";

  self.postMessage({
    id, type: "artifact",
    result: {
      clean,
      artifactScore: Math.round(artifactScore * 1000) / 1000,
      dominantType,
      scores: {
        holeRatio:  Math.round(holeRatio  * 1000) / 1000,
        combScore:  Math.round(maxComb    * 1000) / 1000,
        entropy:    Math.round(entScore   * 1000) / 1000,
        bandwidth:  Math.round(bwScore    * 1000) / 1000,
        phaseJumps: Math.round(jumpRatio  * 1000) / 1000,
      }
    }
  });
};
`;

// ── Worker Factory ────────────────────────────────────────────────────────────

export function makeWorker(src: string): Worker {
  const blob = new Blob([src], { type:"application/javascript" });
  const url  = URL.createObjectURL(blob);
  const w    = new Worker(url);
  URL.revokeObjectURL(url); // revoke immediately — Worker holds internal reference
  return w;
}
