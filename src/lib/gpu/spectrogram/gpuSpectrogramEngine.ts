/**
 * gpuSpectrogramEngine.ts — GPU HDR Forensic Spectrogram Engine
 * Aivora Audio Infrastructure Platform
 *
 * Full GPU pipeline:
 * 1. STFT via gpuFFTPlanner
 * 2. Magnitude → dB conversion (GPU)
 * 3. Logarithmic frequency mapping
 * 4. HDR dynamic range compression
 * 5. Forensic amplification mode (silence exaggeration)
 * 6. Colormap application via gpuColormapEngine
 */

import { gpuFFTPlanner }     from "../fft/gpuFFTPlanner";
import { gpuColormapEngine } from "./gpuColormapEngine";
import { gpuRuntime }        from "../gpuRuntime";
import { gpuBufferPool }     from "../gpuBufferPool";
import { gpuKernelScheduler} from "../gpuKernelScheduler";
import type { ColormapName } from "./gpuColormapEngine";

// ── WGSL: Magnitude → dB + HDR Compression ────────────────────────────────────

const MAG_TO_DB_WGSL = /* wgsl */`
struct Uniforms {
  nBins:      u32,
  frames:     u32,
  minDb:      f32,
  maxDb:      f32,
  forensicAmp:f32,   // 0=off, 1-3=forensic amplification
  _pad:       u32,
};

@group(0) @binding(0) var<storage, read>       re:     array<f32>;
@group(0) @binding(1) var<storage, read>       im:     array<f32>;
@group(0) @binding(2) var<storage, read_write> dbOut:  array<f32>;
@group(0) @binding(3) var<uniform>             u:      Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.nBins * u.frames) { return; }

  let mag    = sqrt(re[i]*re[i] + im[i]*im[i]);
  var db: f32 = select(-120.0, 20.0 * log2(mag) * 0.30103, mag > 1e-10);

  // Forensic amplification: emphasize low-energy regions
  if (u.forensicAmp > 0.0) {
    let norm   = clamp((db - u.minDb) / (u.maxDb - u.minDb), 0.0, 1.0);
    let ampGain = 1.0 + u.forensicAmp * (1.0 - norm) * (1.0 - norm);
    db = u.minDb + (db - u.minDb) * ampGain;
  }

  // HDR compression (soft knee)
  db = clamp(db, u.minDb, u.maxDb);
  dbOut[i] = db;
}
`;

// ── WGSL: Log-Frequency Mapping ───────────────────────────────────────────────

const LOG_FREQ_WGSL = /* wgsl */`
struct Uniforms {
  nBins:    u32,
  outBins:  u32,
  frames:   u32,
  fMin:     f32,
  fMax:     f32,
  sr:       f32,
  _p0:      u32,
  _p1:      u32,
};

@group(0) @binding(0) var<storage, read>       linear:  array<f32>;  // dB linear freq
@group(0) @binding(1) var<storage, read_write> log_out: array<f32>;  // dB log freq

const LOG2: f32 = 0.693147180559945;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.outBins * u.frames) { return; }

  let frame   = i / u.outBins;
  let outBin  = i % u.outBins;

  // Map output bin → log frequency
  let logMin  = log(u.fMin) / LOG2;
  let logMax  = log(u.fMax) / LOG2;
  let logFreq = logMin + f32(outBin) / f32(u.outBins - 1u) * (logMax - logMin);
  let freq    = pow(2.0, logFreq);

  // Map frequency → linear bin
  let linearBin = u32(freq / (u.sr * 0.5) * f32(u.nBins - 1u));
  let srcBin    = clamp(linearBin, 0u, u.nBins - 1u);

  log_out[i] = linear[frame * u.nBins + srcBin];
}
`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpectrogramConfig {
  fftSize:     number;
  hopSize:     number;
  minDb:       number;
  maxDb:       number;
  colormap:    ColormapName;
  logFreq:     boolean;
  forensicAmp: number;   // 0-3
  fMinHz:      number;
  fMaxHz:      number;
}

export interface SpectrogramResult {
  pixels:    Uint32Array;   // RGBA flat array
  width:     number;        // = frames
  height:    number;        // = frequency bins
  fftSize:   number;
  hopSize:   number;
  gpu:       boolean;
  latencyMs: number;
}

const DEFAULT_CONFIG: SpectrogramConfig = {
  fftSize:512, hopSize:128, minDb:-90, maxDb:-10,
  colormap:"aivora", logFreq:true, forensicAmp:1.0,
  fMinHz:20, fMaxHz:20000,
};

// ── GPU Spectrogram Engine ─────────────────────────────────────────────────────

export class GPUSpectrogramEngine {

