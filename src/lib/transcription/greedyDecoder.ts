/**
 * greedyDecoder.ts — Deterministic Greedy Decoder
 * Aivora Platform — Phase 8.1
 *
 * GREEDY ONLY: argmax at each step.
 * temperature = 0 (always)
 * No beam search. No sampling. No top-k. No top-p.
 * Same logits → same tokens → same transcript forever.
 */

import {
  DECODER_STRATEGY,
  TEMPERATURE,
  INFERENCE_PROTOCOL_VERSION,
} from "./asrTypes";
import type { ASRToken, ASRLanguage } from "./asrTypes";

export { DECODER_STRATEGY, TEMPERATURE };

// ── Greedy Argmax ─────────────────────────────────────────────────────────────

/**
 * Greedy argmax over logit vector.
 * Deterministic: same logits → same token id.
 * No temperature scaling. No sampling.
 */
export function greedyArgmax(logits: Float32Array): number {
  let maxIdx = 0;
  let maxVal = logits[0];
  for(let i = 1; i < logits.length; i++) {
    if(logits[i] > maxVal) {
      maxVal = logits[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

/**
 * Compute softmax for confidence score (not for sampling).
 * Used only to derive probability of selected token for confidence field.
 */
export function computeTokenConfidence(
  logits:    Float32Array,
  tokenIdx:  number,
): number {
  // Numerical stability: subtract max
  let maxVal = logits[0];
  for(let i = 1; i < logits.length; i++) {
    if(logits[i] > maxVal) maxVal = logits[i];
  }

  let sumExp = 0;
  for(let i = 0; i < logits.length; i++) {
    sumExp += Math.exp(logits[i] - maxVal);
  }

  const tokenProb = Math.exp(logits[tokenIdx] - maxVal) / sumExp;
  return Math.max(0, Math.min(1, tokenProb));
}

/**
 * Decode a sequence of logit frames to tokens.
 * Each frame: Float32Array of vocab size.
 * Returns deterministic token sequence.
 */
export function decodeGreedy(
  logitFrames: Float32Array[],
  frameShift:  number,  // audio frames per logit frame
  startFrame:  number,  // chunk start frame (for absolute timestamps)
  sampleRate:  number,
): ASRToken[] {
  const tokens: ASRToken[] = [];
  let   prevTokenId = -1;

  for(let f = 0; f < logitFrames.length; f++) {
    const logits    = logitFrames[f];
    const tokenId   = greedyArgmax(logits);

    // CTC: skip blank (id=0) and repeated tokens
    if(tokenId === 0 || tokenId === prevTokenId) {
      prevTokenId = tokenId;
      continue;
    }

    const startF = startFrame + f * frameShift;
    const endF   = startF + frameShift;

    tokens.push({
      id:          tokenId,
      text:        "", // filled by tokenizer
      start_frame: startF,
      end_frame:   endF,
      start_sec:   startF / sampleRate,
      end_sec:     endF   / sampleRate,
      confidence:  computeTokenConfidence(logits, tokenId),
      is_rtl:      false, // filled by tokenizer
    });

    prevTokenId = tokenId;
  }

  return tokens;
}

// ── Governance Record ─────────────────────────────────────────────────────────

export interface DecoderGovernance {
  strategy:            typeof DECODER_STRATEGY;
  temperature:         typeof TEMPERATURE;
  beam_size:           null;    // always null
  top_k:               null;    // always null
  top_p:               null;    // always null
  rng_seed:            null;    // always null
  protocol_version:    string;
}

export const DECODER_GOVERNANCE: DecoderGovernance = {
  strategy:          DECODER_STRATEGY,
  temperature:       TEMPERATURE,
  beam_size:         null,
  top_k:             null,
  top_p:             null,
  rng_seed:          null,
  protocol_version:  INFERENCE_PROTOCOL_VERSION,
} as const;
