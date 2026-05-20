/**
 * gpuKernelScheduler.ts — GPU Compute Kernel Scheduler
 * Aivora Audio Infrastructure Platform
 */

import { gpuRuntime } from "./gpuRuntime";
import type { PooledGPUBuffer } from "./gpuBufferPool";

export type KernelPriority = "critical" | "high" | "normal" | "low";

export interface KernelDescriptor {
  key:         string;
  wgsl:        string;
  entryPoint?: string;
  workgroupX:  number;
  workgroupY?:  number;
  workgroupZ?:  number;
}

export interface KernelBinding {
  binding: number;
  buffer:  GPUBuffer | PooledGPUBuffer;
  offset?: number;
  size?:   number;
}

export interface KernelJob {
  id:         string;
  descriptor: KernelDescriptor;
  bindings:   KernelBinding[];
  priority:   KernelPriority;
  timeoutMs:  number;
  resolve:    (ms: number) => void;
  reject:     (e: Error) => void;
  createdAt:  number;
}

export interface SchedulerStats {
  queued:       number;
  dispatched:   number;
  failed:       number;
  avgLatencyMs: number;
  cacheHitRate: number;
  fallbacks:    number;
}

const PRIORITY_WEIGHT: Record<KernelPriority,number> = { critical:4,high:3,normal:2,low:1 };
const DEFAULT_TIMEOUT_MS = 5000;
let jobSeq = 0;

class KernelQueue {
  private items: KernelJob[] = [];
  enqueue(job: KernelJob): void {
    const w=PRIORITY_WEIGHT[job.priority]; let i=0;
    while(i<this.items.length&&PRIORITY_WEIGHT[this.items[i].priority]>=w) i++;
    this.items.splice(i,0,job);
  }
  dequeue(): KernelJob|undefined { return this.items.shift(); }
  get length(): number            { return this.items.length; }
}

export class GPUKernelScheduler {
  private readonly queue     = new KernelQueue();
  private readonly pipeCache = new Map<string,GPUComputePipeline>();
  private running            = false;
  private dispatched         = 0;
  private failed             = 0;
  private fallbacks          = 0;
  private latencies:         number[] = [];
  private cacheHits          = 0;
  private cacheMisses        = 0;

  submit(
    descriptor: KernelDescriptor,
    bindings:   KernelBinding[],
    options:    { priority?: KernelPriority; timeoutMs?: number } = {}
  ): Promise<number> {
    return new Promise<number>((resolve,reject)=>{
      const job: KernelJob = {
        id:`kernel_${++jobSeq}`, descriptor, bindings,
        priority:  options.priority  ?? "normal",
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        resolve, reject, createdAt:performance.now(),
      };
      this.queue.enqueue(job);
      if(!this.running) this._drain();
    });
  }

  private async _drain(): Promise<void> {
    if(this.running) return;
    this.running=true;
    while(this.queue.length>0){
      const job=this.queue.dequeue();
      if(!job) break;
      await this._dispatch(job);
    }
    this.running=false;
  }

  private async _dispatch(job: KernelJob): Promise<void> {
    const timer=setTimeout(()=>job.reject(new Error(`Kernel timeout: ${job.descriptor.key}`)),job.timeoutMs);
    try {
      let pipeline=this.pipeCache.get(job.descriptor.key);
      if(pipeline){ this.cacheHits++; }
      else {
        this.cacheMisses++;
        const compiled=await gpuRuntime.compilePipeline(
          job.descriptor.key, job.descriptor.wgsl, job.descriptor.entryPoint??"main"
        );
        if(!compiled) throw new Error(`Pipeline compile failed: ${job.descriptor.key}`);
        pipeline=compiled;
        this.pipeCache.set(job.descriptor.key,pipeline);
      }

      const device=gpuRuntime.device;
      if(!device) throw new Error("GPU device unavailable");

      const entries: GPUBindGroupEntry[]=job.bindings.map(b=>({
        binding:b.binding,
        resource:{
          buffer:"buffer" in (b.buffer as PooledGPUBuffer)
            ?(b.buffer as PooledGPUBuffer).buffer
            :b.buffer as GPUBuffer,
          offset:b.offset??0, size:b.size,
        },
      }));

      const bindGroup=device.createBindGroup({ layout:pipeline.getBindGroupLayout(0), entries });
      const ms=await gpuRuntime.dispatch(
        pipeline, bindGroup,
        job.descriptor.workgroupX,
        job.descriptor.workgroupY??1,
        job.descriptor.workgroupZ??1
      );

      clearTimeout(timer);
      this.dispatched++;
      this.latencies.push(ms);
      if(this.latencies.length>128) this.latencies.shift();
      job.resolve(ms);
    } catch(e){
      clearTimeout(timer);
      this.failed++; this.fallbacks++;
      job.reject(e instanceof Error?e:new Error(String(e)));
    }
  }

  optimalWorkgroupSize(elements: number): number {
    const max=gpuRuntime.capabilities?.maxWorkgroupSize??256;
    for(let wg=max;wg>=64;wg>>=1) if(elements%wg===0) return wg;
    return 64;
  }

  workgroupCount(elements: number, wgSize: number): number {
    return Math.ceil(elements/wgSize);
  }

  getStats(): SchedulerStats {
    const avg=this.latencies.length>0?this.latencies.reduce((a,b)=>a+b)/this.latencies.length:0;
    const total=this.cacheHits+this.cacheMisses;
    return {
      queued:this.queue.length, dispatched:this.dispatched, failed:this.failed,
      avgLatencyMs:Math.round(avg*100)/100,
      cacheHitRate:total>0?this.cacheHits/total:0,
      fallbacks:this.fallbacks,
    };
  }

  clearCache(): void { this.pipeCache.clear(); }
}

export const gpuKernelScheduler = new GPUKernelScheduler();
