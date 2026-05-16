/**
 * oracleRunner.ts — Oracle Solution Runner
 * Proves each benchmark task is solvable before it enters the dataset
 *
 * Architecture:
 * - Oracle applies known-good repair to input
 * - Submits result to verifier
 * - If verifier fails → task is invalid
 * - Oracle result becomes ground truth for scoring
 */

import type { BenchmarkTask, TaskOutput, AudioMetadata } from "./types";
import type { VerifierResult } from "./verifierResult";
import { verifyTaskOutput } from "./verifierEngine";

export interface OracleResult {
  readonly taskId:         string;
  readonly solvable:       boolean;
  readonly verifierResult: VerifierResult;
  readonly oracleScore:    number;
  readonly manifest:       OracleManifest;
  readonly runAt:          number;
}

export interface OracleManifest {
  readonly taskId:      string;
  readonly taskVersion: string;
  readonly operations:  string[];
  readonly metrics:     Record<string, number>;
  readonly passed:      boolean;
  readonly sha256:      string;
}

// ── Oracle Repair Strategies ──────────────────────────────────────────────────

/**
 * Oracle silence repair:
 * - Detects silence via energy thresholding
 * - Synthesizes room tone via noise shaping
 * - Applies raised-cosine crossfades
 * This is the REFERENCE implementation — not the user implementation
 */
function oracleSilenceRepair(buffer: AudioBuffer): { output: AudioBuffer; log: string[] } {
  const ctx    = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const sr     = buffer.sampleRate;
  const log: string[] = [];
  const frameLen = Math.floor(0.02 * sr);

  // For each channel
  const outputData: Float32Array<ArrayBuffer>[] = [];

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input  = buffer.getChannelData(ch);
    const output: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(input.length * 4));

    // Copy input
    output.set(input);

    // Detect silence regions
    const silenceFrames: number[] = [];
    for (let start = 0; start + frameLen <= input.length; start += frameLen) {
      let ms = 0;
      for (let i = start; i < start + frameLen; i++) ms += input[i] ** 2;
      const rmsDb = 10 * Math.log10(ms / frameLen + 1e-10);
      if (rmsDb < -42) silenceFrames.push(start);
    }

    log.push(`Channel ${ch}: ${silenceFrames.length} silence frames detected`);

    // Estimate room tone RMS from silence regions
    let roomToneRms = 0.0005; // fallback ~-66dB
    if (silenceFrames.length > 0) {
      let sum = 0;
      for (const sf of silenceFrames.slice(0, 10)) {
        for (let i = sf; i < sf + frameLen && i < input.length; i++)
          sum += input[i] ** 2;
      }
      roomToneRms = Math.sqrt(sum / (Math.min(10, silenceFrames.length) * frameLen));
      roomToneRms = Math.max(roomToneRms, 0.0001); // floor at ~-80dB
    }

    // Replace silence with shaped noise at room tone level
    for (const sf of silenceFrames) {
      const end = Math.min(sf + frameLen, input.length);
      for (let i = sf; i < end; i++) {
        // White noise shaped to room tone level
        const noise = (Math.random() * 2 - 1) * roomToneRms * 0.7;
        output[i] = noise;
      }
    }

    // Apply raised-cosine crossfades at boundaries (10ms)
    const fadeLen = Math.floor(0.01 * sr);
    for (const sf of silenceFrames) {
      // Fade in
      for (let i = 0; i < fadeLen && sf + i < input.length; i++) {
        const t = i / fadeLen;
        const fade = 0.5 * (1 - Math.cos(Math.PI * t));
        output[sf + i] = output[sf + i] * fade + input[sf + i] * (1 - fade);
      }
      // Fade out
      const end = Math.min(sf + frameLen, input.length);
      for (let i = 0; i < fadeLen && end - fadeLen + i < input.length; i++) {
        const t = i / fadeLen;
        const fade = 0.5 * (1 + Math.cos(Math.PI * t));
        output[end - fadeLen + i] = output[end - fadeLen + i] * fade
          + input[end - fadeLen + i] * (1 - fade);
      }
    }

    outputData.push(output);
  }

  // Build output AudioBuffer
  const outBuf = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length:           buffer.length,
    sampleRate:       buffer.sampleRate,
  });
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    outBuf.copyToChannel(outputData[ch], ch);
  }

  log.push("Oracle silence repair complete");
  return { output: outBuf, log };
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────

async function sha256(buffer: AudioBuffer): Promise<string> {
  try {
    const data  = buffer.getChannelData(0);
    const copy  = new Float32Array(data);
    const bytes = new Uint8Array(copy.buffer);
    const hash  = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2,"0")).join("");
  } catch { return "unavailable"; }
}

// ── Run Oracle ────────────────────────────────────────────────────────────────

export async function runOracle(
  task:        BenchmarkTask,
  inputBuffer: AudioBuffer,
): Promise<OracleResult> {
  const startTime = Date.now();

  // Apply oracle repair based on task category
  let repairResult: { output: AudioBuffer; log: string[] };

  switch (task.category) {
    case "silence_repair":
    case "hum_removal":
    case "room_tone_matching":
      repairResult = oracleSilenceRepair(inputBuffer);
      break;
    default:
      repairResult = oracleSilenceRepair(inputBuffer); // fallback
  }

  const { output, log } = repairResult;
  const outputSha = await sha256(output);

  const metadata: AudioMetadata = {
    sampleRate:    output.sampleRate,
    channels:      output.numberOfChannels,
    bitDepth:      32,
    durationSec:   output.length / output.sampleRate,
    format:        "wav_float32",
    fileSizeBytes: output.length * output.numberOfChannels * 4,
    sha256:        outputSha,
  };

  const taskOutput: TaskOutput = {
    taskId:        task.id,
    outputBuffer:  output,
    metadata,
    processingLog: log,
    submittedAt:   startTime,
  };

  const verifierResult = await verifyTaskOutput(task, taskOutput);

  const manifest: OracleManifest = {
    taskId:      task.id,
    taskVersion: task.version,
    operations:  log,
    metrics: {
      score:    verifierResult.score,
      lufs:     verifierResult.metrics.lufs.integrated,
      snr:      verifierResult.metrics.snrDb,
      seamRisk: verifierResult.metrics.seam.riskScore,
    },
    passed: verifierResult.passed,
    sha256: outputSha,
  };

  return {
    taskId:         task.id,
    solvable:       verifierResult.passed,
    verifierResult,
    oracleScore:    verifierResult.score,
    manifest,
    runAt:          Date.now(),
  };
}
