// ============================================================================
// Aivora Platform - Audio QC Type System
// ============================================================================
// Canonical type definitions for the entire audio QC pipeline.
// All detectors, analyzers, and restoration engines share these types.
//
// Design principles:
// - Single source of truth for problem categorization
// - Backward compatible with existing detectors
// - Strong typing without sacrificing flexibility
// - Discriminated union pattern where appropriate
// ============================================================================

// ----------------------------------------------------------------------------
// Severity levels
// ----------------------------------------------------------------------------
// Used across all problem types. Severity drives:
//  - UI color coding
//  - Delivery risk calculation
//  - Score penalty weight
// ----------------------------------------------------------------------------

export type AudioProblemSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "warning";

// ----------------------------------------------------------------------------
// Problem taxonomy
// ----------------------------------------------------------------------------
// Each problem type maps to a specific class of audio defect.
// Grouped here for traceability.
//
// Silence-related:
//   DIGITAL_SILENCE       - Exact-zero or near-zero floor (suspicious edit)
//   BLANK_SPECTROGRAM_GAP - Empty spectrogram region (deleted audio)
//
// Edit-related:
//   HARD_CUT              - Abrupt waveform discontinuity
//
// Distortion-related:
//   CLIPPING              - Generic clipping (legacy / unspecified)
//   HARD_CLIPPING         - Flat-topped, severe distortion
//   SOFT_CLIPPING         - Rounded saturation, milder distortion
//
// Noise-related:
//   SPECTRAL_NOISE        - Broadband or banded noise contamination
//   HISS                  - High-frequency noise (tape/mic preamp)
//   HUM                   - Mains-frequency interference (50/60Hz + harmonics)
//   LOW_SNR               - Speech buried under noise floor
//
// Format/technical:
//   DC_OFFSET             - Non-zero mean offset
//   CODEC_ARTIFACT        - Suspected lossy compression artifacts
//   FORMAT_SPEC           - Spec violation (sample rate, bit depth, etc.)
// ----------------------------------------------------------------------------

export type AudioProblemType =
  | "DIGITAL_SILENCE"
  | "BLANK_SPECTROGRAM_GAP"
  | "HARD_CUT"
  | "CLIPPING"
  | "HARD_CLIPPING"
  | "TOO_QUIET"
  | "TOO_LOUD"
  | "DYNAMIC_RANGE_ISSUE"
  | "BACKGROUND_NOISE"
  | "REVERB"
  | "FREQUENCY_ISSUE"
  | "SOFT_CLIPPING"
  | "SPECTRAL_NOISE"
  | "HISS"
  | "HUM"
  | "LOW_SNR"
  | "DC_OFFSET"
  | "CODEC_ARTIFACT"
  | "FORMAT_SPEC";

// ----------------------------------------------------------------------------
// AudioProblem - canonical problem record
// ----------------------------------------------------------------------------
// All detectors return this shape. Optional location fields let each
// detector specify only what it knows (e.g., HARD_CUT knows sampleIndex,
// CLIPPING knows start+end range).
// ----------------------------------------------------------------------------

export interface AudioProblem {
  type: AudioProblemType;
  severity: AudioProblemSeverity;
  confidence: number; // 0.0 - 1.0
  suggestedAction?: string;

  // Location information (all optional - detectors fill what applies)
  startSample?: number;
  endSample?: number;
  sampleIndex?: number;

  timeMs?: number;
  durationMs?: number;

  // Measurement payloads
  delta?: number;     // Change magnitude (e.g., energy delta for HARD_CUT)
  peak?: number;     // Peak amplitude in the region
  rms?: number;     // RMS amplitude in the region
  freqHz?: number;     // Center frequency (e.g., HUM at 50Hz)
  snrDb?: number;     // Signal-to-noise ratio if applicable
  energyDb?: number;     // Band energy in dB

  // Human-readable
  message: string;
  recommendation?: string;
}

// ----------------------------------------------------------------------------
// AudioMetrics - file-level summary measurements
// ----------------------------------------------------------------------------

export interface AudioMetrics {
  peakDb?: number;
  rmsDb?: number;
  noiseDb?: number;
  snrDb?: number;

  // Extended metrics (optional, populated as detectors run)
  lufsIntegrated?: number;
  truePeakDbtp?: number;
  dcOffset?: number;
  spectralCentroidHz?: number;
  spectralFlatness?: number; // 0=tonal, 1=noise-like
  spectralCoverage?: number; // 0-1, fraction of file with active spectrum
  durationSec?: number;
  sampleRate?: number;
}

