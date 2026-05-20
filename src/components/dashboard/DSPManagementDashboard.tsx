import React, { useState } from 'react';
import { AudioDSPController } from '../audio/AudioDSPController';

export const DSPManagementDashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'telemetry' | 'sandbox'>('sandbox');

    return (
        <div className="min-h-screen bg-slate-950 p-8 text-slate-100">
            <div className="max-w-6xl mx-auto">
                {/* Header Block */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-6 mb-8">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white">Aivora Data Operations Center</h1>
                        <p className="text-sm text-slate-400 mt-1">Infrastructure Control & Client-Side Hardware Acceleration Telemetry.</p>
                    </div>
                    <div className="flex space-x-3 mt-4 md:mt-0">
                        <button 
                            onClick={() => setActiveTab('sandbox')}
                            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${activeTab === 'sandbox' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                        >
                            DSP Execution Sandbox
                        </button>
                        <button 
                            onClick={() => setActiveTab('telemetry')}
                            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${activeTab === 'telemetry' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                        >
                            Hardware Node Telemetry
                        </button>
                    </div>
                </div>

                {/* Conditional Rendering Blocks */}
                {activeTab === 'sandbox' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
                                <h3 className="text-sm font-semibold text-slate-200 mb-4">Aivora Client-Side Core Engine</h3>
                                <AudioDSPController />
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">DSP Global Parameters</h3>
                                <div className="space-y-3 text-xs">
                                    <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                                        <span className="block text-indigo-400 font-mono font-bold">Alpha Factor: 2.5</span>
                                        <span className="text-slate-500 block mt-1">Controls the over-subtraction power against intensive backgrounds.</span>
                                    </div>
                                    <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                                        <span className="block text-emerald-400 font-mono font-bold">Beta Floor: 0.02</span>
                                        <span className="text-slate-500 block mt-1">Spectral floor fraction protecting high-frequency vocal constants.</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl max-w-2xl">
                        <h3 className="text-sm font-semibold text-slate-200 mb-4">Hardware Matrix Diagnostics</h3>
                        <div className="space-y-2 font-mono text-xs text-slate-400">
                            <p className="flex justify-between border-b border-slate-800/60 py-2"><span>Target API:</span> <span className="text-emerald-400">WebGPU / WGSL Subsystem</span></p>
                            <p className="flex justify-between border-b border-slate-800/60 py-2"><span>Compute Pipeline Status:</span> <span className="text-emerald-400">Bound & Validated</span></p>
                            <p className="flex justify-between border-b border-slate-800/60 py-2"><span>FFT Transformation Length:</span> <span className="text-indigo-400">2048 Samples</span></p>
                            <p className="flex justify-between py-2"><span>Synthesis Architecture:</span> <span className="text-indigo-400">75% Constant Overlap-Add (COLA)</span></p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
