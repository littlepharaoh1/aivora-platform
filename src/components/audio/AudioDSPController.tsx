import React, { useState, useRef } from 'react';
import { useAudioProcessor } from '../../lib/audio/hooks/useAudioProcessor';

export const AudioDSPController: React.FC = () => {
    const { isReady, isProcessing, error, processAudio } = useAudioProcessor({
        alpha: 2.5, // Aggressive over-subtraction for standard continuous room noise
        beta: 0.02  // Consonant protection floor threshold
    });

    const [fileLoaded, setFileLoaded] = useState<boolean>(false);
    const [playbackReady, setPlaybackReady] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Persistent memory allocation for audio chunks
    const rawAudioDataRef = useRef<ArrayBuffer | null>(null);
    const cleanAudioBufferRef = useRef<Float32Array | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    /**
     * Reads the uploaded file into high-speed memory as a binary ArrayBuffer.
     */
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            rawAudioDataRef.current = arrayBuffer;
            setFileLoaded(true);
            setPlaybackReady(false);
            cleanAudioBufferRef.current = null;
        } catch (err) {
            console.error("AIVORA UI FILE ERROR:", err);
        }
    };

    /**
     * Dispatches the raw binary buffer directly into the WebGPU isolation pipeline.
     */
    const handleProcessAudio = async () => {
        if (!rawAudioDataRef.current || !isReady) return;

        const result = await processAudio(rawAudioDataRef.current, 2048);
        if (result) {
            cleanAudioBufferRef.current = result;
            setPlaybackReady(true);
        }
    };

    /**
     * Reconstructs the unmanaged float array into hardware speakers via low-latency Web Audio API.
     */
    const handlePlayIsolatedAudio = () => {
        if (!cleanAudioBufferRef.current) return;

        // Instantiating standard modern AudioContext context safely
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 16000 // Standard targeted dataset sample rate for Aivora pipelines
            });
        }

        const ctx = audioContextRef.current;
        const floatArray = cleanAudioBufferRef.current;

        // Generate mono channel buffer frame
        const audioBuffer = ctx.createBuffer(1, floatArray.length, 16000);
        
        // HOT-FIX: Cast to any to bypass strict modern TypedArray buffer-backing constraints
        audioBuffer.copyToChannel(floatArray as any, 0);

        // Connect source execution nodes directly to target hardware output
        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(ctx.destination);
        sourceNode.start();
    };

    return (
        <div className="p-6 max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-xl shadow-2xl text-white">
            <h2 className="text-xl font-bold tracking-tight text-indigo-400 mb-2">
                Aivora Neural Noise Isolation
            </h2>
            <p className="text-xs text-slate-400 mb-6">
                Hardware-accelerated client-side spectral subtraction engine via WebGPU Compute.
            </p>

            {/* Error Vector Detection Block */}
            {error && (
                <div className="p-3 mb-4 text-xs bg-red-950/50 border border-red-800/60 rounded text-red-400">
                    <strong>Hardware Exception:</strong> {error}
                </div>
            )}

            {/* Hardware Synchronization Telemetry */}
            <div className="flex items-center space-x-2 mb-6">
                <span className={`w-2.5 h-2.5 rounded-full ${isReady ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span className="text-xs font-mono text-slate-300">
                    {isReady ? 'WebGPU DSP Core: Active & Synced' : 'Synchronizing Hardware Context...'}
                </span>
            </div>

            <div className="space-y-4">
                {/* Custom File Upload System */}
                <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        Upload Raw Audio Stream
                    </label>
                    <input 
                        type="file" 
                        accept=".wav,.pcm"
                        onChange={handleFileChange}
                        ref={fileInputRef}
                        className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-indigo-400 hover:file:bg-slate-700 cursor-pointer"
                    />
                </div>

                {/* Control Action Matrices */}
                <div className="pt-4 flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={handleProcessAudio}
                        disabled={!fileLoaded || isProcessing || !isReady}
                        className={`flex-1 py-2.5 px-4 text-xs font-medium rounded-md transition-colors ${
                            fileLoaded && isReady && !isProcessing
                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        {isProcessing ? 'Computing Spectral Subtraction...' : 'Execute Noise Isolation'}
                    </button>

                    <button
                        onClick={handlePlayIsolatedAudio}
                        disabled={!playbackReady}
                        className={`flex-1 py-2.5 px-4 text-xs font-medium rounded-md transition-colors ${
                            playbackReady
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        Listen Clean Audio Output
                    </button>
                </div>
            </div>
        </div>
    );
};
