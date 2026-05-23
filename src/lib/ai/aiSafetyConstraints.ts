/**
 * aiSafetyConstraints.ts — AI Execution Safety Constraints
 * Aivora Platform — Phase 6B.7
 *
 * Hard limits. All deterministic. No adaptive thresholds.
 * AI outputs ADVISORY ONLY — no auto-mutations (Prompt 6B Rule 7).
 * Cloud execution ALWAYS blocked in Prompt 6B scope (Rule 9).
 */

import { CLOUD_GOVERNANCE } from "../cloud/CLOUD_GOVERNANCE";

export const AI_SAFETY_LIMITS = {
  MAX_INPUT_DURATION_SEC:  300,
  MAX_INPUT_SAMPLES:       48000 * 300,
  MAX_MODEL_SIZE_MB:       50,
  MAX_CONCURRENT_MODELS:   2,
  MAX_INFERENCE_TIMEOUT_MS:30_000,
  MAX_STREAMING_FRAMES:    10_000,
  ADVISORY_ONLY:           true,
} as const;

export interface AISafetyResult {
  allowed:  boolean;
  reason:   string | null;
}

const OK: AISafetyResult = { allowed: true, reason: null };
const reject = (reason: string): AISafetyResult => ({ allowed: false, reason });

export function checkInputSize(samples: number, sampleRate: number): AISafetyResult {
  if(samples <= 0) return reject("empty_input");
  if(samples > AI_SAFETY_LIMITS.MAX_INPUT_SAMPLES)
    return reject(`input_too_long: ${(samples/sampleRate).toFixed(0)}s > ${AI_SAFETY_LIMITS.MAX_INPUT_DURATION_SEC}s`);
  return OK;
}

export function checkModelSize(weightsMB: number): AISafetyResult {
  if(weightsMB > AI_SAFETY_LIMITS.MAX_MODEL_SIZE_MB)
    return reject(`model_too_large: ${weightsMB}MB > ${AI_SAFETY_LIMITS.MAX_MODEL_SIZE_MB}MB`);
  return OK;
}

// Prompt 6B Rule 9: cloud ALWAYS blocked in 6B scope
export function checkCloudExecution(operation: string): AISafetyResult {
  if(CLOUD_GOVERNANCE.ENABLE_CLOUD_EXECUTION) {
    // Even if flag enabled, 6B scope forbids it
    console.warn("[AISafety] Cloud execution flag enabled but blocked by 6B governance");
  }
  return reject(`cloud_blocked_in_6B: ${operation}`);
}

export function checkStreamingBounds(frameCount: number): AISafetyResult {
  if(frameCount > AI_SAFETY_LIMITS.MAX_STREAMING_FRAMES)
    return reject(`stream_too_long: ${frameCount} > ${AI_SAFETY_LIMITS.MAX_STREAMING_FRAMES}`);
  return OK;
}

// Prompt 6B Rule 7: AI outputs are advisory only — never auto-apply
export function assertAdvisoryOnly(operation: string): void {
  // Always passes — documents the boundary
  if(!AI_SAFETY_LIMITS.ADVISORY_ONLY) {
    throw new Error(`[AISafety] "${operation}": ADVISORY_ONLY must be true`);
  }
}

export function getAISafetySummary() {
  return {
    input_duration_limit_sec: AI_SAFETY_LIMITS.MAX_INPUT_DURATION_SEC,
    model_size_limit_mb:      AI_SAFETY_LIMITS.MAX_MODEL_SIZE_MB,
    concurrent_models_limit:  AI_SAFETY_LIMITS.MAX_CONCURRENT_MODELS,
    inference_timeout_ms:     AI_SAFETY_LIMITS.MAX_INFERENCE_TIMEOUT_MS,
    advisory_only:            AI_SAFETY_LIMITS.ADVISORY_ONLY,
    cloud_disabled:           true, // always in 6B
  };
}
