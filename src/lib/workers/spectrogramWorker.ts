/**
 * spectrogramWorker.ts — Off-main-thread Spectrogram Computation
 * Aivora Platform — P0.6 Fix
 *
 * Architecture:
 * - Runs computeSpectrogramPro off main thread
 * - Transferable ArrayBuffer output (zero-copy back to main)
 * - Chunked FFT with progress reporting
 * - Cancellation via generation counter
 * - Mobile-safe: yields between chunks
 */

// ── Inline FFT (Cooley-Tukey — same as existing STFT worker) ──────────────────

function runFFT(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1) j^=bit;
    j^=bit;
    if(i<j){
      [re[i],re[j]]=[re[j],re[i]];
      [im[i],im[j]]=[im[j],im[i]];
    }
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len;
    const wRe=Math.cos(ang), wIm=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let curRe=1, curIm=0;
      for(let j=0;j<len/2;j++){
        const uRe=re[i+j],           uIm=im[i+j];
        const vRe=re[i+j+len/2]*curRe - im[i+j+len/2]*curIm;
        const vIm=re[i+j+len/2]*curIm + im[i+j+len/2]*curRe;
        re[i+j]        = uRe+vRe; im[i+j]        = uIm+vIm;
        re[i+j+len/2]  = uRe-vRe; im[i+j+len/2]  = uIm-vIm;
        const nRe=curRe*wRe-curIm*wIm;
        curIm=curRe*wIm+curIm*wRe;
        curRe=nRe;
      }
    }
  }
}

function makeHannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for(let i=0;i<n;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(n-1)));
  return w;
}

// ── Worker Message Handler ────────────────────────────────────────────────────

interface SpectrogramRequest {
  id:       number;     // generation counter — stale requests ignored
  samples:  ArrayBuffer; // mono Float32Array
  sr:       number;
  fftSize:  number;
  overlap:  number;
  minDb:    number;
  maxDb:    number;
}

self.onmessage = async (e: MessageEvent<SpectrogramRequest>) => {
  const { id, samples, sr, fftSize, overlap, minDb, maxDb } = e.data;

  const mono    = new Float32Array(samples);
  const hopSize = Math.max(1, Math.floor(fftSize * (1 - overlap)));
  const numBins = fftSize / 2;
  const window  = makeHannWindow(fftSize);

  const totalFrames = Math.max(0,
    Math.floor((mono.length - fftSize) / hopSize) + 1
  );

  // Pre-allocate flat output buffer (transferable)
  const flatTex  = new Float32Array(totalFrames * numBins);
  const CHUNK    = 32; // frames per chunk (yield between chunks)
  let   frameIdx = 0;

  for(let chunkStart = 0; chunkStart < totalFrames; chunkStart += CHUNK) {
    const chunkEnd = Math.min(chunkStart + CHUNK, totalFrames);

    for(let f = chunkStart; f < chunkEnd; f++) {
      const start = f * hopSize;
      const re    = new Float64Array(fftSize);
      const im    = new Float64Array(fftSize);

      for(let i = 0; i < fftSize; i++) {
        re[i] = (start + i < mono.length)
          ? mono[start + i] * window[i]
          : 0;
      }

      runFFT(re, im);

      const base = frameIdx * numBins;
      for(let i = 0; i < numBins; i++) {
        const m = Math.sqrt(re[i]**2 + im[i]**2) / fftSize;
        flatTex[base + i] = Math.max(minDb, Math.min(maxDb,
          20 * Math.log10(m + 1e-10)
        ));
      }
      frameIdx++;
    }

    // Report progress
    const progress = Math.round((chunkEnd / totalFrames) * 100);
    (self as unknown as Worker).postMessage({
      type: "progress", id, progress,
    });

    // Yield to prevent watchdog termination on mobile
    await new Promise(r => setTimeout(r, 0));
  }

  // Transfer flat buffer zero-copy back to main thread
  (self as unknown as Worker).postMessage({
    type:      "complete",
    id,
    nFrames:   totalFrames,
    nBins:     numBins,
    sampleRate:sr,
    fftSize,
    flatTex:   flatTex.buffer,
  }, [flatTex.buffer]);
};
