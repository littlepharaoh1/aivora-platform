/**
 * Aivora Core DSP Engine
 * Module: Dynamic Spectral Subtraction & Consonant Protection
 * Description: Eliminates continuous noise floor while preserving unvoiced, low-energy speech features.
 */

import { ComplexTensor } from './stftPipeline';

export class SpectralSubtraction {
    private alpha: number; // Over-subtraction factor
    private beta: number;  // Spectral floor coefficient to protect whispered consonants

    constructor(alpha: number = 2.0, beta: number = 0.02) {
        this.alpha = alpha;
        this.beta = beta;
    }

    /**
     * Processes complex frequency tensors to attenuate stable noise profiles.
     * Implements spectral flooring to combat musical noise components.
     */
    public process(frames: ComplexTensor[]): ComplexTensor[] {
        if (frames.length === 0) return [];
        const fftSize = frames[0].real.length;
        
        // Step 1: Estimate Noise Profile from the first 5 frames (Initial Noise Floor)
        const noiseEstimate = new Float32Array(fftSize);
        const estimationFrames = Math.min(5, frames.length);
        
        for (let i = 0; i < estimationFrames; i++) {
            for (let j = 0; j < fftSize; j++) {
                const r = frames[i].real[j];
                const im = frames[i].imag[j];
                noiseEstimate[j] += (r * r + im * im);
            }
        }
        for (let j = 0; j < fftSize; j++) {
            noiseEstimate[j] /= estimationFrames;
        }

        // Step 2: Apply Spectral Subtraction Frame-by-Frame
        return frames.map(frame => {
            const cleanReal = new Float32Array(fftSize);
            const cleanImag = new Float32Array(fftSize);

            for (let j = 0; j < fftSize; j++) {
                const r = frame.real[j];
                const im = frame.imag[j];
                const magnitudeSq = r * r + im * im;
                const magnitude = Math.sqrt(magnitudeSq);

                if (magnitude === 0) {
                    cleanReal[j] = 0;
                    cleanImag[j] = 0;
                    continue;
                }

                // Subtraction formula: P_clean = P_signal - alpha * P_noise
                let cleanMagnitudeSq = magnitudeSq - this.alpha * noiseEstimate[j];
                const floorThreshold = this.beta * magnitudeSq;

                // Spectral Flooring Pattern to block distortion and musical noise
                if (cleanMagnitudeSq < floorThreshold) {
                    cleanMagnitudeSq = floorThreshold;
                }

                const cleanMagnitude = Math.sqrt(cleanMagnitudeSq);
                const gain = cleanMagnitude / magnitude;

                cleanReal[j] = r * gain;
                cleanImag[j] = im * gain;
            }

            return { real: cleanReal, imag: cleanImag };
        });
    }
}
