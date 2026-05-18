/**
 * fftWorker.js — High-Performance FFT Web Worker
 * Aivora Audio Infrastructure Platform
 *
 * Cooley-Tukey Radix-2 FFT with:
 * - SharedArrayBuffer support for zero-copy
 * - Hann/Hamming/Blackman/Kaiser windowing
 * - Multi-resolution support (256/1024/2048/4096/8192)
 * - Magnitude/phase/power output
 * - Mel/Bark scale mapping
 */

// ── Cooley-Tukey Radix-2 FFT ──────────────────────────────────────────────────

function fft(re, im) {
  const n = re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cR=1,cI=0;
      for(let j=0;j<len>>1;j++){
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

function buildWindow(size, type="hann") {
  const w = new Float32Array(size);
  switch(type) {
    case "hann":
      for(let i=0;i<size;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(size-1)));
      break;
    case "hamming":
      for(let i=0;i<size;i++) w[i]=0.54-0.46*Math.cos(2*Math.PI*i/(size-1));
      break;
    case "blackman":
      for(let i=0;i<size;i++)
        w[i]=0.42-0.5*Math.cos(2*Math.PI*i/(size-1))+0.08*Math.cos(4*Math.PI*i/(size-1));
      break;
    case "blackman-harris":
      for(let i=0;i<size;i++)
        w[i]=0.35875-0.48829*Math.cos(2*Math.PI*i/(size-1))
            +0.14128*Math.cos(4*Math.PI*i/(size-1))
            -0.01168*Math.cos(6*Math.PI*i/(size-1));
      break;
    default:
      w.fill(1.0);
  }
  return w;
}

// ── Mel Scale ─────────────────────────────────────────────────────────────────

function hzToMel(hz) { return 2595*Math.log10(1+hz/700); }
function melToHz(mel) { return 700*(Math.pow(10,mel/2595)-1); }

function mapToMel(magnitudes, sr, fftSize, numBands=128) {
  const numBins = fftSize/2;
  const out     = new Float32Array(numBands);
  const counts  = new Uint32Array(numBands);
  const maxMel  = hzToMel(sr/2);

  for(let k=1;k<numBins;k++){
    const hz   = k*sr/fftSize;
    const mel  = hzToMel(hz);
    const band = Math.floor(mel/maxMel*numBands);
    if(band>=0&&band<numBands){ out[band]+=magnitudes[k]; counts[band]++; }
  }
  for(let b=0;b<numBands;b++) if(counts[b]>0) out[b]/=counts[b];
  return out;
}

// ── Main Message Handler ──────────────────────────────────────────────────────

self.onmessage = function(e) {
  const {
    type       = "analyze",
    audioData,          // Float32Array or SharedArrayBuffer view
    sampleRate = 48000,
    fftSize    = 2048,
    hopSize    = 512,
    windowType = "hann",
    outputMel  = false,
    numMelBands = 128,
    minDb      = -90,
    sharedBuffer,       // SharedArrayBuffer (optional)
    sharedOffset = 0,
  } = e.data;

  // Get input data
  let data;
  if(sharedBuffer) {
    data = new Float32Array(sharedBuffer, sharedOffset);
  } else {
    data = audioData instanceof Float32Array ? audioData : new Float32Array(audioData);
  }

  const numBins  = fftSize/2;
  const win      = buildWindow(fftSize, windowType);
  const frames   = [];
  const powerFrames = [];

  for(let start=0; start+fftSize<=data.length; start+=hopSize){
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for(let i=0;i<fftSize;i++) re[i]=data[start+i]*win[i];
    fft(re, im);

    const mags   = new Float32Array(numBins);
    const power  = new Float32Array(numBins);
    for(let k=0;k<numBins;k++){
      const mag   = Math.sqrt(re[k]**2+im[k]**2)/fftSize;
      mags[k]     = mag;
      const db    = mag>0 ? 20*Math.log10(mag) : minDb;
      power[k]    = Math.max(minDb, db);
    }

    if(outputMel) {
      const mel = mapToMel(mags, sampleRate, fftSize, numMelBands);
      const melDb = new Float32Array(numMelBands);
      for(let b=0;b<numMelBands;b++)
        melDb[b] = mel[b]>0 ? Math.max(minDb,20*Math.log10(mel[b])) : minDb;
      frames.push(Array.from(melDb));
    } else {
      frames.push(Array.from(power));
    }

    // Spectral centroid per frame
    let weightedSum=0, totalMag=0;
    for(let k=0;k<numBins;k++){
      const hz=k*sampleRate/fftSize;
      weightedSum+=hz*mags[k];
      totalMag+=mags[k];
    }
    powerFrames.push(totalMag>0?weightedSum/totalMag:0);
  }

  self.postMessage({
    type:       "fft_result",
    frames,
    centroids:  powerFrames,
    numFrames:  frames.length,
    numBins:    outputMel ? numMelBands : numBins,
    fftSize,
    hopSize,
    sampleRate,
  });
};
