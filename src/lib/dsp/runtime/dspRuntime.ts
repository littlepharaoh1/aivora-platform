/**
 * dspRuntime.ts — Shared DSP Runtime
 * Centralized FFT cache, spectral frames, window functions
 * Aivora Platform — Phase 3
 */

// ── Window Functions Cache ────────────────────────────────────────────────────

const windowCache = new Map<string, Float32Array>();

export function getHannWindow(size: number): Float32Array {
  const key = `hann_${size}`;
  if (windowCache.has(key)) return windowCache.get(key)!;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  windowCache.set(key, w);
  return w;
}

export function getHammingWindow(size: number): Float32Array {
  const key = `hamming_${size}`;
  if (windowCache.has(key)) return windowCache.get(key)!;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1));
  windowCache.set(key, w);
  return w;
}

export function getBlackmanWindow(size: number): Float32Array {
  const key = `blackman_${size}`;
  if (windowCache.has(key)) return windowCache.get(key)!;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.42 - 0.5*Math.cos(2*Math.PI*i/(size-1))
           + 0.08*Math.cos(4*Math.PI*i/(size-1));
  windowCache.set(key, w);
  return w;
}

export function clearWindowCache(): void {
  windowCache.clear();
}

// ── FFT Implementation ────────────────────────────────────────────────────────

export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len >> 1; j++) {
        const uRe = re[i+j], uIm = im[i+j];
        const vRe = re[i+j+len/2]*cRe - im[i+j+len/2]*cIm;
        const vIm = re[i+j+len/2]*cIm + im[i+j+len/2]*cRe;
        re[i+j]       = uRe + vRe; im[i+j]       = uIm + vIm;
        re[i+j+len/2] = uRe - vRe; im[i+j+len/2] = uIm - vIm;
        const nRe = cRe*wRe - cIm*wIm;
        cIm = cRe*wIm + cIm*wRe; cRe = nRe;
      }
    }
  }
}

// ── Spectral Frame ────────────────────────────────────────────────────────────

export interface SpectralFrame {
  frameIndex:  number;
  timeSec:     number;
  magnitude:   Float32Array;
  phase:       Float32Array;
  energy:      number;
  windowType:  "hann" | "hamming" | "blackman";
  fftSize:     number;
  sampleRate:  number;
}

// ── Spectral Frame Registry ───────────────────────────────────────────────────

interface RegistryEntry {
  frames:      SpectralFrame[];
  sampleRate:  number;
  fftSize:     number;
  hopSize:     number;
  duration:    number;
  createdAt:   number;
  lastAccess:  number;
}

const MAX_REGISTRY_ENTRIES = 10;
const REGISTRY_TTL_MS      = 5 * 60 * 1000; // 5 minutes

class SpectralFrameRegistry {
  private cache = new Map<string, RegistryEntry>();

  private makeKey(bufferKey: string, fftSize: number, hopSize: number): string {
    return `${bufferKey}_${fftSize}_${hopSize}`;
  }

  has(bufferKey: string, fftSize: number, hopSize: number): boolean {
    const key   = this.makeKey(bufferKey, fftSize, hopSize);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > REGISTRY_TTL_MS) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  get(bufferKey: string, fftSize: number, hopSize: number): RegistryEntry | null {
    const key   = this.makeKey(bufferKey, fftSize, hopSize);
    const entry = this.cache.get(key);
    if (!entry) return null;
    entry.lastAccess = Date.now();
    return entry;
  }

  set(
    bufferKey:  string,
    fftSize:    number,
    hopSize:    number,
    entry:      Omit<RegistryEntry, "createdAt" | "lastAccess">
  ): void {
    // Evict oldest if full
    if (this.cache.size >= MAX_REGISTRY_ENTRIES) {
      let oldest = Infinity, oldestKey = "";
      for (const [k, v] of this.cache) {
        if (v.lastAccess < oldest) { oldest = v.lastAccess; oldestKey = k; }
      }
      this.cache.delete(oldestKey);
    }
    const key = this.makeKey(bufferKey, fftSize, hopSize);
    this.cache.set(key, { ...entry, createdAt: Date.now(), lastAccess: Date.now() });
  }

  evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.cache)
      if (now - v.createdAt > REGISTRY_TTL_MS) this.cache.delete(k);
  }

  clear(): void { this.cache.clear(); }

  get size(): number { return this.cache.size; }
}

export const spectralRegistry = new SpectralFrameRegistry();

