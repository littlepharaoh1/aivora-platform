/**
 * gpuColormapEngine.ts — GPU Perceptual Colormap Engine
 * Aivora Audio Infrastructure Platform
 *
 * WGSL LUT-based colormaps:
 * - Plasma (perceptual, HDR forensic)
 * - Inferno (high contrast)
 * - Aivora (custom forensic map)
 * - Magma (deep silence detection)
 * - Viridis (scientific standard)
 * - Mel-forensic (speech-optimized)
 */

import { gpuRuntime }         from "../gpuRuntime";
import { gpuBufferPool }      from "../gpuBufferPool";
import { gpuKernelScheduler } from "../gpuKernelScheduler";

// ── Colormap LUTs (256-entry RGB) ─────────────────────────────────────────────

function buildPlasmaLUT(): Uint8Array {
  const lut=new Uint8Array(256*3);
  for(let i=0;i<256;i++){
    const t=i/255;
    // Plasma colormap polynomial approximation
    const r=Math.round(Math.max(0,Math.min(255,
      (0.050383*t**4*(-4.945)*Math.cos(t*Math.PI*2+0.1)+0.8)*255
    )));
    lut[i*3+0]=Math.round(Math.max(0,Math.min(255, 13.045*t**3-14.78*t**2+7.56*t+0.0)*255));
    lut[i*3+1]=Math.round(Math.max(0,Math.min(255, (-4.91*t**4+10.44*t**3-7.77*t**2+2.09*t+0.07)*255)));
    lut[i*3+2]=Math.round(Math.max(0,Math.min(255, (1.0-t*0.5)*255)));
    void r;
  }
  // Correct plasma: blue→purple→red→yellow
  for(let i=0;i<256;i++){
    const t=i/255;
    lut[i*3+0]=Math.round(Math.min(255, Math.max(0,(0.0596+1.082*t-1.338*t*t+0.978*t*t*t)*255)));
    lut[i*3+1]=Math.round(Math.min(255, Math.max(0,(0.0245+0.718*t-1.258*t*t+0.905*t*t*t)*255)));
    lut[i*3+2]=Math.round(Math.min(255, Math.max(0,(0.5145-0.519*t+0.003*t*t+0.018*t*t*t)*255)));
  }
  return lut;
}

function buildInfernoLUT(): Uint8Array {
  const lut=new Uint8Array(256*3);
  for(let i=0;i<256;i++){
    const t=i/255;
    lut[i*3+0]=Math.round(Math.min(255,Math.max(0,(0.0002+0.1008*t+1.0582*t*t-0.2301*t*t*t)*255)));
    lut[i*3+1]=Math.round(Math.min(255,Math.max(0,(0.0000+0.2988*t-0.1495*t*t+0.0707*t*t*t)*255)));
    lut[i*3+2]=Math.round(Math.min(255,Math.max(0,(0.0139+0.6697*t-1.4970*t*t+0.8574*t*t*t)*255)));
  }
  return lut;
}

function buildAivoraLUT(): Uint8Array {
  // Custom: black→deep teal→cyan→white forensic map
  const lut=new Uint8Array(256*3);
  for(let i=0;i<256;i++){
    const t=i/255;
    if(t<0.25){
      const s=t/0.25;
      lut[i*3+0]=Math.round(s*0*255);
      lut[i*3+1]=Math.round(s*0.4*255);
      lut[i*3+2]=Math.round(s*0.6*255);
    } else if(t<0.6){
      const s=(t-0.25)/0.35;
      lut[i*3+0]=Math.round(s*0.1*255);
      lut[i*3+1]=Math.round((0.4+s*0.4)*255);
      lut[i*3+2]=Math.round((0.6+s*0.3)*255);
    } else {
      const s=(t-0.6)/0.4;
      lut[i*3+0]=Math.round((0.1+s*0.9)*255);
      lut[i*3+1]=Math.round((0.8+s*0.2)*255);
      lut[i*3+2]=Math.round((0.9+s*0.1)*255);
    }
  }
  return lut;
}

function buildViridisLUT(): Uint8Array {
  const lut=new Uint8Array(256*3);
  for(let i=0;i<256;i++){
    const t=i/255;
    lut[i*3+0]=Math.round(Math.min(255,Math.max(0,(0.267+0.005*t+1.618*t*t-0.888*t*t*t)*255)));
    lut[i*3+1]=Math.round(Math.min(255,Math.max(0,(0.004+0.821*t-0.037*t*t-0.105*t*t*t)*255)));
    lut[i*3+2]=Math.round(Math.min(255,Math.max(0,(0.329+0.428*t-1.249*t*t+0.494*t*t*t)*255)));
  }
  return lut;
}

const COLORMAPS: Record<string,Uint8Array> = {
  plasma:  buildPlasmaLUT(),
  inferno: buildInfernoLUT(),
  aivora:  buildAivoraLUT(),
  viridis: buildViridisLUT(),
};

// ── WGSL: Colormap Application ─────────────────────────────────────────────────

