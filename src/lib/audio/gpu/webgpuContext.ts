/**
 * Aivora Core GPU Engine
 * Module: WebGPU Compute Context Lock
 */

export class WebGPUContext {
    private adapter: GPUAdapter | null = null;
    private device: GPUDevice | null = null;
    public isInitialized: boolean = false;

    public async initialize(): Promise<GPUDevice> {
        if (this.isInitialized && this.device) return this.device;
        if (!navigator.gpu) throw new Error("AIVORA FATAL: WebGPU not supported.");

        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!this.adapter) throw new Error("AIVORA FATAL: GPU Adapter acquisition failed.");

        this.device = await this.adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
                maxComputeWorkgroupSizeX: 256,
                maxComputeInvocationsPerWorkgroup: 256
            }
        });

        this.device.lost.then((info) => {
            console.error(`AIVORA GPU CONTEXT LOSS: ${info.message}`);
            this.isInitialized = false;
        });

        this.isInitialized = true;
        return this.device;
    }

    public getDevice(): GPUDevice {
        if (!this.device) throw new Error("AIVORA FATAL: Device requested before init.");
        return this.device;
    }
}

export const gpuContext = new WebGPUContext();
