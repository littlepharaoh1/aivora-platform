/**
 * harmonicTracker.ts — Harmonic Tracking & Room Tone Fingerprinting
 * Aivora Forensic DSP Platform
 */

export interface HarmonicFrame {
  timeSec:     number;
  fundamental: number;   // Hz
  harmonics:   number[]; // Hz list
  energy:      number;
  inHarmonic:  number;   // 0-1 inharmonicity score
}

export interface RoomToneProfile {
  noiseFloorDb:   number;
  dominantHz:     number[];
  spectralShape:  Float32Array;
  fingerprint:    string;
}

// ── Harmonic Tracking ─────────────────────────────────────────────────────────

export function trackHarmonics(
  mono:       Float32Array,
  sampleRate: number,
  fftSize:    number = 4096
): HarmonicFrame[] {
  const hopSize = Math.floor(fftSize / 4);
  const numBins = fftSize / 2;
  const frames: HarmonicFrame[] = [];

  // Hann window
  const win = new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)));

  for(let start=0; start+fftSize<=mono.length; start+=hopSize*4) {
    const timeSec = start/sampleRate;

    // FFT magnitude
    const mag = new Float32Array(numBins);
    let totalEnergy = 0;
    const step = Math.max(1,Math.floor(fftSize/256));

    for(let k=1;k<numBins;k++) {
      let re=0,im=0;
      for(let n=0;n<fftSize;n+=step) {
        const angle=(2*Math.PI*k*n)/fftSize;
        re+=mono[start+n]*win[n]*Math.cos(angle);
        im+=mono[start+n]*win[n]*Math.sin(angle);
      }
      mag[k]=Math.sqrt(re*re+im*im);
      totalEnergy+=mag[k];
    }

    if(totalEnergy < 0.001) continue;

    // Find fundamental (strongest low-freq peak)
    let fundamental = 0;
    let maxMag = 0;
    const minBin = Math.floor(50*fftSize/sampleRate);
    const maxBin = Math.floor(1000*fftSize/sampleRate);

    for(let k=minBin;k<maxBin;k++) {
      if(mag[k]>maxMag && mag[k]>mag[k-1] && mag[k]>mag[k+1]) {
        maxMag=mag[k]; fundamental=k*sampleRate/fftSize;
      }
    }

    if(fundamental < 50) continue;

    // Find harmonics
    const harmonics: number[] = [];
    let inHarmonic = 0;
    for(let h=2;h<=8;h++) {
      const expectedHz = fundamental*h;
      const expectedBin = Math.round(expectedHz*fftSize/sampleRate);
      if(expectedBin >= numBins) break;

      // Search around expected bin
      let peakBin = expectedBin;
      let peakMag = 0;
      for(let b=Math.max(0,expectedBin-3);b<Math.min(numBins,expectedBin+3);b++) {
        if(mag[b]>peakMag) { peakMag=mag[b]; peakBin=b; }
      }

      const actualHz = peakBin*sampleRate/fftSize;
      harmonics.push(actualHz);

      // Inharmonicity = deviation from perfect harmonic
      const deviation = Math.abs(actualHz-expectedHz)/expectedHz;
      inHarmonic += deviation;
    }

    frames.push({
      timeSec,
      fundamental,
      harmonics,
      energy: totalEnergy/numBins,
      inHarmonic: Math.min(1, inHarmonic/harmonics.length),
    });
  }

  return frames;
}

// ── Room Tone Fingerprinting ──────────────────────────────────────────────────

export function fingerPrintRoomTone(
  mono:       Float32Array,
  sampleRate: number,
  fftSize:    number = 4096
): RoomToneProfile {
  const numBins = fftSize/2;
  const spectralShape = new Float32Array(numBins);
  const step = Math.max(1,Math.floor(fftSize/128));
  let frameCount = 0;

  // Average spectrum of silence regions
  for(let start=0; start+fftSize<=mono.length; start+=fftSize) {
    let rms=0;
    for(let i=0;i<fftSize;i++) rms+=mono[start+i]**2;
    rms=Math.sqrt(rms/fftSize);
    if(rms>0.01) continue; // skip speech

    for(let k=1;k<numBins;k++) {
      let re=0,im=0;
      for(let n=0;n<fftSize;n+=step) {
        const angle=(2*Math.PI*k*n)/fftSize;
        re+=mono[start+n]*Math.cos(angle);
        im+=mono[start+n]*Math.sin(angle);
      }
      spectralShape[k]+=Math.sqrt(re*re+im*im);
    }
    frameCount++;
  }

  if(frameCount>0) for(let k=0;k<numBins;k++) spectralShape[k]/=frameCount;

  // Find dominant frequencies in room tone
  const dominantHz: number[] = [];
  for(let k=1;k<numBins-1;k++) {
    if(spectralShape[k]>spectralShape[k-1] &&
       spectralShape[k]>spectralShape[k+1] &&
       spectralShape[k]>0.001) {
      dominantHz.push(k*sampleRate/fftSize);
      if(dominantHz.length>=5) break;
    }
  }

  // Noise floor
  let sumDb=0;
  for(let i=0;i<mono.length;i+=1000) {
    const a=Math.abs(mono[i]);
    if(a>0) sumDb+=20*Math.log10(a);
  }
  const noiseFloorDb = sumDb/(mono.length/1000);

  // Simple fingerprint hash
  const fingerprint = dominantHz.map(h=>Math.round(h)).join("-") +
    "_" + noiseFloorDb.toFixed(0);

  return { noiseFloorDb, dominantHz, spectralShape, fingerprint };
}

// ── Draw Harmonic Overlay ─────────────────────────────────────────────────────

export function drawHarmonicOverlay(
  canvas:  HTMLCanvasElement,
  frames:  HarmonicFrame[],
  opts: {
    zoom:      number;
    panOffset: number;
    height:    number;
    width:     number;
    sampleRate: number;
  }
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx||frames.length===0) return;
  const {zoom,panOffset,height,width,sampleRate} = opts;
  const nyquist = sampleRate/2;

  for(const frame of frames) {
    const x = (frame.timeSec - panOffset)*zoom;
    if(x<0||x>width) continue;

    // Fundamental line
    const yFund = height - (frame.fundamental/nyquist)*height*0.8;
    ctx.fillStyle=`rgba(0,255,136,${Math.min(0.8,frame.energy*10)})`;
    ctx.fillRect(x,yFund,Math.max(2,zoom*0.2),2);

    // Harmonic lines
    frame.harmonics.forEach((hz,i)=>{
      const y = height - (hz/nyquist)*height*0.8;
      ctx.fillStyle=`rgba(139,92,246,${Math.min(0.6,frame.energy*8/(i+2))})`;
      ctx.fillRect(x,y,Math.max(1,zoom*0.15),1);
    });

    // Inharmonicity warning
    if(frame.inHarmonic>0.05) {
      ctx.fillStyle=`rgba(239,68,68,${frame.inHarmonic*0.5})`;
      ctx.fillRect(x,0,Math.max(2,zoom*0.2),height*0.05);
    }
  }
}
