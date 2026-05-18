/**
 * taskSchema.ts — Task Definition, Validation & Schema
 * Ensures every benchmark task is well-formed before execution
 */

import type { BenchmarkTask, TaskThresholds, TaskCategory, TaskDifficulty } from "./types";

// ── Default thresholds per category ───────────────────────────────────────────
// Based on: EBU R128, ITU-R BS.1770-4, Industry QA standards

export const DEFAULT_THRESHOLDS: Record<TaskCategory, TaskThresholds> = {
  silence_repair: {
    minLufs: -35, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 10,
    maxSilenceRmsDb: -42,
    maxHumProbability: 0.15,
    maxSeamRisk: 0.20,
    minSpeechPreservation: 0.99,
    maxDurationDriftMs: 50,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  hum_removal: {
    minLufs: -35, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 15,
    maxSilenceRmsDb: -45,
    maxHumProbability: 0.10,
    maxSeamRisk: 0.15,
    minSpeechPreservation: 0.98,
    maxDurationDriftMs: 10,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  hiss_reduction: {
    minLufs: -35, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 18,
    maxSilenceRmsDb: -48,
    maxHumProbability: 0.15,
    maxSeamRisk: 0.15,
    minSpeechPreservation: 0.98,
    maxDurationDriftMs: 10,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  seam_repair: {
    minLufs: -35, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 12,
    maxSilenceRmsDb: -42,
    maxHumProbability: 0.20,
    maxSeamRisk: 0.10,
    minSpeechPreservation: 0.99,
    maxDurationDriftMs: 20,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  speech_preservation: {
    minLufs: -35, maxLufs: -14,
    maxTruePeak: -1.0,
    minSnrDb: 20,
    maxSilenceRmsDb: -40,
    maxHumProbability: 0.20,
    maxSeamRisk: 0.20,
    minSpeechPreservation: 0.995,
    maxDurationDriftMs: 5,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  room_tone_matching: {
    minLufs: -35, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 10,
    maxSilenceRmsDb: -38,
    maxHumProbability: 0.25,
    maxSeamRisk: 0.15,
    minSpeechPreservation: 0.98,
    maxDurationDriftMs: 50,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  clipping_recovery: {
    minLufs: -35, maxLufs: -14,
    maxTruePeak: -1.0,
    minSnrDb: 15,
    maxSilenceRmsDb: -42,
    maxHumProbability: 0.20,
    maxSeamRisk: 0.20,
    minSpeechPreservation: 0.97,
    maxDurationDriftMs: 10,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  stereo_repair: {
    minLufs: -35, maxLufs: -14,
    maxTruePeak: -1.0,
    minSnrDb: 15,
    maxSilenceRmsDb: -42,
    maxHumProbability: 0.20,
    maxSeamRisk: 0.20,
    minSpeechPreservation: 0.98,
    maxDurationDriftMs: 10,
    requiredSampleRate: 48000,
    requiredChannels: 2,
  },
  asr_readiness: {
    minLufs: -23, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 20,
    maxSilenceRmsDb: -50,
    maxHumProbability: 0.10,
    maxSeamRisk: 0.10,
    minSpeechPreservation: 0.995,
    maxDurationDriftMs: 5,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  tts_qa: {
    minLufs: -23, maxLufs: -16,
    maxTruePeak: -1.0,
    minSnrDb: 25,
    maxSilenceRmsDb: -55,
    maxHumProbability: 0.05,
    maxSeamRisk: 0.08,
    minSpeechPreservation: 0.999,
    maxDurationDriftMs: 2,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  wake_word_qa: {
    minLufs: -23, maxLufs: -14,
    maxTruePeak: -1.0,
    minSnrDb: 20,
    maxSilenceRmsDb: -50,
    maxHumProbability: 0.10,
    maxSeamRisk: 0.10,
    minSpeechPreservation: 0.999,
    maxDurationDriftMs: 2,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
  conversation_qa: {
    minLufs: -30, maxLufs: -12,
    maxTruePeak: -1.0,
    minSnrDb: 15,
    maxSilenceRmsDb: -45,
    maxHumProbability: 0.15,
    maxSeamRisk: 0.15,
    minSpeechPreservation: 0.98,
    maxDurationDriftMs: 20,
    requiredSampleRate: 48000,
    requiredChannels: 1,
  },
};

// ── Task Validation ────────────────────────────────────────────────────────────

export interface TaskValidationResult {
  readonly valid:  boolean;
  readonly errors: string[];
}

export function validateTask(task: BenchmarkTask): TaskValidationResult {
  const errors: string[] = [];

  if (!task.id?.trim())           errors.push("Task id is required");
  if (!task.version?.trim())      errors.push("Task version is required");
  if (!task.title?.trim())        errors.push("Task title is required");
  if (!task.instructions?.trim()) errors.push("Task instructions are required");
  if (!task.category)             errors.push("Task category is required");
  if (!task.difficulty)           errors.push("Task difficulty is required");
  if (!task.inputFiles?.length)   errors.push("Task must have at least one input file");

  const t = task.thresholds;
  if (t.minLufs >= t.maxLufs)
    errors.push(`Invalid LUFS range: ${t.minLufs} >= ${t.maxLufs}`);
  if (t.maxTruePeak > 0)
    errors.push(`True peak threshold must be <= 0 dBTP, got ${t.maxTruePeak}`);
  if (t.minSnrDb < 0)
    errors.push(`SNR threshold must be >= 0, got ${t.minSnrDb}`);
  if (t.minSpeechPreservation < 0 || t.minSpeechPreservation > 1)
    errors.push(`Speech preservation must be 0-1, got ${t.minSpeechPreservation}`);
  if (t.maxHumProbability < 0 || t.maxHumProbability > 1)
    errors.push(`Hum probability must be 0-1, got ${t.maxHumProbability}`);
  if (t.requiredSampleRate <= 0)
    errors.push(`Required sample rate must be > 0`);

  return { valid: errors.length === 0, errors };
}

export function getDifficultyWeight(difficulty: TaskDifficulty): number {
  return { easy: 1.0, medium: 1.5, hard: 2.0, expert: 3.0 }[difficulty];
}
