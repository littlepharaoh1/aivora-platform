/**
 * Aivora Frontend Core
 * Hook: useAudioProcessor
 * Description: React hook to interface reactive UI states with the WebGPU DSP Orchestrator.
 */

import { useState, useEffect, useRef } from 'react';
import { AivoraAudioProcessor, ProcessorOptions } from '../core/aivoraProcessor';

export interface UseAudioProcessorReturn {
    isReady: boolean;
    isProcessing: boolean;
    error: string | null;
    processAudio: (rawPcmBuffer: ArrayBuffer, fftSize?: number) => Promise<Float32Array | null>;
}

export function useAudioProcessor(options: ProcessorOptions = {}): UseAudioProcessorReturn {
    const [isReady, setIsReady] = useState<boolean>(false);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    // Maintain a persistent reference to the processor instance across re-renders
    const processorRef = useRef<AivoraAudioProcessor | null>(null);

    useEffect(() => {
        let isMounted = true;

        const initializeEngine = async () => {
            try {
                const processor = new AivoraAudioProcessor(options);
                await processor.bootstrap();
                
                if (isMounted) {
                    processorRef.current = processor;
                    setIsReady(true);
                }
            } catch (err: any) {
                if (isMounted) {
                    console.error("AIVORA HOOK ERROR:", err);
                    setError(err.message || "Failed to bootstrap WebGPU Core Engine.");
                }
            }
        };

        initializeEngine();

        // Safe teardown to avoid memory constraints on multi-page hot reloads
        return () => {
            isMounted = false;
        };
    }, []);

    /**
     * Higher-order processing function to transform dirty PCM chunks into isolated speech streams.
     */
    const processAudio = async (rawPcmBuffer: ArrayBuffer, fftSize: number = 2048): Promise<Float32Array | null> => {
        if (!processorRef.current || !isReady) {
            setError("AIVORA UTILITY ERROR: Process invoked before hardware synchronization.");
            return null;
        }

        setIsProcessing(true);
        setError(null);

        try {
            const cleanedAudio = await processorRef.current.process16BitPCM(rawPcmBuffer, fftSize);
            setIsProcessing(false);
            return cleanedAudio;
        } catch (err: any) {
            setIsProcessing(false);
            setError(err.message || "Exception intercepted during GPU compute dispatch.");
            return null;
        }
    };

    return {
        isReady,
        isProcessing,
        error,
        processAudio
    };
}
