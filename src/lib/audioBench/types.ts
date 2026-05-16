/**
 * types.ts — Aivora Audio Bench Core Types
 * Production-grade type system for verifier-backed audio QA benchmark
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export type TaskCategory =
  | "silence_repair"
  | "hum_removal"
  | "hiss_reduction"
  | "seam_repair"
  | "speech_preservation"
  | "room_tone_matching"
  | "clipping_recovery"
  | "stereo_repair"
  | "asr_readiness"
  | "tts_qa"
  | "wake_word_qa"
  | "conversation_qa";

export type TaskDifficulty = "easy" | "medium" | "hard" | "expert";

export type MetricGrade = "pass" | "review" | "fail";

export type VerifierDecision = "pass" | "fail" | "inconclusive";

export type AudioFormat = "wav_pcm16" | "wav_pcm24" | "wav_float32" | "mp3" | "aac" | "unknown";

// ── Audio Metadata ─────────────────────────────────────────────────────────────

export interface AudioMetadata {
  readonly sampleRate:    number;       // Hz — expected 48000
  readonly channels:      number;       // 1=mono, 2=stereo
  readonly bitDepth:      number;       // 16, 24, or 32
  readonly durationSec:   number;       // seconds
  readonly format:        AudioFormat;
  readonly fileSizeBytes: number;
  readonly sha256:        string;       // reproducibility hash
}

// ── Metric Result ─────────────────────────────────────────────────────────────

export interface MetricResult {
  readonly name:       string;
  readonly value:      number;
  readonly unit:       string;
  readonly threshold:  number;
  readonly grade:      MetricGrade;
  readonly confidence: number;    // 0-1
  readonly notes:      string;
}

// ── Task Input/Output ─────────────────────────────────────────────────────────

export interface TaskInput {
  readonly taskId:        string;
  readonly inputBuffer:   AudioBuffer;
  readonly referenceBuffer?: AudioBuffer;  // optional clean reference
  readonly metadata:      AudioMetadata;
}

export interface TaskOutput {
  readonly taskId:        string;
  readonly outputBuffer:  AudioBuffer;
  readonly metadata:      AudioMetadata;
  readonly processingLog: string[];
  readonly submittedAt:   number;         // timestamp ms
}

// ── Benchmark Task ─────────────────────────────────────────────────────────────

export interface BenchmarkTask {
  readonly id:           string;
  readonly version:      string;
  readonly category:     TaskCategory;
  readonly difficulty:   TaskDifficulty;
  readonly title:        string;
  readonly instructions: string;
  readonly inputFiles:   string[];
  readonly thresholds:   TaskThresholds;
  readonly metadata:     TaskMetadata;
}

export interface TaskThresholds {
  readonly minLufs:           number;   // e.g. -23
  readonly maxLufs:           number;   // e.g. -16
  readonly maxTruePeak:       number;   // e.g. -1.0 dBTP
  readonly minSnrDb:          number;   // e.g. 15
  readonly maxSilenceRmsDb:   number;   // e.g. -50
  readonly maxHumProbability: number;   // 0-1, e.g. 0.1
  readonly maxSeamRisk:       number;   // 0-1, e.g. 0.15
  readonly minSpeechPreservation: number; // 0-1, e.g. 0.98
  readonly maxDurationDriftMs: number;  // e.g. 50ms
  readonly requiredSampleRate: number;  // e.g. 48000
  readonly requiredChannels:   number;  // e.g. 1
}

export interface TaskMetadata {
  readonly createdAt:    string;
  readonly author:       string;
  readonly tags:         string[];
  readonly description:  string;
  readonly oracleExists: boolean;
}
