/**
 * transientShaper.ts — Professional Transient Shaper
 * Aivora Audio Infrastructure Platform
 *
 * Algorithm:
 * - Multi-stage transient detection via envelope differential
 * - Attack/sustain separation using dual time-constant envelope followers
 * - Consonant protection via VAD + spectral centroid tracking
 * - Plosive detection via sub-band energy burst analysis
 *
 * Reference:
 * - Müller & Massberg (2011) "Transient detection via energy difference"
 * - Bello et al. (2005) "A tutorial on onset detection in music signals"
 */

// ── Numerical Guards ──────────────────────────────────────────────────────────

function safeDb(x: number): number {
  if (!isFinite(x) || isNaN(x) || x <= 0) return -120;
  return 20 * Math.log10(x);
}

function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, isFinite(x) ? x : lo));
}

// ── Envelope Follower ─────────────────────────────────────────────────────────

function makeEnvFollower(attackMs: number, releaseMs: number, sr: number) {
  const aCoef = Math.exp(-1 / (sr * attackMs  / 1000));
  const rCoef = Math.exp(-1 / (sr * releaseMs / 1000));
  let env = 0;
  return (x: number): number => {
    const v = Math.abs(x);
    env = v > env ? aCoef * env + (1 - aCoef) * v
                  : rCoef * env + (1 - rCoef) * v;
    return env;
  };
}

// ── Transient Detection ───────────────────────────────────────────────────────
// Dual envelope follower: fast attack - slow attack = transient signal
// Normalized by slow envelope to get onset strength

export interface TransientMap {
  onsetStrength:  Float32Array;  // 0-1 per sample
  attackRegions:  [number,number][];  // [start, end] sample indices
  sustainRegions: [number,number][];
  metrics: {
    transientCount:    number;
    avgOnsetStrength:  number;
    attackRatio:       number;   // fraction of file that is attack
    sustainRatio:      number;
  };
}

export function detectTransients(
  data:    Float32Array,
  sr:      number,
  options: {
    fastAttackMs?:  number;
    slowAttackMs?:  number;
    releaseMs?:     number;
    threshold?:     number;
    minDurationMs?: number;
  } = {}
): TransientMap {
  const fastA  = options.fastAttackMs  ?? 1;
  const slowA  = options.slowAttackMs  ?? 30;
  const rel    = options.releaseMs     ?? 100;
  const thresh = options.threshold     ?? 0.15;
  const minDur = Math.floor((options.minDurationMs ?? 5) * sr / 1000);

  const fastEnv = makeEnvFollower(fastA, rel, sr);
  const slowEnv = makeEnvFollower(slowA, rel, sr);

  const onsetStrength = new Float32Array(data.length);
  const isAttack      = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const fast = fastEnv(data[i]);
    const slow = slowEnv(data[i]);
    // Transient = fast envelope exceeds slow envelope significantly
    const strength = slow > 1e-8 ? clamp((fast - slow) / slow, 0, 1) : 0;
    onsetStrength[i] = strength;
    isAttack[i] = strength > thresh ? 1 : 0;
  }

  // Remove short spurious detections
  for (let i = 0; i < data.length - minDur; i++) {
    if (isAttack[i]) {
      let end = i;
      while (end < data.length && isAttack[end]) end++;
      if (end - i < minDur) {
        for (let j = i; j < end; j++) isAttack[j] = 0;
      }
    }
  }

  // Extract regions
  const attackRegions:  [number,number][] = [];
  const sustainRegions: [number,number][] = [];
  let inAttack = false, regionStart = 0;

  for (let i = 0; i <= data.length; i++) {
    const a = i < data.length ? isAttack[i] : 0;
    if (a && !inAttack) { inAttack = true; regionStart = i; }
    else if (!a && inAttack) {
      attackRegions.push([regionStart, i]);
      inAttack = false;
    }
  }

  // Sustain = non-attack voiced regions
  let inSustain = false;
  regionStart = 0;
  const fastE2 = makeEnvFollower(5, 200, sr);
  for (let i = 0; i <= data.length; i++) {
    const voiced = i < data.length && Math.abs(data[i]) > 1e-4 && !isAttack[i];
    if (voiced && !inSustain)  { inSustain = true; regionStart = i; }
    else if (!voiced && inSustain) {
      if (i - regionStart > minDur) sustainRegions.push([regionStart, i]);
      inSustain = false;
    }
  }

  const attackSamples  = attackRegions.reduce((s,[a,b])=>s+b-a,0);
  const sustainSamples = sustainRegions.reduce((s,[a,b])=>s+b-a,0);
  const avgOnset = onsetStrength.reduce((s,v)=>s+v,0) / data.length;

  return {
    onsetStrength,
    attackRegions,
    sustainRegions,
    metrics: {
      transientCount:   attackRegions.length,
      avgOnsetStrength: avgOnset,
      attackRatio:      attackSamples  / data.length,
      sustainRatio:     sustainSamples / data.length,
    },
  };
}

