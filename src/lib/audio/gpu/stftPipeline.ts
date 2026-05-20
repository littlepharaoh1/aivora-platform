/**
 * Aivora Core GPU Engine
 * Module: STFT & ISTFT Execution Pipeline
 * Description: High-performance, zero-allocation time-frequency mapping on the GPU.
 */

import { gpuContext } from './webgpuContext';
import radix2FFTShader from './radix2FFT.wgsl?raw';

export interface ComplexTensor {
    real: Float32Array;
    imag: Float32Array;
}

export class STFTPipeline {
    private device: GPUDevice;
    private fftPipeline!: GPUComputePipeline;
    private bitReversalPipeline!: GPUComputePipeline;

    constructor() {
        this.device = gpuContext.getDevice();
        this.compileShaders();
    }

    private compileShaders() {
        const shaderModule = this.device.createShaderModule({
            code: radix2FFTShader
        });

        this.bitReversalPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'bitReversalPass'
            }
        });

        this.fftPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'butterflyPass'
            }
        });
    }

    public async forwardSTFT(audioData: Float32Array, fftSize: number = 2048): Promise<ComplexTensor[]> {
        const sampleRateOverlapFactor = 4; 
        const hopSize = fftSize / sampleRateOverlapFactor; // 75% Overlap constraint (COLA)
        const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1;
        const results: ComplexTensor[] = [];

        const hannWindow = new Float32Array(fftSize);
        for (let n = 0; n < fftSize; n++) {
            hannWindow[n] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / (fftSize - 1)));
        }

        const bufferSize = fftSize * 8; // Complex allocation: 2 * 4 bytes per sample

        for (let frame = 0; frame < numFrames; frame++) {
            const startIdx = frame * hopSize;
            
            const gpuInputBuffer = this.device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                mappedAtCreation: true
            });

            const arrayBuffer = gpuInputBuffer.getMappedRange();
            const floatView = new Float32Array(arrayBuffer);
            
            for (let i = 0; i < fftSize; i++) {
                floatView[i * 2] = audioData[startIdx + i] * hannWindow[i]; 
                floatView[i * 2 + 1] = 0.0;                                
            }
            gpuInputBuffer.unmap();

            const gpuOutputBuffer = this.device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
            });

            const gpuStagingBuffer = this.device.createBuffer({
                size: bufferSize,
                usage: GPUMapMode.READ | GPUBufferUsage.COPY_DST
            });

            const log2N = Math.log2(fftSize);
            const uniformData = new ArrayBuffer(16);
            const uniformView = new DataView(uniformData);
            uniformView.setUint32(0, fftSize, true);
            uniformView.setUint32(4, 0, true); 
            uniformView.setInt32(8, 1, true);  

            const gpuUniformBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            this.device.queue.writeBuffer(gpuUniformBuffer, 0, uniformData);

            const bindGroup = this.device.createBindGroup({
                layout: this.bitReversalPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: gpuUniformBuffer } },
                    { binding: 1, resource: { buffer: gpuInputBuffer } },
                    { binding: 2, resource: { buffer: gpuOutputBuffer } }
                ]
            });

            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginComputePass();
            
            passEncoder.setPipeline(this.bitReversalPipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.dispatchWorkgroups(Math.ceil(fftSize / 256));

            passEncoder.setPipeline(this.fftPipeline);
            for (let stage = 0; stage < log2N; stage++) {
                uniformView.setUint32(4, stage, true);
                this.device.queue.writeBuffer(gpuUniformBuffer, 0, uniformData);
                passEncoder.dispatchWorkgroups(Math.ceil(fftSize / 256));
            }
            
            passEncoder.end();
            commandEncoder.copyBufferToBuffer(gpuOutputBuffer, 0, gpuStagingBuffer, 0, bufferSize);
            this.device.queue.submit([commandEncoder.finish()]);

            await gpuStagingBuffer.mapAsync(GPUMapMode.READ);
            const resultCopy = new Float32Array(gpuStagingBuffer.getMappedRange().slice(0));
            gpuStagingBuffer.unmap();

            const realTensor = new Float32Array(fftSize);
            const imagTensor = new Float32Array(fftSize);
            for (let i = 0; i < fftSize; i++) {
                realTensor[i] = resultCopy[i * 2];
                imagTensor[i] = resultCopy[i * 2 + 1];
            }

            results.push({ real: realTensor, imag: imagTensor });

            gpuInputBuffer.destroy();
            gpuOutputBuffer.destroy();
            gpuStagingBuffer.destroy();
            gpuUniformBuffer.destroy();
        }

        return results;
    }
}
