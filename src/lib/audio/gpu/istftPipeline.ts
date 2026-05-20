/**
 * Aivora Core GPU Engine
 * Module: ISTFT (Inverse Short-Time Fourier Transform) Pipeline
 * Description: Reconstructs time-domain audio from filtered frequency tensors using Overlap-Add (OLA).
 */

import { gpuContext } from './webgpuContext';
import { ComplexTensor } from './stftPipeline';
import radix2FFTShader from './radix2FFT.wgsl?raw';

export class ISTFTPipeline {
    private device: GPUDevice;
    private ifftPipeline!: GPUComputePipeline;
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

        this.ifftPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'butterflyPass'
            }
        });
    }

    /**
     * Converts frequency-domain tensors back into continuous time-domain audio data.
     * Reconstructs signal using Overlap-Add synthesis with window normalization.
     */
    public async inverseSTFT(frames: ComplexTensor[], fftSize: number = 2048): Promise<Float32Array> {
        if (frames.length === 0) return new Float32Array(0);

        const sampleRateOverlapFactor = 4;
        const hopSize = fftSize / sampleRateOverlapFactor; // 75% Overlap constraint
        const numFrames = frames.length;
        const totalLength = (numFrames - 1) * hopSize + fftSize;

        const outputAudio = new Float32Array(totalLength);
        const windowSum = new Float32Array(totalLength);

        // Re-generate Hann Window for Synthesis normalization
        const hannWindow = new Float32Array(fftSize);
        for (let n = 0; n < fftSize; n++) {
            hannWindow[n] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * n) / (fftSize - 1)));
        }

        const bufferSize = fftSize * 8; // Complex: 2 * 4 bytes per sample

        for (let frame = 0; frame < numFrames; frame++) {
            const startIdx = frame * hopSize;

            const gpuInputBuffer = this.device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                mappedAtCreation: true
            });

            // Load the clean complex frame into GPU memory
            const arrayBuffer = gpuInputBuffer.getMappedRange();
            const floatView = new Float32Array(arrayBuffer);
            for (let i = 0; i < fftSize; i++) {
                floatView[i * 2] = frames[frame].real[i];
                floatView[i * 2 + 1] = frames[frame].imag[i];
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
            uniformView.setInt32(8, -1, true); // Direction = -1 triggers IFFT Mode inside WGSL

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

            passEncoder.setPipeline(this.ifftPipeline);
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

            // Overlap-Add Accumulation Loop with 1/N Scaling applied on CPU to preserve GPU performance
            for (let i = 0; i < fftSize; i++) {
                const realTimeVal = resultCopy[i * 2] / fftSize; 
                outputAudio[startIdx + i] += realTimeVal * hannWindow[i];
                windowSum[startIdx + i] += hannWindow[i] * hannWindow[i];
            }

            gpuInputBuffer.destroy();
            gpuOutputBuffer.destroy();
            gpuStagingBuffer.destroy();
            gpuUniformBuffer.destroy();
        }

        // Apply Window Normalization to fully eliminate COLA edge distortion artifacts
        for (let i = 0; i < outputAudio.length; i++) {
            if (windowSum[i] > 1e-4) {
                outputAudio[i] /= windowSum[i];
            }
        }

        return outputAudio;
    }
}
