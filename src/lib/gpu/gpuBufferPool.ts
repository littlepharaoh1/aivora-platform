/**
 * gpuBufferPool.ts — Persistent GPU Buffer Pool
 * Aivora Audio Infrastructure Platform
 *
 * 16MB virtual pages, 256MB budget enforcement
 */

import { gpuRuntime } from "./gpuRuntime";

export const GPU_PAGE_SIZE     = 16 * 1024 * 1024;
export const MAX_ACTIVE_MEMORY = 256 * 1024 * 1024;

const SIZE_CLASSES = [64*1024, 256*1024, 1024*1024, 4*1024*1024, GPU_PAGE_SIZE] as const;
const POOL_DEPTH   = 4;

export interface PooledGPUBuffer {
  readonly buffer:    GPUBuffer;
  readonly sizeClass: number;
  readonly id:        string;
  dirty:              boolean;
  lastUsedAt:         number;
  _pool:              GPUBufferPool;
  _released:          boolean;
}

export interface GPUBufferPoolStats {
  totalAllocatedMB: number;
  activeMB:         number;
  hits:             number;
  misses:           number;
  activePages:      number;
  budgetPressure:   number;
}

class GPUSlab {
  private free: GPUBuffer[] = [];
  private activeCount = 0;
  hits = 0; misses = 0;

  constructor(readonly sizeClass:number){ this._prewarm(); }

  private _prewarm(): void {
    if(!gpuRuntime.isGPU) return;
    for(let i=0;i<POOL_DEPTH;i++){
      const b=gpuRuntime.createBuffer(this.sizeClass,
        GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
      if(b) this.free.push(b);
    }
  }

  acquire(): GPUBuffer|null {
    if(!gpuRuntime.isGPU) return null;
    if(this.free.length>0){ this.hits++; this.activeCount++; return this.free.pop()!; }
    this.misses++; this.activeCount++;
    return gpuRuntime.createBuffer(this.sizeClass,
      GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
  }

  release(buf:GPUBuffer): void {
    this.activeCount=Math.max(0,this.activeCount-1);
    if(this.free.length<POOL_DEPTH) this.free.push(buf);
    else buf.destroy();
  }

  get totalAllocated(): number { return (this.free.length+this.activeCount)*this.sizeClass; }
  get active(): number         { return this.activeCount; }
}

export class GPUBufferPool {
  private readonly slabs    = new Map<number,GPUSlab>();
  private activeBytes       = 0;
  private stagingBufs:      GPUBuffer[] = [];

  constructor(){ for(const sc of SIZE_CLASSES) this.slabs.set(sc,new GPUSlab(sc)); }

  private static nextSC(bytes:number): number {
    for(const sc of SIZE_CLASSES) if(sc>=bytes) return sc;
    return SIZE_CLASSES[SIZE_CLASSES.length-1];
  }

  acquire(minBytes:number): PooledGPUBuffer|null {
    if(!gpuRuntime.isGPU) return null;
    if(this.activeBytes+minBytes>MAX_ACTIVE_MEMORY) return null;
    const sc=GPUBufferPool.nextSC(minBytes);
    const slab=this.slabs.get(sc);
    const buf=slab?.acquire()??null;
    if(!buf) return null;
    this.activeBytes+=sc;
    return {
      buffer:buf, sizeClass:sc,
      id:`gpubuf_${sc}_${Date.now().toString(36)}`,
      dirty:false, lastUsedAt:performance.now(),
      _pool:this, _released:false,
    };
  }

  release(p:PooledGPUBuffer): void {
    if(p._released) return;
    (p as {_released:boolean})._released=true;
    this.slabs.get(p.sizeClass)?.release(p.buffer);
    this.activeBytes=Math.max(0,this.activeBytes-p.sizeClass);
  }

  async withBuffer<T>(minBytes:number, fn:(b:PooledGPUBuffer)=>Promise<T>): Promise<T|null> {
    const p=this.acquire(minBytes); if(!p) return null;
    try{ return await fn(p); } finally{ this.release(p); }
  }

  acquireStaging(bytes:number): GPUBuffer|null {
    if(!gpuRuntime.isGPU) return null;
    const i=this.stagingBufs.findIndex(b=>(b as unknown as{size?:number}).size??0>=bytes);
    if(i>=0) return this.stagingBufs.splice(i,1)[0];
    return gpuRuntime.createBuffer(bytes,GPUBufferUsage.MAP_WRITE|GPUBufferUsage.COPY_SRC);
  }

  releaseStaging(buf:GPUBuffer): void {
    if(this.stagingBufs.length<8) this.stagingBufs.push(buf);
    else buf.destroy();
  }

  async upload(data:Float32Array, target:PooledGPUBuffer): Promise<boolean> {
    if(!gpuRuntime.device) return false;
    const staging=this.acquireStaging(data.byteLength); if(!staging) return false;
    try {
      await staging.mapAsync(GPUMapMode.WRITE);
      new Float32Array(staging.getMappedRange()).set(data);
      staging.unmap();
      const enc=gpuRuntime.device.createCommandEncoder();
      enc.copyBufferToBuffer(staging,0,target.buffer,0,data.byteLength);
      gpuRuntime.device.queue.submit([enc.finish()]);
      await gpuRuntime.device.queue.onSubmittedWorkDone();
      target.dirty=false; target.lastUsedAt=performance.now();
      return true;
    } finally { this.releaseStaging(staging); }
  }

  async download(src:PooledGPUBuffer, length:number): Promise<Float32Array> {
    if(!gpuRuntime.device) return new Float32Array(length);
    return gpuRuntime.readBuffer(src.buffer,length*4);
  }

  getStats(): GPUBufferPoolStats {
    let tot=0,hits=0,misses=0,pages=0;
    for(const slab of this.slabs.values()){ tot+=slab.totalAllocated; hits+=slab.hits; misses+=slab.misses; }
    const pageSlab=this.slabs.get(GPU_PAGE_SIZE); pages=pageSlab?.active??0;
    return {
      totalAllocatedMB:Math.round(tot/1048576*10)/10,
      activeMB:Math.round(this.activeBytes/1048576*10)/10,
      hits, misses, activePages:pages,
      budgetPressure:this.activeBytes/MAX_ACTIVE_MEMORY,
    };
  }

  dispose(): void { for(const b of this.stagingBufs) b.destroy(); this.stagingBufs=[]; }
}

export const gpuBufferPool = new GPUBufferPool();
