/**
 * adobeGate.ts — Final Adobe QA Gate
 * Prevents export unless files meet strict reviewer-safe thresholds
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import type { AdobeQAResult } from "./types";


import type { SpeechPreservationResult } from "./speechPreservation";
import type { SilenceForensicsResult } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GateStatus =
  | "PASS_VISUAL_QA"
  | "NEEDS_REVIEW"
  | "FAIL_REPAIR"
  | "RE_RECORD_REQUIRED";

export interface GateResult {
  gateStatus:      GateStatus;
  passed:          boolean;
  exportAllowed:   boolean;
  blockingReasons: string[];
  warnings:        string[];
  scores: {
    silenceRealism:    number;
    speechPreservation: number;
    seamRisk:          number;
    reviewerRisk:      number;
    overallGate:       number;
  };
}

// ── Quality Tiers ─────────────────────────────────────────────────────────────
// Tier 1: Broadcast/TTS — strictest (EBU R128 + iZotope standards)
// Tier 2: ASR/Dataset   — standard (Appen/Scale AI standards)
// Tier 3: Podcast/Gen   — relaxed (general production standards)

export type QualityTier = "broadcast" | "dataset" | "general";

export const QUALITY_TIERS: Record<QualityTier, {
  label:                 string;
  description:           string;
  color:                 string;
  silenceRealismMin:     number;
  speechPreservationMin: number;
  seamRiskMax:           number;
  reviewerRiskMax:       number;
  speechRiskMax:         number;
  timingShiftMaxMs:      number;
}> = {
  broadcast: {
    label:                 "Broadcast / TTS",
    description:           "Strictest — EBU R128 + iZotope standards. For TTS training, broadcast delivery, professional studios.",
    color:                 "#EF4444",
    silenceRealismMin:     0.90,
    speechPreservationMin: 0.97,
    seamRiskMax:           0.15,
    reviewerRiskMax:       0.20,
    speechRiskMax:         0.15,
    timingShiftMaxMs:      10,
  },
  dataset: {
    label:                 "ASR / Dataset",
    description:           "Standard — Appen/Scale AI standards. For ASR training, voice datasets, annotation projects.",
    color:                 "#F59E0B",
    silenceRealismMin:     0.75,
    speechPreservationMin: 0.93,
    seamRiskMax:           0.25,
    reviewerRiskMax:       0.35,
    speechRiskMax:         0.25,
    timingShiftMaxMs:      25,
  },
  general: {
    label:                 "Podcast / General",
    description:           "Relaxed — General production standards. For podcasts, interviews, internal use, demos.",
    color:                 "#10B981",
    silenceRealismMin:     0.55,
    speechPreservationMin: 0.85,
    seamRiskMax:           0.45,
    reviewerRiskMax:       0.55,
    speechRiskMax:         0.40,
    timingShiftMaxMs:      75,
  },
};

// Legacy default (backward compat)
const GATE = QUALITY_TIERS.broadcast;

// ── Main Gate ─────────────────────────────────────────────────────────────────

export function runAdobeGate(
  qa:       AdobeQAResult,
  speech:   SpeechPreservationResult,
  forensics: SilenceForensicsResult,
  tier:     QualityTier = "broadcast"
): GateResult {
  const GATE = QUALITY_TIERS[tier];
  const blocking: string[]=[];
  const warnings: string[]=[];

  // ── Blocking checks (FAIL or RE_RECORD) ──────────────────────────────────

  if(speech.grade==="FAIL"||speech.modifiedSpeechRisk>GATE.speechRiskMax){
    blocking.push(`Speech preservation failed (score: ${(speech.score*100).toFixed(0)}%) — speech may have been damaged`);
  }

  if(forensics.hasDigitalSilence){
    blocking.push("Digital mute (flat silence) still detected — not suitable for delivery");
  }

  if(forensics.hasRepeatedPattern){
    blocking.push("Repeated silence texture detected — visible in spectrogram as copy-paste artifact");
  }

  if(qa.silenceRealismScore<GATE.silenceRealismMin*0.67){
    blocking.push(`Silence realism critically low (${(qa.silenceRealismScore*100).toFixed(0)}%) — silence sounds artificial`);
  }

  if(qa.seamRiskScore>GATE.seamRiskMax*4){
    blocking.push(`Hard cuts or clicks detected (seam risk: ${(qa.seamRiskScore*100).toFixed(0)}%) — visible in waveform`);
  }

  if(forensics.hasHum&&forensics.contaminatedRegions.some(
    r=>r.contaminationType==="hum_50hz"||r.contaminationType==="hum_60hz"
  )){
    blocking.push(`Hum lines still present at ${forensics.humFrequencyHz}Hz — visible in spectrogram`);
  }

  if(Math.abs(speech.timingShiftMs)>GATE.timingShiftMaxMs*5){
    blocking.push(`Timing shift detected: ${speech.timingShiftMs.toFixed(1)}ms — speech timing altered`);
  }

  // ── Warning checks (NEEDS_REVIEW) ────────────────────────────────────────

  if(qa.silenceRealismScore<GATE.silenceRealismMin&&qa.silenceRealismScore>=0.75){
    warnings.push(`Silence realism below target (${(qa.silenceRealismScore*100).toFixed(0)}% < ${GATE.silenceRealismMin*100}%)`);
  }

  if(speech.score<GATE.speechPreservationMin&&speech.score>=0.93){
    warnings.push(`Speech preservation slightly below target (${(speech.score*100).toFixed(0)}%)`);
  }

  if(qa.seamRiskScore>GATE.seamRiskMax&&qa.seamRiskScore<=0.30){
    warnings.push(`Seam risk slightly elevated (${(qa.seamRiskScore*100).toFixed(0)}%)`);
  }

  if(qa.reviewerRiskScore>GATE.reviewerRiskMax&&qa.reviewerRiskScore<=0.40){
    warnings.push(`Reviewer risk above target (${(qa.reviewerRiskScore*100).toFixed(0)}%)`);
  }

  if(forensics.hasSeams){
    warnings.push("Minor waveform seams detected — may be visible under close inspection");
  }

  if(speech.transientRisk>0.05){
    warnings.push(`Transient preservation risk: ${(speech.transientRisk*100).toFixed(0)}%`);
  }

  if(speech.rmsDeltaDb>2){
    warnings.push(`Speech RMS changed by ${speech.rmsDeltaDb.toFixed(1)} dB`);
  }

  // ── Gate Decision ─────────────────────────────────────────────────────────

  let gateStatus: GateStatus;
  let exportAllowed: boolean;

  if(blocking.length>0){
    // Determine severity
    const hasReRecord=
      blocking.some(b=>b.includes("speech may have been damaged"))||
      blocking.some(b=>b.includes("Hum lines"))||
      blocking.some(b=>b.includes("timing"));

    gateStatus     = hasReRecord ? "RE_RECORD_REQUIRED" : "FAIL_REPAIR";
    exportAllowed  = false;
  } else if(
    qa.silenceRealismScore>=GATE.silenceRealismMin&&
    speech.score>=GATE.speechPreservationMin&&
    qa.seamRiskScore<=GATE.seamRiskMax&&
    qa.reviewerRiskScore<=GATE.reviewerRiskMax&&
    warnings.length===0
  ){
    gateStatus    = "PASS_VISUAL_QA";
    exportAllowed = true;
  } else {
    gateStatus    = "NEEDS_REVIEW";
    exportAllowed = true; // Allowed with warning
  }

  // Overall gate score
  const overallGate=
    qa.silenceRealismScore  * 0.30 +
    speech.score            * 0.30 +
    (1-qa.seamRiskScore)    * 0.20 +
    (1-qa.reviewerRiskScore)* 0.20;

  return {
    gateStatus,
    passed:        gateStatus==="PASS_VISUAL_QA",
    exportAllowed,
    blockingReasons: blocking,
    warnings,
    scores: {
      silenceRealism:     qa.silenceRealismScore,
      speechPreservation: speech.score,
      seamRisk:           qa.seamRiskScore,
      reviewerRisk:       qa.reviewerRiskScore,
      overallGate,
    },
  };
}

// ── Batch Gate ────────────────────────────────────────────────────────────────

export interface BatchGateSummary {
  totalFiles:   number;
  passed:       number;
  needsReview:  number;
  failRepair:   number;
  reRecord:     number;
  exportReady:  number;
  blocked:      number;
  avgGateScore: number;
}

export function summarizeBatchGate(
  gates: GateResult[]
): BatchGateSummary {
  return {
    totalFiles:   gates.length,
    passed:       (gates as GateResult[]).filter(g=>g.gateStatus==="PASS_VISUAL_QA").length,
    needsReview:  (gates as GateResult[]).filter(g=>g.gateStatus==="NEEDS_REVIEW").length,
    failRepair:   (gates as GateResult[]).filter(g=>g.gateStatus==="FAIL_REPAIR").length,
    reRecord:     (gates as GateResult[]).filter(g=>g.gateStatus==="RE_RECORD_REQUIRED").length,
    exportReady:  (gates as GateResult[]).filter(g=>g.exportAllowed).length,
    blocked:      (gates as GateResult[]).filter(g=>!g.exportAllowed).length,
    avgGateScore: gates.length>0
      ? (gates as GateResult[]).reduce((s,g)=>s+g.scores.overallGate,0)/gates.length : 0,
  };
}
