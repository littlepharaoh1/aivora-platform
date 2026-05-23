/**
 * tokenAlignment.ts — Deterministic Token Alignment Engine
 * Aivora Platform — Phase 8.2
 *
 * Rules:
 *   - Frame-based timestamps only (not performance.now())
 *   - Same audio → same token offsets forever
 *   - RTL-safe positioning
 *   - Arabic numeral preservation
 *   - Bidi mapping: audio_frame ↔ token ↔ word
 */

import { detectTextDirection } from "./tokenizerGovernance";
import type { ASRToken, ASRSegment } from "./asrTypes";

export const ALIGNMENT_VERSION = "8.2.0";

// ── Word (grouped tokens) ─────────────────────────────────────────────────────

export interface AlignedWord {
  text:         string;
  tokens:       ASRToken[];
  start_frame:  number;
  end_frame:    number;
  start_sec:    number;
  end_sec:      number;
  is_rtl:       boolean;
  confidence:   number;   // mean token confidence
}

// ── Alignment Result ──────────────────────────────────────────────────────────

export interface AlignmentResult {
  version:       string;
  words:         AlignedWord[];
  segments:      ASRSegment[];
  total_frames:  number;
  sample_rate:   number;
  drift_frames:  number;   // detected drift (0 = no drift)
  rtl_segments:  number;
  ltr_segments:  number;
}

// ── Token → Word Grouping ─────────────────────────────────────────────────────

export function groupTokensToWords(
  tokens:     ASRToken[],
  sampleRate: number,
): AlignedWord[] {
  if(tokens.length === 0) return [];

  const words:    AlignedWord[] = [];
  let   current:  ASRToken[]    = [];

  for(const token of tokens) {
    // Word boundary: space character or RTL word separator
    const isWordEnd = token.text.endsWith(" ") ||
                      token.text === "▁" ||      // SentencePiece word boundary
                      token.text === "Ġ";         // GPT-style word boundary

    current.push(token);

    if(isWordEnd || token === tokens[tokens.length - 1]) {
      if(current.length === 0) continue;

      const wordText = current.map(t => t.text).join("").trim();
      if(!wordText) { current = []; continue; }

      const startFrame = current[0].start_frame;
      const endFrame   = current[current.length - 1].end_frame;
      const meanConf   = current.reduce((s, t) => s + t.confidence, 0) / current.length;

      words.push({
        text:        wordText,
        tokens:      [...current],
        start_frame: startFrame,
        end_frame:   endFrame,
        start_sec:   startFrame / sampleRate,
        end_sec:     endFrame   / sampleRate,
        is_rtl:      detectTextDirection(wordText) === "rtl",
        confidence:  Math.round(meanConf * 10000) / 10000,
      });

      current = [];
    }
  }

  return words;
}

// ── Timestamp Drift Detection ─────────────────────────────────────────────────

export function detectTimestampDrift(
  words:      AlignedWord[],
  totalFrames:number,
): number {
  if(words.length === 0) return 0;

  const lastWord     = words[words.length - 1];
  const expectedEnd  = totalFrames;
  const actualEnd    = lastWord.end_frame;
  const drift        = Math.abs(expectedEnd - actualEnd);

  return drift;
}

// ── Timestamp Reconciliation ──────────────────────────────────────────────────
// Adjusts timestamps to remove accumulated drift.
// Deterministic: same drift → same adjustment.

export function reconcileTimestamps(
  words:       AlignedWord[],
  totalFrames: number,
  sampleRate:  number,
): AlignedWord[] {
  if(words.length === 0) return [];

  const drift = detectTimestampDrift(words, totalFrames);
  if(drift === 0) return words;

  // Linear adjustment across all words
  const ratio = totalFrames / Math.max(1, words[words.length-1].end_frame);

  return words.map(w => ({
    ...w,
    start_frame: Math.round(w.start_frame * ratio),
    end_frame:   Math.round(w.end_frame   * ratio),
    start_sec:   Math.round(w.start_frame * ratio) / sampleRate,
    end_sec:     Math.round(w.end_frame   * ratio) / sampleRate,
  }));
}

// ── Main Alignment Function ───────────────────────────────────────────────────

export function alignTranscript(
  segments:    ASRSegment[],
  totalFrames: number,
  sampleRate:  number,
): AlignmentResult {
  const allWords: AlignedWord[] = [];
  let   rtlCount = 0, ltrCount = 0;

  for(const seg of segments) {
    const words = groupTokensToWords(seg.tokens, sampleRate);
    const reconciled = reconcileTimestamps(words, totalFrames, sampleRate);
    allWords.push(...reconciled);
    if(seg.is_rtl) rtlCount++; else ltrCount++;
  }

  const drift = detectTimestampDrift(allWords, totalFrames);

  return {
    version:      ALIGNMENT_VERSION,
    words:        allWords,
    segments,
    total_frames: totalFrames,
    sample_rate:  sampleRate,
    drift_frames: drift,
    rtl_segments: rtlCount,
    ltr_segments: ltrCount,
  };
}
