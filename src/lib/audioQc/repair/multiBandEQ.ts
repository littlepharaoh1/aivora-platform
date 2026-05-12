/**
 * multiBandEQ.ts — Multi-band parametric EQ
 * Aivora Audio QC Engine
 */

export interface EQBand {
  frequency: number;  // Hz
  gain:      number;  // dB (-12 to +12)
  q:         number;  // Q factor
  type:      "lowshelf" | "highshelf" | "peak" | "highpass" | "lowpass";
}

export interface EQOptions {
  bands: EQBand[];
}

export interface EQResult {
  buffer:   AudioBuffer;
  changed:  boolean;
  warnings: string[];
}

interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

function computeCoeffs(band: EQBand, sr: number): BiquadCoeffs {
  const A  = Math.pow(10, band.gain / 40);
  const w0 = 2 * Math.PI * band.frequency / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * band.q);

  switch (band.type) {
    case "peak": {
      const b0 =  1 + alpha * A;
      const b1 = -2 * cos;
      const b2 =  1 - alpha * A;
      const a0 =  1 + alpha / A;
      const a1 = -2 * cos;
      const a2 =  1 - alpha / A;
      return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    case "lowshelf": {
      const b0 =  A*((A+1)-(A-1)*cos+2*Math.sqrt(A)*alpha);
      const b1 =  2*A*((A-1)-(A+1)*cos);
      const b2 =  A*((A+1)-(A-1)*cos-2*Math.sqrt(A)*alpha);
      const a0 =     (A+1)+(A-1)*cos+2*Math.sqrt(A)*alpha;
      const a1 = -2*((A-1)+(A+1)*cos);
      const a2 =     (A+1)+(A-1)*cos-2*Math.sqrt(A)*alpha;
      return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    case "highshelf": {
      const b0 =  A*((A+1)+(A-1)*cos+2*Math.sqrt(A)*alpha);
      const b1 = -2*A*((A-1)+(A+1)*cos);
      const b2 =  A*((A+1)+(A-1)*cos-2*Math.sqrt(A)*alpha);
      const a0 =     (A+1)-(A-1)*cos+2*Math.sqrt(A)*alpha;
      const a1 =  2*((A-1)-(A+1)*cos);
      const a2 =     (A+1)-(A-1)*cos-2*Math.sqrt(A)*alpha;
      return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    case "highpass": {
      const b0 =  (1+cos)/2;
      const b1 = -(1+cos);
      const b2 =  (1+cos)/2;
      const a0 =   1+alpha;
      const a1 =  -2*cos;
      const a2 =   1-alpha;
      return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
    case "lowpass":
    default: {
      const b0 =  (1-cos)/2;
      const b1 =   1-cos;
      const b2 =  (1-cos)/2;
      const a0 =   1+alpha;
      const a1 =  -2*cos;
      const a2 =   1-alpha;
      return { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 };
    }
  }
}

function applyBiquad(
  samples: Float32Array,
  c: BiquadCoeffs
): Float32Array<ArrayBuffer> {
  const out: Float32Array<ArrayBuffer> = new Float32Array(samples.length);
  let x1=0,x2=0,y1=0,y2=0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = c.b0*x0 + c.b1*x1 + c.b2*x2 - c.a1*y1 - c.a2*y2;
    out[i]=y0; x2=x1; x1=x0; y2=y1; y1=y0;
  }
  return out;
}

export function applyEQ(buffer: AudioBuffer, options: EQOptions): EQResult {
  const sr      = buffer.sampleRate;
  const warnings: string[] = [];
  if (options.bands.length === 0)
    return { buffer, changed: false, warnings: ["No EQ bands defined"] };

  const ctx    = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sr);
  const outBuf = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    let data: Float32Array<ArrayBuffer> = new Float32Array(buffer.getChannelData(ch));
    for (const band of options.bands) {
      if (Math.abs(band.gain) < 0.1 && band.type === "peak") continue;
      const coeffs = computeCoeffs(band, sr);
      data = applyBiquad(data, coeffs);
    }
    outBuf.getChannelData(ch).set(data);
  }

  return { buffer: outBuf, changed: true, warnings };
}

// Preset EQ profiles for speech clarity
export const SPEECH_CLARITY_EQ: EQBand[] = [
  { frequency: 80,   gain: -6,  q: 0.7, type: "highpass"  },  // Remove rumble
  { frequency: 200,  gain: -3,  q: 1.0, type: "peak"      },  // Reduce muddiness
  { frequency: 1000, gain: +2,  q: 1.5, type: "peak"      },  // Boost presence
  { frequency: 3000, gain: +3,  q: 1.0, type: "peak"      },  // Boost clarity
  { frequency: 8000, gain: -2,  q: 0.7, type: "highshelf" },  // Tame harshness
];

export const HUM_FILTER_EQ: EQBand[] = [
  { frequency: 50,  gain: -12, q: 10, type: "peak" },
  { frequency: 100, gain: -8,  q: 10, type: "peak" },
  { frequency: 150, gain: -6,  q: 10, type: "peak" },
  { frequency: 60,  gain: -12, q: 10, type: "peak" },
  { frequency: 120, gain: -8,  q: 10, type: "peak" },
];
