/**
 * vadAnalyzer.ts — Voice Activity Detection
 * Aivora Audio QC Engine — Batch 4
 */

import { AudioProblem, makeProblem } from "./qcTypes";

// ── ENERGY + ZCR FRAME ANALYSIS ───────────────────────────────────────────────

interface Frame {
  energy:  number;
  zcr:     number;
  isSpeech: boolean;
}

function analyzeFrames(
  samples: Float32Array,
  sampleRate: number,
  frameSizeMs = 20,
  hopMs = 10
): Frame[] {
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const hop       = Math.round((hopMs / 1000) * sampleRate);
  const frames: Frame[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += hop) {
    let energy = 0;
    let zcr    = 0;
    for (let j = i; j < i + frameSize; j++) {
      energy += samples[j] * samples[j];
      if (j > i && samples[j] * samples[j - 1] < 0) zcr++;
    }
    energy /= frameSize;
    zcr    /= frameSize;
    frames.push({ energy, zcr, isSpeech: false });
  }
  return frames;
}

function adaptiveThreshold(frames: Frame[]): number {
  const energies = frames.map(f => f.energy).sort((a, b) => a - b);
  const p10 = energies[Math.floor(energies.length * 0.10)];
  const p90 = energies[Math.floor(energies.length * 0.90)];
  return p10 + (p90 - p10) * 0.15;
}

function markSpeech(frames: Frame[], threshold: number): void {
  // Initial marking
  for (const f of frames) f.isSpeech = f.energy > threshold;

  // Smooth: fill short gaps (< 5 frames) between speech
  let inGap = false;
  let gapStart = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].isSpeech) {
      if (inGap && i - gapStart < 5) {
        for (let j = gapStart; j < i; j++) frames[j].isSpeech = true;
      }
      inGap = false;
    } else if (!inGap) {
      inGap = true;
      gapStart = i;
    }
  }

  // Remove very short speech bursts (< 3 frames)
  let inBurst = false;
  let burstStart = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].isSpeech) {
      if (!inBurst) { inBurst = true; burstStart = i; }
    } else {
      if (inBurst && i - burstStart < 3) {
        for (let j = burstStart; j < i; j++) frames[j].isSpeech = false;
      }
      inBurst = false;
    }
  }
}

// ── REGION EXTRACTION ─────────────────────────────────────────────────────────

export interface SpeechRegion {
  startSec: number;
  endSec:   number;
  durationSec: number;
}

function extractRegions(
  frames: Frame[],
  hopMs: number
): SpeechRegion[] {
  const regions: SpeechRegion[] = [];
  let inSpeech = false;
  let startIdx = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].isSpeech && !inSpeech) {
      inSpeech = true; startIdx = i;
    } else if (!frames[i].isSpeech && inSpeech) {
      inSpeech = false;
      const startSec = (startIdx * hopMs) / 1000;
      const endSec   = (i * hopMs) / 1000;
      regions.push({ startSec, endSec, durationSec: endSec - startSec });
    }
  }
  if (inSpeech) {
    const startSec = (startIdx * hopMs) / 1000;
    const endSec   = (frames.length * hopMs) / 1000;
    regions.push({ startSec, endSec, durationSec: endSec - startSec });
  }
  return regions;
}

// ── SILENCE METRICS ───────────────────────────────────────────────────────────

export interface SilenceMetrics {
  leadingSec:   number;
  trailingSec:  number;
  totalSilenceSec: number;
  speechRatio:  number;
  longestGapSec: number;
}

function computeSilenceMetrics(
  frames: Frame[],
  hopMs: number,
  durationSec: number
): SilenceMetrics {
  const hopSec = hopMs / 1000;
  const speechFrames = frames.filter(f => f.isSpeech).length;
  const speechRatio  = speechFrames / frames.length;

  // Leading silence
  let leadingFrames = 0;
  for (const f of frames) { if (!f.isSpeech) leadingFrames++; else break; }

  // Trailing silence
  let trailingFrames = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (!frames[i].isSpeech) trailingFrames++; else break;
  }

  // Longest internal gap
  let longestGap = 0, curGap = 0;
  let pastFirstSpeech = false;
  for (const f of frames) {
    if (f.isSpeech) { pastFirstSpeech = true; curGap = 0; }
    else if (pastFirstSpeech) {
      curGap++;
      if (curGap > longestGap) longestGap = curGap;
    }
  }

  return {
    leadingSec:      leadingFrames * hopSec,
    trailingSec:     trailingFrames * hopSec,
    totalSilenceSec: (frames.length - speechFrames) * hopSec,
    speechRatio,
    longestGapSec:   longestGap * hopSec,
  };
}

