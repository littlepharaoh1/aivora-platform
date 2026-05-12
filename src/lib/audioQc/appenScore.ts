/**
 * appenScore.ts — Appen Delivery Readiness Score
 * Aivora Audio QC Engine
 */

import type { LUFSResult } from "./lufsAnalyzer";
import type { FFTResult }  from "./fftAnalyzer";
import type { VADResult }  from "./vadAnalyzer";
import type { SNRResult }  from "./snrAnalyzer";

export type AppenVerdict = "READY" | "FIX_REQUIRED" | "REJECT";

export interface AppenCheck {
  id:       string;
  label:    string;
  passed:   boolean;
  critical: boolean;
  value:    string;
  reason:   string;
  fix?:     string;
}

export interface AppenDeliveryResult {
  verdict:       AppenVerdict;
  score:         number;        // 0-100
  checks:        AppenCheck[];
  criticalFails: number;
  warnings:      number;
  summary:       string;
}

export interface AppenInput {
  fileName:   string;
  profile:    "wakeword" | "asr" | "tts" | "conversation" | "byd_wakeword";
  sampleRate: number;
  duration:   number;
  lufs:       LUFSResult;
  fft:        FFTResult;
  vad:        VADResult;
  snr:        SNRResult;
  hasDigitalGaps: boolean;
  digitalGapCount: number;
  peakDb:     number;
  silenceRatio: number;
}

// ── Profile-specific Appen requirements ───────────────────────────────────────

const REQUIREMENTS = {
  wakeword: {
    minSNR:         35,
    minSpeechRatio: 0.35,
    maxLeadingSec:  0.5,
    maxTrailingSec: 0.5,
    lufsMin:        -26,
    lufsMax:        -16,
    minDuration:    0.5,
    maxDuration:    5.0,
    requiredSR:     [16000, 44100, 48000],
  },
  asr: {
    minSNR:         20,
    minSpeechRatio: 0.25,
    maxLeadingSec:  1.0,
    maxTrailingSec: 1.0,
    lufsMin:        -26,
    lufsMax:        -14,
    minDuration:    0.5,
    maxDuration:    30.0,
    requiredSR:     [16000, 44100, 48000],
  },
  tts: {
    minSNR:         35,
    minSpeechRatio: 0.45,
    maxLeadingSec:  0.3,
    maxTrailingSec: 0.3,
    lufsMin:        -24,
    lufsMax:        -16,
    minDuration:    0.3,
    maxDuration:    15.0,
    requiredSR:     [44100, 48000],
  },
  byd_wakeword: {
    minSNR:         30,
    minSpeechRatio: 0.30,
    maxLeadingSec:  0.5,
    maxTrailingSec: 0.5,
    lufsMin:        -26,
    lufsMax:        -14,
    minDuration:    0.35,
    maxDuration:    1.45,
    requiredSR:     [48000],
  },
  conversation: {
    minSNR:         15,
    minSpeechRatio: 0.15,
    maxLeadingSec:  2.0,
    maxTrailingSec: 2.0,
    lufsMin:        -30,
    lufsMax:        -14,
    minDuration:    1.0,
    maxDuration:    60.0,
    requiredSR:     [16000, 44100, 48000],
  },
};

