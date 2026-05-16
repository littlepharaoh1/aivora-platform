// fftWorker.js — FFT Web Worker
// Aivora Forensic DSP Platform

function hannWindow(size) {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  return w;
}

function runFFT(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
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
        const nRe = cRe*wRe - cIm*wIm; cIm = cRe*wIm + cIm*wRe; cRe = nRe;
      }
    }
  }
}

self.onmessage = function(e) {
  const { mono, sampleRate, fftSize, minDb, maxDb, id } = e.data;
  const hopSize = Math.floor(fftSize / 8);
  const numBins = fftSize / 2;
  const window  = hannWindow(fftSize);
  const frames  = [];

  for (let start = 0; start + fftSize <= mono.length; start += hopSize) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = mono[start + i] * window[i];
    runFFT(re, im);
    const mag = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      const m = Math.sqrt(re[i] ** 2 + im[i] ** 2) / fftSize;
      mag[i] = Math.max(minDb, Math.min(maxDb, 20 * Math.log10(m + 1e-10)));
    }
    frames.push(mag);
  }

  self.postMessage({ frames, sampleRate, fftSize, minDb, maxDb, id });
};
