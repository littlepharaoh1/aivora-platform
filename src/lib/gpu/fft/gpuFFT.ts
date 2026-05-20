/**
 * gpuFFT.ts — GPU Radix-2 FFT Engine
 * Aivora Audio Infrastructure Platform
 *
 * Full WGSL Radix-2 DIT FFT:
 * - Bit-reversal permutation
 * - Butterfly network (log2(N) passes)
 * - Real-to-complex mode
 * - Inverse FFT
 * - Batched FFT (multiple signals in one dispatch)
 * - Overlap-add compatible output layout
 *
 * Mathematical basis:
 * DFT: X[k] = Σ x[n] * W_N^(nk), W_N = e^(-j2π/N)
 * Radix-2 DIT: butterfly W_{2m}^k = W_N^k (even) and W_N^(k+N/2) (odd)
 */

import { gpuRuntime }         from "../gpuRuntime";
import { gpuBufferPool }      from "../gpuBufferPool";
import { gpuKernelScheduler } from "../gpuKernelScheduler";
import { gpuProfiler }        from "../gpuProfiler";

// ── WGSL: Bit-Reversal Permutation ────────────────────────────────────────────

const BIT_REVERSAL_WGSL = /* wgsl */`
struct Uniforms {
  n:       u32,   // FFT size
  log2n:   u32,   // log2(N)
  batch:   u32,   // batch count
  _pad:    u32,
};

@group(0) @binding(0) var<storage, read_write> re: array<f32>;
@group(0) @binding(1) var<storage, read_write> im: array<f32>;
@group(0) @binding(2) var<uniform>             u:  Uniforms;

fn bitReverse(x: u32, bits: u32) -> u32 {
  var r: u32 = 0u;
  var v: u32 = x;
  for (var i: u32 = 0u; i < bits; i++) {
    r = (r << 1u) | (v & 1u);
    v >>= 1u;
  }
  return r;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tid  = gid.x;
  let n    = u.n;
  let bits = u.log2n;

  // Each thread handles one sample across all batches
  if (tid >= n) { return; }

  let rev = bitReverse(tid, bits);
  if (rev > tid) {
    // Swap re/im for each batch
    for (var b: u32 = 0u; b < u.batch; b++) {
      let i0 = b * n + tid;
      let i1 = b * n + rev;
      let tmpR = re[i0]; re[i0] = re[i1]; re[i1] = tmpR;
      let tmpI = im[i0]; im[i0] = im[i1]; im[i1] = tmpI;
    }
  }
}
`;

// ── WGSL: FFT Butterfly Pass ──────────────────────────────────────────────────

const BUTTERFLY_WGSL = /* wgsl */`
struct Uniforms {
  n:        u32,   // FFT size
  halfLen:  u32,   // current half-length (N/2^stage)
  batch:    u32,   // batch count
  inverse:  u32,   // 0=forward, 1=inverse
};

@group(0) @binding(0) var<storage, read_write> re: array<f32>;
@group(0) @binding(1) var<storage, read_write> im: array<f32>;
@group(0) @binding(2) var<uniform>             u:  Uniforms;

const PI: f32 = 3.14159265358979323846;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tid     = gid.x;
  let n       = u.n;
  let halfLen = u.halfLen;
  let len     = halfLen * 2u;

  // Total butterflies = N/2 per batch
  let totalBF = n / 2u;
  if (tid >= totalBF) { return; }

  // Which butterfly group and position within group
  let group = tid / halfLen;
  let pos   = tid % halfLen;
  let sign  = select(-1.0, 1.0, u.inverse == 1u);
  let angle = sign * PI * f32(pos) / f32(halfLen);
  let wr    = cos(angle);
  let wi    = sin(angle);

  for (var b: u32 = 0u; b < u.batch; b++) {
    let base = b * n + group * len;
    let i0   = base + pos;
    let i1   = base + pos + halfLen;

    let r0 = re[i0]; let i_0 = im[i0];
    let r1 = re[i1]; let i_1 = im[i1];

    // Twiddle factor multiplication: W * x[i1]
    let tr = wr * r1 - wi * i_1;
    let ti = wr * i_1 + wi * r1;

    // Butterfly: x[i0] + W*x[i1], x[i0] - W*x[i1]
    re[i0] = r0 + tr;  im[i0] = i_0 + ti;
    re[i1] = r0 - tr;  im[i1] = i_0 - ti;
  }

  storageBarrier();
}
`;

// ── WGSL: IFFT Normalization ───────────────────────────────────────────────────

