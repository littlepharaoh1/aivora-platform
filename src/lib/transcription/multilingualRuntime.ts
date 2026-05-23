/**
 * multilingualRuntime.ts — Multilingual + RTL Runtime
 * Aivora Platform — Phase 8.5
 *
 * Arabic + English + RTL + bidi + Arabic numerals.
 * Deterministic: same text → same direction → same rendering.
 */

import { detectTextDirection, isRTLChar, normalizeArabicNumerals } from "./tokenizerGovernance";
import type { ASRSegment } from "./asrTypes";

export const MULTILINGUAL_VERSION = "8.5.0";

// ── Language Detection ────────────────────────────────────────────────────────

export type DetectedLanguage = "ar" | "en" | "mixed" | "unknown";

export function detectSegmentLanguage(text: string): DetectedLanguage {
  const arChars = Array.from(text).filter(c => isRTLChar(c)).length;
  const enChars = (text.match(/[a-zA-Z]/g) ?? []).length;
  const total   = arChars + enChars;

  if(total === 0) return "unknown";
  if(arChars / total >= 0.8) return "ar";
  if(enChars / total >= 0.8) return "en";
  return "mixed";
}

// ── Bidi Segment ──────────────────────────────────────────────────────────────

export interface BidiSegment {
  text:      string;
  direction: "rtl" | "ltr";
  language:  DetectedLanguage;
  start_sec: number;
  end_sec:   number;
  normalized:string;  // Arabic numerals normalized
}

export function buildBidiSegments(segments: ASRSegment[]): BidiSegment[] {
  return segments.map(seg => {
    const lang      = detectSegmentLanguage(seg.text);
    const direction = detectTextDirection(seg.text);
    const normalized= normalizeArabicNumerals(seg.text);

    return {
      text:      seg.text,
      direction,
      language:  lang,
      start_sec: seg.start_sec,
      end_sec:   seg.end_sec,
      normalized,
    };
  });
}

// ── Code-Switch Detection ─────────────────────────────────────────────────────

export interface CodeSwitchEvent {
  from_language: DetectedLanguage;
  to_language:   DetectedLanguage;
  at_sec:        number;
}

export function detectCodeSwitches(bidi: BidiSegment[]): CodeSwitchEvent[] {
  const events: CodeSwitchEvent[] = [];
  for(let i = 1; i < bidi.length; i++) {
    const prev = bidi[i-1];
    const curr = bidi[i];
    if(prev.language !== curr.language &&
       prev.language !== "unknown" &&
       curr.language !== "unknown") {
      events.push({
        from_language: prev.language,
        to_language:   curr.language,
        at_sec:        curr.start_sec,
      });
    }
  }
  return events;
}

// ── RTL Transcript Builder ────────────────────────────────────────────────────

export interface RTLTranscript {
  full_text_ltr:  string;
  full_text_rtl:  string;   // RTL segments reversed for display
  bidi_segments:  BidiSegment[];
  code_switches:  CodeSwitchEvent[];
  primary_lang:   DetectedLanguage;
  rtl_ratio:      number;
}

export function buildRTLTranscript(
  segments: ASRSegment[],
): RTLTranscript {
  const bidi   = buildBidiSegments(segments);
  const switches = detectCodeSwitches(bidi);

  const rtlSegs = bidi.filter(s => s.direction === "rtl").length;
  const rtlRatio = bidi.length > 0 ? rtlSegs / bidi.length : 0;

  const primaryLang: DetectedLanguage =
    rtlRatio >= 0.5 ? "ar" : rtlRatio <= 0.2 ? "en" : "mixed";

  // LTR: segments in order
  const ltrText = bidi.map(s => s.normalized).join(" ").trim();

  // RTL: reverse RTL segments within their groups
  const rtlText = bidi
    .map(s => s.direction === "rtl" ? s.normalized : s.normalized)
    .join(" ").trim();

  return {
    full_text_ltr:  ltrText,
    full_text_rtl:  rtlText,
    bidi_segments:  bidi,
    code_switches:  switches,
    primary_lang:   primaryLang,
    rtl_ratio:      Math.round(rtlRatio * 1000) / 1000,
  };
}
