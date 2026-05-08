// ════════════════════════════════════════════════════════════════════
// AIVORA STUDIO SPEC COMPLIANCE ENGINE
// Production-grade QA validator for professional audio data factories
// Compatible with: Apple Siri, Appen, Magic Data, DataPlus standards
// ════════════════════════════════════════════════════════════════════

import type { FullAudioAnalysis } from "./AdvancedAudioAnalyzer";

// ─── TYPES ───────────────────────────────────────────────────────

export type Severity = "critical" | "major" | "minor" | "info";
export type Verdict = "READY" | "REVIEW" | "REJECT";

export interface ComplianceIssue {
  id: string;
  severity: Severity;
  category: "specs" | "noise" | "level" | "environment" | "integrity" | "voice";
  title: string;
  detail: string;
  measured: string;
  required: string;
  fix?: string;
}

export interface StudioSpec {
  name: string;
  description: string;
  
  // File specs (hard requirements)
  sampleRate: number;
  bitDepth: number;
  channels: number;
  
  // Level requirements
  peakDbFsMin: number;
  peakDbFsMax: number;
  truePeakDbTpMax: number;
  rmsDbFsMin: number;
  rmsDbFsMax: number;
  lufsMin: number;
  lufsMax: number;
  
  // Noise & SNR (studio-grade)
  noiseFloorDbFsMax: number;
  snrDbMin: number;
  
  // Acoustic requirements
  rt60SecondsMax: number;
  allowedEnvironments: Array<"studio" | "room" | "bathroom" | "outdoor" | "car" | "phone">;
  
  // Voice activity
  voiceRatioMin: number;
  voiceRatioMax: number;
  silenceRatioMax: number;
  leadingSilenceMsMax: number;
  trailingSilenceMsMax: number;
  
  // Hard tolerances (ANY violation = REJECT)
  zeroHumTolerance: boolean;
  zeroClippingTolerance: boolean;
  rejectIfPhoneArtifact: boolean;
  
  // Scoring boundaries
  readyScoreMin: number;    // >= this = READY
  reviewScoreMin: number;   // >= this = REVIEW (else REJECT)
}

export interface ComplianceReport {
  verdict: Verdict;
  score: number;              // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  
  // Hard rejection reasons (override score)
  hardRejects: ComplianceIssue[];
  
  // All issues found (warnings + failures)
  issues: ComplianceIssue[];
  
  // What passed
  passed: string[];
  
  // Actionable recommendations
  recommendations: string[];
  
  // Summary
  summary: string;
  
  // Profile used
  profile: string;
  profileName: string;
  
  // Timestamps
  analyzedAt: string;
}

// ─── STUDIO PROFILES ─────────────────────────────────────────────
// Calibrated to real industry standards for AI training data

