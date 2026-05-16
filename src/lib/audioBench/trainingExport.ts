/**
 * trainingExport.ts — Agent Training Data Export
 * Converts verified benchmark results into SFT/RL-ready training format
 *
 * Format compatible with:
 * - Supervised Fine-Tuning (SFT) datasets
 * - Reinforcement Learning from Human Feedback (RLHF)
 * - Audio repair agent training
 * - OpenAI/Anthropic tool-use trajectory format
 */

import type { BenchmarkTask } from "./types";
import type { VerifierResult } from "./verifierResult";
import type { OracleResult } from "./oracleRunner";

// ── Training Example Format ───────────────────────────────────────────────────

export interface TrainingExample {
  readonly id:              string;
  readonly version:         string;
  readonly timestamp:       number;
  readonly task:            TrainingTask;
  readonly trajectory:      ToolUseStep[];
  readonly verifierResult:  TrainingVerifierResult;
  readonly outcome:         TrainingOutcome;
  readonly metadata:        TrainingMetadata;
}

export interface TrainingTask {
  readonly taskId:       string;
  readonly category:     string;
  readonly difficulty:   string;
  readonly instruction:  string;
  readonly inputFormat:  string;
  readonly outputFormat: string;
  readonly thresholds:   Record<string, number>;
}

export interface ToolUseStep {
  readonly stepIndex:  number;
  readonly tool:       string;
  readonly input:      Record<string, unknown>;
  readonly output:     Record<string, unknown>;
  readonly durationMs: number;
  readonly success:    boolean;
}

export interface TrainingVerifierResult {
  readonly passed:      boolean;
  readonly score:       number;
  readonly grade:       string;
  readonly metrics:     Record<string, number>;
  readonly failures:    string[];
  readonly warnings:    string[];
  readonly hash:        string;
}

export interface TrainingOutcome {
  readonly reward:      number;    // 0-1 for RL
  readonly success:     boolean;
  readonly scoreNorm:   number;    // 0-1 normalized score
  readonly penalty:     number;    // 0-1 penalty for failures
}

export interface TrainingMetadata {
  readonly taskVersion:   string;
  readonly verifierVer:   string;
  readonly exportedAt:    number;
  readonly oracleScore:   number | null;
  readonly tags:          string[];
}

// ── Export Functions ──────────────────────────────────────────────────────────

export function buildTrainingExample(
  task:           BenchmarkTask,
  verifierResult: VerifierResult,
  oracleResult:   OracleResult | null,
  processingLog:  string[],
  durationMs:     number,
): TrainingExample {

  // Build tool-use trajectory from processing log
  const trajectory: ToolUseStep[] = processingLog.map((entry, i) => ({
    stepIndex:  i,
    tool:       inferToolFromLog(entry),
    input:      { description: entry },
    output:     { status: "completed" },
    durationMs: Math.floor(durationMs / Math.max(1, processingLog.length)),
    success:    true,
  }));

  // Normalize metrics for training
  const metrics: Record<string, number> = {
    lufs:              verifierResult.metrics.lufs.integrated,
    truePeak:          verifierResult.metrics.lufs.truePeak,
    snrDb:             verifierResult.metrics.snrDb,
    silenceRmsDb:      verifierResult.metrics.silence.rmsDb,
    humProbability:    verifierResult.metrics.silence.humProbability,
    seamRisk:          verifierResult.metrics.seam.riskScore,
    speechPreservation: verifierResult.metrics.speech.preservationScore,
    speechRatio:       verifierResult.metrics.speech.speechRatio,
    spectralCentroid:  verifierResult.metrics.spectral.centroid,
    spectralFlatness:  verifierResult.metrics.spectral.flatness,
    durationDriftMs:   verifierResult.metrics.format.durationDriftMs,
  };

  // Compute reward signal for RL
  const scoreNorm   = verifierResult.score / 100;
  const penalty     = verifierResult.blockingFailures.length * 0.12;
  const reward      = Math.max(0, scoreNorm - penalty);

  return {
    id:        `${task.id}-${verifierResult.verifiedAt}`,
    version:   "1.0.0",
    timestamp: verifierResult.verifiedAt,
    task: {
      taskId:       task.id,
      category:     task.category,
      difficulty:   task.difficulty,
      instruction:  task.instructions,
      inputFormat:  "wav_float32_48khz_mono",
      outputFormat: "wav_float32_48khz_mono",
      thresholds: {
        minLufs:              task.thresholds.minLufs,
        maxLufs:              task.thresholds.maxLufs,
        maxTruePeak:          task.thresholds.maxTruePeak,
        minSnrDb:             task.thresholds.minSnrDb,
        maxHumProbability:    task.thresholds.maxHumProbability,
        maxSeamRisk:          task.thresholds.maxSeamRisk,
        minSpeechPreservation: task.thresholds.minSpeechPreservation,
      },
    },
    trajectory,
    verifierResult: {
      passed:   verifierResult.passed,
      score:    verifierResult.score,
      grade:    verifierResult.grade,
      metrics,
      failures: verifierResult.blockingFailures.map(f => f.code),
      warnings: verifierResult.warnings.map(w => w.code),
      hash:     verifierResult.reproducibilityHash,
    },
    outcome: {
      reward,
      success:   verifierResult.passed,
      scoreNorm,
      penalty,
    },
    metadata: {
      taskVersion:  task.version,
      verifierVer:  verifierResult.verifierVersion,
      exportedAt:   Date.now(),
      oracleScore:  oracleResult?.oracleScore ?? null,
      tags:         task.metadata.tags,
    },
  };
}

