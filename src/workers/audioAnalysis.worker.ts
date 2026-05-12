/**
 * audioAnalysis.worker.ts — Background DSP Worker
 * Aivora Platform — Phase 3
 */

type WorkerMessage =
  | { type: "ANALYZE_QC";       id: string; samples: Float32Array; sampleRate: number; channels: number; duration: number; profile: string }
  | { type: "COMPUTE_FFT";      id: string; samples: Float32Array; sampleRate: number; fftSize: number }
  | { type: "COMPUTE_MFCC";     id: string; samples: Float32Array; sampleRate: number }
  | { type: "COMPUTE_RT60";     id: string; samples: Float32Array; sampleRate: number }
  | { type: "COMPUTE_VAD";      id: string; samples: Float32Array; sampleRate: number; profile: string }
  | { type: "COMPUTE_SNR";      id: string; samples: Float32Array; sampleRate: number }
  | { type: "CANCEL";           id: string };

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
        const uRe=re[i+j], uIm=im[i+j];
        const vRe=re[i+j+len/2]*cRe-im[i+j+len/2]*cIm;
        const vIm=re[i+j+len/2]*cIm+im[i+j+len/2]*cRe;
        re[i+j]=uRe+vRe; im[i+j]=uIm+vIm;
        re[i+j+len/2]=uRe-vRe; im[i+j+len/2]=uIm-vIm;
        const nRe=cRe*wRe-cIm*wIm; cIm=cRe*wIm+cIm*wRe; cRe=nRe;
      }
    }
  }
}

// ── SNR ───────────────────────────────────────────────────────────────────────

function computeSNR(samples: Float32Array, sampleRate: number) {
  const frameSize = Math.round(0.02 * sampleRate);
  const hopSize   = Math.round(0.01 * sampleRate);
  const energies: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += hopSize) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) e += samples[i+j]**2;
    energies.push(e / frameSize);
  }

  energies.sort((a,b) => a-b);
  const cut     = Math.max(1, Math.floor(energies.length * 0.1));
  const noise   = energies.slice(0, cut).reduce((s,v) => s+v, 0) / cut;
  const signal  = energies.slice(-cut).reduce((s,v) => s+v, 0) / cut;
  const snrDb   = noise > 0 ? 10 * Math.log10(signal / noise) : 60;
  const floorDb = noise > 0 ? 10 * Math.log10(noise) : -120;

  return { snrDb: Math.min(snrDb, 80), noiseFloorDb: floorDb };
}

// ── VAD ───────────────────────────────────────────────────────────────────────

function computeVAD(samples: Float32Array, sampleRate: number) {
  const frameSize = Math.round(0.02 * sampleRate);
  const hopSize   = Math.round(0.01 * sampleRate);
  let speechFrames = 0, totalFrames = 0;

  const energies: number[] = [];
  for (let i = 0; i + frameSize <= samples.length; i += hopSize) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) e += samples[i+j]**2;
    energies.push(e / frameSize);
    totalFrames++;
  }

  const sorted  = [...energies].sort((a,b) => a-b);
  const cut     = Math.max(1, Math.floor(sorted.length * 0.1));
  const noise   = sorted.slice(0, cut).reduce((s,v) => s+v, 0) / cut;
  const thresh  = noise * 6;

  for (const e of energies) if (e > thresh) speechFrames++;

  return {
    speechRatio: totalFrames > 0 ? speechFrames / totalFrames : 0,
    speechFrames,
    totalFrames,
  };
}

// ── RT60 ──────────────────────────────────────────────────────────────────────

function computeRT60(samples: Float32Array, sampleRate: number) {
  let totalE = 0;
  for (let i = 0; i < samples.length; i++) totalE += samples[i]**2;

  let cumE = 0, t5 = -1, t35 = -1;
  for (let i = 0; i < samples.length; i++) {
    cumE += samples[i]**2;
    const edc = 10 * Math.log10((totalE - cumE + 1e-10) / (totalE + 1e-10));
    if (t5  < 0 && edc <= -5)  t5  = i / sampleRate;
    if (t35 < 0 && edc <= -35) t35 = i / sampleRate;
  }

  const rt60Ms = (t5 >= 0 && t35 > t5) ? (t35 - t5) * 2 * 1000 : 0;
  const environment =
    rt60Ms < 50  ? "anechoic" :
    rt60Ms < 150 ? "studio"   :
    rt60Ms < 300 ? "office"   :
    rt60Ms < 500 ? "room"     :
    rt60Ms < 900 ? "hall"     : "bathroom";

  return { rt60Ms, environment };
}

// ── FFT Analysis ──────────────────────────────────────────────────────────────

function computeFFTAnalysis(samples: Float32Array, sampleRate: number, fftSize: number) {
  const re  = new Float64Array(fftSize);
  const im  = new Float64Array(fftSize);
  const len = Math.min(fftSize, samples.length);

  // Hann window
  for (let i = 0; i < len; i++)
    re[i] = samples[i] * 0.5 * (1 - Math.cos(2*Math.PI*i/(len-1)));

  fft(re, im);

  const mag = new Float32Array(fftSize/2);
  for (let i = 0; i < fftSize/2; i++)
    mag[i] = Math.sqrt(re[i]**2 + im[i]**2);

  // Check for hum
  const binHz    = sampleRate / fftSize;
  const hum50Bin = Math.round(50 / binHz);
  const hum60Bin = Math.round(60 / binHz);
  const hum50    = mag[hum50Bin] || 0;
  const hum60    = mag[hum60Bin] || 0;
  const avgMag   = mag.reduce((s,v) => s+v, 0) / mag.length;
  const humDetected = hum50 > avgMag * 8 || hum60 > avgMag * 8;
  const humFreq     = hum50 > hum60 ? 50 : 60;

  // Spectral flatness
  let logSum = 0, linSum = 0;
  for (let i = 1; i < mag.length; i++) {
    logSum += Math.log(mag[i] + 1e-10);
    linSum += mag[i];
  }
  const spectralFlatness = Math.exp(logSum/mag.length) / (linSum/mag.length + 1e-10);

  return { mag, humDetected, humFreq, spectralFlatness };
}