export const STUDIO_PROFILES: Record<string, StudioSpec> = {
  
  // ══ WAKE WORD (Apple Siri / Alexa / Google Assistant style) ══
  wakeword_studio: {
    name: "wakeword_studio",
    description: "Wake word recordings — professional studio environment",
    
    sampleRate: 48000,
    bitDepth: 32,
    channels: 1,
    
    peakDbFsMin: -6,
    peakDbFsMax: -1,
    truePeakDbTpMax: -1.0,
    rmsDbFsMin: -28,
    rmsDbFsMax: -10,
    lufsMin: -23,
    lufsMax: -16,
    
    noiseFloorDbFsMax: -75,    // STRICT: studio-grade
    snrDbMin: 60,              // STRICT: broadcast quality
    
    rt60SecondsMax: 0.3,
    allowedEnvironments: ["studio", "room"],
    
    voiceRatioMin: 0.05,       // wake word is short
    voiceRatioMax: 0.50,       // not the entire file
    silenceRatioMax: 0.85,     // mostly silence is OK for wake words
    leadingSilenceMsMax: 2000,
    trailingSilenceMsMax: 2000,
    
    zeroHumTolerance: true,
    zeroClippingTolerance: true,
    rejectIfPhoneArtifact: true,
    
    readyScoreMin: 85,
    reviewScoreMin: 70,
  },
  
  // ══ ASR / SPEECH RECOGNITION (long-form speech) ══
  asr_studio: {
    name: "asr_studio",
    description: "ASR training data — clean speech, minimal noise",
    
    sampleRate: 48000,
    bitDepth: 32,
    channels: 1,
    
    peakDbFsMin: -9,
    peakDbFsMax: -2,
    truePeakDbTpMax: -1.0,
    rmsDbFsMin: -32,
    rmsDbFsMax: -12,
    lufsMin: -26,
    lufsMax: -16,
    
    noiseFloorDbFsMax: -70,
    snrDbMin: 50,
    
    rt60SecondsMax: 0.4,
    allowedEnvironments: ["studio", "room"],
    
    voiceRatioMin: 0.40,       // mostly speech
    voiceRatioMax: 0.95,
    silenceRatioMax: 0.50,
    leadingSilenceMsMax: 1500,
    trailingSilenceMsMax: 1500,
    
    zeroHumTolerance: true,
    zeroClippingTolerance: true,
    rejectIfPhoneArtifact: true,
    
    readyScoreMin: 85,
    reviewScoreMin: 70,
  },
  
  // ══ TTS TRAINING (highest quality - broadcast grade) ══
  tts_studio: {
    name: "tts_studio",
    description: "TTS training — broadcast-grade studio recording",
    
    sampleRate: 48000,
    bitDepth: 32,
    channels: 1,
    
    peakDbFsMin: -6,
    peakDbFsMax: -1,
    truePeakDbTpMax: -1.0,
    rmsDbFsMin: -24,
    rmsDbFsMax: -10,
    lufsMin: -20,
    lufsMax: -14,
    
    noiseFloorDbFsMax: -80,    // STRICTEST - TTS needs pristine data
    snrDbMin: 65,
    
    rt60SecondsMax: 0.25,      // very dry
    allowedEnvironments: ["studio"],  // studio ONLY
    
    voiceRatioMin: 0.50,
    voiceRatioMax: 0.95,
    silenceRatioMax: 0.40,
    leadingSilenceMsMax: 1000,
    trailingSilenceMsMax: 1000,
    
    zeroHumTolerance: true,
    zeroClippingTolerance: true,
    rejectIfPhoneArtifact: true,
    
    readyScoreMin: 90,
    reviewScoreMin: 75,
  },
  
  // ══ CONVERSATION / DIALOGUE (more relaxed) ══
  conversation_studio: {
    name: "conversation_studio",
    description: "Conversational AI training — natural dialogue, controlled environment",
    
    sampleRate: 48000,
    bitDepth: 32,
    channels: 1,
    
    peakDbFsMin: -12,
    peakDbFsMax: -3,
    truePeakDbTpMax: -1.5,
    rmsDbFsMin: -35,
    rmsDbFsMax: -15,
    lufsMin: -28,
    lufsMax: -18,
    
    noiseFloorDbFsMax: -65,
    snrDbMin: 40,
    
    rt60SecondsMax: 0.5,
    allowedEnvironments: ["studio", "room"],
    
    voiceRatioMin: 0.30,
    voiceRatioMax: 0.95,
    silenceRatioMax: 0.60,
    leadingSilenceMsMax: 2000,
    trailingSilenceMsMax: 2000,
    
    zeroHumTolerance: false,   // some hum may be unavoidable in dialogue
    zeroClippingTolerance: false,
    rejectIfPhoneArtifact: true,
    
    readyScoreMin: 80,
    reviewScoreMin: 65,
  },
};

// Default fallback
export const DEFAULT_PROFILE = "asr_studio";

// ─── HELPERS ─────────────────────────────────────────────────────

