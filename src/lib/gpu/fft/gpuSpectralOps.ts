/**
 * gpuSpectralOps.ts — GPU Spectral Operations
 * Aivora Audio Infrastructure Platform
 *
 * WGSL compute shaders for:
 * - Magnitude + phase extraction
 * - Spectral masking (Wiener-style)
 * - Spectral subtraction (noise reduction)
 * - Spectral smoothing (temporal + frequency)
 * - Spectral interpolation (gap filling)
 */

import { gpuRuntime }         from "../gpuRuntime";
import { gpuBufferPool }      from "../gpuBufferPool";
import { gpuKernelScheduler } from "../gpuKernelScheduler";

// ── WGSL: Magnitude + Phase ────────────────────────────────────────────────────

const MAG_PHASE_WGSL = /* wgsl */`
struct Uniforms { nBins: u32, frames: u32, _p0: u32, _p1: u32 };

@group(0) @binding(0) var<storage, read>       re:    array<f32>;
@group(0) @binding(1) var<storage, read>       im:    array<f32>;
@group(0) @binding(2) var<storage, read_write> mag:   array<f32>;
@group(0) @binding(3) var<storage, read_write> phase: array<f32>;
@group(0) @binding(4) var<uniform>             u:     Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.nBins * u.frames) { return; }
  let r = re[i];
  let c = im[i];
  mag[i]   = sqrt(r * r + c * c);
  phase[i] = atan2(c, r);
}
`;

// ── WGSL: Spectral Subtraction ─────────────────────────────────────────────────

const SPECTRAL_SUB_WGSL = /* wgsl */`
struct Uniforms {
  nBins:    u32,
  frames:   u32,
  alpha:    f32,   // oversubtraction factor (1.0-2.0)
  beta:     f32,   // spectral floor (0.001-0.01)
};

@group(0) @binding(0) var<storage, read>       noiseMag: array<f32>;
@group(0) @binding(1) var<storage, read_write> mag:      array<f32>;
@group(0) @binding(2) var<storage, read_write> re:       array<f32>;
@group(0) @binding(3) var<storage, read_write> im:       array<f32>;
@group(0) @binding(4) var<uniform>             u:        Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i    = gid.x;
  let nBins = u.nBins;
  if (i >= nBins * u.frames) { return; }

  let bin      = i % nBins;
  let noisePow = noiseMag[bin] * noiseMag[bin];
  let sigMag   = mag[i];
  let sigPow   = sigMag * sigMag;

  // Spectral subtraction: H(k) = max(S - alpha*N, beta*S) / S
  let subPow   = max(sigPow - u.alpha * noisePow, u.beta * sigPow);
  let gain     = select(0.0, sqrt(subPow / sigPow), sigMag > 1e-8);

  // Apply gain to complex spectrum
  re[i] *= gain;
  im[i] *= gain;
  mag[i]  = sigMag * gain;
}
`;

// ── WGSL: Wiener Gain ──────────────────────────────────────────────────────────

const WIENER_WGSL = /* wgsl */`
struct Uniforms {
  nBins:  u32,
  frames: u32,
  floor:  f32,   // noise floor multiplier
  _pad:   u32,
};

@group(0) @binding(0) var<storage, read>       noiseVar: array<f32>;
@group(0) @binding(1) var<storage, read_write> re:       array<f32>;
@group(0) @binding(2) var<storage, read_write> im:       array<f32>;
@group(0) @binding(3) var<uniform>             u:        Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i    = gid.x;
  if (i >= u.nBins * u.frames) { return; }
  let bin  = i % u.nBins;
  let r    = re[i]; let c = im[i];
  let pow  = r*r + c*c;
  let nVar = noiseVar[bin];

  // Wiener gain: H(k) = SNR / (SNR + 1) where SNR = pow/nVar
  let snr  = pow / max(nVar, u.floor);
  let gain = snr / (snr + 1.0);
  gain     = max(gain, u.floor);

  re[i] *= gain;
  im[i] *= gain;
}
`;

// ── WGSL: Spectral Smoothing ───────────────────────────────────────────────────

