/**
 * tasks/index.ts — Aivora Audio Bench Task Registry
 * Production benchmark tasks with verifier thresholds
 */

import type { BenchmarkTask } from "../types";
import { DEFAULT_THRESHOLDS } from "../taskSchema";

export const BENCH_TASKS: BenchmarkTask[] = [

  // ── Task 1: Noisy Silence Repair ─────────────────────────────────────────
  {
    id:         "ABT-001",
    version:    "1.0.0",
    category:   "silence_repair",
    difficulty: "medium",
    title:      "Noisy Silence Repair",
    instructions: `
You are given a WAV file containing speech with silence regions contaminated
by background noise (hiss, hum, or room tone artifacts).

Your task:
1. Detect all silence regions (RMS < -42 dB)
2. Reconstruct silence using natural room tone synthesis
3. Ensure no digital mute (silence RMS must be between -65 and -42 dB)
4. Preserve all speech segments exactly (no modification allowed)
5. Avoid visible seams at silence/speech boundaries
6. Export as 32-bit float WAV at 48kHz mono

Acceptance criteria:
- Silence RMS: -65 to -42 dB
- Hum probability: < 0.15
- Speech preservation: > 0.99
- Seam risk: < 0.20
- No digital mute detected
- Duration drift: < 50ms
    `.trim(),
    inputFiles:  ["noisy_silence_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.silence_repair,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["silence", "noise", "repair", "room-tone"],
      description:  "Replace contaminated silence with natural room tone synthesis",
      oracleExists: true,
    },
  },

  // ── Task 2: Hum Removal ──────────────────────────────────────────────────
  {
    id:         "ABT-002",
    version:    "1.0.0",
    category:   "hum_removal",
    difficulty: "hard",
    title:      "50Hz Hum Removal from Silence Regions",
    instructions: `
You are given a WAV file where silence regions contain 50Hz electrical hum
and its harmonics (100Hz, 150Hz, 200Hz).

Your task:
1. Detect silence regions (RMS < -38 dB)
2. Apply notch filtering at 50Hz, 100Hz, 150Hz, 200Hz in silence regions only
3. Do NOT apply notch filtering to speech regions
4. Verify hum probability drops below 0.10 in silence regions
5. Preserve spectral envelope of speech
6. Export as 32-bit float WAV at 48kHz mono

Constraints:
- Notch bandwidth must be <= 4Hz per notch
- Speech regions must not be altered
- No amplitude normalization of speech allowed

Acceptance criteria:
- Hum probability in silence: < 0.10
- Speech preservation: > 0.98
- SNR improvement: measurable
- No new artifacts introduced
- Duration drift: < 10ms
    `.trim(),
    inputFiles:  ["hum_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.hum_removal,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["hum", "50hz", "notch", "electrical-noise"],
      description:  "Remove 50Hz electrical hum and harmonics from silence regions only",
      oracleExists: true,
    },
  },

  // ── Task 3: Speech Preservation Validation ───────────────────────────────
  {
    id:         "ABT-003",
    version:    "1.0.0",
    category:   "speech_preservation",
    difficulty: "expert",
    title:      "Speech Preservation Under Aggressive Silence Repair",
    instructions: `
You are given a WAV file with very short silence gaps (50-200ms) between
speech segments. These silences contain noise contamination.

Your task:
1. Identify silence regions with RMS < -35 dB AND duration < 300ms
2. Reconstruct these silences WITHOUT touching adjacent speech
3. Apply adaptive crossfades (5-15ms) at silence/speech boundaries
4. Verify no speech samples were modified beyond -80 dB difference
5. Verify no clicks or discontinuities were introduced
6. Export as 32-bit float WAV at 48kHz mono

This is an EXPERT task. Short silence gaps make boundary detection critical.
A wrong boundary detection will damage speech and fail the verifier.

Acceptance criteria:
- Speech preservation: > 0.995 (strictest threshold)
- Seam risk: < 0.10
- No clipping introduced
- Silence RMS: -65 to -38 dB
- Duration drift: < 5ms
- No digital mute detected
    `.trim(),
    inputFiles:  ["speech_preservation_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.speech_preservation,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["speech", "preservation", "short-silence", "crossfade", "expert"],
      description:  "Repair short silence gaps without any speech modification",
      oracleExists: true,
    },
  },
];

export function getTask(id: string): BenchmarkTask | undefined {
  return BENCH_TASKS.find(t => t.id === id);
}

export function getTasksByCategory(category: string): BenchmarkTask[] {
  return BENCH_TASKS.filter(t => t.category === category);
}

export function getTasksByDifficulty(difficulty: string): BenchmarkTask[] {
  return BENCH_TASKS.filter(t => t.difficulty === difficulty);
}