// ----------------------------------------------------------------------------
// AudioQcProfile - tunable thresholds per project
// ----------------------------------------------------------------------------
// Different clients (Appen, DataPlus, Apple Siri, etc.) have different
// requirements. This profile lets us configure detectors per project
// without changing detector code.
// ----------------------------------------------------------------------------

export interface AudioQcProfile {
  // Silence tolerances
  maxAllowedSilenceMs?: number;
  digitalSilenceFloor?: number; // linear amplitude (e.g., 0.0001)
  minSpeechRegionMs?: number;

  // SNR requirements
  minAcceptableSnrDb?: number; // typically 25-30 dB for ASR data
  excellentSnrDb?: number;     // typically 40+ dB

  // Hum detection
  expectedMainsFreqHz?: number; // 50 or 60

  // Format spec
  requiredSampleRate?: number; // typically 48000 or 16000
  requiredBitDepth?: number;     // typically 16 or 24
  requiredChannels?: number;     // typically 1 (mono)
}

// ----------------------------------------------------------------------------
// SNR Engine output
// ----------------------------------------------------------------------------

export type SnrClassification =
  | "excellent"
  | "good"
  | "acceptable"
  | "poor"
  | "unusable";

export interface SnrAnalysisResult {
  snrDb: number;
  noiseFloorDb: number;
  signalLevelDb: number;
  classification: SnrClassification;
  speechActivityRatio: number; // 0-1, fraction of file classified as speech
  problems: AudioProblem[];

  // Detailed breakdown for diagnostics
  noiseFloorEstimationMethod: string;
  speechRegionsCount: number;
  totalSpeechDurationMs: number;
  totalNoiseDurationMs: number;
}

// ----------------------------------------------------------------------------
// Spectrogram Engine output (returned alongside AudioProblem[])
// ----------------------------------------------------------------------------

export interface SpectrogramAnalysisResult {
  problems: AudioProblem[];

  // Spectral summary
  spectralCentroidHz: number;
  spectralFlatness: number;
  spectralCoverage: number; // 0-1
  bandEnergies: number[];   // average energy per band (dB)
  bandFrequencies: number[]; // center frequencies of bands (Hz)

  // Detection counts
  blankGapCount: number;
  humDetectedAtHz: number | null;
  hissDetected: boolean;
  codecArtifactSuspicion: number; // 0-1
}

// ----------------------------------------------------------------------------
// Restoration Engine - manifest & result
// ----------------------------------------------------------------------------
// IMPORTANT ETHICAL NOTE:
// Restoration here means honest reconstruction of natural room tone in
// regions where digital silence was found. It does NOT and CANNOT
// recover deleted speech content. The manifest documents exactly what
// was changed so downstream consumers know the audio was processed.
// ----------------------------------------------------------------------------

export type RestorationMethod =
  | "room_tone_synthesis_from_fingerprint"
  | "room_tone_synthesis_synthetic"
  | "equal_power_crossfade"
  | "none";

export interface RestoredRegion {
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  method: RestorationMethod;
  sourceFingerprintQuality: number; // 0-1
  matchedRmsDb: number;
  notes: string;
}

export interface RestorationManifest {
  engineVersion: string;
  processedAt: number;          // Unix epoch ms
  totalRegionsRestored: number;
  totalRestoredDurationMs: number;
  fingerprintExtracted: boolean;
  fingerprintQuality: number;     // 0-1
  fingerprintSourceMs: number;     // duration of source region
  warnings: string[];
  regions: RestoredRegion[];

  // Mandatory disclosure
  ethicalNotice: string;
}

export interface RestorationResult {
  restoredSamples: Float32Array; // NEW buffer - original untouched
  manifest: RestorationManifest;
  changed: boolean;             // false if nothing was restored
}

// ----------------------------------------------------------------------------
// Convenience factory for constructing AudioProblem entries with defaults
// ----------------------------------------------------------------------------

export function makeProblem(
  type: AudioProblemType,
  severity: AudioProblemSeverity,
  message: string,
  extras?: Partial<AudioProblem>
): AudioProblem {
  return {
    type,
    severity,
    confidence: extras?.confidence ?? 0.75,
    message,
    ...extras,
  };
}