const SMOOTH_WGSL = /* wgsl */`
struct Uniforms {
  nBins:   u32,
  frames:  u32,
  alpha:   f32,   // temporal smoothing (0=no smooth, 0.9=heavy)
  freqW:   u32,   // frequency smoothing half-width
};

@group(0) @binding(0) var<storage, read>       input:  array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform>             u:      Uniforms;

var<workgroup> shared: array<f32, 288>; // 256 + 32 for halo

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) gid:  vec3<u32>,
  @builtin(local_invocation_id)  lid:  vec3<u32>
) {
  let i     = gid.x;
  let nBins = u.nBins;
  if (i >= nBins * u.frames) { return; }

  let frame = i / nBins;
  let bin   = i % nBins;

  // Frequency smoothing via shared memory
  let halfW = u.freqW;
  var sum: f32 = 0.0;
  var cnt: u32 = 0u;
  for (var k: i32 = -i32(halfW); k <= i32(halfW); k++) {
    let b = i32(bin) + k;
    if (b >= 0 && u32(b) < nBins) {
      sum += input[frame * nBins + u32(b)];
      cnt++;
    }
  }
  let freqSmoothed = sum / f32(max(cnt, 1u));

  // Temporal smoothing (exponential)
  if (frame > 0u && u.alpha > 0.0) {
    let prev = output[(frame - 1u) * nBins + bin];
    output[i] = u.alpha * prev + (1.0 - u.alpha) * freqSmoothed;
  } else {
    output[i] = freqSmoothed;
  }
}
`;

// ── CPU Fallbacks ──────────────────────────────────────────────────────────────

function extractMagPhaseCPU(
  re: Float32Array, im: Float32Array
): { mag: Float32Array; phase: Float32Array } {
  const n=re.length;
  const mag=new Float32Array(n), phase=new Float32Array(n);
  for(let i=0;i<n;i++){
    mag[i]  =Math.sqrt(re[i]**2+im[i]**2);
    phase[i]=Math.atan2(im[i],re[i]);
  }
  return { mag, phase };
}

// ── GPU Spectral Ops ──────────────────────────────────────────────────────────

export class GPUSpectralOps {

