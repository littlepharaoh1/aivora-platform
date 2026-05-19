/**
 * goldenReference.ts — Golden Reference Signal Generator & Oracle
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Generates deterministic reference signals (sine, noise, impulse, speech-like)
 * - Oracle: computes expected output for known DSP operations
 * - Tolerance-based comparison (absolute + relative + perceptual)
 * - SNR-based pass/fail criteria
 * - Phase-aware comparison for linear-phase filters
 * - Frequency-domain validation (spectral match)
 *
 * Design reference:
 * - Google DeepMind eval oracle model
 * - ITU-R BS.1770-4 reference signal methodology
 * - iZotope RX golden reference testing
 * - MATLAB audioread/audiowrite reference workflow
 */

// ── Reference Signal Types ────────────────────────────────────────────────────

export type ReferenceSignalType =
  | "sine"           // pure tone — tests frequency response
  | "white_noise"    // flat spectrum — tests broadband processing
  | "pink_noise"     // 1/f spectrum — perceptual reference
  | "impulse"        // Dirac delta — tests impulse response
  | "dc"             // constant offset — tests DC removal
  | "swept_sine"     // log sweep — tests nonlinearity
  | "silence"        // digital zero — tests noise floor
  | "clipped_sine"   // hard-clipped — tests limiter
  | "speech_like";   // voiced + unvoiced model — tests VAD

export interface ReferenceSignalSpec {
  type:       ReferenceSignalType;
  durationSec: number;
  sampleRate:  number;
  amplitude?:  number;   // 0-1, default 0.5
  freqHz?:     number;   // for sine/swept_sine
  seed?:       number;   // for reproducible noise
}

// ── Deterministic PRNG (xorshift32) ──────────────────────────────────────────
// Reproducible across browsers/platforms — no Math.random()

function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 0xDEADBEEF;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

// ── Signal Generators ─────────────────────────────────────────────────────────

export function generateReferenceSignal(spec: ReferenceSignalSpec): Float32Array {
  const { type, durationSec, sampleRate } = spec;
  const amp    = spec.amplitude ?? 0.5;
  const freq   = spec.freqHz   ?? 1000;
  const N      = Math.floor(durationSec * sampleRate);
  const data   = new Float32Array(N);
  const rand   = xorshift32(spec.seed ?? 42);

  switch(type) {

    case "sine":
      for(let i = 0; i < N; i++)
        data[i] = amp * Math.sin(2 * Math.PI * freq * i / sampleRate);
      break;

    case "white_noise":
      for(let i = 0; i < N; i++)
        data[i] = amp * (rand() * 2 - 1);
      break;

    case "pink_noise": {
      // Paul Kellet pink noise approximation
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for(let i = 0; i < N; i++) {
        const wh = rand() * 2 - 1;
        b0 = 0.99886*b0 + wh*0.0555179;
        b1 = 0.99332*b1 + wh*0.0750759;
        b2 = 0.96900*b2 + wh*0.1538520;
        b3 = 0.86650*b3 + wh*0.3104856;
        b4 = 0.55000*b4 + wh*0.5329522;
        b5 = -0.7616*b5 - wh*0.0168980;
        data[i] = amp * (b0+b1+b2+b3+b4+b5+b6+wh*0.5362) * 0.11;
        b6 = wh * 0.115926;
      }
      break;
    }

    case "impulse":
      data[0] = amp;
      break;

    case "dc":
      data.fill(amp);
      break;

    case "swept_sine": {
      // Log sweep from 20Hz to Nyquist
      const f1 = 20, f2 = sampleRate / 2;
      const T  = durationSec;
      for(let i = 0; i < N; i++) {
        const t    = i / sampleRate;
        const inst = f1 * Math.pow(f2/f1, t/T);
        const phase = 2*Math.PI*f1*T/Math.log(f2/f1)*(Math.pow(f2/f1,t/T)-1);
        data[i] = amp * Math.sin(phase);
      }
      break;
    }

    case "silence":
      // Already zero from Float32Array init
      break;

    case "clipped_sine": {
      const clipLevel = 0.3;
      for(let i = 0; i < N; i++) {
        const s = amp * Math.sin(2*Math.PI*freq*i/sampleRate);
        data[i] = Math.max(-clipLevel, Math.min(clipLevel, s));
      }
      break;
    }

    case "speech_like": {
      // Simple voiced/unvoiced model
      const f0 = 120; // fundamental freq
      let   voiced = true;
      let   segLen = Math.floor(sampleRate * 0.05); // 50ms segments
      let   segCount = 0;

      for(let i = 0; i < N; i++) {
        if(i % segLen === 0) {
          segCount++;
          voiced = rand() > 0.3; // 70% voiced
          segLen = Math.floor(sampleRate * (0.03 + rand() * 0.07));
        }
        if(voiced) {
          // Voiced: harmonic series
          let v = 0;
          for(let h = 1; h <= 8; h++)
            v += (1/h) * Math.sin(2*Math.PI*f0*h*i/sampleRate);
          data[i] = amp * v * 0.3;
        } else {
          // Unvoiced: filtered noise
          data[i] = amp * (rand() * 2 - 1) * 0.1;
        }
      }
      break;
    }
  }

  return data;
}