// ── PUBLIC INTERFACE ──────────────────────────────────────────────────────────

export interface VADResult {
  speechRegions:  SpeechRegion[];
  silenceMetrics: SilenceMetrics;
  speechRatio:    number;
  problems:       AudioProblem[];
}

export function analyzeVAD(
  buffer: AudioBuffer,
  profile: "wakeword" | "asr" | "tts" | "conversation" = "asr"
): VADResult {
  // Mix to mono
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  const HOP_MS = 10;
  const frames    = analyzeFrames(mono, buffer.sampleRate, 20, HOP_MS);
  const threshold = adaptiveThreshold(frames);
  markSpeech(frames, threshold);

  const speechRegions  = extractRegions(frames, HOP_MS);
  const durationSec    = buffer.length / buffer.sampleRate;
  const silenceMetrics = computeSilenceMetrics(frames, HOP_MS, durationSec);
  const speechRatio    = silenceMetrics.speechRatio;

  // ── Profile thresholds ────────────────────────────────────────────────────
  const thresholds: Record<string, {
    minSpeechRatio: number;
    maxLeadingSec:  number;
    maxTrailingSec: number;
    maxGapSec:      number;
  }> = {
    wakeword:     { minSpeechRatio: 0.40, maxLeadingSec: 0.5,  maxTrailingSec: 0.5,  maxGapSec: 0.3  },
    asr:          { minSpeechRatio: 0.30, maxLeadingSec: 1.0,  maxTrailingSec: 1.0,  maxGapSec: 2.0  },
    tts:          { minSpeechRatio: 0.50, maxLeadingSec: 0.3,  maxTrailingSec: 0.3,  maxGapSec: 1.0  },
    conversation: { minSpeechRatio: 0.20, maxLeadingSec: 2.0,  maxTrailingSec: 2.0,  maxGapSec: 5.0  },
  };
  const t = thresholds[profile];
  const problems: AudioProblem[] = [];

  if (speechRatio < t.minSpeechRatio) {
    problems.push(makeProblem("SILENCE_ABUSE", "warning",
      `Speech ratio ${(speechRatio * 100).toFixed(1)}% is too low (min ${(t.minSpeechRatio * 100).toFixed(0)}%)`,
      { confidence: 0.88, suggestedAction: "Remove excessive silence or re-record" }));
  }

  if (silenceMetrics.leadingSec > t.maxLeadingSec) {
    problems.push(makeProblem("LEADING_SILENCE", "medium",
      `Leading silence ${silenceMetrics.leadingSec.toFixed(2)}s exceeds limit (${t.maxLeadingSec}s)`,
      { confidence: 0.92 }));
  }

  if (silenceMetrics.trailingSec > t.maxTrailingSec) {
    problems.push(makeProblem("TRAILING_SILENCE", "medium",
      `Trailing silence ${silenceMetrics.trailingSec.toFixed(2)}s exceeds limit (${t.maxTrailingSec}s)`,
      { confidence: 0.92 }));
  }

  if (silenceMetrics.longestGapSec > t.maxGapSec) {
    problems.push(makeProblem("SILENCE_GAP", "warning",
      `Internal silence gap ${silenceMetrics.longestGapSec.toFixed(2)}s exceeds limit (${t.maxGapSec}s)`,
      { confidence: 0.85 }));
  }

  if (speechRegions.length === 0) {
    problems.push(makeProblem("DIGITAL_SILENCE", "critical",
      "No speech detected — file may be silent or noise-only",
      { confidence: 0.97, suggestedAction: "Verify recording and re-upload" }));
  }

  return { speechRegions, silenceMetrics, speechRatio, problems };
}