  async extractMagnitudePhase(
    re: Float32Array, im: Float32Array
  ): Promise<{ mag: Float32Array; phase: Float32Array }> {
    if(!gpuRuntime.isGPU) return extractMagPhaseCPU(re,im);

    const n=re.length;
    const magBuf=gpuBufferPool.acquire(n*4), phaseBuf=gpuBufferPool.acquire(n*4);
    const reBuf =gpuBufferPool.acquire(n*4), imBuf  =gpuBufferPool.acquire(n*4);

    if(!magBuf||!phaseBuf||!reBuf||!imBuf){
      for(const b of [magBuf,phaseBuf,reBuf,imBuf]) if(b) gpuBufferPool.release(b);
      return extractMagPhaseCPU(re,im);
    }

    try {
      await Promise.all([gpuBufferPool.upload(re,reBuf), gpuBufferPool.upload(im,imBuf)]);

      const unif=gpuRuntime.createBuffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unif) throw new Error("Uniform alloc failed");
      const ud=new Uint32Array(4); ud[0]=n; ud[1]=1;
      gpuRuntime.writeBuffer(unif,new Float32Array(ud.buffer));

      await gpuKernelScheduler.submit(
        { key:"spectral_magphase", wgsl:MAG_PHASE_WGSL, workgroupX:Math.ceil(n/256) },
        [
          {binding:0,buffer:reBuf},{binding:1,buffer:imBuf},
          {binding:2,buffer:magBuf},{binding:3,buffer:phaseBuf},{binding:4,buffer:unif},
        ],
        {priority:"normal"}
      );
      unif.destroy();

      const [mag,phase]=await Promise.all([
        gpuBufferPool.download(magBuf,n),
        gpuBufferPool.download(phaseBuf,n),
      ]);
      return {mag,phase};
    } finally {
      for(const b of [magBuf,phaseBuf,reBuf,imBuf]) gpuBufferPool.release(b);
    }
  }

  async spectralSubtraction(
    re: Float32Array, im: Float32Array,
    noiseProfile: Float32Array,
    alpha=1.5, beta=0.005
  ): Promise<{ re:Float32Array; im:Float32Array }> {
    if(!gpuRuntime.isGPU){
      const out={re:new Float32Array(re),im:new Float32Array(im)};
      const nBins=noiseProfile.length;
      for(let i=0;i<re.length;i++){
        const bin=i%nBins;
        const nP=noiseProfile[bin]**2;
        const sP=re[i]**2+im[i]**2;
        const sub=Math.max(sP-alpha*nP,beta*sP);
        const g=sP>1e-15?Math.sqrt(sub/sP):0;
        out.re[i]*=g; out.im[i]*=g;
      }
      return out;
    }

    const n=re.length, nBins=noiseProfile.length;
    const reBuf=gpuBufferPool.acquire(n*4), imBuf=gpuBufferPool.acquire(n*4);
    const magBuf=gpuBufferPool.acquire(n*4), noiseBuf=gpuBufferPool.acquire(nBins*4);
    if(!reBuf||!imBuf||!magBuf||!noiseBuf){
      for(const b of [reBuf,imBuf,magBuf,noiseBuf]) if(b) gpuBufferPool.release(b);
      return {re,im};
    }

    try {
      const mag=new Float32Array(n);
      for(let i=0;i<n;i++) mag[i]=Math.sqrt(re[i]**2+im[i]**2);
      await Promise.all([
        gpuBufferPool.upload(noiseProfile,noiseBuf),
        gpuBufferPool.upload(mag,magBuf),
        gpuBufferPool.upload(re,reBuf),
        gpuBufferPool.upload(im,imBuf),
      ]);

      const unif=gpuRuntime.createBuffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unif) throw new Error("Uniform alloc");
      const ud=new Float32Array(4);
      new Uint32Array(ud.buffer)[0]=nBins;
      new Uint32Array(ud.buffer)[1]=Math.floor(n/nBins);
      ud[2]=alpha; ud[3]=beta;
      gpuRuntime.writeBuffer(unif,ud);

      await gpuKernelScheduler.submit(
        {key:"spectral_sub",wgsl:SPECTRAL_SUB_WGSL,workgroupX:Math.ceil(n/256)},
        [
          {binding:0,buffer:noiseBuf},{binding:1,buffer:magBuf},
          {binding:2,buffer:reBuf},{binding:3,buffer:imBuf},{binding:4,buffer:unif},
        ],
        {priority:"high"}
      );
      unif.destroy();

      const [outRe,outIm]=await Promise.all([
        gpuBufferPool.download(reBuf,n),
        gpuBufferPool.download(imBuf,n),
      ]);
      return {re:outRe,im:outIm};
    } finally {
      for(const b of [reBuf,imBuf,magBuf,noiseBuf]) gpuBufferPool.release(b);
    }
  }

  async wienerFilter(
    re: Float32Array, im: Float32Array,
    noiseVariance: Float32Array,
    floor=0.001
  ): Promise<{ re:Float32Array; im:Float32Array }> {
    if(!gpuRuntime.isGPU){
      const oR=new Float32Array(re), oI=new Float32Array(im);
      const nBins=noiseVariance.length;
      for(let i=0;i<re.length;i++){
        const bin=i%nBins;
        const pow=re[i]**2+im[i]**2;
        const snr=pow/Math.max(noiseVariance[bin],floor);
        const g=Math.max(snr/(snr+1),floor);
        oR[i]*=g; oI[i]*=g;
      }
      return {re:oR,im:oI};
    }

    const n=re.length, nBins=noiseVariance.length;
    const reBuf=gpuBufferPool.acquire(n*4), imBuf=gpuBufferPool.acquire(n*4);
    const varBuf=gpuBufferPool.acquire(nBins*4);
    if(!reBuf||!imBuf||!varBuf){
      for(const b of [reBuf,imBuf,varBuf]) if(b) gpuBufferPool.release(b);
      return {re,im};
    }

    try {
      await Promise.all([
        gpuBufferPool.upload(noiseVariance,varBuf),
        gpuBufferPool.upload(re,reBuf),
        gpuBufferPool.upload(im,imBuf),
      ]);

      const unif=gpuRuntime.createBuffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unif) throw new Error("Uniform");
      const ud=new Float32Array(4);
      new Uint32Array(ud.buffer)[0]=nBins;
      new Uint32Array(ud.buffer)[1]=Math.ceil(n/nBins);
      ud[2]=floor;
      gpuRuntime.writeBuffer(unif,ud);

      await gpuKernelScheduler.submit(
        {key:"wiener_filter",wgsl:WIENER_WGSL,workgroupX:Math.ceil(n/256)},
        [{binding:0,buffer:varBuf},{binding:1,buffer:reBuf},{binding:2,buffer:imBuf},{binding:3,buffer:unif}],
        {priority:"high"}
      );
      unif.destroy();

      const [outRe,outIm]=await Promise.all([
        gpuBufferPool.download(reBuf,n),
        gpuBufferPool.download(imBuf,n),
      ]);
      return {re:outRe,im:outIm};
    } finally {
      for(const b of [reBuf,imBuf,varBuf]) gpuBufferPool.release(b);
    }
  }
}

export const gpuSpectralOps = new GPUSpectralOps();