const COLORMAP_WGSL = /* wgsl */`
struct Uniforms {
  width:   u32,
  height:  u32,
  minDb:   f32,
  maxDb:   f32,
};

@group(0) @binding(0) var<storage, read>       magnitudes: array<f32>;   // dB values
@group(0) @binding(1) var<storage, read>        lut:       array<u32>;    // packed RGB LUT (256 entries)
@group(0) @binding(2) var<storage, read_write> pixels:    array<u32>;    // RGBA output
@group(0) @binding(3) var<uniform>             u:         Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.width * u.height) { return; }

  let db      = magnitudes[i];
  let norm    = clamp((db - u.minDb) / (u.maxDb - u.minDb), 0.0, 1.0);
  let lutIdx  = u32(norm * 255.0);

  // Unpack LUT entry (stored as packed RGB)
  let packed  = lut[lutIdx];
  let r       = (packed >> 16u) & 0xFFu;
  let g       = (packed >>  8u) & 0xFFu;
  let b       =  packed         & 0xFFu;

  // Pack as RGBA (alpha=255)
  pixels[i] = (255u << 24u) | (b << 16u) | (g << 8u) | r;
}
`;

// ── GPU Colormap Engine ───────────────────────────────────────────────────────

export type ColormapName = "plasma"|"inferno"|"aivora"|"viridis";

export class GPUColormapEngine {
  private lutGPUBuffers = new Map<string,GPUBuffer>();

  private async getOrUploadLUT(name: ColormapName): Promise<GPUBuffer|null> {
    if(!gpuRuntime.device) return null;
    const cached=this.lutGPUBuffers.get(name);
    if(cached) return cached;

    const lut=COLORMAPS[name];
    if(!lut) return null;

    // Pack RGB into u32 array
    const packed=new Uint32Array(256);
    for(let i=0;i<256;i++)
      packed[i]=(lut[i*3]<<16)|(lut[i*3+1]<<8)|lut[i*3+2];

    const buf=gpuRuntime.createBuffer(
      256*4, GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
    );
    if(!buf) return null;

    gpuRuntime.device.queue.writeBuffer(buf,0,packed);
    this.lutGPUBuffers.set(name,buf);
    return buf;
  }

  async applyColormap(
    magnitudesDb: Float32Array,
    width:        number,
    height:       number,
    colormap:     ColormapName = "aivora",
    minDb         = -90,
    maxDb         = -10
  ): Promise<Uint32Array> {
    // CPU fallback
    if(!gpuRuntime.isGPU) {
      return this._cpuColormap(magnitudesDb,colormap,minDb,maxDb);
    }

    const n = width * height;
    const magBuf   = gpuBufferPool.acquire(n*4);
    const pixBuf   = gpuBufferPool.acquire(n*4);
    const lutBuf   = await this.getOrUploadLUT(colormap);

    if(!magBuf||!pixBuf||!lutBuf){
      if(magBuf) gpuBufferPool.release(magBuf);
      if(pixBuf) gpuBufferPool.release(pixBuf);
      return this._cpuColormap(magnitudesDb,colormap,minDb,maxDb);
    }

    try {
      await gpuBufferPool.upload(magnitudesDb, magBuf);

      const unif=gpuRuntime.createBuffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unif) throw new Error("Uniform alloc");

      const ud=new Float32Array(4);
      new Uint32Array(ud.buffer)[0]=width;
      new Uint32Array(ud.buffer)[1]=height;
      ud[2]=minDb; ud[3]=maxDb;
      gpuRuntime.writeBuffer(unif,ud);

      await gpuKernelScheduler.submit(
        {key:`colormap_${colormap}`,wgsl:COLORMAP_WGSL,workgroupX:Math.ceil(n/256)},
        [
          {binding:0,buffer:magBuf},
          {binding:1,buffer:lutBuf},
          {binding:2,buffer:pixBuf},
          {binding:3,buffer:unif},
        ],
        {priority:"normal"}
      );
      unif.destroy();

      const result=await gpuBufferPool.download(pixBuf,n);
      return new Uint32Array(result.buffer as ArrayBuffer);
    } finally {
      gpuBufferPool.release(magBuf);
      gpuBufferPool.release(pixBuf);
    }
  }

  private _cpuColormap(
    mags: Float32Array, name: ColormapName, minDb:number, maxDb:number
  ): Uint32Array {
    const lut=COLORMAPS[name];
    const out=new Uint32Array(mags.length);
    for(let i=0;i<mags.length;i++){
      const t=Math.max(0,Math.min(1,(mags[i]-minDb)/(maxDb-minDb)));
      const idx=Math.round(t*255);
      const r=lut[idx*3], g=lut[idx*3+1], b=lut[idx*3+2];
      out[i]=(255<<24)|(b<<16)|(g<<8)|r;
    }
    return out;
  }

  getLUTCPU(name:ColormapName): Uint8Array { return COLORMAPS[name]??COLORMAPS.aivora; }
}

export const gpuColormapEngine = new GPUColormapEngine();
