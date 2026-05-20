/**
 * modelProfiler.ts — AI Model Performance Profiler
 * Aivora Audio Infrastructure Platform
 *
 * - Inference latency (warm/cold)
 * - VRAM estimation
 * - Model switching cost
 * - Throughput (samples/sec)
 * - Browser performance budget tracking
 */

import type { ModelEntry } from "./modelRegistry";

export interface InferenceMetrics {
  modelId:         string;
  coldStartMs:     number;
  warmLatencyMs:   number;
  p95LatencyMs:    number;
  throughputSPS:   number;  // samples per second
  estimatedVRAMMB: number;
  switchCostMs:    number;
  calls:           number;
}

class LatencyRing {
  private b=new Float64Array(64); private h=0; private c=0;
  push(v:number):void{ this.b[this.h%64]=v; this.h++; if(this.c<64) this.c++; }
  mean():number{ if(!this.c)return 0; let s=0; const base=(this.h-this.c+6400)%64; for(let i=0;i<this.c;i++) s+=this.b[(base+i)%64]; return s/this.c; }
  p95():number{
    if(!this.c) return 0;
    const t=new Float64Array(this.c);
    const base=(this.h-this.c+6400)%64;
    for(let i=0;i<this.c;i++) t[i]=this.b[(base+i)%64];
    t.sort(); return t[Math.floor(0.95*(this.c-1))];
  }
  get length():number{ return this.c; }
}

interface ModelState {
  modelId:     string;
  coldStartMs: number;
  ring:        LatencyRing;
  calls:       number;
  loadedAt:    number;
  lastUsedAt:  number;
}

export class ModelProfiler {
  private readonly states = new Map<string,ModelState>();

  recordColdStart(modelId:string, ms:number): void {
    let s=this.states.get(modelId);
    if(!s){ s={modelId,coldStartMs:ms,ring:new LatencyRing(),calls:0,loadedAt:Date.now(),lastUsedAt:Date.now()}; this.states.set(modelId,s); }
    else s.coldStartMs=ms;
  }

  recordInference(modelId:string, ms:number, samples:number): void {
    let s=this.states.get(modelId);
    if(!s){ s={modelId,coldStartMs:0,ring:new LatencyRing(),calls:0,loadedAt:Date.now(),lastUsedAt:Date.now()}; this.states.set(modelId,s); }
    s.ring.push(ms);
    s.calls++;
    s.lastUsedAt=Date.now();
    void samples;
  }

  getMetrics(modelId:string, model?:ModelEntry): InferenceMetrics|null {
    const s=this.states.get(modelId);
    if(!s) return null;

    const warmMs=s.ring.mean();
    const sps   =warmMs>0?(model?.capabilities.frameSize??512)/(warmMs/1000):0;

    return {
      modelId,
      coldStartMs:     Math.round(s.coldStartMs*100)/100,
      warmLatencyMs:   Math.round(warmMs*100)/100,
      p95LatencyMs:    Math.round(s.ring.p95()*100)/100,
      throughputSPS:   Math.round(sps),
      estimatedVRAMMB: model?.memory.minVRAMMB??0,
      switchCostMs:    Math.round(s.coldStartMs*0.3),
      calls:           s.calls,
    };
  }

  getAllMetrics(): InferenceMetrics[] {
    return Array.from(this.states.keys())
      .map(id=>this.getMetrics(id))
      .filter(Boolean) as InferenceMetrics[];
  }

  // Estimate if model fits in browser memory budget
  fitsInBudget(model:ModelEntry, availableMB:number): boolean {
    return model.memory.recommendedMB<=availableMB;
  }

  getBudgetRecommendation(models:ModelEntry[], budgetMB:number): ModelEntry[] {
    return models.filter(m=>this.fitsInBudget(m,budgetMB))
      .sort((a,b)=>b.capabilities.frameSize-a.capabilities.frameSize);
  }
}

export const modelProfiler = new ModelProfiler();