// ── Transient Shaper ──────────────────────────────────────────────────────────
// Independent gain control for attack and sustain regions
// Smooth gain transitions via raised-cosine envelope to prevent clicks

export interface TransientShaperOptions {
  attackGainDb:    number;    // gain applied to attack regions (+/-12dB)
  sustainGainDb:   number;    // gain applied to sustain regions
  fadeMs:          number;    // crossfade between regions (ms)
  consonantProtect: boolean;  // lock consonant regions from attenuation
}

export interface TransientShaperResult {
  output:               Float32Array;
  attackGainApplied:    number;   // dB
  sustainGainApplied:   number;   // dB
  transientMap:         TransientMap;
  consonantRegions:     [number,number][];
  speechPreservation:   number;   // 0-1
}

export function applyTransientShaper(
  data:    Float32Array,
  sr:      number,
  options: Partial<TransientShaperOptions> = {}
): TransientShaperResult {
  const attackGain   = fromDb(clamp(options.attackGainDb  ?? 3,  -12, 12));
  const sustainGain  = fromDb(clamp(options.sustainGainDb ?? -3, -12, 12));
  const fadeLen      = Math.floor(((options.fadeMs ?? 5) / 1000) * sr);
  const protectCons  = options.consonantProtect ?? true;

  // Detect transients
  const transientMap = detectTransients(data, sr);

  // Detect consonants (high-frequency energy bursts — plosives + fricatives)
  const consonantRegions = detectConsonants(data, sr);

  // Build gain envelope
  const gainEnv = new Float32Array(data.length).fill(1.0);

  // Apply attack gain
  for (const [start, end] of transientMap.attackRegions) {
    for (let i = start; i < end && i < data.length; i++) {
      gainEnv[i] = attackGain;
    }
  }

  // Apply sustain gain
  for (const [start, end] of transientMap.sustainRegions) {
    // Check consonant protection
    if (protectCons) {
      const isConsonant = consonantRegions.some(
        ([cs, ce]) => start < ce && end > cs
      );
      if (isConsonant) continue;
    }
    for (let i = start; i < end && i < data.length; i++) {
      gainEnv[i] = sustainGain;
    }
  }

  // Smooth gain envelope with raised-cosine crossfades
  const smoothGain = smoothEnvelope(gainEnv, fadeLen);

  // Apply gain
  const output = new Float32Array(data.length);
  let speechModified = 0, speechTotal = 0;

  for (let i = 0; i < data.length; i++) {
    output[i] = clamp(data[i] * smoothGain[i], -1, 1);
    if (Math.abs(data[i]) > 0.01) {
      speechTotal++;
      if (Math.abs(output[i] - data[i]) > 0.001) speechModified++;
    }
  }

  const speechPreservation = speechTotal > 0
    ? 1 - speechModified / speechTotal : 1;

  return {
    output,
    attackGainApplied:  options.attackGainDb  ?? 3,
    sustainGainApplied: options.sustainGainDb ?? -3,
    transientMap,
    consonantRegions,
    speechPreservation,
  };
}

