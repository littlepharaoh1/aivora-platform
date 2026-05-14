/**
 * longAudioProcessor.ts — Long Audio Stability Engine
 * Chunked processing, streaming, memory management
 * Aivora Platform — Phase 5
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE_SAMPLES  = 441000;  // 10 seconds at 44.1kHz
const MAX_MEMORY_MB       = 512;
const IDLE_CLEANUP_MS     = 30000;
const MAX_WAVEFORM_POINTS = 10000;   // Max points for waveform display

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChunkResult {
  chunkIndex:  number;
  startSample: number;
  endSample:   number;
  startSec:    number;
  endSec:      number;
  snrDb:       number;
  energyDb:    number;
  speechRatio: number;
  noiseFloorDb: number;
  hasClipping: boolean;
}

export interface LongAudioResult {
  duration:       number;
  sampleRate:     number;
  totalSamples:   number;
  chunkCount:     number;
  chunks:         ChunkResult[];
  globalSnr:      number;
  globalLufs:     number;
  speechRatio:    number;
  noiseFloorDb:   number;
  clippingRatio:  number;
  waveformPoints: Float32Array;
  peakDb:         number;
  processingMs:   number;
}

export interface ProgressCallback {
  (percent: number, step: string, chunksProcessed: number): void;
}

// ── Memory Guard ──────────────────────────────────────────────────────────────

function estimateMemoryMB(samples: number, channels = 1): number {
  return (samples * channels * 4) / (1024 * 1024);
}

function isMemorySafe(samples: number, channels = 1): boolean {
  return estimateMemoryMB(samples, channels) < MAX_MEMORY_MB;
}

// ── Chunked SNR ───────────────────────────────────────────────────────────────

function computeChunkMetrics(
  samples:    Float32Array,
  sampleRate: number,
  startSample: number
): ChunkResult {
  const frameSize = Math.round(0.02 * sampleRate);
  const hopSize   = Math.round(0.01 * sampleRate);
  const energies: number[] = [];
  let   clipped   = 0;
  let   peakAbs   = 0;

  for (let i = 0; i + frameSize <= samples.length; i += hopSize) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) {
      const s = samples[i+j];
      e += s*s;
      const a = Math.abs(s);
      if (a > peakAbs) peakAbs = a;
      if (a >= 0.99) clipped++;
    }
    energies.push(e / frameSize);
  }

  if (energies.length === 0) {
    return {
      chunkIndex: 0, startSample, endSample: startSample + samples.length,
      startSec: startSample/sampleRate, endSec: (startSample+samples.length)/sampleRate,
      snrDb: 0, energyDb: -120, speechRatio: 0, noiseFloorDb: -120, hasClipping: false,
    };
  }

  const sorted  = [...energies].sort((a,b) => a-b);
  const cut     = Math.max(1, Math.floor(sorted.length * 0.1));
  const noise   = sorted.slice(0, cut).reduce((s,v) => s+v, 0) / cut;
  const signal  = sorted.slice(-cut).reduce((s,v) => s+v, 0) / cut;
  const thresh  = noise * 6;
  const speechFrames = energies.filter(e => e > thresh).length;
  const avgEnergy    = energies.reduce((s,v) => s+v, 0) / energies.length;

  return {
    chunkIndex:   0,
    startSample,
    endSample:    startSample + samples.length,
    startSec:     startSample / sampleRate,
    endSec:       (startSample + samples.length) / sampleRate,
    snrDb:        noise > 0 ? Math.min(80, 10*Math.log10(signal/noise)) : 60,
    energyDb:     avgEnergy > 0 ? 10*Math.log10(avgEnergy) : -120,
    speechRatio:  energies.length > 0 ? speechFrames/energies.length : 0,
    noiseFloorDb: noise > 0 ? 10*Math.log10(noise) : -120,
    hasClipping:  clipped > 10,
  };
}

// ── Waveform Downsampler ──────────────────────────────────────────────────────

export function downsampleWaveform(
  mono:       Float32Array,
  maxPoints:  number = MAX_WAVEFORM_POINTS
): Float32Array {
  if (mono.length <= maxPoints) return mono;

  const ratio     = mono.length / maxPoints;
  const result    = new Float32Array(maxPoints);

  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * ratio);
    const end   = Math.min(Math.floor((i+1) * ratio), mono.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(mono[j]);
      if (abs > max) max = abs;
    }
    result[i] = max;
  }

  return result;
}

// ── Streaming LUFS Estimator ──────────────────────────────────────────────────

function estimateLufs(chunks: ChunkResult[]): number {
  if (chunks.length === 0) return -70;
  const avgEnergyDb = chunks.reduce((s,c) => s + c.energyDb, 0) / chunks.length;
  // Approximate LUFS from energy (rough estimation for long files)
  return Math.max(-70, Math.min(0, avgEnergyDb - 3));
}

// ── Main Long Audio Processor ─────────────────────────────────────────────────

export async function processLongAudio(
  buffer:     AudioBuffer,
  onProgress?: ProgressCallback
): Promise<LongAudioResult> {
  const startTime  = Date.now();
  const sr         = buffer.sampleRate;
  const totalLen   = buffer.length;
  const duration   = buffer.duration;

  // Mix to mono efficiently
  const mono = new Float32Array(totalLen);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < totalLen; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < totalLen; i++) mono[i] /= buffer.numberOfChannels;

  onProgress?.(5, "Mono mix", 0);

  // Determine chunk size based on available memory
  const memPerChunk = estimateMemoryMB(CHUNK_SIZE_SAMPLES);
  const chunkSize   = memPerChunk > MAX_MEMORY_MB / 4
    ? Math.floor(CHUNK_SIZE_SAMPLES / 2)
    : CHUNK_SIZE_SAMPLES;

  const chunkCount  = Math.ceil(totalLen / chunkSize);
  const chunks:     ChunkResult[] = [];

  // Process chunks
  for (let i = 0; i < chunkCount; i++) {
    const startSample = i * chunkSize;
    const endSample   = Math.min(startSample + chunkSize, totalLen);
    const chunkMono   = mono.subarray(startSample, endSample);

    const result      = computeChunkMetrics(chunkMono, sr, startSample);
    result.chunkIndex = i;
    chunks.push(result);

    const percent = 10 + Math.round((i / chunkCount) * 75);
    onProgress?.(percent, `Chunk ${i+1}/${chunkCount}`, i+1);

    // Yield to UI thread every 5 chunks
    if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }

  onProgress?.(87, "Computing globals", chunkCount);

  // Aggregate results
  const globalSnr     = chunks.reduce((s,c) => s + c.snrDb, 0) / chunks.length;
  const speechRatio   = chunks.reduce((s,c) => s + c.speechRatio, 0) / chunks.length;
  const noiseFloorDb  = chunks.reduce((s,c) => s + c.noiseFloorDb, 0) / chunks.length;
  const clippingRatio = chunks.filter(c => c.hasClipping).length / chunks.length;
  const globalLufs    = estimateLufs(chunks);

  // Peak detection
  let peakAbs = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peakAbs) peakAbs = a;
  }
  const peakDb = peakAbs > 0 ? 20*Math.log10(peakAbs) : -120;

  onProgress?.(93, "Waveform downsampling", chunkCount);

  // Downsample waveform for display
  const waveformPoints = downsampleWaveform(mono, MAX_WAVEFORM_POINTS);

  onProgress?.(100, "Complete", chunkCount);

  return {
    duration, sampleRate: sr, totalSamples: totalLen,
    chunkCount, chunks, globalSnr, globalLufs,
    speechRatio, noiseFloorDb, clippingRatio,
    waveformPoints, peakDb,
    processingMs: Date.now() - startTime,
  };
}

// ── Virtualized Spectrogram ───────────────────────────────────────────────────

export interface SpectrogramTile {
  startSec:  number;
  endSec:    number;
  startBin:  number;
  endBin:    number;
  data:      Float32Array;
  width:     number;
  height:    number;
  rendered:  boolean;
}

export class VirtualizedSpectrogram {
  private tiles    = new Map<string, SpectrogramTile>();
  private maxTiles = 20;

  getTileKey(startSec: number, endSec: number): string {
    return `${startSec.toFixed(2)}_${endSec.toFixed(2)}`;
  }

  hasTile(startSec: number, endSec: number): boolean {
    return this.tiles.has(this.getTileKey(startSec, endSec));
  }

  getTile(startSec: number, endSec: number): SpectrogramTile | null {
    return this.tiles.get(this.getTileKey(startSec, endSec)) ?? null;
  }

  setTile(tile: SpectrogramTile): void {
    const key = this.getTileKey(tile.startSec, tile.endSec);
    if (this.tiles.size >= this.maxTiles) {
      // Evict first tile
      const firstKey = this.tiles.keys().next().value;
      if (firstKey) this.tiles.delete(firstKey);
    }
    this.tiles.set(key, tile);
  }

  clear(): void { this.tiles.clear(); }
  get tileCount(): number { return this.tiles.size; }
}

// ── Memory Cleanup ────────────────────────────────────────────────────────────

const cleanupCallbacks: (() => void)[] = [];
let   idleTimer: ReturnType<typeof setTimeout> | null = null;

export function registerCleanup(cb: () => void): void {
  cleanupCallbacks.push(cb);
}

export function scheduleIdleCleanup(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    for (const cb of cleanupCallbacks) {
      try { cb(); } catch {}
    }
    idleTimer = null;
  }, IDLE_CLEANUP_MS);
}

export function cancelIdleCleanup(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

// ── Upload Size Guard ─────────────────────────────────────────────────────────

export interface UploadGuardResult {
  allowed:     boolean;
  fileSizeMb:  number;
  durationSec: number;
  warning?:    string;
  strategy:    "normal" | "chunked" | "streaming";
}

export function guardUploadSize(
  fileSizeBytes: number,
  estimatedDurationSec?: number
): UploadGuardResult {
  const mb = fileSizeBytes / (1024 * 1024);

  if (mb > 2048) return {
    allowed: false, fileSizeMb: mb,
    durationSec: estimatedDurationSec ?? 0,
    warning: "File exceeds 2GB limit",
    strategy: "streaming",
  };

  if (mb > 500) return {
    allowed: true, fileSizeMb: mb,
    durationSec: estimatedDurationSec ?? 0,
    warning: "Large file — chunked processing enabled",
    strategy: "chunked",
  };

  if (mb > 100) return {
    allowed: true, fileSizeMb: mb,
    durationSec: estimatedDurationSec ?? 0,
    warning: "Large file — processing may take time",
    strategy: "chunked",
  };

  return {
    allowed: true, fileSizeMb: mb,
    durationSec: estimatedDurationSec ?? 0,
    strategy: "normal",
  };
}
