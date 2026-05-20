import React, { useState, useRef } from 'react';
import { useAudioProcessor } from '../../lib/audio/hooks/useAudioProcessor';

export const AudioAnnotationWorkspace: React.FC = () => {
    const { isReady, isProcessing, error, processAudio } = useAudioProcessor({ alpha: 2.2, beta: 0.02 });
    const [isFilterActive, setIsFilterActive] = useState<boolean>(false);
    const [transcription, setTranscription] = useState<string>("");
    
    // Simulated mock task data context mimicking production payload structures
    const [mockTask] = useState({
        taskId: "TASK-48912-MED-ONC",
        language: "Arabic (Egypt)",
        status: "Pending Review"
    });

    const audioContextRef = useRef<AudioContext | null>(null);
    const mockAudioDataRef = useRef<ArrayBuffer | null>(null);

    /**
     * Synthesizes a safe dummy 16-bit PCM block internally for seamless validation testing.
     */
    const generateInternalMockBuffer = () => {
        const sampleRate = 16000;
        const duration = 2; // 2 Seconds
        const numSamples = sampleRate * duration;
        const buffer = new ArrayBuffer(numSamples * 2); // 16-bit = 2 bytes
        const view = new DataView(buffer);

        // Inject a simulated sine wave with artificial white noise components
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            const signal = Math.sin(2 * Math.PI * 440 * t); // 440Hz harmonic pure tone
            const noise = (Math.random() * 2 - 1) * 0.4;    // Intensive background noise floor injection
            const sample = Math.max(-1, Math.min(1, signal + noise));
            
            view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        mockAudioDataRef.current = buffer;
    };

    const handlePlaybackToggle = async () => {
        if (!mockAudioDataRef.current) {
            generateInternalMockBuffer();
        }

        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        }

        const ctx = audioContextRef.current;
        let pcmDataToPlay: Float32Array;

        if (isFilterActive && isReady) {
            // Stream the buffer through the high-performance WebGPU noise extraction layer
            const cleaned = await processAudio(mockAudioDataRef.current!, 2048);
            pcmDataToPlay = cleaned || new Float32Array(mockAudioDataRef.current!.byteLength / 2);
        } else {
            // Emulate fallback standard CPU extraction layout
            const raw16 = new Int16Array(mockAudioDataRef.current!);
            pcmDataToPlay = new Float32Array(raw16.length);
            for (let i = 0; i < raw16.length; i++) {
                pcmDataToPlay[i] = raw16[i] / 32768.0;
            }
        }

        const audioBuffer = ctx.createBuffer(1, pcmDataToPlay.length, 16000);
        audioBuffer.copyToChannel(pcmDataToPlay as any, 0);

        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(ctx.destination);
        sourceNode.start();
    };

    return (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl text-white max-w-4xl mx-auto my-6">
            {/* Context Tracking Banner */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
                <div>
                    <span className="text-[10px] bg-indigo-950 text-indigo-400 border border-indigo-900 font-mono px-2 py-0.5 rounded">
                        {mockTask.taskId}
                    </span>
                    <h2 className="text-base font-bold mt-1">Multilingual Validation Interface</h2>
                </div>
                <div className="text-right text-xs">
                    <p className="text-slate-400">Target Locale: <span className="text-white font-medium">{mockTask.language}</span></p>
                </div>
            </div>

            {error && <div className="p-2 mb-4 text-xs bg-red-950 border border-red-900 text-red-400 rounded">Exception: {error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Audio Manipulation Deck */}
                <div className="md:col-span-1 bg-slate-950 p-4 border border-slate-800/80 rounded-lg flex flex-col justify-between">
                    <div>
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Audio Control Board</h4>
                        
                        {/* THE NEURAL FILTER TOGGLE */}
                        <div className="flex items-center justify-between p-3 bg-slate-900 border border-slate-800 rounded-lg mb-4">
                            <div>
                                <p className="text-xs font-bold text-slate-200">Aivora Neural Filter</p>
                                <p className="text-[10px] text-slate-500">Accelerated via WebGPU</p>
                            </div>
                            <input 
                                type="checkbox" 
                                checked={isFilterActive}
                                onChange={(e) => setIsFilterActive(e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 accent-indigo-500 cursor-pointer"
                            />
                        </div>
                    </div>

                    <button
                        onClick={handlePlaybackToggle}
                        disabled={isProcessing}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 font-medium text-xs rounded transition-colors text-white"
                    >
                        {isProcessing ? 'Filtering Stream...' : 'Play Audio Segment'}
                    </button>
                </div>

                {/* Linguistic Input Deck */}
                <div className="md:col-span-2 flex flex-col space-y-3">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Linguistic Transcript Output</label>
                    <textarea
                        value={transcription}
                        onChange={(e) => setTranscription(e.target.value)}
                        placeholder="Listen to the stream and input accurate transcription data here..."
                        className="w-full h-32 p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder-slate-600 resize-none"
                    />
                    <div className="flex justify-end">
                        <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold rounded text-white transition-colors">
                            Submit Validated Task
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
