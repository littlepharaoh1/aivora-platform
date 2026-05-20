/**
 * gpuProfiler.ts — GPU Kernel Profiler
 * Aivora Audio Infrastructure Platform
 *
 * Per-kernel P50/P95/P99 latency, bandwidth estimation,
 * occupancy estimation, bottleneck detection
 */

import { gpuRuntime } from "./gpuRuntime";

export interface KernelProfile {
  key:          string;
  calls:        number;
  totalMs:      number;
  p50Ms:        number;
  p95Ms:        number;
  p99Ms:        number;
  lastMs:       number;
  bytesIn:      number;
  bytesOut:     number;
  bandwidthGBs: number;
  occupancy:    number;
}

export interface GPUProfilerSnapshot {
  timestamp:       number;
  backend:         string;
  kernels:         KernelProfile[];
  totalKernels:    number;
  totalMs:         number;
  avgBandwidthGBs: number;
  bottleneck:      "memory_bound"|"compute_bound"|"balanced"|"unknown";
  recommendation:  string;
}

class TimingRing {
  private b=new Float64Array(128); private h=0; private c=0;
  push(v:number):void{ this.b[this.h%128]=v; this.h++; if(this.c<128)this.c++; }
  pct(p:number):number{
    if(!this.c) return 0;
    const t=new Float64Array(this.c);
    const s=(this.h-this.c+12800)%128;
    for(let i=0;i<this.c;i++) t[i]=this.b[(s+i)%128];
    t.sort(); return t[Math.floor(p*(this.c-1))];
  }
  mean():number{ if(!this.c)return 0; let s=0; const base=(this.h-this.c+12800)%128; for(let i=0;i<this.c;i++) s+=this.b[(base+i)%128]; return s/this.c; }
  last():number{ return this.c?this.b[(this.h-1+128)%128]:0; }
  sum():number{  let s=0; const base=(this.h-this.c+12800)%128; for(let i=0;i<this.c;i++) s+=this.b[(base+i)%128]; return s; }
  get length():number{ return this.c; }
}

interface KernelState {
  key:string; ring:TimingRing;
  bytesIn:number; bytesOut:number; calls:number;
  lastWG:number; lastElem:number;
}

export class GPUProfiler {
  private readonly kernels = new Map<string,KernelState>();
  private enabled = true;

  record(key:string, dMs:number, bIn:number, bOut:number, wg:number, elem:number): void {
    if(!this.enabled) return;
    let s=this.kernels.get(key);
    if(!s){ s={key,ring:new TimingRing(),bytesIn:0,bytesOut:0,calls:0,lastWG:wg,lastElem:elem}; this.kernels.set(key,s); }
    s.ring.push(dMs); s.bytesIn+=bIn; s.bytesOut+=bOut; s.calls++; s.lastWG=wg; s.lastElem=elem;
  }

  async profileKernel<T>(key:string,bIn:number,bOut:number,wgX:number,elem:number,fn:()=>Promise<T>): Promise<T> {
    if(!this.enabled) return fn();
    const t0=performance.now(); const r=await fn();
    this.record(key,performance.now()-t0,bIn,bOut,wgX,elem);
    return r;
  }

  getKernelProfile(key:string): KernelProfile|null {
    const s=this.kernels.get(key); if(!s) return null;
    const totalMs=s.ring.sum();
    const bw=totalMs>0?(s.bytesIn+s.bytesOut)/(totalMs/1000)/1e9:0;
    const occ=s.lastElem>0&&s.lastWG>0?Math.min(1,s.lastElem%s.lastWG===0?1:0.8):0;
    return {
      key, calls:s.calls,
      totalMs:Math.round(totalMs*100)/100,
      p50Ms:Math.round(s.ring.pct(0.50)*100)/100,
      p95Ms:Math.round(s.ring.pct(0.95)*100)/100,
      p99Ms:Math.round(s.ring.pct(0.99)*100)/100,
      lastMs:Math.round(s.ring.last()*100)/100,
      bytesIn:s.bytesIn, bytesOut:s.bytesOut,
      bandwidthGBs:Math.round(bw*100)/100,
      occupancy:Math.round(occ*1000)/1000,
    };
  }

  exportSnapshot(): GPUProfilerSnapshot {
    const profiles:KernelProfile[]=[]; let totMs=0,totBW=0,cnt=0;
    for(const [k] of this.kernels){ const p=this.getKernelProfile(k); if(p){profiles.push(p);totMs+=p.totalMs;totBW+=p.bandwidthGBs;cnt++;} }
    const avgBW=cnt>0?totBW/cnt:0;
    const avgOcc=cnt>0?profiles.reduce((s,k)=>s+k.occupancy,0)/cnt:0;
    let bottleneck:"memory_bound"|"compute_bound"|"balanced"|"unknown"="unknown";
    let rec="No GPU data";
    if(cnt>0){
      if(avgBW>400&&avgOcc<0.7){bottleneck="memory_bound";rec="Reduce transfers, increase compute/byte";}
      else if(avgOcc>0.9&&avgBW<100){bottleneck="compute_bound";rec="Optimize WGSL arithmetic";}
      else if(avgOcc>0.7&&avgBW>100){bottleneck="balanced";rec="Well-balanced workload";}
      else{bottleneck="unknown";rec="Insufficient data";}
    }
    return {
      timestamp:Date.now(),
      backend:gpuRuntime.capabilities?.backend??"unknown",
      kernels:profiles.sort((a,b)=>b.totalMs-a.totalMs),
      totalKernels:cnt, totalMs:Math.round(totMs*100)/100,
      avgBandwidthGBs:Math.round(avgBW*100)/100,
      bottleneck, recommendation:rec,
    };
  }

  reset():void{ this.kernels.clear(); }
  setEnabled(v:boolean):void{ this.enabled=v; }
}

export const gpuProfiler = new GPUProfiler();