// ── AudioBuffer Registry ──────────────────────────────────────────────────────

class AudioBufferRegistry {
  private buffers  = new Map<string, AudioBuffer>();
  private monoData = new Map<string, Float32Array>();
  private counter  = 0;

  register(buffer: AudioBuffer): string {
    const key = `buf_${++this.counter}_${Date.now()}`;
    this.buffers.set(key, buffer);
    // Pre-compute and cache mono mix
    const mono = new Float32Array(buffer.length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
    }
    if (buffer.numberOfChannels > 1)
      for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
    this.monoData.set(key, mono);
    return key;
  }

  getMono(key: string): Float32Array | null {
    return this.monoData.get(key) ?? null;
  }

  getBuffer(key: string): AudioBuffer | null {
    return this.buffers.get(key) ?? null;
  }

  release(key: string): void {
    this.buffers.delete(key);
    this.monoData.delete(key);
    spectralRegistry.evictExpired();
  }

  clear(): void {
    this.buffers.clear();
    this.monoData.clear();
    spectralRegistry.clear();
  }
}

export const audioRegistry = new AudioBufferRegistry();

// ── Shared Spectral Analysis ──────────────────────────────────────────────────

export function computeSpectralFrames(
  mono:       Float32Array,
  sampleRate: number,
  fftSize     = 2048,
  hopSize     = 512,
  windowType: "hann" | "hamming" | "blackman" = "hann"
): SpectralFrame[] {
  const window = windowType === "hann"     ? getHannWindow(fftSize)
               : windowType === "hamming"  ? getHammingWindow(fftSize)
               : getBlackmanWindow(fftSize);

  const frames: SpectralFrame[] = [];
  const halfFFT = fftSize / 2;

  for (let offset = 0; offset + fftSize <= mono.length; offset += hopSize) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);

    let energy = 0;
    for (let i = 0; i < fftSize; i++) {
      re[i] = mono[offset + i] * window[i];
      energy += mono[offset + i] ** 2;
    }
    energy /= fftSize;

    fftInPlace(re, im);

    const magnitude = new Float32Array(halfFFT);
    const phase     = new Float32Array(halfFFT);
    for (let i = 0; i < halfFFT; i++) {
      magnitude[i] = Math.sqrt(re[i]**2 + im[i]**2);
      phase[i]     = Math.atan2(im[i], re[i]);
    }

    frames.push({
      frameIndex: frames.length,
      timeSec:    offset / sampleRate,
      magnitude,
      phase,
      energy,
      windowType,
      fftSize,
      sampleRate,
    });
  }

  return frames;
}

// ── Shared Analysis Results ───────────────────────────────────────────────────

export interface SharedAnalysisResult {
  frames:         SpectralFrame[];
  sampleRate:     number;
  duration:       number;
  frameCount:     number;
  hopSizeSec:     number;
  noiseFloorDb:   number;
  energyProfile:  Float32Array;
}

export function analyzeShared(
  mono:       Float32Array,
  sampleRate: number,
  fftSize     = 2048,
  hopSize     = 512
): SharedAnalysisResult {
  const frames  = computeSpectralFrames(mono, sampleRate, fftSize, hopSize);
  const energies = frames.map(f => f.energy).sort((a,b) => a-b);
  const cut      = Math.max(1, Math.floor(energies.length * 0.1));
  const noiseE   = energies.slice(0, cut).reduce((s,v) => s+v, 0) / cut;
  const noiseFloorDb = noiseE > 0 ? 10 * Math.log10(noiseE) : -120;

  const energyProfile = new Float32Array(frames.map(f => f.energy));

  return {
    frames,
    sampleRate,
    duration:     mono.length / sampleRate,
    frameCount:   frames.length,
    hopSizeSec:   hopSize / sampleRate,
    noiseFloorDb,
    energyProfile,
  };
}

// ── Memory Cleanup ────────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startIdleCleanup(intervalMs = 60000): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    spectralRegistry.evictExpired();
  }, intervalMs);
}

export function stopIdleCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function clearAllDspCaches(): void {
  spectralRegistry.clear();
  audioRegistry.clear();
  clearWindowCache();
}

// ── Runtime Stats ─────────────────────────────────────────────────────────────

export function getDspRuntimeStats(): {
  windowCacheSize:   number;
  spectralCacheSize: number;
  audioCacheSize:    number;
} {
  return {
    windowCacheSize:   windowCache.size,
    spectralCacheSize: spectralRegistry.size,
    audioCacheSize:    0,
  };
}