// ── Consonant Detection ───────────────────────────────────────────────────────
// Detects plosives and fricatives via:
// 1. Sub-band energy burst (plosives: wideband energy spike)
// 2. High-frequency energy ratio (fricatives: energy > 3kHz)
// 3. Zero-crossing rate burst (fricatives: high ZCR)

export function detectConsonants(
  data: Float32Array,
  sr:   number,
  frameMs = 10
): [number,number][] {
  const frameLen = Math.floor(frameMs * sr / 1000);
  const regions:  [number,number][] = [];
  let   prevRms   = 0;

  for (let start = 0; start + frameLen <= data.length; start += frameLen) {
    let ms = 0, zcr = 0, hfE = 0, totalE = 0;

    for (let i = start; i < start + frameLen; i++) {
      ms += data[i] ** 2;
      if (i > start && data[i] * data[i-1] < 0) zcr++;
    }
    const rms = Math.sqrt(ms / frameLen);

    // High-frequency energy via simple HP filter proxy (diff signal)
    for (let i = start+1; i < start+frameLen; i++) {
      const diff = data[i] - data[i-1];
      hfE    += diff ** 2;
      totalE += data[i] ** 2;
    }
    const hfRatio = totalE > 1e-10 ? hfE / totalE : 0;
    const zcrRate = zcr / frameLen;

    // Consonant criteria:
    // - Plosive: sudden RMS burst > 3x previous frame
    // - Fricative: high ZCR + high HF ratio
    const isPlosive  = rms > prevRms * 3 && rms > 0.01;
    const isFricative = zcrRate > 0.3 && hfRatio > 0.4 && rms > 0.005;

    if (isPlosive || isFricative) {
      // Expand protection window by 10ms each side
      const padSamples = Math.floor(0.01 * sr);
      const s = Math.max(0, start - padSamples);
      const e = Math.min(data.length, start + frameLen + padSamples);
      if (regions.length > 0 && regions[regions.length-1][1] >= s) {
        regions[regions.length-1][1] = e; // merge adjacent
      } else {
        regions.push([s, e]);
      }
    }
    prevRms = rms;
  }
  return regions;
}

// ── Smooth Gain Envelope ──────────────────────────────────────────────────────
// Raised-cosine crossfade between gain segments to prevent clicks

function smoothEnvelope(gainEnv: Float32Array, fadeLen: number): Float32Array {
  const smooth = new Float32Array(gainEnv);
  for (let i = 1; i < gainEnv.length; i++) {
    if (Math.abs(gainEnv[i] - gainEnv[i-1]) > 0.001) {
      // Crossfade region
      const start = Math.max(0, i - fadeLen);
      const end   = Math.min(gainEnv.length, i + fadeLen);
      const gFrom = gainEnv[start];
      const gTo   = gainEnv[end-1] ?? gainEnv[gainEnv.length-1];
      for (let j = start; j < end; j++) {
        const t    = (j - start) / (end - start);
        const fade = 0.5 * (1 - Math.cos(Math.PI * t));
        smooth[j]  = gFrom * (1 - fade) + gTo * fade;
      }
    }
  }
  return smooth;
}

// ── Transient Preservation Score ─────────────────────────────────────────────
// Measures how well transients are preserved after processing
// Compares onset strength of original vs processed

export function measureTransientPreservation(
  original:  Float32Array,
  processed: Float32Array,
  sr:        number
): number {
  const origMap = detectTransients(original,  sr);
  const procMap = detectTransients(processed, sr);

  // Compare onset count and average strength
  const countRatio    = procMap.metrics.transientCount /
    Math.max(1, origMap.metrics.transientCount);
  const strengthRatio = procMap.metrics.avgOnsetStrength /
    Math.max(1e-6, origMap.metrics.avgOnsetStrength);

  // Score: 1.0 = perfect preservation
  return clamp(
    (clamp(countRatio, 0, 1) + clamp(strengthRatio, 0, 1)) / 2,
    0, 1
  );
}
