/**
 * memoryManager.ts — Enterprise Memory Protection
 * AudioBuffer lifecycle, FFT cache eviction, RAM tracking
 * Aivora Platform — Phase 12
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_AUDIO_BUFFERS   = 20;
const MAX_FFT_CACHE       = 50;
const MAX_MEMORY_MB       = 512;
const IDLE_CLEANUP_MS     = 60000;
const MAX_UPLOAD_MB       = 500;

// ── Memory Estimation ─────────────────────────────────────────────────────────

export function estimateBufferMB(buffer: AudioBuffer): number {
  return (buffer.length * buffer.numberOfChannels * 4) / (1024*1024);
}

export function estimateFloat32MB(arr: Float32Array): number {
  return (arr.length * 4) / (1024*1024);
}

// ── Memory Telemetry ──────────────────────────────────────────────────────────

export interface MemorySnapshot {
  timestamp:        number;
  audioBuffersMB:   number;
  fftCacheMB:       number;
  totalEstimatedMB: number;
  audioBufferCount: number;
  fftCacheCount:    number;
  jsHeapMB?:        number;
  jsHeapLimitMB?:   number;
}

class MemoryTelemetry {
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 100;
  private peakMB = 0;

  record(snapshot: MemorySnapshot): void {
    this.snapshots.push(snapshot);
    if(this.snapshots.length > this.maxSnapshots)
      this.snapshots.shift();
    if(snapshot.totalEstimatedMB > this.peakMB)
      this.peakMB = snapshot.totalEstimatedMB;
  }

  getLatest(): MemorySnapshot | null {
    return this.snapshots[this.snapshots.length-1] ?? null;
  }

  getPeak(): number { return this.peakMB; }

  getAverage(): number {
    if(this.snapshots.length===0) return 0;
    return this.snapshots.reduce((s,v)=>s+v.totalEstimatedMB,0)/this.snapshots.length;
  }

  clear(): void { this.snapshots=[]; this.peakMB=0; }
}

export const memoryTelemetry = new MemoryTelemetry();

// ── AudioBuffer Registry ──────────────────────────────────────────────────────

interface BufferEntry {
  buffer:     AudioBuffer;
  mono?:      Float32Array;
  key:        string;
  sizeMB:     number;
  createdAt:  number;
  lastAccess: number;
  accessCount: number;
  pinned:     boolean;
}

class AudioBufferManager {
  private entries  = new Map<string, BufferEntry>();
  private counter  = 0;
  private totalMB  = 0;

  register(buffer: AudioBuffer, pin = false): string {
    const key     = `buf_${++this.counter}_${Date.now()}`;
    const sizeMB  = estimateBufferMB(buffer);

    // Evict if needed
    this.evictIfNeeded(sizeMB);

    // Pre-compute mono
    const mono = new Float32Array(buffer.length);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){
      const d=buffer.getChannelData(ch);
      for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
    }
    if(buffer.numberOfChannels>1)
      for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

    this.entries.set(key,{
      buffer,mono,key,sizeMB,
      createdAt:  Date.now(),
      lastAccess: Date.now(),
      accessCount: 0,
      pinned: pin,
    });
    this.totalMB += sizeMB;
    this.snapshot();
    return key;
  }

  get(key: string): AudioBuffer | null {
    const entry = this.entries.get(key);
    if(!entry) return null;
    entry.lastAccess = Date.now();
    entry.accessCount++;
    return entry.buffer;
  }

  getMono(key: string): Float32Array | null {
    const entry = this.entries.get(key);
    if(!entry) return null;
    entry.lastAccess = Date.now();
    return entry.mono ?? null;
  }

  pin(key: string): void {
    const entry = this.entries.get(key);
    if(entry) entry.pinned = true;
  }

  unpin(key: string): void {
    const entry = this.entries.get(key);
    if(entry) entry.pinned = false;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if(!entry) return;
    this.totalMB -= entry.sizeMB;
    this.entries.delete(key);
    this.snapshot();
  }

  releaseAll(): void {
    this.entries.clear();
    this.totalMB = 0;
    this.snapshot();
  }

  private evictIfNeeded(incomingMB: number): void {
    // Evict LRU unpinned entries
    while(
      (this.totalMB + incomingMB > MAX_MEMORY_MB ||
       this.entries.size >= MAX_AUDIO_BUFFERS) &&
      this.entries.size > 0
    ){
      let lruKey = "", lruTime = Infinity;
      for(const [k,e] of this.entries){
        if(!e.pinned && e.lastAccess < lruTime){
          lruTime = e.lastAccess; lruKey = k;
        }
      }
      if(!lruKey) break;
      this.release(lruKey);
    }
  }

  private snapshot(): void {
    const jsHeap = (performance as unknown as {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
    }).memory;

    memoryTelemetry.record({
      timestamp:        Date.now(),
      audioBuffersMB:   this.totalMB,
      fftCacheMB:       fftCacheManager.sizeMB,
      totalEstimatedMB: this.totalMB + fftCacheManager.sizeMB,
      audioBufferCount: this.entries.size,
      fftCacheCount:    fftCacheManager.size,
      jsHeapMB:         jsHeap ? jsHeap.usedJSHeapSize/1024/1024 : undefined,
      jsHeapLimitMB:    jsHeap ? jsHeap.jsHeapSizeLimit/1024/1024 : undefined,
    });
  }

  getStats() {
    return {
      count:   this.entries.size,
      totalMB: this.totalMB.toFixed(1),
      pinned:  [...this.entries.values()].filter(e=>e.pinned).length,
    };
  }
}

// ── FFT Cache Manager ─────────────────────────────────────────────────────────

interface FFTCacheEntry {
  magnitude:  Float32Array;
  phase:      Float32Array;
  sizeMB:     number;
  createdAt:  number;
  lastAccess: number;
}

class FFTCacheManager {
  private cache   = new Map<string, FFTCacheEntry>();
  private _sizeMB = 0;

  makeKey(bufKey: string, offset: number, fftSize: number): string {
    return `${bufKey}_${offset}_${fftSize}`;
  }

  has(key: string): boolean { return this.cache.has(key); }

  get(key: string): FFTCacheEntry | null {
    const entry = this.cache.get(key);
    if(!entry) return null;
    entry.lastAccess = Date.now();
    return entry;
  }

  set(key: string, magnitude: Float32Array, phase: Float32Array): void {
    const sizeMB = estimateFloat32MB(magnitude)+estimateFloat32MB(phase);
    this.evictIfNeeded(sizeMB);
    this.cache.set(key,{
      magnitude, phase, sizeMB,
      createdAt:  Date.now(),
      lastAccess: Date.now(),
    });
    this._sizeMB += sizeMB;
  }

  private evictIfNeeded(incomingMB: number): void {
    while(
      (this._sizeMB+incomingMB > MAX_MEMORY_MB*0.25 ||
       this.cache.size >= MAX_FFT_CACHE) &&
      this.cache.size > 0
    ){
      let lruKey="", lruTime=Infinity;
      for(const [k,e] of this.cache)
        if(e.lastAccess<lruTime){lruTime=e.lastAccess;lruKey=k;}
      if(!lruKey) break;
      const e=this.cache.get(lruKey)!;
      this._sizeMB-=e.sizeMB;
      this.cache.delete(lruKey);
    }
  }

  evictOlderThan(ms: number): void {
    const cutoff=Date.now()-ms;
    for(const [k,e] of this.cache){
      if(e.lastAccess<cutoff){
        this._sizeMB-=e.sizeMB;
        this.cache.delete(k);
      }
    }
  }

  clear(): void { this.cache.clear(); this._sizeMB=0; }

  get sizeMB(): number { return this._sizeMB; }
  get size():   number { return this.cache.size; }
}

// ── Upload Size Guard ─────────────────────────────────────────────────────────

export interface UploadGuard {
  allowed:     boolean;
  fileSizeMB:  number;
  warning?:    string;
  error?:      string;
}

export function guardUpload(file: File): UploadGuard {
  const mb = file.size/(1024*1024);
  if(mb > MAX_UPLOAD_MB) return {
    allowed: false, fileSizeMB: mb,
    error: `File too large: ${mb.toFixed(0)}MB (max ${MAX_UPLOAD_MB}MB)`,
  };
  if(mb > 200) return {
    allowed: true, fileSizeMB: mb,
    warning: `Large file (${mb.toFixed(0)}MB) — chunked processing enabled`,
  };
  return { allowed: true, fileSizeMB: mb };
}

// ── Idle Cleanup ──────────────────────────────────────────────────────────────

class IdleCleanupManager {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = IDLE_CLEANUP_MS): void {
    if(this.timer) return;
    this.timer = setInterval(()=>this.cleanup(), intervalMs);
  }

  stop(): void {
    if(this.timer){ clearInterval(this.timer); this.timer=null; }
  }

  cleanup(): void {
    // Evict FFT cache entries older than 5 minutes
    fftCacheManager.evictOlderThan(5*60*1000);
  }
}

// ── Singletons ────────────────────────────────────────────────────────────────

export const audioBufferManager = new AudioBufferManager();
export const fftCacheManager    = new FFTCacheManager();
export const idleCleanup        = new IdleCleanupManager();

// Auto-start idle cleanup
idleCleanup.start();

// ── Memory Report ─────────────────────────────────────────────────────────────

export function getMemoryReport(): {
  audioBuffers: ReturnType<AudioBufferManager["getStats"]>;
  fftCache:     { size: number; sizeMB: string };
  peak:         string;
  average:      string;
  latest:       MemorySnapshot | null;
} {
  return {
    audioBuffers: audioBufferManager.getStats(),
    fftCache:     { size: fftCacheManager.size, sizeMB: fftCacheManager.sizeMB.toFixed(1) },
    peak:         memoryTelemetry.getPeak().toFixed(1)+" MB",
    average:      memoryTelemetry.getAverage().toFixed(1)+" MB",
    latest:       memoryTelemetry.getLatest(),
  };
}

export function clearAllCaches(): void {
  audioBufferManager.releaseAll();
  fftCacheManager.clear();
  memoryTelemetry.clear();
}