const IFFT_NORM_WGSL = /* wgsl */`
struct Uniforms { n: u32, batch: u32, _p0: u32, _p1: u32 };
@group(0) @binding(0) var<storage, read_write> re: array<f32>;
@group(0) @binding(1) var<storage, read_write> im: array<f32>;
@group(0) @binding(2) var<uniform>             u:  Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.n * u.batch) { return; }
  let scale = 1.0 / f32(u.n);
  re[i] *= scale;
  im[i] *= scale;
}
`;

// ── CPU Fallback FFT ──────────────────────────────────────────────────────────

export function fftCPU(re: Float64Array, im: Float64Array): void {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cR=1,cI=0;
      for(let j=0;j<len>>1;j++){
        const uR=re[i+j],uI=im[i+j];
        const vR=re[i+j+len/2]*cR-im[i+j+len/2]*cI;
        const vI=re[i+j+len/2]*cI+im[i+j+len/2]*cR;
        re[i+j]=uR+vR;im[i+j]=uI+vI;
        re[i+j+len/2]=uR-vR;im[i+j+len/2]=uI-vI;
        const nR=cR*wR-cI*wI;cI=cR*wI+cI*wR;cR=nR;
      }
    }
  }
}

export function ifftCPU(re: Float64Array, im: Float64Array): void {
  for(let i=0;i<im.length;i++) im[i]=-im[i];
  fftCPU(re,im);
  const n=re.length;
  for(let i=0;i<n;i++){re[i]/=n;im[i]=-im[i]/n;}
}

// ── GPU FFT Engine ─────────────────────────────────────────────────────────────

export interface FFTResult {
  re:       Float32Array;
  im:       Float32Array;
  n:        number;
  batch:    number;
  inverse:  boolean;
  gpu:      boolean;
  latencyMs:number;
}

export class GPUFFTEngine {
  private log2Cache = new Map<number,number>();

  private log2(n:number): number {
    const c=this.log2Cache.get(n);
    if(c!==undefined) return c;
    const v=Math.round(Math.log2(n));
    this.log2Cache.set(n,v);
    return v;
  }

  private isPow2(n:number): boolean { return n>0&&(n&(n-1))===0; }

  // ── GPU FFT ─────────────────────────────────────────────────────────────────

  async fft(
    inputRe:  Float32Array,
    inputIm:  Float32Array | null,
    options: {
      inverse?:  boolean;
      batch?:    number;
    } = {}
  ): Promise<FFTResult> {
    const n       = inputRe.length;
    const batch   = options.batch   ?? 1;
    const inverse = options.inverse ?? false;

    if(!this.isPow2(n)) throw new Error(`FFT size must be power of 2, got ${n}`);

    if(!gpuRuntime.isGPU) return this._cpuFFT(inputRe, inputIm, inverse);

    return gpuProfiler.profileKernel(
      `fft_n${n}_b${batch}`,
      inputRe.byteLength * 2,
      n * 4 * 2,
      256, n,
      () => this._gpuFFT(inputRe, inputIm, n, batch, inverse)
    );
  }

