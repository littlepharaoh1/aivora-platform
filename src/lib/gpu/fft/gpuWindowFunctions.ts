/**
 * gpuWindowFunctions.ts — GPU Window Functions
 * Aivora Audio Infrastructure Platform
 *
 * WGSL compute shaders for:
 * Hann, Hamming, Blackman, Blackman-Harris, Kaiser, Flat-top
 */

import { gpuRuntime }          from "../gpuRuntime";
import { gpuBufferPool }       from "../gpuBufferPool";
import { gpuKernelScheduler }  from "../gpuKernelScheduler";

// ── WGSL Shader ───────────────────────────────────────────────────────────────

const WINDOW_WGSL = /* wgsl */`
struct Uniforms {
  n:        u32,   // window length
  winType:  u32,   // 0=Hann 1=Hamming 2=Blackman 3=BlackmanHarris 4=FlatTop
  beta:     f32,   // Kaiser beta parameter
  _pad:     u32,
};

@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform>             uniforms: Uniforms;

const PI: f32 = 3.14159265358979323846;
const TWO_PI: f32 = 6.28318530717958647692;

fn i0(x: f32) -> f32 {
  // Modified Bessel function I0 via polynomial approximation
  var sum: f32 = 1.0;
  var term: f32 = 1.0;
  let half_x = x * 0.5;
  for (var k: u32 = 1u; k <= 25u; k++) {
    term *= (half_x * half_x) / f32(k * k);
    sum += term;
    if (term < 1e-10) { break; }
  }
  return sum;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= uniforms.n) { return; }

  let n = uniforms.n;
  let t = f32(i) / f32(n - 1u);

  var w: f32 = 0.0;

  switch (uniforms.winType) {
    case 0u: {
      // Hann: 0.5 * (1 - cos(2pi*t))
      w = 0.5 * (1.0 - cos(TWO_PI * t));
    }
    case 1u: {
      // Hamming: 0.54 - 0.46 * cos(2pi*t)
      w = 0.54 - 0.46 * cos(TWO_PI * t);
    }
    case 2u: {
      // Blackman: 0.42 - 0.5*cos(2pi*t) + 0.08*cos(4pi*t)
      w = 0.42 - 0.5 * cos(TWO_PI * t) + 0.08 * cos(4.0 * PI * t);
    }
    case 3u: {
      // Blackman-Harris: 4-term
      w =  0.35875
         - 0.48829 * cos(TWO_PI * t)
         + 0.14128 * cos(4.0 * PI * t)
         - 0.01168 * cos(6.0 * PI * t);
    }
    case 4u: {
      // Flat-top: 5-term (amplitude calibration)
      w =  0.21557895
         - 0.41663158 * cos(TWO_PI * t)
         + 0.27726316 * cos(4.0 * PI * t)
         - 0.08357895 * cos(6.0 * PI * t)
         + 0.00694737 * cos(8.0 * PI * t);
    }
    default: {
      // Kaiser: w(n) = I0(beta*sqrt(1-(2n/N-1)^2)) / I0(beta)
      let x = 2.0 * f32(i) / f32(n - 1u) - 1.0;
      let arg = uniforms.beta * sqrt(max(0.0, 1.0 - x * x));
      w = i0(arg) / i0(uniforms.beta);
    }
  }

  output[i] = w;
}
`;

// ── Window Type ───────────────────────────────────────────────────────────────

export type WindowType = "hann"|"hamming"|"blackman"|"blackman_harris"|"flat_top"|"kaiser";

const WINDOW_TYPE_ID: Record<WindowType,number> = {
  hann:0, hamming:1, blackman:2, blackman_harris:3, flat_top:4, kaiser:5,
};

// ── CPU Fallback ──────────────────────────────────────────────────────────────

function computeWindowCPU(n: number, type: WindowType, beta=8.6): Float32Array {
  const w=new Float32Array(n);
  const pi=Math.PI;

  const i0=(x:number)=>{
    let s=1,t=1; const hx=x/2;
    for(let k=1;k<=25;k++){ t*=(hx*hx)/(k*k); s+=t; if(t<1e-10)break; }
    return s;
  };

  for(let i=0;i<n;i++){
    const t=i/(n-1);
    switch(type){
      case "hann":           w[i]=0.5*(1-Math.cos(2*pi*t)); break;
      case "hamming":        w[i]=0.54-0.46*Math.cos(2*pi*t); break;
      case "blackman":       w[i]=0.42-0.5*Math.cos(2*pi*t)+0.08*Math.cos(4*pi*t); break;
      case "blackman_harris":w[i]=0.35875-0.48829*Math.cos(2*pi*t)+0.14128*Math.cos(4*pi*t)-0.01168*Math.cos(6*pi*t); break;
      case "flat_top":       w[i]=0.21557895-0.41663158*Math.cos(2*pi*t)+0.27726316*Math.cos(4*pi*t)-0.08357895*Math.cos(6*pi*t)+0.00694737*Math.cos(8*pi*t); break;
      case "kaiser":{ const x=2*i/(n-1)-1; w[i]=i0(beta*Math.sqrt(Math.max(0,1-x*x)))/i0(beta); break; }
    }
  }
  return w;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const windowCache = new Map<string,Float32Array>();

export async function computeWindow(
  n:    number,
  type: WindowType,
  beta = 8.6
): Promise<Float32Array> {
  const key=`${type}_${n}_${beta}`;
  const cached=windowCache.get(key);
  if(cached) return cached;

  let result: Float32Array;

  if(!gpuRuntime.isGPU){
    result=computeWindowCPU(n,type,beta);
  } else {
    try {
      const outBuf  = gpuBufferPool.acquire(n*4);
      const unifBuf = gpuRuntime.createBuffer(16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);

      if(!outBuf||!unifBuf){ throw new Error("Buffer alloc failed"); }

      const unifData=new Uint32Array(4);
      unifData[0]=n;
      unifData[1]=WINDOW_TYPE_ID[type];
      new Float32Array(unifData.buffer)[2]=beta;

      gpuRuntime.writeBuffer(unifBuf, new Float32Array(unifData.buffer));

      const wgX=Math.ceil(n/256);
      await gpuKernelScheduler.submit(
        { key:`window_${type}`, wgsl:WINDOW_WGSL, workgroupX:wgX },
        [
          { binding:0, buffer:outBuf },
          { binding:1, buffer:unifBuf },
        ],
        { priority:"normal" }
      );

      result = await gpuBufferPool.download(outBuf,n);
      gpuBufferPool.release(outBuf);
      unifBuf.destroy();
    } catch {
      result=computeWindowCPU(n,type,beta);
    }
  }

  windowCache.set(key,result);
  return result;
}

// Synchronous CPU version for hot paths
export function getWindowSync(n:number, type:WindowType="hann", beta=8.6): Float32Array {
  const key=`${type}_${n}_${beta}`;
  return windowCache.get(key) ?? computeWindowCPU(n,type,beta);
}
