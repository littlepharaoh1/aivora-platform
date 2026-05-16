/**
 * metricTypes.ts — Objective Audio Metrics Type System
 * All metrics are deterministic, sanitized, and benchmarkable
 *
 * Algorithm notes:
 * - LUFS: ITU-R BS.1770-4 with K-weighting + gating
 * - SNR: VAD-separated spectral estimate
 * - True Peak: 4x oversampled interpolation per ITU-R BS.1770-4
 * - Hum: FFT-based harmonic series detection (50/60Hz + harmonics)
 * - Seam: Phase discontinuity + spectral flux delta
 */

export interface LufsMetrics {
  readonly integrated:    number;   // LUFS integrated (ITU-R BS.1770-4)
  readonly shortTerm:     number;   // LUFS short-term (3s window)
  readonly momentary:     number;   // LUFS momentary (400ms window)
  readonly range:         number;   // LU loudness range
  readonly truePeak:      number;   // dBTP true peak
}

export interface SpectralMetrics {
  readonly centroid:      number;   // Hz — weighted mean frequency
  readonly flatness:      number;   // 0-1 (0=tonal, 1=noise)
  readonly rolloff:       number;   // Hz — 85% energy rolloff
  readonly flux:          number;   // frame-to-frame spectral change
  readonly entropy:       number;   // 0-1 spectral entropy
}

export interface SilenceMetrics {
  readonly rmsDb:         number;   // dB RMS of silence regions
  readonly noiseFloorDb:  number;   // estimated noise floor dB
  readonly humProbability: number;  // 0-1 (50/60Hz harmonic presence)
  readonly hissProbability: number; // 0-1 (high-freq energy ratio)
  readonly isDigitalMute: boolean;  // true if RMS < -90dB
  readonly purityScore:   number;   // 0-1 overall silence quality
  readonly contaminationPct: number; // 0-100
}

export interface SpeechMetrics {
  readonly speechRatio:      number;  // 0-1 fraction of file with speech
  readonly vadConfidence:    number;  // 0-1 VAD reliability
  readonly preservationScore: number; // 0-1 vs reference (if available)
  readonly clippingRatio:    number;  // 0-1 fraction of clipped samples
}

export interface SeamMetrics {
  readonly riskScore:        number;  // 0-1 overall seam risk
  readonly discontinuities:  SeamLocation[];
  readonly maxPhaseJump:     number;  // radians
  readonly maxRmsDelta:      number;  // dB between adjacent frames
}

export interface SeamLocation {
  readonly timeSec:     number;
  readonly riskScore:   number;   // 0-1
  readonly type:        "phase" | "amplitude" | "spectral";
  readonly severity:    "low" | "medium" | "high" | "critical";
}

export interface FormatMetrics {
  readonly sampleRate:     number;
  readonly channels:       number;
  readonly bitDepth:       number;
  readonly durationSec:    number;
  readonly durationDriftMs: number;  // vs expected
  readonly formatValid:    boolean;
  readonly sha256:         string;
}

export interface FullAudioMetrics {
  readonly lufs:     LufsMetrics;
  readonly spectral: SpectralMetrics;
  readonly silence:  SilenceMetrics;
  readonly speech:   SpeechMetrics;
  readonly seam:     SeamMetrics;
  readonly format:   FormatMetrics;
  readonly snrDb:    number;
  readonly computedAt: number;  // timestamp ms
}
