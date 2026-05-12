/**
 * noiseReducer.ts — Spectral Subtraction Noise Reduction
 * Aivora Audio QC Engine
 */

import { AudioProblem, makeProblem } from "../qcTypes";

export interface NoiseReducerOptions {
  strength:       number;   // 0.0–1.0 (default 0.7)
  noiseEstMs:     number;   // ms to use for noise estimation (default 500)
  overSubtract:   number;   // over-subtraction factor (default 1.2)
}

export interface NoiseReducerResult {
  buffer:       AudioBuffer;
  changed:      boolean;
  noiseFloorDb: number;
  reductionDb:  number;
  warnings:     string[];
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len >> 1; j++) {
        const uRe = re[i+j], uIm = im[i+j];
        const vRe = re[i+j+len/2]*cRe - im[i+j+len/2]*cIm;
        const vIm = re[i+j+len/2]*cIm + im[i+j+len/2]*cRe;
        re[i+j] = uRe+vRe; im[i+j] = uIm+vIm;
        re[i+j+len/2] = uRe-vRe; im[i+j+len/2] = uIm-vIm;
        const nRe = cRe*wRe - cIm*wIm;
        cIm = cRe*wIm + cIm*wRe; cRe = nRe;
      }
    }
  }
}

function ifft(re: Float64Array, im: Float64Array): void {
  // Conjugate, FFT, conjugate, normalize
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < re.length; i++) { re[i] /= re.length; im[i] = -im[i] / re.length; }
}

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

export function reduceNoise(
  buffer:  AudioBuffer,
  options: NoiseReducerOptions = { strength: 0.7, noiseEstMs: 500, overSubtract: 1.2 }
): NoiseReducerResult {
  const { strength, noiseEstMs, overSubtract } = options;
  const sr       = buffer.sampleRate;
  const FFT_SIZE = 1024;
  const HOP_SIZE = FFT_SIZE / 4;
  const window   = hannWindow(FFT_SIZE);
  const warnings: string[] = [];

  if (strength > 0.9) warnings.push("High noise reduction strength may cause musical noise artifacts");

  const ctx    = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sr);
  const outBuf = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);

  // Estimate noise from first noiseEstMs
  const noiseFrames = Math.round((noiseEstMs / 1000) * sr);

  let noiseFloorDb = -120;
  let reductionDb  = 0;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = outBuf.getChannelData(ch);

    // Step 1: Estimate noise spectrum from beginning
    const noiseSpectrum = new Float64Array(FFT_SIZE / 2);
    let noiseCount = 0;

    for (let i = 0; i + FFT_SIZE <= Math.min(noiseFrames, src.length); i += HOP_SIZE) {
      const re = new Float64Array(FFT_SIZE);
      const im = new Float64Array(FFT_SIZE);
      for (let j = 0; j < FFT_SIZE; j++) re[j] = src[i+j] * window[j];
      fft(re, im);
      for (let j = 0; j < FFT_SIZE/2; j++)
        noiseSpectrum[j] += Math.sqrt(re[j]*re[j] + im[j]*im[j]);
      noiseCount++;
    }

    if (noiseCount > 0)
      for (let j = 0; j < noiseSpectrum.length; j++) noiseSpectrum[j] /= noiseCount;

    // Compute noise floor dB
    const avgNoise = noiseSpectrum.reduce((s,v) => s+v, 0) / noiseSpectrum.length;
    if (ch === 0) noiseFloorDb = avgNoise > 0 ? 20 * Math.log10(avgNoise) : -120;

    // Step 2: OLA spectral subtraction
    const output  = new Float64Array(src.length + FFT_SIZE);
    const overlap  = new Float64Array(src.length + FFT_SIZE);

    for (let i = 0; i + FFT_SIZE <= src.length; i += HOP_SIZE) {
      const re = new Float64Array(FFT_SIZE);
      const im = new Float64Array(FFT_SIZE);
      for (let j = 0; j < FFT_SIZE; j++) re[j] = src[i+j] * window[j];
      fft(re, im);

      // Spectral subtraction
      for (let j = 0; j < FFT_SIZE/2; j++) {
        const mag   = Math.sqrt(re[j]*re[j] + im[j]*im[j]);
        const phase = Math.atan2(im[j], re[j]);
        const noiseMag = noiseSpectrum[j] * overSubtract * strength;
        const newMag   = Math.max(mag * (1 - strength) * 0.1,
                                   Math.sqrt(Math.max(0, mag*mag - noiseMag*noiseMag)));
        re[j] = newMag * Math.cos(phase);
        im[j] = newMag * Math.sin(phase);
        // Mirror
        if (j > 0 && j < FFT_SIZE/2) {
          re[FFT_SIZE-j] = re[j];
          im[FFT_SIZE-j] = -im[j];
        }
      }

      ifft(re, im);

      // OLA
      for (let j = 0; j < FFT_SIZE; j++) {
        output[i+j]  += re[j] * window[j];
        overlap[i+j] += window[j] * window[j];
      }
    }

    // Normalize and copy
    let maxBefore = 0, maxAfter = 0;
    for (let i = 0; i < src.length; i++) if (Math.abs(src[i]) > maxBefore) maxBefore = Math.abs(src[i]);

    for (let i = 0; i < src.length; i++) {
      dest[i] = overlap[i] > 0.001
        ? Math.max(-1, Math.min(1, output[i] / overlap[i]))
        : src[i];
      if (Math.abs(dest[i]) > maxAfter) maxAfter = Math.abs(dest[i]);
    }

    if (ch === 0 && maxBefore > 0 && maxAfter > 0)
      reductionDb = 20 * Math.log10(maxBefore / maxAfter);
  }

  return { buffer: outBuf, changed: true, noiseFloorDb, reductionDb, warnings };
}