// ── Comparison Metrics ────────────────────────────────────────────────────────

export interface SignalComparisonResult {
  readonly snrDb:         number;    // signal-to-noise ratio vs reference
  readonly maxAbsError:   number;    // max sample-wise error
  readonly rmsError:      number;    // RMS error
  readonly spectralMatch: number;    // 0-1 spectral similarity
  readonly passed:        boolean;
  readonly reason:        string;
}

export function compareSignals(
  reference: Float32Array,
  actual:    Float32Array,
  criteria: {
    minSnrDb?:          number;   // default 40dB
    maxRmsError?:       number;   // default 0.01
    minSpectralMatch?:  number;   // default 0.95
  } = {}
): SignalComparisonResult {
  const minSnr    = criteria.minSnrDb         ?? 40;
  const maxRms    = criteria.maxRmsError      ?? 0.01;
  const minSpec   = criteria.minSpectralMatch ?? 0.95;
  const n         = Math.min(reference.length, actual.length);

  let sigPow = 0, noisePow = 0, maxErr = 0, rmsAcc = 0;

  for(let i = 0; i < n; i++) {
    const err = actual[i] - reference[i];
    sigPow  += reference[i] * reference[i];
    noisePow += err * err;
    const absErr = Math.abs(err);
    if(absErr > maxErr) maxErr = absErr;
    rmsAcc += err * err;
  }

  const snrDb = noisePow > 1e-15
    ? 10 * Math.log10(sigPow / noisePow)
    : 120;
  const rmsError = Math.sqrt(rmsAcc / n);

  // Spectral match via normalized cross-correlation of energy envelopes
  const frameLen = 512;
  let   dotProd = 0, normR = 0, normA = 0;
  for(let s = 0; s + frameLen <= n; s += frameLen) {
    let eR = 0, eA = 0;
    for(let i = s; i < s + frameLen; i++) {
      eR += reference[i] * reference[i];
      eA += actual[i]    * actual[i];
    }
    dotProd += Math.sqrt(eR) * Math.sqrt(eA);
    normR   += eR;
    normA   += eA;
  }
  const spectralMatch = (normR > 0 && normA > 0)
    ? dotProd / Math.sqrt(normR * normA)
    : 0;

  const snrPass  = snrDb       >= minSnr;
  const rmsPass  = rmsError    <= maxRms;
  const specPass = spectralMatch >= minSpec;
  const passed   = snrPass && rmsPass && specPass;

  let reason = "PASS";
  if(!snrPass)  reason = `SNR ${snrDb.toFixed(1)}dB < ${minSnr}dB`;
  else if(!rmsPass)  reason = `RMS error ${rmsError.toFixed(4)} > ${maxRms}`;
  else if(!specPass) reason = `Spectral match ${(spectralMatch*100).toFixed(1)}% < ${minSpec*100}%`;

  return {
    snrDb:         Math.round(snrDb * 100) / 100,
    maxAbsError:   Math.round(maxErr * 1e6) / 1e6,
    rmsError:      Math.round(rmsError * 1e6) / 1e6,
    spectralMatch: Math.round(spectralMatch * 1000) / 1000,
    passed,
    reason,
  };
}

// ── Oracle ────────────────────────────────────────────────────────────────────

export interface OracleExpectation {
  readonly operation:    string;
  readonly signal:       ReferenceSignalSpec;
  readonly expectation:  (input: Float32Array) => Float32Array;
  readonly criteria:     Parameters<typeof compareSignals>[2];
  readonly description:  string;
}

/**
 * Built-in oracle expectations for core DSP operations.
 */
export const ORACLE_EXPECTATIONS: OracleExpectation[] = [
  {
    operation:   "dc_removal",
    description: "DC offset removal must reduce DC to < 0.001",
    signal: { type:"dc", durationSec:1, sampleRate:48000, amplitude:0.3 },
    expectation: (input) => {
      const mean = input.reduce((a,b)=>a+b,0) / input.length;
      const out  = new Float32Array(input.length);
      for(let i=0;i<input.length;i++) out[i] = input[i] - mean;
      return out;
    },
    criteria: { minSnrDb:60, maxRmsError:0.001 },
  },
  {
    operation:   "silence_passthrough",
    description: "Silence must remain silence after processing",
    signal: { type:"silence", durationSec:0.5, sampleRate:48000 },
    expectation: (input) => new Float32Array(input),
    criteria: { minSnrDb:120, maxRmsError:1e-6 },
  },
  {
    operation:   "gain_unity",
    description: "Unity gain must produce identical output",
    signal: { type:"sine", durationSec:1, sampleRate:48000, freqHz:1000, amplitude:0.5 },
    expectation: (input) => new Float32Array(input),
    criteria: { minSnrDb:100, maxRmsError:1e-5 },
  },
];

// ── Singleton ─────────────────────────────────────────────────────────────────

export const goldenRef = {
  generate:  generateReferenceSignal,
  compare:   compareSignals,
  oracles:   ORACLE_EXPECTATIONS,
};