function fmt(n: number, digits: number = 1): string {
  return n.toFixed(digits);
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

// ─── MAIN VALIDATOR ──────────────────────────────────────────────

export function validateStudioCompliance(
  analysis: FullAudioAnalysis,
  profileKey: string = DEFAULT_PROFILE
): ComplianceReport {
  
  const spec = STUDIO_PROFILES[profileKey] || STUDIO_PROFILES[DEFAULT_PROFILE];
  const issues: ComplianceIssue[] = [];
  const hardRejects: ComplianceIssue[] = [];
  const passed: string[] = [];
  const recommendations: string[] = [];
  
  // ═══ FILE SPECS (hard requirements) ═══
  
  if (analysis.sampleRate !== spec.sampleRate) {
    hardRejects.push({
      id: "spec_samplerate",
      severity: "critical",
      category: "specs",
      title: "Sample Rate Mismatch",
      detail: "Recording does not match required sample rate",
      measured: `${analysis.sampleRate} Hz`,
      required: `${spec.sampleRate} Hz exactly`,
      fix: `Resample to ${spec.sampleRate} Hz using high-quality SRC (libsamplerate, sox)`,
    });
  } else {
    passed.push(`Sample rate: ${spec.sampleRate} Hz ✓`);
  }
  
  if (analysis.bitDepth < spec.bitDepth) {
    hardRejects.push({
      id: "spec_bitdepth",
      severity: "critical",
      category: "specs",
      title: "Bit Depth Below Requirement",
      detail: "Recording bit depth is lower than required for professional grade",
      measured: `${analysis.bitDepth}-bit`,
      required: `${spec.bitDepth}-bit minimum`,
      fix: "Re-record with 32-bit float capture",
    });
  } else {
    passed.push(`Bit depth: ${analysis.bitDepth}-bit ✓`);
  }
  
  if (analysis.channels !== spec.channels) {
    hardRejects.push({
      id: "spec_channels",
      severity: "critical",
      category: "specs",
      title: "Channel Configuration Mismatch",
      detail: "Channel count does not match required configuration",
      measured: `${analysis.channels} channel(s)`,
      required: `${spec.channels === 1 ? "Mono (1 channel)" : `${spec.channels} channels`}`,
      fix: spec.channels === 1 ? "Convert to mono (sum or take channel 0)" : "Re-record with correct channels",
    });
  } else {
    passed.push(`Channels: ${spec.channels === 1 ? "Mono" : spec.channels} ✓`);
  }
  
  // ═══ HARD REJECTS — ZERO TOLERANCE RULES ═══
  
  // Hum detection (critical for studio)
  if (spec.zeroHumTolerance) {
    const isHum = analysis.noise.type === "hum_50" || analysis.noise.type === "hum_60";
    if (isHum) {
      hardRejects.push({
        id: "hum_detected",
        severity: "critical",
        category: "noise",
        title: `${analysis.noise.humFreq || 50}Hz Hum Detected`,
        detail: "Electrical hum is unacceptable in studio recordings (zero tolerance)",
        measured: `${analysis.noise.humFreq}Hz, strength ${fmt(analysis.noise.humStrength || 0, 2)}`,
        required: "No hum (zero tolerance)",
        fix: `Apply notch filter at ${analysis.noise.humFreq}Hz and harmonics, or fix grounding/cabling and re-record`,
      });
    } else {
      passed.push("No electrical hum detected ✓");
    }
  }
  
  // Clipping (critical)
  if (spec.zeroClippingTolerance) {
    if (analysis.clipping.severity !== "none") {
      hardRejects.push({
        id: "clipping_detected",
        severity: "critical",
        category: "integrity",
        title: `Audio Clipping (${analysis.clipping.severity})`,
        detail: "Sample-level clipping detected — recording is permanently damaged",
        measured: `${analysis.clipping.hardClips} hard clips, ${analysis.clipping.softClips} soft clips`,
        required: "Zero clipping",
        fix: "Re-record with peaks below -1 dBFS. Check input gain staging.",
      });
    } else {
      passed.push("No clipping detected ✓");
    }
  }
  
  // Phone artifact detection
  if (spec.rejectIfPhoneArtifact && analysis.noise.type === "phone") {
    hardRejects.push({
      id: "phone_artifact",
      severity: "critical",
      category: "integrity",
      title: "Phone/Narrowband Audio Detected",
      detail: "Recording shows characteristics of phone-grade audio (limited bandwidth)",
      measured: "Bandwidth limited above 8kHz",
      required: "Full-band studio recording (up to Nyquist)",
      fix: "Re-record using studio-grade microphone and full-bandwidth interface",
    });
  }
  
  // True Peak (intersample peaks)
  if (analysis.lufs.truePeak > spec.truePeakDbTpMax) {
    hardRejects.push({
      id: "true_peak",
      severity: "critical",
      category: "level",
      title: "True Peak Exceeds Limit",
      detail: "Intersample peaks will cause distortion when decoded/converted",
      measured: `${fmt(analysis.lufs.truePeak)} dBTP`,
      required: `≤ ${fmt(spec.truePeakDbTpMax)} dBTP`,
      fix: "Apply true-peak limiter before export (e.g., -1 dBTP ceiling)",
    });
  } else {
    passed.push(`True peak: ${fmt(analysis.lufs.truePeak)} dBTP ✓`);
  }
  
  // ═══ NOISE FLOOR (studio-grade strict) ═══
  
  if (analysis.noise.floorDb > spec.noiseFloorDbFsMax) {
    const delta = analysis.noise.floorDb - spec.noiseFloorDbFsMax;
    if (delta > 5) {
      // Major issue — likely reject
      hardRejects.push({
        id: "noise_floor_high",
        severity: "critical",
        category: "noise",
        title: "Noise Floor Far Above Studio Standard",
        detail: "Background noise level exceeds professional studio requirements",
        measured: `${fmt(analysis.noise.floorDb)} dBFS`,
        required: `≤ ${fmt(spec.noiseFloorDbFsMax)} dBFS`,
        fix: "Re-record in treated room with proper isolation. Check microphone self-noise spec.",
      });
    } else {
      issues.push({
        id: "noise_floor_marginal",
        severity: "major",
        category: "noise",
        title: "Noise Floor Above Target",
        detail: "Noise floor is acceptable but above studio target",
        measured: `${fmt(analysis.noise.floorDb)} dBFS`,
        required: `≤ ${fmt(spec.noiseFloorDbFsMax)} dBFS`,
        fix: "Apply gentle noise reduction (NR ≤ 6dB) or improve recording environment",
      });
    }
  } else {
    passed.push(`Noise floor: ${fmt(analysis.noise.floorDb)} dBFS ✓`);
  }
  
  // ═══ SNR (Signal-to-Noise) ═══
  
  if (analysis.snrDb < spec.snrDbMin) {
    const delta = spec.snrDbMin - analysis.snrDb;
    if (delta > 10) {
      hardRejects.push({
        id: "snr_low",
        severity: "critical",
        category: "noise",
        title: "SNR Critically Low",
        detail: "Signal-to-noise ratio is far below studio requirement",
        measured: `${fmt(analysis.snrDb)} dB`,
        required: `≥ ${spec.snrDbMin} dB`,
        fix: "Increase signal level OR reduce noise. Re-record in better environment.",
      });
    } else {
      issues.push({
        id: "snr_marginal",
        severity: "major",
        category: "noise",
        title: "SNR Below Target",
        detail: "SNR is acceptable but below studio target",
        measured: `${fmt(analysis.snrDb)} dB`,
        required: `≥ ${spec.snrDbMin} dB`,
        fix: "Boost signal or reduce noise floor",
      });
    }
  } else {
    passed.push(`SNR: ${fmt(analysis.snrDb)} dB ✓`);
  }
  
  // ═══ ENVIRONMENT VALIDATION ═══
  
  if (!spec.allowedEnvironments.includes(analysis.environment.type as any)) {
    hardRejects.push({
      id: "wrong_environment",
      severity: "critical",
      category: "environment",
      title: "Recording Environment Not Permitted",
      detail: `Detected environment '${analysis.environment.type}' is not acceptable for this profile`,
      measured: `${analysis.environment.type} (RT60: ${fmt(analysis.environment.rt60Estimate, 2)}s)`,
      required: `One of: ${spec.allowedEnvironments.join(", ")}`,
      fix: "Re-record in approved studio/treated room environment",
    });
  } else {
    passed.push(`Environment: ${analysis.environment.type} ✓`);
  }
  
  if (analysis.environment.rt60Estimate > spec.rt60SecondsMax) {
    issues.push({
      id: "rt60_high",
      severity: "major",
      category: "environment",
      title: "Excessive Reverberation",
      detail: "Room reverberation time exceeds studio target",
      measured: `RT60: ${fmt(analysis.environment.rt60Estimate, 2)}s`,
      required: `≤ ${fmt(spec.rt60SecondsMax, 2)}s`,
      fix: "Add acoustic treatment, move closer to microphone, or use directional mic",
    });
  }
  
  // ═══ LEVEL CHECKS ═══
  
  if (!inRange(analysis.peakDb, spec.peakDbFsMin, spec.peakDbFsMax)) {
    const tooLow = analysis.peakDb < spec.peakDbFsMin;
    issues.push({
      id: "peak_out_of_range",
      severity: "major",
      category: "level",
      title: tooLow ? "Peak Level Too Low" : "Peak Level Too High",
      detail: "Peak level outside acceptable range",
      measured: `${fmt(analysis.peakDb)} dBFS`,
      required: `${fmt(spec.peakDbFsMin)} to ${fmt(spec.peakDbFsMax)} dBFS`,
      fix: tooLow
        ? `Apply +${fmt(((spec.peakDbFsMin + spec.peakDbFsMax) / 2) - analysis.peakDb)} dB gain`
        : "Reduce input gain and re-record (do not normalize down)",
    });
  } else {
    passed.push(`Peak level: ${fmt(analysis.peakDb)} dBFS ✓`);
  }
  
  if (!inRange(analysis.rmsDb, spec.rmsDbFsMin, spec.rmsDbFsMax)) {
    const tooLow = analysis.rmsDb < spec.rmsDbFsMin;
    issues.push({
      id: "rms_out_of_range",
      severity: "minor",
      category: "level",
      title: tooLow ? "RMS Level Low" : "RMS Level High",
      detail: "Average level outside target range",
      measured: `${fmt(analysis.rmsDb)} dBFS`,
      required: `${fmt(spec.rmsDbFsMin)} to ${fmt(spec.rmsDbFsMax)} dBFS`,
      fix: tooLow ? "Increase recording level" : "Reduce recording level",
    });
  } else {
    passed.push(`RMS level: ${fmt(analysis.rmsDb)} dBFS ✓`);
  }
  
  if (!inRange(analysis.lufs.integrated, spec.lufsMin, spec.lufsMax)) {
    const tooLow = analysis.lufs.integrated < spec.lufsMin;
    const target = (spec.lufsMin + spec.lufsMax) / 2;
    const adjustment = target - analysis.lufs.integrated;
    issues.push({
      id: "lufs_out_of_range",
      severity: "major",
      category: "level",
      title: "Loudness Out of Target Range",
      detail: "Integrated LUFS not within EBU R128 target",
      measured: `${fmt(analysis.lufs.integrated)} LUFS`,
      required: `${fmt(spec.lufsMin)} to ${fmt(spec.lufsMax)} LUFS`,
      fix: `Apply ${adjustment > 0 ? "+" : ""}${fmt(adjustment)} dB gain to reach target ${fmt(target)} LUFS`,
    });
  } else {
    passed.push(`LUFS: ${fmt(analysis.lufs.integrated)} ✓`);
  }
  
  // ═══ VOICE ACTIVITY ═══
  
  if (analysis.vad.voiceRatio < spec.voiceRatioMin) {
    issues.push({
      id: "voice_too_low",
      severity: "minor",
      category: "voice",
      title: "Insufficient Voice Activity",
      detail: "Voice content ratio is below expected for this profile",
      measured: `${fmt(analysis.vad.voiceRatio * 100, 0)}%`,
      required: `≥ ${fmt(spec.voiceRatioMin * 100, 0)}%`,
      fix: "Ensure speaker is delivering content for most of the recording",
    });
  } else if (analysis.vad.voiceRatio > spec.voiceRatioMax) {
    issues.push({
      id: "voice_too_high",
      severity: "minor",
      category: "voice",
      title: "Voice Coverage Excessive",
      detail: "Almost entire file is speech — may indicate trimming or merging",
      measured: `${fmt(analysis.vad.voiceRatio * 100, 0)}%`,
      required: `≤ ${fmt(spec.voiceRatioMax * 100, 0)}%`,
      fix: "Verify natural pauses are preserved",
    });
  } else {
    passed.push(`Voice activity: ${fmt(analysis.vad.voiceRatio * 100, 0)}% ✓`);
  }
  
  // ═══ SILENCE EDGES ═══
  
  if (analysis.silence.leadingMs > spec.leadingSilenceMsMax) {
    issues.push({
      id: "leading_silence",
      severity: "minor",
      category: "voice",
      title: "Excessive Leading Silence",
      detail: "Too much silence at the start of the file",
      measured: `${analysis.silence.leadingMs}ms`,
      required: `≤ ${spec.leadingSilenceMsMax}ms`,
      fix: `Trim ${analysis.silence.leadingMs - spec.leadingSilenceMsMax}ms from the start`,
    });
  }
  
  if (analysis.silence.trailingMs > spec.trailingSilenceMsMax) {
    issues.push({
      id: "trailing_silence",
      severity: "minor",
      category: "voice",
      title: "Excessive Trailing Silence",
      detail: "Too much silence at the end of the file",
      measured: `${analysis.silence.trailingMs}ms`,
      required: `≤ ${spec.trailingSilenceMsMax}ms`,
      fix: `Trim ${analysis.silence.trailingMs - spec.trailingSilenceMsMax}ms from the end`,
    });
  }
  
  // ═══ COMPUTE FINAL SCORE ═══
  
  // If any hard rejects → score is capped at 30
  let score: number;
  if (hardRejects.length > 0) {
    score = Math.max(0, 30 - hardRejects.length * 5);
  } else {
    // Start at 100, deduct based on issues
    score = 100;
    for (const issue of issues) {
      if (issue.severity === "critical") score -= 25;
      else if (issue.severity === "major") score -= 10;
      else if (issue.severity === "minor") score -= 4;
      // info doesn't deduct
    }
    score = Math.max(0, Math.min(100, score));
  }
  
  // ═══ DETERMINE VERDICT ═══
  
  let verdict: Verdict;
  if (hardRejects.length > 0) {
    verdict = "REJECT";
  } else if (score >= spec.readyScoreMin) {
    verdict = "READY";
  } else if (score >= spec.reviewScoreMin) {
    verdict = "REVIEW";
  } else {
    verdict = "REJECT";
  }
  
  // ═══ GRADE ═══
  
  const grade: ComplianceReport["grade"] =
    score >= 90 ? "A" :
    score >= 80 ? "B" :
    score >= 70 ? "C" :
    score >= 50 ? "D" : "F";
  
  // ═══ COLLECT RECOMMENDATIONS ═══
  
  for (const r of [...hardRejects, ...issues]) {
    if (r.fix) recommendations.push(r.fix);
  }
  
  // ═══ SUMMARY ═══
  
  const summary = generateSummary(verdict, score, hardRejects, issues, spec);
  
  return {
    verdict,
    score: Math.round(score),
    grade,
    hardRejects,
    issues,
    passed,
    recommendations: [...new Set(recommendations)], // dedupe
    summary,
    profile: spec.name,
    profileName: spec.description,
    analyzedAt: new Date().toISOString(),
  };
}

// ─── SUMMARY GENERATOR ───────────────────────────────────────────

function generateSummary(
  verdict: Verdict,
  score: number,
  hardRejects: ComplianceIssue[],
  issues: ComplianceIssue[],
  spec: StudioSpec
): string {
  if (verdict === "REJECT") {
    if (hardRejects.length > 0) {
      const topReason = hardRejects[0];
      return `REJECTED: ${topReason.title}. ${hardRejects.length > 1 ? `+${hardRejects.length - 1} more critical issues. ` : ""}This recording does not meet ${spec.description.toLowerCase()} requirements.`;
    }
    return `REJECTED: Score ${score}/100 below acceptance threshold (${spec.reviewScoreMin}/100).`;
  }
  
  if (verdict === "REVIEW") {
    const majorCount = issues.filter(i => i.severity === "major").length;
    return `REVIEW: Score ${score}/100. ${majorCount} major issue(s) need human review before delivery.`;
  }
  
  // READY
  const minorCount = issues.filter(i => i.severity === "minor").length;
  if (minorCount === 0) {
    return `READY: Score ${score}/100. All studio specifications met.`;
  }
  return `READY: Score ${score}/100. Meets all critical requirements (${minorCount} minor note(s)).`;
}

// ─── EXPORTS ─────────────────────────────────────────────────────

export default {
  validateStudioCompliance,
  STUDIO_PROFILES,
  DEFAULT_PROFILE,
};
