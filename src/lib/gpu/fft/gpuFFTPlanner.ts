/**
 * gpuFFTPlanner.ts — GPU FFT Plan Cache & Workgroup Optimizer
 * Aivora Audio Infrastructure Platform
 *
 * - FFT plan caching (avoid recompilation)
 * - Workgroup size optimization per GPU
 * - Adaptive dispatch sizing
 * - Browser-specific tuning
 */

import { gpuRuntime }    from "../gpuRuntime";
import { gpuFFT }        from "./gpuFFT";
import type { FFTResult } from "./gpuFFT";
import { getWindowSync } from "./gpuWindowFunctions";

export interface FFTPlan {
  n:            number;
  batch:        number;
  windowType:   string;
  workgroupX:   number;
  latencyEstMs: number;
  createdAt:    number;
}

export interface STFTConfig {
  fftSize:    number;
  hopSize:    number;
  windowType: "hann"|"hamming"|"blackman";
  padded:     boolean;
}

export interface STFTResult {
  re:     Float32Array[];   // per-frame re
  im:     Float32Array[];   // per-frame im
  frames: number;
  fftSize:number;
  hopSize:number;
  gpu:    boolean;
}

export class GPUFFTPlanner {
  private plans     = new Map<string,FFTPlan>();
  private latencies = new Map<number,number[]>();

  // ── Plan Management ───────────────────────────────────────────────────────

  getOrCreatePlan(n:number, batch=1, windowType="hann"): FFTPlan {
    const key=`${n}_${batch}_${windowType}`;
    const cached=this.plans.get(key);
    if(cached) return cached;

    const caps       = gpuRuntime.capabilities;
    const maxWG      = caps?.maxWorkgroupSize ?? 256;
    const workgroupX = this._optimalWorkgroup(n*batch, maxWG);

    const plan: FFTPlan = {
      n, batch, windowType,
      workgroupX,
      latencyEstMs: this._estimateLatency(n, batch),
      createdAt: Date.now(),
    };

    this.plans.set(key,plan);
    return plan;
  }

  private _optimalWorkgroup(elements:number, maxWG:number): number {
    for(let wg=Math.min(maxWG,256);wg>=32;wg>>=1)
      if(elements%wg===0) return wg;
    return 64;
  }

  private _estimateLatency(n:number, batch:number): number {
    const lats=this.latencies.get(n)??[];
    if(lats.length>0) return lats.reduce((a,b)=>a+b)/lats.length*batch;
    // Heuristic: 0.01ms per 1024 samples on GPU
    return (n*batch/1024)*0.01;
  }

  recordLatency(n:number, ms:number): void {
    const lats=this.latencies.get(n)??[];
    lats.push(ms);
    if(lats.length>32) lats.shift();
    this.latencies.set(n,lats);
  }

  // ── STFT ──────────────────────────────────────────────────────────────────

  async stft(
    data:   Float32Array,
    config: STFTConfig
  ): Promise<STFTResult> {
    const { fftSize, hopSize, windowType } = config;
    const win    = getWindowSync(fftSize, windowType);
    const frames: number = Math.floor((data.length - fftSize) / hopSize) + 1;

    // Build frame matrix
    const packed = new Float32Array(fftSize * frames);
    for(let f=0;f<frames;f++){
      const start = f * hopSize;
      for(let i=0;i<fftSize;i++){
        const idx = start+i;
        packed[f*fftSize+i] = (idx<data.length?data[idx]:0) * win[i];
      }
    }

    const t0     = performance.now();
    const result = await gpuFFT.fft(packed, null, { batch:frames });
    const latMs  = performance.now()-t0;
    this.recordLatency(fftSize, latMs/frames);

    // Unpack per-frame
    const reFrames: Float32Array[] = [];
    const imFrames: Float32Array[] = [];
    for(let f=0;f<frames;f++){
      reFrames.push(result.re.slice(f*fftSize,(f+1)*fftSize));
      imFrames.push(result.im.slice(f*fftSize,(f+1)*fftSize));
    }

    return { re:reFrames, im:imFrames, frames, fftSize, hopSize, gpu:result.gpu };
  }

  // ── ISTFT ─────────────────────────────────────────────────────────────────

  async istft(
    stftResult: STFTResult,
    outputLen:  number
  ): Promise<Float32Array> {
    const { re, im, fftSize, hopSize, frames } = stftResult;
    const win    = getWindowSync(fftSize, "hann");
    const output = new Float64Array(outputLen);
    const norm   = new Float64Array(outputLen);

    // Pack frames for batch IFFT
    const packed   = new Float32Array(fftSize*frames);
    const packedIm = new Float32Array(fftSize*frames);
    for(let f=0;f<frames;f++){
      packed.set(re[f],f*fftSize);
      packedIm.set(im[f],f*fftSize);
    }

    const result=await gpuFFT.fft(packed,packedIm,{inverse:true,batch:frames});

    // Overlap-add reconstruction
    for(let f=0;f<frames;f++){
      const start=f*hopSize;
      for(let i=0;i<fftSize&&start+i<outputLen;i++){
        output[start+i]  +=result.re[f*fftSize+i]*win[i];
        norm[start+i]    +=win[i]**2;
      }
    }

    const out=new Float32Array(outputLen);
    for(let i=0;i<outputLen;i++)
      out[i]=norm[i]>1e-8?output[i]/norm[i]:0;
    return out;
  }

  getPlans(): FFTPlan[] { return Array.from(this.plans.values()); }
  clearPlans(): void    { this.plans.clear(); }
}

export const gpuFFTPlanner = new GPUFFTPlanner();