  async compute(
    data:   Float32Array,
    sr:     number,
    config: Partial<SpectrogramConfig> = {}
  ): Promise<SpectrogramResult> {
    const cfg   = { ...DEFAULT_CONFIG, ...config };
    const t0    = performance.now();

    // Step 1: STFT
    const stft  = await gpuFFTPlanner.stft(data, {
      fftSize:   cfg.fftSize,
      hopSize:   cfg.hopSize,
      windowType:"hann",
      padded:    false,
    });

    const frames = stft.frames;
    const nBins  = cfg.fftSize / 2;

    // Step 2: Mag→dB (GPU)
    const dbData = await this._magToDb(stft.re, stft.im, frames, nBins, cfg);

    // Step 3: Log frequency mapping (optional)
    const outBins = nBins;
    let finalDb   = dbData;
    if(cfg.logFreq && gpuRuntime.isGPU) {
      finalDb = await this._logFreqMap(dbData, frames, nBins, outBins, cfg, sr);
    }

    // Step 4: Colormap → RGBA pixels
    const pixels = await gpuColormapEngine.applyColormap(
      finalDb, frames, outBins, cfg.colormap, cfg.minDb, cfg.maxDb
    );

    return {
      pixels, width:frames, height:outBins,
      fftSize:cfg.fftSize, hopSize:cfg.hopSize,
      gpu: stft.gpu,
      latencyMs: Math.round((performance.now()-t0)*100)/100,
    };
  }

  private async _magToDb(
    reFrames: Float32Array[], imFrames: Float32Array[],
    frames: number, nBins: number,
    cfg: SpectrogramConfig
  ): Promise<Float32Array> {
    const total = frames * nBins;

    // Pack frames
    const packedRe = new Float32Array(total);
    const packedIm = new Float32Array(total);
    for(let f=0;f<frames;f++){
      packedRe.set(reFrames[f].slice(0,nBins), f*nBins);
      packedIm.set(imFrames[f].slice(0,nBins), f*nBins);
    }

    if(!gpuRuntime.isGPU) {
      const db=new Float32Array(total);
      for(let i=0;i<total;i++){
        const m=Math.sqrt(packedRe[i]**2+packedIm[i]**2);
        let d=m>1e-10?20*Math.log10(m):-120;
        d=Math.max(cfg.minDb,Math.min(cfg.maxDb,d));
        db[i]=d;
      }
      return db;
    }

    const reBuf=gpuBufferPool.acquire(total*4);
    const imBuf=gpuBufferPool.acquire(total*4);
    const dbBuf=gpuBufferPool.acquire(total*4);

    if(!reBuf||!imBuf||!dbBuf){
      for(const b of [reBuf,imBuf,dbBuf]) if(b) gpuBufferPool.release(b);
      return new Float32Array(total);
    }

    try {
      await Promise.all([gpuBufferPool.upload(packedRe,reBuf),gpuBufferPool.upload(packedIm,imBuf)]);

      const unif=gpuRuntime.createBuffer(24,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unif) throw new Error("Uniform");
      const ud=new Float32Array(6);
      new Uint32Array(ud.buffer)[0]=nBins;
      new Uint32Array(ud.buffer)[1]=frames;
      ud[2]=cfg.minDb; ud[3]=cfg.maxDb; ud[4]=cfg.forensicAmp;
      gpuRuntime.writeBuffer(unif,ud);

      await gpuKernelScheduler.submit(
        {key:"spec_mag2db",wgsl:MAG_TO_DB_WGSL,workgroupX:Math.ceil(total/256)},
        [{binding:0,buffer:reBuf},{binding:1,buffer:imBuf},{binding:2,buffer:dbBuf},{binding:3,buffer:unif}],
        {priority:"high"}
      );
      unif.destroy();
      return await gpuBufferPool.download(dbBuf,total);
    } finally {
      for(const b of [reBuf,imBuf,dbBuf]) gpuBufferPool.release(b);
    }
  }

  private async _logFreqMap(
    linear: Float32Array, frames: number,
    nBins: number, outBins: number,
    cfg: SpectrogramConfig, sr: number
  ): Promise<Float32Array> {
    const total=frames*outBins;
    const linBuf=gpuBufferPool.acquire(frames*nBins*4);
    const outBuf=gpuBufferPool.acquire(total*4);
    if(!linBuf||!outBuf){ if(linBuf)gpuBufferPool.release(linBuf); if(outBuf)gpuBufferPool.release(outBuf); return linear; }

    try {
      await gpuBufferPool.upload(linear,linBuf);
      const unif=gpuRuntime.createBuffer(32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      if(!unif) throw new Error("Uniform");
      const ud=new Float32Array(8);
      new Uint32Array(ud.buffer)[0]=nBins;
      new Uint32Array(ud.buffer)[1]=outBins;
      new Uint32Array(ud.buffer)[2]=frames;
      ud[3]=cfg.fMinHz; ud[4]=Math.min(cfg.fMaxHz,sr/2); ud[5]=sr;
      gpuRuntime.writeBuffer(unif,ud);

      await gpuKernelScheduler.submit(
        {key:"spec_logfreq",wgsl:LOG_FREQ_WGSL,workgroupX:Math.ceil(total/256)},
        [{binding:0,buffer:linBuf},{binding:1,buffer:outBuf},{binding:2,buffer:unif}],
        {priority:"normal"}
      );
      unif.destroy();
      return await gpuBufferPool.download(outBuf,total);
    } finally {
      gpuBufferPool.release(linBuf); gpuBufferPool.release(outBuf);
    }
  }
}

export const gpuSpectrogramEngine = new GPUSpectrogramEngine();
