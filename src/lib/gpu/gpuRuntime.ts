/**
 * gpuRuntime.ts — WebGPU Compute Runtime
 * Aivora Audio Infrastructure Platform
 */

export type GPUBackend = "webgpu" | "cpu_fallback";

export interface GPUCapabilities {
  backend:           GPUBackend;
  adapterName:       string;
  maxBufferSize:     number;
  maxWorkgroupSize:  number;
  maxStorageBuffers: number;
  supportsTimestamp: boolean;
  supportsFloat32:   boolean;
  estimatedVRAMMB:   number;
}

export interface GPURuntimeStats {
  backend:           GPUBackend;
  pipelinesCompiled: number;
  totalDispatches:   number;
  failedDispatches:  number;
  avgDispatchMs:     number;
  deviceLost:        boolean;
}

const MAX_BUF = 256 * 1024 * 1024;
const PIPE_MAX = 32;

export class GPURuntime {
  private dev:    GPUDevice|null       = null;
  private ada:    GPUAdapter|null      = null;
  private caps:   GPUCapabilities|null = null;
  private pipes   = new Map<string,GPUComputePipeline>();
  private inited  = false;
  private lost    = false;
  private dispatched = 0;
  private failed     = 0;
  private lats:   number[] = [];

  async initialize(): Promise<GPUCapabilities> {
    if(this.inited && this.caps) return this.caps;

    if(typeof navigator === "undefined" || !("gpu" in navigator))
      return this._fallback();

    try {
      const gpu = (navigator as unknown as {gpu:GPU}).gpu;
      const adapter = await gpu.requestAdapter({ powerPreference:"high-performance" });
      if(!adapter) return this._fallback();

      const features: GPUFeatureName[] = [];
      if(adapter.features.has("timestamp-query")) features.push("timestamp-query");

      const device = await adapter.requestDevice({
        requiredFeatures: features,
        requiredLimits: {
          maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, MAX_BUF),
          maxBufferSize:               Math.min(adapter.limits.maxBufferSize, MAX_BUF),
        },
      });

      device.lost.then(() => {
        this.lost=true; this.dev=null; this.inited=false;
        setTimeout(()=>{ this.lost=false; this.initialize().catch(()=>{}); }, 2000);
      });

      this.dev  = device;
      this.ada  = adapter;
      this.caps = {
        backend:           "webgpu",
        adapterName:       "WebGPU Adapter",
        maxBufferSize:     device.limits.maxBufferSize,
        maxWorkgroupSize:  device.limits.maxComputeWorkgroupSizeX,
        maxStorageBuffers: device.limits.maxStorageBuffersPerShaderStage,
        supportsTimestamp: adapter.features.has("timestamp-query"),
        supportsFloat32:   true,
        estimatedVRAMMB:   Math.round(device.limits.maxBufferSize/1048576),
      };
      this.inited = true;
      return this.caps;
    } catch {
      return this._fallback();
    }
  }

  private _fallback(): GPUCapabilities {
    this.caps = {
      backend:"cpu_fallback", adapterName:"CPU Fallback",
      maxBufferSize:MAX_BUF, maxWorkgroupSize:256, maxStorageBuffers:8,
      supportsTimestamp:false, supportsFloat32:true, estimatedVRAMMB:0,
    };
    this.dev    = null;
    this.inited = true;
    return this.caps;
  }

  async compilePipeline(key:string, wgsl:string, entry="main"): Promise<GPUComputePipeline|null> {
    if(!this.dev) return null;
    const cached=this.pipes.get(key);
    if(cached) return cached;
    if(this.pipes.size>=PIPE_MAX){ const k=this.pipes.keys().next().value; if(k) this.pipes.delete(k); }
    try {
      const mod  = this.dev.createShaderModule({code:wgsl});
      const info = await mod.getCompilationInfo();
      if(info.messages.some(m=>m.type==="error")) throw new Error("WGSL compile error");
      const pipe = await this.dev.createComputePipelineAsync({layout:"auto",compute:{module:mod,entryPoint:entry}});
      this.pipes.set(key,pipe);
      return pipe;
    } catch(e){ this.failed++; throw e; }
  }

  createBuffer(size:number, usage:number): GPUBuffer|null {
    return this.dev?.createBuffer({size,usage})??null;
  }

  async dispatch(pipe:GPUComputePipeline, bg:GPUBindGroup, x:number, y=1, z=1): Promise<number> {
    if(!this.dev) return 0;
    const t0=performance.now();
    const enc=this.dev.createCommandEncoder();
    const pass=enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0,bg);
    pass.dispatchWorkgroups(x,y,z); pass.end();
    this.dev.queue.submit([enc.finish()]);
    await this.dev.queue.onSubmittedWorkDone();
    const ms=performance.now()-t0;
    this.dispatched++; this.lats.push(ms);
    if(this.lats.length>128) this.lats.shift();
    return ms;
  }

  async readBuffer(buf:GPUBuffer, size:number): Promise<Float32Array> {
    if(!this.dev) return new Float32Array(size/4);
    const staging=this.dev.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const enc=this.dev.createCommandEncoder();
    enc.copyBufferToBuffer(buf,0,staging,0,size);
    this.dev.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const result=new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    return result;
  }

  writeBuffer(buf:GPUBuffer, data:Float32Array): void {
    this.dev?.queue.writeBuffer(buf,0,data.buffer as ArrayBuffer,data.byteOffset,data.byteLength);
  }

  get device():       GPUDevice|null       { return this.dev; }
  get capabilities(): GPUCapabilities|null { return this.caps; }
  get isGPU():        boolean              { return this.caps?.backend==="webgpu"; }
  get isReady():      boolean              { return this.inited&&!this.lost; }

  getStats(): GPURuntimeStats {
    const avg=this.lats.length>0?this.lats.reduce((a,b)=>a+b)/this.lats.length:0;
    return {
      backend:           this.caps?.backend??"cpu_fallback",
      pipelinesCompiled: this.pipes.size,
      totalDispatches:   this.dispatched,
      failedDispatches:  this.failed,
      avgDispatchMs:     Math.round(avg*100)/100,
      deviceLost:        this.lost,
    };
  }

  dispose(): void { this.dev?.destroy(); this.dev=null; this.inited=false; }
}

export const gpuRuntime = new GPURuntime();
