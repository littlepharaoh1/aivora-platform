/**
 * humRemover.ts — Notch filter hum removal (50/60 Hz + harmonics)
 * Aivora Honest Audio Repair Suite — Batch 9
 */

export interface HumRemoverOptions {
  frequency: 50 | 60;
  harmonics?: number;   // how many harmonics to notch (default 4)
  qFactor?:  number;    // notch Q (default 30 — narrow & safe)
  amount?:   number;    // 0.0–1.0 wet mix (default 1.0)
}

export interface HumRemoverResult {
  buffer:       AudioBuffer;
  changed:      boolean;
  notchesApplied: number;
  warnings:     string[];
}

interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

function notchCoeffs(freq: number, q: number, sampleRate: number): BiquadCoeffs {
  const w0    = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);
  const a0    = 1 + alpha;
  return {
    b0:  1 / a0,
    b1: (-2 * cosW0) / a0,
    b2:  1 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyNotch(samples: Float32Array, c: BiquadCoeffs, amount: number): Float32Array<ArrayBuffer> {
  const out: Float32Array<ArrayBuffer> = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i]   = amount * y0 + (1 - amount) * x0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

export function removeHum(
  buffer: AudioBuffer,
  options: HumRemoverOptions
): HumRemoverResult {
  const { frequency, harmonics = 4, qFactor = 30, amount = 1.0 } = options;
  const sr       = buffer.sampleRate;
  const warnings: string[] = [];

  // Safety check: don't notch above Nyquist
  const maxHarmonic = Math.floor((sr / 2 - 100) / frequency);
  const actualHarmonics = Math.min(harmonics, maxHarmonic);
  if (actualHarmonics < harmonics) {
    warnings.push(`Only ${actualHarmonics} harmonics applied (Nyquist limit at ${sr / 2} Hz)`);
  }

  // Build output buffer
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sr);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    let data = new Float32Array(buffer.getChannelData(ch));
    for (let h = 1; h <= actualHarmonics; h++) {
      const freq   = frequency * h;
      const coeffs = notchCoeffs(freq, qFactor, sr);
      data = applyNotch(data, coeffs, amount);
    }
    out.getChannelData(ch).set(data);
  }

  return {
    buffer:         out,
    changed:        true,
    notchesApplied: actualHarmonics,
    warnings,
  };
}
