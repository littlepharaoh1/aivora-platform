/**
 * forensicCursorInspector.ts — Realtime Forensic Cursor Inspector
 * Aivora Forensic DSP Platform
 */

export interface ForensicCursorInfo {
  // Time
  timeSec:       number;
  timeMs:        number;
  sampleIndex:   number;
  smpte:         string;

  // Amplitude
  peakDb:        number;
  rmsDb:         number;
  crestFactor:   number;
  lufsEstimate:  number;

  // Frequency
  dominantHz:    number;
  spectralCentroid: number;
  spectralFlatness: number;

  // Forensics
  noiseFloorDb:  number;
  humProb:       number;   // 0-1
  hissProb:      number;   // 0-1
  contaminationProb: number; // 0-1
  seamProb:      number;   // 0-1
  silencePurity: number;   // 0-1
}

export function inspectForensicCursor(
  mono:       Float32Array,
  sampleRate: number,
  timeSec:    number,
  windowSec:  number = 0.05
): ForensicCursorInfo {
  const sampleIndex  = Math.floor(timeSec * sampleRate);
  const timeMs       = timeSec * 1000;
  const windowSamples = Math.floor(windowSec * sampleRate);

  // SMPTE 25fps
  const fr   = Math.floor(timeSec * 25) % 25;
  const ss   = Math.floor(timeSec) % 60;
  const mm   = Math.floor(timeSec / 60) % 60;
  const hh   = Math.floor(timeSec / 3600);
  const smpte = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}:${String(fr).padStart(2,"0")}`;

  // Extract window
  const start = Math.max(0, sampleIndex - windowSamples);
  const end   = Math.min(mono.length, sampleIndex + windowSamples);
  const chunk = mono.slice(start, end);
  const N     = chunk.length;

  // Peak
  let peak = 0;
  for(let i=0;i<N;i++) { const a=Math.abs(chunk[i]); if(a>peak) peak=a; }
  const peakDb = peak > 1e-10 ? 20*Math.log10(peak) : -120;

  // RMS
  let sum = 0;
  for(let i=0;i<N;i++) sum += chunk[i]*chunk[i];
  const rms    = Math.sqrt(sum/Math.max(1,N));
  const rmsDb  = rms > 1e-10 ? 20*Math.log10(rms) : -120;

  // Crest factor
  const crestFactor = rms > 0 ? peakDb - rmsDb : 0;

  // LUFS estimate (simplified)
  const lufsEstimate = rmsDb - 0.691;

  // Fast frequency analysis via autocorrelation
  let dominantHz = 0;
  let maxCorr    = 0;
  const minLag   = Math.floor(sampleRate / 4000);
  const maxLag   = Math.min(Math.floor(sampleRate / 50), Math.floor(N/2));
  for(let lag=minLag; lag<maxLag; lag+=2) {
    let corr = 0;
    for(let n=0;n<N-lag;n+=4) corr += chunk[n]*chunk[n+lag];
    if(corr > maxCorr) { maxCorr=corr; dominantHz=sampleRate/lag; }
  }

  // Spectral centroid & flatness (fast approximation)
  let weightedSum = 0, totalMag = 0, logMagSum = 0;
  const step = Math.max(1, Math.floor(N/64));
  const numBins = Math.floor(N/2/step);
  for(let k=1; k<numBins; k++) {
    let re=0, im=0;
    for(let n=0;n<N;n+=step) {
      const angle = (2*Math.PI*k*n)/N;
      re += chunk[n]*Math.cos(angle);
      im += chunk[n]*Math.sin(angle);
    }
    const mag = Math.sqrt(re*re+im*im);
    const hz  = k*sampleRate/N;
    weightedSum += hz*mag;
    totalMag    += mag;
    logMagSum   += Math.log(mag+1e-10);
  }
  const spectralCentroid = totalMag>0 ? weightedSum/totalMag : 0;
  const geometricMean    = Math.exp(logMagSum/numBins);
  const arithmeticMean   = totalMag/numBins;
  const spectralFlatness = arithmeticMean>0 ? geometricMean/arithmeticMean : 0;

  // Forensic scores
  const noiseFloorDb     = rmsDb - 30;
  const humProb          = dominantHz>40&&dominantHz<130 ? Math.min(1,(130-Math.abs(dominantHz-90))/90) : 0;
  const hissProb         = spectralCentroid > sampleRate*0.3 ? Math.min(1,spectralCentroid/(sampleRate*0.4)) : 0;
  const silencePurity    = rmsDb < -40 ? Math.max(0,1+rmsDb/60) : 1;
  const contaminationProb = Math.min(1, humProb*0.5 + hissProb*0.3 + (1-silencePurity)*0.2);
  const seamProb         = crestFactor > 20 ? Math.min(1,(crestFactor-20)/20) : 0;

  return {
    timeSec, timeMs, sampleIndex, smpte,
    peakDb, rmsDb, crestFactor, lufsEstimate,
    dominantHz, spectralCentroid, spectralFlatness,
    noiseFloorDb, humProb, hissProb,
    contaminationProb, seamProb, silencePurity,
  };
}
