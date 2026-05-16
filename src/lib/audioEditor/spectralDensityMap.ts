/**
 * spectralDensityMap.ts — Spectral Density & Energy Analysis
 * Aivora Forensic DSP Platform
 */

export interface SpectralDensityData {
  energyMap:      Float32Array;   // per-frame RMS energy
  entropyMap:     Float32Array;   // per-frame spectral entropy
  transientMap:   Float32Array;   // transient energy delta
  numFrames:      number;
  durationSec:    number;
}

export function computeSpectralDensity(
  mono:       Float32Array,
  sampleRate: number,
  fftSize:    number = 2048
): SpectralDensityData {
  const hopSize   = Math.floor(fftSize / 4);
  const numBins   = fftSize / 2;
  const frames: number[] = [];

  // Hann window
  const win = new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) win[i] = 0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)));

  const energyMap:   number[] = [];
  const entropyMap:  number[] = [];
  const transientMap: number[] = [];
  let prevEnergy = 0;

  for(let start=0; start+fftSize<=mono.length; start+=hopSize) {
    // RMS energy
    let sum = 0;
    for(let i=0;i<fftSize;i++) sum += mono[start+i]**2;
    const energy = Math.sqrt(sum/fftSize);
    energyMap.push(energy);

    // Spectral entropy (simplified via magnitude distribution)
    const bins = new Float32Array(numBins);
    let totalMag = 0;
    for(let k=1;k<numBins;k++) {
      let re=0, im=0;
      const step = Math.max(1, Math.floor(fftSize/128));
      for(let n=0;n<fftSize;n+=step) {
        const angle = (2*Math.PI*k*n)/fftSize;
        re += mono[start+n]*win[n]*Math.cos(angle);
        im += mono[start+n]*win[n]*Math.sin(angle);
      }
      bins[k] = Math.sqrt(re*re+im*im);
      totalMag += bins[k];
    }

    let entropy = 0;
    if(totalMag > 0) {
      for(let k=1;k<numBins;k++) {
        const p = bins[k]/totalMag;
        if(p > 0) entropy -= p*Math.log2(p);
      }
      entropy /= Math.log2(numBins); // normalize 0-1
    }
    entropyMap.push(entropy);

    // Transient detection
    const energyDelta = Math.abs(energy - prevEnergy);
    transientMap.push(Math.min(1, energyDelta * 20));
    prevEnergy = energy;

    frames.push(start/sampleRate);
  }

  return {
    energyMap:   new Float32Array(energyMap),
    entropyMap:  new Float32Array(entropyMap),
    transientMap: new Float32Array(transientMap),
    numFrames:   energyMap.length,
    durationSec: mono.length/sampleRate,
  };
}

export function drawSpectralDensityOverlay(
  canvas:  HTMLCanvasElement,
  data:    SpectralDensityData,
  opts: {
    zoom:      number;
    panOffset: number;
    height:    number;
    width:     number;
    mode:      "energy"|"entropy"|"transient";
  }
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx || data.numFrames === 0) return;
  const { zoom, panOffset, height, width, mode } = opts;

  const map = mode === "energy"    ? data.energyMap   :
              mode === "entropy"   ? data.entropyMap   :
                                     data.transientMap;

  const frameDur = data.durationSec / data.numFrames;

  for(let f=0; f<data.numFrames; f++) {
    const sec = f * frameDur;
    const x1  = (sec - panOffset) * zoom;
    const x2  = ((sec + frameDur) - panOffset) * zoom;
    if(x2 < 0 || x1 > width) continue;

    const val = map[f];
    const alpha = Math.min(0.6, val * 0.8);

    const color = mode === "energy"
      ? `rgba(0,255,136,${alpha})`
      : mode === "entropy"
      ? `rgba(139,92,246,${alpha})`
      : `rgba(239,68,68,${alpha})`;

    ctx.fillStyle = color;
    ctx.fillRect(x1, height - val*height*0.3, Math.max(1,x2-x1), val*height*0.3);
  }
}