export function computeAppenScore(input: AppenInput): AppenDeliveryResult {
  const req    = REQUIREMENTS[input.profile] ?? REQUIREMENTS['wakeword'];
  const checks: AppenCheck[] = [];

  // ── 1. Sample Rate ────────────────────────────────────────────────────────
  const srOk = req.requiredSR.includes(input.sampleRate);
  checks.push({
    id: "sample_rate", label: "Sample Rate",
    passed: srOk, critical: true,
    value: input.sampleRate + " Hz",
    reason: srOk
      ? `${input.sampleRate} Hz is accepted`
      : `${input.sampleRate} Hz not in [${req.requiredSR.join(", ")}] Hz`,
    fix: srOk ? undefined : "Resample to 48000 Hz before delivery",
  });

  // ── 2. Duration ───────────────────────────────────────────────────────────
  const durOk = input.duration >= req.minDuration && input.duration <= req.maxDuration;
  checks.push({
    id: "duration", label: "Duration",
    passed: durOk, critical: true,
    value: input.duration.toFixed(2) + "s",
    reason: durOk
      ? `Duration within range (${req.minDuration}–${req.maxDuration}s)`
      : `Duration out of range (${req.minDuration}–${req.maxDuration}s)`,
    fix: durOk ? undefined : "Trim or re-record to fit duration requirements",
  });

  // ── 3. No Clipping ────────────────────────────────────────────────────────
  const clipOk = input.lufs.truePeak <= -1.0;
  checks.push({
    id: "clipping", label: "No Clipping",
    passed: clipOk, critical: true,
    value: input.lufs.truePeak.toFixed(2) + " dBTP",
    reason: clipOk
      ? "True peak safe"
      : `True peak ${input.lufs.truePeak.toFixed(2)} dBTP exceeds -1 dBTP`,
    fix: clipOk ? undefined : "Reduce gain to keep true peak below -1 dBTP",
  });

  // ── 4. No Digital Silence Gaps ────────────────────────────────────────────
  checks.push({
    id: "digital_gaps", label: "No Digital Silence Gaps",
    passed: !input.hasDigitalGaps, critical: true,
    value: input.digitalGapCount > 0 ? `${input.digitalGapCount} gap(s)` : "None",
    reason: !input.hasDigitalGaps
      ? "No digital silence gaps detected"
      : `${input.digitalGapCount} digital silence gap(s) found — Appen rejects these`,
    fix: input.hasDigitalGaps
      ? "Use Natural Silence Restoration to replace gaps with room tone" : undefined,
  });

  // ── 5. SNR ────────────────────────────────────────────────────────────────
  const snrOk = input.snr.snrDb >= req.minSNR;
  checks.push({
    id: "snr", label: "Signal-to-Noise Ratio",
    passed: snrOk, critical: false,
    value: input.snr.snrDb.toFixed(1) + " dB",
    reason: snrOk
      ? `SNR ${input.snr.snrDb.toFixed(1)} dB ≥ ${req.minSNR} dB`
      : `SNR ${input.snr.snrDb.toFixed(1)} dB below minimum ${req.minSNR} dB`,
    fix: snrOk ? undefined : "Record in quieter environment or use noise reduction",
  });

  // ── 6. LUFS Range ─────────────────────────────────────────────────────────
  const lufsOk = input.lufs.integrated >= req.lufsMin &&
                 input.lufs.integrated <= req.lufsMax;
  checks.push({
    id: "lufs", label: "Loudness (LUFS)",
    passed: lufsOk, critical: false,
    value: input.lufs.integrated.toFixed(1) + " LUFS",
    reason: lufsOk
      ? `Loudness within range (${req.lufsMin}–${req.lufsMax} LUFS)`
      : `Loudness ${input.lufs.integrated.toFixed(1)} LUFS outside range`,
    fix: lufsOk ? undefined : "Normalize loudness using Repair Suite",
  });

  // ── 7. Speech Ratio ───────────────────────────────────────────────────────
  const speechOk = input.vad.speechRatio >= req.minSpeechRatio;
  checks.push({
    id: "speech_ratio", label: "Speech Ratio",
    passed: speechOk, critical: false,
    value: (input.vad.speechRatio * 100).toFixed(1) + "%",
    reason: speechOk
      ? `Speech ratio OK (≥ ${(req.minSpeechRatio * 100).toFixed(0)}%)`
      : `Too much silence — speech ratio ${(input.vad.speechRatio * 100).toFixed(1)}% < ${(req.minSpeechRatio * 100).toFixed(0)}%`,
    fix: speechOk ? undefined : "Trim leading/trailing silence using Repair Suite",
  });

  // ── 8. No Hum ─────────────────────────────────────────────────────────────
  const humOk = input.fft.noiseClass !== "hum_50hz" &&
                input.fft.noiseClass !== "hum_60hz";
  checks.push({
    id: "hum", label: "No Electrical Hum",
    passed: humOk, critical: false,
    value: humOk ? "Clean" : input.fft.noiseClass.replace("_", " ").toUpperCase(),
    reason: humOk
      ? "No electrical hum detected"
      : `${input.fft.noiseClass.replace("hum_", "")} Hz hum detected`,
    fix: humOk ? undefined : "Apply hum removal filter in Repair Suite",
  });

  // ── 9. Acceptable Environment ─────────────────────────────────────────────
  const envOk = !["bathroom", "outdoor"].includes(input.fft.environment);
  checks.push({
    id: "environment", label: "Recording Environment",
    passed: envOk, critical: false,
    value: input.fft.environment.replace("_", " ").toUpperCase(),
    reason: envOk
      ? `Environment acceptable (${input.fft.environment})`
      : `${input.fft.environment} environment — too much reverb/noise`,
    fix: envOk ? undefined : "Record in a treated room or studio",
  });

  // ── 10. File Naming (German) ──────────────────────────────────────────────
  const nameMatch = input.fileName.match(
    /^DE-DE_(D\d{4})_S(\d{4})_(dkws|oneshot200|query)_(slow|normal|fast)\.wav$/i
  );
  const nameOk = nameMatch !== null;
  checks.push({
    id: "naming", label: "File Naming (Appen Standard)",
    passed: nameOk, critical: false,
    value: nameOk ? "Valid" : "Invalid",
    reason: nameOk
      ? "File name matches Appen German naming pattern"
      : "File name does not match DE-DE_DXXXX_SXXXX_task_speed.wav",
    fix: nameOk ? undefined : "Rename using German Naming tool",
  });

  // ── Score calculation ─────────────────────────────────────────────────────
  const criticalFails = checks.filter(c => c.critical && !c.passed).length;
  const warnings      = checks.filter(c => !c.critical && !c.passed).length;
  const passed        = checks.filter(c => c.passed).length;
  const score         = Math.round((passed / checks.length) * 100);

  const verdict: AppenVerdict =
    criticalFails > 0 ? "REJECT" :
    warnings      > 0 ? "FIX_REQUIRED" : "READY";

  const summary =
    verdict === "READY"
      ? "✅ File meets all Appen delivery requirements"
      : verdict === "FIX_REQUIRED"
      ? `⚠️ ${warnings} issue(s) need fixing before delivery`
      : `❌ ${criticalFails} critical issue(s) — file will be rejected by Appen`;

  return { verdict, score, checks, criticalFails, warnings, summary };
}