// ── Export to JSONL (SFT format) ──────────────────────────────────────────────

export function exportToJsonl(examples: TrainingExample[]): string {
  return examples.map(ex => JSON.stringify({
    messages: [
      {
        role:    "system",
        content: "You are an expert audio repair agent. Analyze the input audio and apply the required repairs according to the task specification. Your goal is to pass the verifier.",
      },
      {
        role:    "user",
        content: `Task: ${ex.task.taskId} (${ex.task.category})
Difficulty: ${ex.task.difficulty}

Instructions:
${ex.task.instruction}

Thresholds:
${JSON.stringify(ex.task.thresholds, null, 2)}`,
      },
      {
        role:    "assistant",
        content: `Repair completed.
Score: ${ex.verifierResult.score}/100 (Grade: ${ex.verifierResult.grade})
Passed: ${ex.verifierResult.passed}
Key metrics: LUFS=${ex.verifierResult.metrics.lufs?.toFixed(1)}, SNR=${ex.verifierResult.metrics.snrDb?.toFixed(1)}dB, Seam=${ex.verifierResult.metrics.seamRisk?.toFixed(3)}`,
      },
    ],
    reward:    ex.outcome.reward,
    metadata:  ex.metadata,
  })).join("\n");
}

// ── Export Manifest ───────────────────────────────────────────────────────────

export interface BenchManifest {
  readonly version:      string;
  readonly exportedAt:   number;
  readonly totalTasks:   number;
  readonly passed:       number;
  readonly failed:       number;
  readonly avgScore:     number;
  readonly tasks:        ManifestTask[];
}

export interface ManifestTask {
  readonly taskId:    string;
  readonly category:  string;
  readonly passed:    boolean;
  readonly score:     number;
  readonly grade:     string;
  readonly hash:      string;
}

export function buildManifest(examples: TrainingExample[]): BenchManifest {
  const passed   = examples.filter(e => e.verifierResult.passed).length;
  const avgScore = examples.length > 0
    ? examples.reduce((s,e) => s + e.verifierResult.score, 0) / examples.length
    : 0;

  return {
    version:    "1.0.0",
    exportedAt: Date.now(),
    totalTasks: examples.length,
    passed,
    failed:     examples.length - passed,
    avgScore:   Math.round(avgScore * 10) / 10,
    tasks:      examples.map(e => ({
      taskId:   e.task.taskId,
      category: e.task.category,
      passed:   e.verifierResult.passed,
      score:    e.verifierResult.score,
      grade:    e.verifierResult.grade,
      hash:     e.verifierResult.hash,
    })),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferToolFromLog(entry: string): string {
  if (entry.toLowerCase().includes("silence")) return "silence_detector";
  if (entry.toLowerCase().includes("hum"))     return "hum_remover";
  if (entry.toLowerCase().includes("seam"))    return "seam_detector";
  if (entry.toLowerCase().includes("speech"))  return "speech_protector";
  if (entry.toLowerCase().includes("export"))  return "wav_exporter";
  if (entry.toLowerCase().includes("oracle"))  return "oracle_runner";
  return "audio_processor";
}
