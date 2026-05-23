/**
 * quantizationPolicy.ts — Quantization + Tier Policies
 * Aivora Platform — Phase 6B.6
 *
 * Deterministic quantization selection per execution tier.
 * "none" quantization (WASM models) always compatible.
 */

import type { ModelQuantization } from "../models/modelRegistry";
import type { RuntimeExecutionMode } from "../../runtime/runtimeTypes";

export const TIER_QUANTIZATION: Record<RuntimeExecutionMode, ModelQuantization[]> = {
  DESKTOP_ULTRA:    ["fp32", "fp16", "int8", "int4"],
  DESKTOP_BALANCED: ["fp32", "fp16", "int8", "int4"],
  MOBILE_SAFE:      ["int8", "int4", "fp16", "fp32"],
  LOW_MEMORY:       ["int4", "int8", "fp16", "fp32"],
};

export function selectQuantization(
  available: ModelQuantization[],
  tier:      RuntimeExecutionMode,
): ModelQuantization {
  const preference = TIER_QUANTIZATION[tier];
  for(const q of preference) {
    if(available.includes(q)) return q;
  }
  return available[0] ?? "fp32";
}

export function isQuantizationCompatible(
  quantization: ModelQuantization,
  tier:         RuntimeExecutionMode,
): boolean {
  if(quantization === "none") return true;  // WASM models always OK
  if(tier === "LOW_MEMORY"  && quantization === "fp32") return false;
  if(tier === "MOBILE_SAFE" && quantization === "fp32") return false;
  return true;
}

export const QUANTIZATION_MEMORY_MULTIPLIER: Record<ModelQuantization, number> = {
  fp32: 1.000,
  fp16: 0.500,
  int8: 0.250,
  int4: 0.125,
  none: 1.000,
} as const;
