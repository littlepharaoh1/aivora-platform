/**
 * Aivora Core DSP Engine
 * Module: Unified Audio Processor Orchestrator
 * Description: End-to-end pipeline management from raw input to noise-isolated output.
 */

import { BitDepthExpander } from './bitDepthExpander';
import { STFTPipeline } from '../gpu/stftPipeline';
import { SpectralSubtraction } from '../gpu/spectralSubtraction';
import { ISTFTPipeline } from '../gpu/istftPipeline';
import { gpuContext } from '../gpu/webgpuContext';

export interface ProcessorOptions {
    fftSize?: number;
    alpha?: number;
    beta?: number;
}

export class AivoraAudioProcessor {
    private stftPipeline!: STFTPipeline;
    private spectralSubtractor!: SpectralSubtraction;
    private istftPipeline!: ISTFTPipeline;
    private isEngineReady: boolean = false;

    constructor(options: ProcessorOptions = {}) {
        const fftSize = options.fftSize || 2048;
        const alpha = options.alpha || 2.0;
        const beta = options.beta || 0.02;

        // Initialize downstream DSP processing modules
        this.spectralSubtractor = new SpectralSubtraction(alpha, beta);
    }

    /**
     * Initializes the WebGPU hardware context and compiles compute pipelines.
     */
    public async bootstrap(): Promise<void> {
        if (this.isEngineReady) return;

        // Ensure GPU context is locked and active
        await gpuContext.initialize();
        
        // Instantiate pipelines sharing the initialized device context
        this.stftPipeline = new STFTPipeline();
        this.istftPipeline = new ISTFTPipeline();
        
        this.isEngineReady = true;
    }

    /**
     * Executes full noise isolation round-trip on a raw 16-bit PCM AudioBuffer.
     */
    public async process16BitPCM(rawPcmBuffer: ArrayBuffer, fftSize: number = 2048): Promise<Float32Array> {
        if (!this.isEngineReady) {
            throw new Error("AIVORA PROXIMITY ERROR: Processor not bootstrapped. Call bootstrap() first.");
        }

        // Phase 1: Expand bit depth to high-headroom 32-bit floats
        const normalizedAudio = BitDepthExpander.expand16Bit(rawPcmBuffer);

        // Phase 2: Compute Forward STFT via WebGPU
        const frequencyTensors = await this.stftPipeline.forwardSTFT(normalizedAudio, fftSize);

        // Phase 3: Execute Dynamic Spectral Subtraction (Noise Floor Suppression)
        const cleanTensors = this.spectralSubtractor.process(frequencyTensors);

        // Phase 4: Execute Inverse STFT via WebGPU and Overlap-Add Synthesis
        const cleanTimeDomainAudio = await this.istftPipeline.inverseSTFT(cleanTensors, fftSize);

        return cleanTimeDomainAudio;
    }
}
