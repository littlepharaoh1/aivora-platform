/**
 * types.ts — Audio Forensics Type Definitions
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

// ── Contamination Types ───────────────────────────────────────────────────────

export type ContaminationType =
  | "hum_50hz"
  | "hum_60hz"
  | "hiss"
  | "fan_noise"
  | "ac_noise"
  | "breath_residual"
  | "mouth_click"
  | "digital_silence"
  | "repeated_silence"
  | "waveform_seam"
  | "phase_jump"
  | "spectral_discontinuity"
  | "room_tone_leak"
  | "click"
  | "pop"
  | "unknown";

export type SuggestedAction =
  | "replace_with_reference"
  | "spectral_repair"
  | "crossfade_repair"
  | "phase_align"
  | "hum_notch"
  | "denoise"
  | "re_record"
  | "manual_review";

export type QARecommendation =
  | "PASS_VISUAL_QA"
  | "NEEDS_REVIEW"
  | "REPAIR_AGAIN"
  | "RE_RECORD_REQUIRED";

// ── Silence Region ────────────────────────────────────────────────────────────

export interface SilenceRegion {
  startMs:           number;
  endMs:             number;
  durationMs:        number;
  startSample:       number;
  endSample:         number;
  contaminationType: ContaminationType;
  noiseFloorDb:      number;
  humHz:             number | null;
  seamRisk:          number;      // 0.0 – 1.0
  spectralMatchRisk: number;      // 0.0 – 1.0 (repeated pattern risk)
  purityScore:       number;      // 0.0 – 1.0 (1 = perfectly clean)
  confidence:        number;      // 0.0 – 1.0
  suggestedAction:   SuggestedAction;
  rmsDb:             number;
  peakDb:            number;
  spectralSlope:     number;      // Spectral tilt (negative = natural)
}

// ── Silence Forensics Result ──────────────────────────────────────────────────

export interface SilenceForensicsResult {
  totalRegions:         number;
  contaminatedRegions:  SilenceRegion[];
  cleanRegions:         SilenceRegion[];
  overallPurityScore:   number;     // 0.0 – 1.0
  dominantContamination: ContaminationType | null;
  noiseFloorDb:         number;
  hasDigitalSilence:    boolean;
  hasRepeatedPattern:   boolean;
  hasSeams:             boolean;
  hasHum:               boolean;
  humFrequencyHz:       number | null;
  processingMs:         number;
  sampleRate:           number;
  duration:             number;
}

// ── Reference Silence Profile ─────────────────────────────────────────────────

export interface SilenceGrain {
  samples:       Float32Array;
  durationMs:    number;
  rmsDb:         number;
  spectralSlope: number;
}

export interface ReferenceSilenceProfile {
  id:              string;
  fileName:        string;
  sampleRate:      number;
  channels:        number;
  rmsDb:           number;
  rmsDistribution: Float32Array;   // Per-frame RMS
  spectralFingerprint: Float32Array; // Avg magnitude spectrum
  spectralSlope:   number;
  noiseFloorDb:    number;
  purityScore:     number;
  grainLibrary:    SilenceGrain[];  // Randomizable silence segments
  createdAt:       string;
}

// ── Reconstruction Result ─────────────────────────────────────────────────────

export interface ReconstructedRegion {
  startMs:          number;
  endMs:            number;
  durationMs:       number;
  contaminationType: ContaminationType;
  noiseFloorBefore: number;
  noiseFloorAfter:  number;
  purityBefore:     number;
  purityAfter:      number;
  method:           string;
  seamHidden:       boolean;
}

export interface ReconstructionResult {
  buffer:             AudioBuffer;
  repairedRegions:    ReconstructedRegion[];
  totalRepairedMs:    number;
  speechPreserved:    boolean;
  processingMs:       number;
  warnings:           string[];
}

// ── Adobe QA Result ───────────────────────────────────────────────────────────

export interface AdobeQAResult {
  adobePassLikely:          boolean;
  reviewerRiskScore:        number;   // 0.0 – 1.0 (1 = high risk of rejection)
  silenceRealismScore:      number;   // 0.0 – 1.0
  seamRiskScore:            number;   // 0.0 – 1.0
  spectralMatchScore:       number;   // 0.0 – 1.0
  speechPreservationScore:  number;   // 0.0 – 1.0
  transientPreservationScore: number; // 0.0 – 1.0
  detectedProblems:         string[];
  recommendation:           QARecommendation;
  confidence:               number;
}

// ── Batch Rework ──────────────────────────────────────────────────────────────

export interface BatchReworkEntry {
  originalFileName:  string;
  repairedFileName:  string;
  repairedRegions:   ReconstructedRegion[];
  noiseFloorBefore:  number;
  noiseFloorAfter:   number;
  adobePassProbability: number;
  reviewerRiskScore: number;
  qaRecommendation:  QARecommendation;
  warnings:          string[];
  processingMs:      number;
}

export interface BatchReworkReport {
  totalFiles:         number;
  repairedFiles:      number;
  passCount:          number;
  reviewCount:        number;
  reRecordCount:      number;
  avgAdobePassProb:   number;
  entries:            BatchReworkEntry[];
  referenceProfileId: string;
  createdAt:          string;
}

// ── Cursor Inspector ──────────────────────────────────────────────────────────

export interface CursorInspection {
  timeSec:         number;
  sampleIndex:     number;
  frequencyHz:     number;
  amplitudeDb:     number;
  rmsDb:           number;
  peakDb:          number;
  lufs:            number;
  spectralDensity: number;
  noiseFloorDb:    number;
  humFrequencyHz:  number | null;
  silencePurityScore: number;
}