// ── MFCC ──────────────────────────────────────────────────────────────────────

function computeMFCC(samples: Float32Array, sampleRate: number): Float32Array {
  const numCoeffs = 13;
  const fftSize   = 512;
  const hopSize   = 256;
  const numFilters = 26;

  // Mel filterbank
  function hzToMel(hz: number) { return 2595 * Math.log10(1 + hz/700); }
  function melToHz(mel: number) { return 700 * (Math.pow(10, mel/2595) - 1); }

  const lowMel  = hzToMel(80);
  const highMel = hzToMel(sampleRate/2);
  const melPts  = Array.from({length: numFilters+2}, (_,i) =>
    lowMel + i*(highMel-lowMel)/(numFilters+1)
  );
  const hzPts   = melPts.map(melToHz);
  const binPts  = hzPts.map(hz => Math.round(hz*fftSize/sampleRate));

  const filters = Array.from({length: numFilters}, (_,m) => {
    const f = new Float32Array(fftSize/2);
    for (let k = binPts[m]; k < binPts[m+1]; k++)
      f[k] = (k-binPts[m])/(binPts[m+1]-binPts[m]);
    for (let k = binPts[m+1]; k < binPts[m+2]; k++)
      f[k] = (binPts[m+2]-k)/(binPts[m+2]-binPts[m+1]);
    return f;
  });

  const allMFCC: number[][] = [];

  for (let start = 0; start+fftSize <= samples.length; start += hopSize) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++)
      re[i] = samples[start+i] * 0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)));
    fft(re, im);

    const mag = new Float32Array(fftSize/2);
    for (let i = 0; i < fftSize/2; i++)
      mag[i] = Math.sqrt(re[i]**2+im[i]**2);

    const mel = filters.map(f => {
      let e = 0;
      for (let i = 0; i < mag.length; i++) e += mag[i]*f[i];
      return Math.log(e+1e-10);
    });

    const mfcc = Array.from({length: numCoeffs}, (_,k) =>
      mel.reduce((s,v,n) => s + v*Math.cos(Math.PI*k*(n+0.5)/mel.length), 0)
    );
    allMFCC.push(mfcc);
  }

  if (allMFCC.length === 0) return new Float32Array(numCoeffs);
  const avg = new Float32Array(numCoeffs);
  for (const frame of allMFCC)
    for (let i = 0; i < numCoeffs; i++) avg[i] += frame[i];
  for (let i = 0; i < numCoeffs; i++) avg[i] /= allMFCC.length;
  return avg;
}

// ── Message Handler ───────────────────────────────────────────────────────────

const cancelled = new Set<string>();

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === "CANCEL") {
    cancelled.add(msg.id);
    return;
  }

  if (cancelled.has(msg.id)) {
    cancelled.delete(msg.id);
    return;
  }

  try {
    switch (msg.type) {

      case "COMPUTE_SNR": {
        const result = computeSNR(msg.samples, msg.sampleRate);
        self.postMessage({ type: "RESULT", id: msg.id, result });
        break;
      }

      case "COMPUTE_VAD": {
        const result = computeVAD(msg.samples, msg.sampleRate);
        self.postMessage({ type: "RESULT", id: msg.id, result });
        break;
      }

      case "COMPUTE_RT60": {
        const result = computeRT60(msg.samples, msg.sampleRate);
        self.postMessage({ type: "RESULT", id: msg.id, result });
        break;
      }

      case "COMPUTE_FFT": {
        const result = computeFFTAnalysis(msg.samples, msg.sampleRate, msg.fftSize);
        self.postMessage({ type: "RESULT", id: msg.id, result });
        break;
      }

      case "COMPUTE_MFCC": {
        const result = computeMFCC(msg.samples, msg.sampleRate);
        self.postMessage({ type: "RESULT", id: msg.id, result });
        break;
      }

      case "ANALYZE_QC": {
        // Progress updates
        self.postMessage({ type: "PROGRESS", id: msg.id, progress: 10, step: "SNR" });
        const snr = computeSNR(msg.samples, msg.sampleRate);

        self.postMessage({ type: "PROGRESS", id: msg.id, progress: 30, step: "VAD" });
        const vad = computeVAD(msg.samples, msg.sampleRate);

        self.postMessage({ type: "PROGRESS", id: msg.id, progress: 55, step: "FFT" });
        const fftResult = computeFFTAnalysis(msg.samples, msg.sampleRate, 2048);

        self.postMessage({ type: "PROGRESS", id: msg.id, progress: 75, step: "RT60" });
        const rt60 = computeRT60(msg.samples, msg.sampleRate);

        self.postMessage({ type: "PROGRESS", id: msg.id, progress: 90, step: "MFCC" });
        const mfcc = computeMFCC(msg.samples, msg.sampleRate);

        self.postMessage({ type: "PROGRESS", id: msg.id, progress: 100, step: "Done" });
        self.postMessage({
          type: "RESULT", id: msg.id,
          result: { snr, vad, fft: fftResult, rt60, mfcc },
        });
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      type: "ERROR", id: msg.id,
      error: err instanceof Error ? err.message : "Worker error",
    });
  }
};
