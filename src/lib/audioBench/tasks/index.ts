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

  // ── Task 4: ASR Readiness ──────────────────────────────────────────────
  {
    id:         "ABT-004",
    version:    "1.0.0",
    category:   "asr_readiness",
    difficulty: "hard",
    title:      "ASR Dataset Readiness Validation",
    instructions: `
You are given a WAV file intended for ASR (Automatic Speech Recognition) training.

Your task:
1. Verify LUFS is between -23 and -16 (EBU R128 broadcast standard)
2. Verify True Peak <= -1.0 dBTP
3. Verify SNR >= 20 dB
4. Verify silence regions are clean (RMS -65 to -50 dB)
5. Verify hum probability < 0.10
6. Verify no clipping (True Peak <= -1.0 dBTP)
7. Verify sample rate is exactly 48000 Hz
8. If any metric fails, apply minimal corrections only
9. Export as 32-bit float WAV at 48kHz mono

ASR datasets require the strictest quality standards.
Any speech modification will cause model training degradation.
    `.trim(),
    inputFiles:  ["asr_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.asr_readiness,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["asr", "speech-recognition", "dataset-qa", "broadcast"],
      description:  "Validate and prepare audio for ASR model training",
      oracleExists: true,
    },
  },

  // ── Task 5: Dead Silence Detection ──────────────────────────────────────
  {
    id:         "ABT-005",
    version:    "1.0.0",
    category:   "silence_repair",
    difficulty: "easy",
    title:      "Dead Silence Detection and Replacement",
    instructions: `
You are given a WAV file containing regions of digital mute (dead silence).
Digital silence has RMS < -90 dB and is unnatural for recording environments.

Your task:
1. Detect all digital silence regions (RMS < -90 dB)
2. Replace with synthesized room tone at -55 to -45 dB RMS
3. Match the spectral slope of adjacent non-silent regions
4. Apply 5ms crossfades at boundaries
5. Verify no digital mute remains in output
6. Export as 32-bit float WAV at 48kHz mono

Detection criteria: a region is digital mute if RMS < -90 dB for > 10ms
    `.trim(),
    inputFiles:  ["dead_silence_input.wav"],
    thresholds:  {
      ...DEFAULT_THRESHOLDS.silence_repair,
      maxSilenceRmsDb: -45,
      maxSeamRisk: 0.15,
    },
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["digital-mute", "dead-silence", "room-tone", "easy"],
      description:  "Replace unnatural digital silence with synthesized room tone",
      oracleExists: true,
    },
  },

  // ── Task 6: Hiss Reduction ──────────────────────────────────────────────
  {
    id:         "ABT-006",
    version:    "1.0.0",
    category:   "hiss_reduction",
    difficulty: "hard",
    title:      "High-Frequency Hiss Reduction in Silence",
    instructions: `
You are given a WAV file where silence regions contain high-frequency hiss
(broadband noise concentrated above 4kHz).

Your task:
1. Detect silence regions (RMS < -38 dB)
2. Estimate noise floor spectral profile from first 200ms of silence
3. Apply spectral subtraction ONLY in silence regions
4. Preserve speech regions completely — no noise reduction on speech
5. Verify hiss probability drops below 0.15 in silence
6. Verify SNR improves by at least 3dB
7. Export as 32-bit float WAV at 48kHz mono

Algorithm requirement:
- Use spectral subtraction or Wiener filtering
- Over-subtraction factor must be <= 2.0 to avoid musical noise
- Apply soft-thresholding to prevent negative spectral values
    `.trim(),
    inputFiles:  ["hiss_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.hiss_reduction,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["hiss", "spectral-subtraction", "noise-reduction", "wiener"],
      description:  "Reduce high-frequency hiss in silence using spectral subtraction",
      oracleExists: true,
    },
  },

  // ── Task 7: Clipping Detection ───────────────────────────────────────────
  {
    id:         "ABT-007",
    version:    "1.0.0",
    category:   "clipping_recovery",
    difficulty: "expert",
    title:      "Clipping Detection and Waveform Recovery",
    instructions: `
You are given a WAV file with clipped speech samples (amplitude = ±1.0).

Your task:
1. Detect clipped regions (|sample| >= 0.999 for >= 3 consecutive samples)
2. Mark clipped regions precisely
3. Reconstruct clipped waveform using cubic spline interpolation
4. Verify True Peak drops to <= -1.0 dBTP after recovery
5. Verify speech naturalness is preserved
6. Verify clipping ratio drops to < 0.001
7. Export as 32-bit float WAV at 48kHz mono

Clipping recovery algorithm:
- Fit cubic spline through last valid samples before and after clipped region
- Constrain reconstruction to physical amplitude limits
- Apply short crossfades (2ms) at recovery boundaries
- DO NOT apply hard limiting or compression to speech

This is EXPERT difficulty — wrong interpolation will create audible artifacts.
    `.trim(),
    inputFiles:  ["clipping_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.clipping_recovery,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["clipping", "waveform-recovery", "spline", "interpolation", "expert"],
      description:  "Recover clipped speech waveform using cubic spline interpolation",
      oracleExists: true,
    },
  },

  // ── Task 8: Stereo Phase Mismatch ────────────────────────────────────────
  {
    id:         "ABT-008",
    version:    "1.0.0",
    category:   "stereo_repair",
    difficulty: "medium",
    title:      "Stereo Phase Correlation Repair",
    instructions: `
You are given a stereo WAV file where the two channels have phase mismatch
(correlation < 0.3 in silence regions, indicating cabling or recording issue).

Your task:
1. Analyze stereo phase correlation in 100ms windows
2. Detect regions where correlation < 0.3
3. In affected silence regions: phase-align channels using cross-correlation
4. In speech regions: do NOT modify phase (risk of comb filtering)
5. Verify phase correlation improves to > 0.7 in silence regions
6. Verify stereo image is preserved in speech regions
7. Export as 32-bit float WAV at 48kHz STEREO (2 channels)

Phase alignment:
- Use cross-correlation to find lag between channels
- Apply sample-accurate delay compensation
- Maximum allowed correction: ±10ms (±480 samples at 48kHz)
    `.trim(),
    inputFiles:  ["stereo_phase_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.stereo_repair,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["stereo", "phase", "correlation", "cross-correlation"],
      description:  "Repair stereo phase mismatch using cross-correlation alignment",
      oracleExists: false,
    },
  },

  // ── Task 9: TTS Training Data QA ─────────────────────────────────────────
  {
    id:         "ABT-009",
    version:    "1.0.0",
    category:   "tts_qa",
    difficulty: "expert",
    title:      "TTS Training Data Quality Gate",
    instructions: `
You are given a WAV file intended for Text-to-Speech model training.
TTS training data requires the STRICTEST quality standards of all audio tasks.

Your task:
1. Verify LUFS: -23 to -16 (broadcast standard, no deviation allowed)
2. Verify True Peak: <= -1.0 dBTP (mandatory)
3. Verify SNR: >= 25 dB (high quality requirement)
4. Verify silence RMS: -65 to -55 dB (very clean silence)
5. Verify hum probability: < 0.05 (near-zero hum)
6. Verify seam risk: < 0.08 (seamless transitions)
7. Verify speech preservation: > 0.999 (no modification allowed)
8. Verify duration drift: < 2ms (sample-accurate)
9. Verify no digital mute anywhere in file
10. Export as 32-bit float WAV at 48kHz mono

CRITICAL: Any speech modification causes permanent rejection.
This file will be used to train a voice model.
A bad file corrupts the entire training batch.
    `.trim(),
    inputFiles:  ["tts_input.wav"],
    thresholds:  DEFAULT_THRESHOLDS.tts_qa,
    metadata: {
      createdAt:    "2026-01-01",
      author:       "Aivora Audio Bench",
      tags:         ["tts", "voice-model", "training-data", "expert", "broadcast"],
      description:  "Strictest quality gate for TTS training data validation",
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