  private async _gpuFFT(
    inputRe:  Float32Array,
    inputIm:  Float32Array | null,
    n:        number,
    batch:    number,
    inverse:  boolean
  ): Promise<FFTResult> {
    const t0      = performance.now();
    const bufSize = n * batch * 4;
    const log2n   = this.log2(n);

    const reBuf = gpuBufferPool.acquire(bufSize);
    const imBuf = gpuBufferPool.acquire(bufSize);

    if(!reBuf || !imBuf) {
      if(reBuf) gpuBufferPool.release(reBuf);
      if(imBuf) gpuBufferPool.release(imBuf);
      return this._cpuFFT(inputRe, inputIm, inverse);
    }

    try {
      // Upload input
      await gpuBufferPool.upload(inputRe, reBuf);
      const imInput = inputIm ?? new Float32Array(n * batch);
      await gpuBufferPool.upload(imInput, imBuf);

      // ── Step 1: Bit-reversal permutation ──────────────────────────────────
      const unifBR = gpuRuntime.createBuffer(16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unifBR) throw new Error("Uniform buffer alloc failed");

      const brData = new Uint32Array(4);
      brData[0]=n; brData[1]=log2n; brData[2]=batch;
      gpuRuntime.writeBuffer(unifBR, new Float32Array(brData.buffer));

      await gpuKernelScheduler.submit(
        { key:"fft_bitrev", wgsl:BIT_REVERSAL_WGSL, workgroupX:Math.ceil(n/256) },
        [
          { binding:0, buffer:reBuf },
          { binding:1, buffer:imBuf },
          { binding:2, buffer:unifBR },
        ],
        { priority:"high" }
      );
      unifBR.destroy();

      // ── Step 2: Butterfly passes (log2(N) stages) ─────────────────────────
      for(let stage=0; stage<log2n; stage++) {
        const halfLen = 1 << stage;  // 2^stage
        const unifBF  = gpuRuntime.createBuffer(16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        if(!unifBF) break;

        const bfData  = new Uint32Array(4);
        bfData[0]=n; bfData[1]=halfLen; bfData[2]=batch; bfData[3]=inverse?1:0;
        gpuRuntime.writeBuffer(unifBF, new Float32Array(bfData.buffer));

        const totalBF = (n/2) * batch;
        await gpuKernelScheduler.submit(
          { key:`fft_butterfly_s${stage}`, wgsl:BUTTERFLY_WGSL, workgroupX:Math.ceil(totalBF/256) },
          [
            { binding:0, buffer:reBuf },
            { binding:1, buffer:imBuf },
            { binding:2, buffer:unifBF },
          ],
          { priority:"high" }
        );
        unifBF.destroy();
      }

      // ── Step 3: IFFT normalization ─────────────────────────────────────────
      if(inverse) {
        const unifNorm = gpuRuntime.createBuffer(16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        if(unifNorm){
          const nd=new Uint32Array(4); nd[0]=n; nd[1]=batch;
          gpuRuntime.writeBuffer(unifNorm, new Float32Array(nd.buffer));
          await gpuKernelScheduler.submit(
            { key:"fft_ifft_norm", wgsl:IFFT_NORM_WGSL, workgroupX:Math.ceil(n*batch/256) },
            [
              { binding:0, buffer:reBuf },
              { binding:1, buffer:imBuf },
              { binding:2, buffer:unifNorm },
            ],
            { priority:"high" }
          );
          unifNorm.destroy();
        }
      }

      // ── Read back ──────────────────────────────────────────────────────────
      const [outRe, outIm] = await Promise.all([
        gpuBufferPool.download(reBuf, n*batch),
        gpuBufferPool.download(imBuf, n*batch),
      ]);

      return {
        re:outRe, im:outIm, n, batch, inverse, gpu:true,
        latencyMs:Math.round((performance.now()-t0)*100)/100,
      };

    } finally {
      gpuBufferPool.release(reBuf);
      gpuBufferPool.release(imBuf);
    }
  }

  // ── CPU Fallback ────────────────────────────────────────────────────────────

  private _cpuFFT(
    inputRe:  Float32Array,
    inputIm:  Float32Array | null,
    inverse:  boolean
  ): FFTResult {
    const t0  = performance.now();
    const n   = inputRe.length;
    const re  = new Float64Array(n);
    const im  = new Float64Array(n);
    for(let i=0;i<n;i++){ re[i]=inputRe[i]; im[i]=inputIm?inputIm[i]:0; }

    if(inverse) ifftCPU(re,im);
    else        fftCPU(re,im);

    return {
      re:  new Float32Array(re),
      im:  new Float32Array(im),
      n, batch:1, inverse, gpu:false,
      latencyMs:Math.round((performance.now()-t0)*100)/100,
    };
  }

  // ── Real FFT (input real-only) ─────────────────────────────────────────────

  async rfft(real: Float32Array): Promise<{ re:Float32Array; im:Float32Array; n:number }> {
    const result=await this.fft(real,null,{inverse:false});
    // Only return first N/2+1 bins (conjugate symmetry)
    const half=real.length/2+1;
    return {
      re:result.re.slice(0,half),
      im:result.im.slice(0,half),
      n:real.length,
    };
  }

  // ── Batched FFT ────────────────────────────────────────────────────────────

  async batchFFT(
    frames:  Float32Array[],  // array of same-size frames
    inverse = false
  ): Promise<FFTResult[]> {
    if(frames.length===0) return [];
    const n     = frames[0].length;
    const batch = frames.length;

    // Pack into interleaved buffer
    const packed=new Float32Array(n*batch);
    for(let b=0;b<batch;b++) packed.set(frames[b],b*n);

    const result=await this.fft(packed,null,{inverse,batch});

    // Unpack results
    return Array.from({length:batch},(_,b)=>({
      re:result.re.slice(b*n,(b+1)*n),
      im:result.im.slice(b*n,(b+1)*n),
      n, batch:1, inverse, gpu:result.gpu,
      latencyMs:result.latencyMs/batch,
    }));
  }
}

export const gpuFFT = new GPUFFTEngine();
