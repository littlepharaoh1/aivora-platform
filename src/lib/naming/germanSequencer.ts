/**
 * germanSequencer.ts — German Wake Word Smart Naming Engine
 * Aivora Platform — Official Appen Sequence Logic
 */

export interface SequenceRule {
  from:   number;
  to:     number;
  task:   string;
  speed:  string;
  suffix: string;
}

export interface NamingResult {
  original: string;
  renamed:  string;
  sequence: number;
  suffix:   string;
  valid:    boolean;
  error?:   string;
}

export interface SequencerOptions {
  speakerId:  string;   // e.g. "D1065"
  startIndex: number;   // e.g. 1
  locale:     string;   // e.g. "DE-DE"
}

// ── Official Appen Sequence Rules ─────────────────────────────────────────────

export const SEQUENCE_RULES: SequenceRule[] = [
  { from:   1, to:  10, task: "dkws",       speed: "slow",   suffix: "dkws_slow"       },
  { from:  11, to:  30, task: "dkws",       speed: "normal", suffix: "dkws_normal"     },
  { from:  31, to:  40, task: "dkws",       speed: "fast",   suffix: "dkws_fast"       },
  { from:  41, to:  50, task: "dkws",       speed: "slow",   suffix: "dkws_slow"       },
  { from:  51, to:  70, task: "dkws",       speed: "normal", suffix: "dkws_normal"     },
  { from:  71, to:  80, task: "dkws",       speed: "fast",   suffix: "dkws_fast"       },
  { from:  81, to:  90, task: "dkws",       speed: "normal", suffix: "dkws_normal"     },
  { from:  91, to: 100, task: "dkws",       speed: "fast",   suffix: "dkws_fast"       },
  { from: 101, to: 110, task: "dkws",       speed: "normal", suffix: "dkws_normal"     },
  { from: 111, to: 120, task: "dkws",       speed: "fast",   suffix: "dkws_fast"       },
  { from: 121, to: 160, task: "oneshot200", speed: "normal", suffix: "oneshot200_normal"},
  { from: 161, to: 200, task: "query",      speed: "normal", suffix: "query_normal"    },
];

export function getSuffixForIndex(index: number): string {
  const rule = SEQUENCE_RULES.find(r => index >= r.from && index <= r.to);
  return rule ? rule.suffix : "dkws_normal";
}

export function getRuleForIndex(index: number): SequenceRule | null {
  return SEQUENCE_RULES.find(r => index >= r.from && index <= r.to) ?? null;
}

export function buildFileName(
  locale:    string,
  speakerId: string,
  index:     number,
): string {
  const suffix = getSuffixForIndex(index);
  const seq    = String(index).padStart(4, "0");
  return `${locale}_${speakerId}_S${seq}_${suffix}.wav`;
}

export function extractNumberFromFileName(fileName: string): number | null {
  // Match leading number: "93. Hey Denza (fast).wav" → 93
  // Or "120_rec.wav" → 120
  // Or "recording_085.wav" → 85
  const match = fileName.match(/^(\d+)[.\s_-]/);
  if (match) return parseInt(match[1], 10);
  // Also try any number in filename
  const anyNum = fileName.match(/(\d+)/);
  if (anyNum) return parseInt(anyNum[1], 10);
  return null;
}

export function generateSequence(
  files:   File[],
  options: SequencerOptions
): NamingResult[] {
  const { speakerId, startIndex, locale } = options;
  const results: NamingResult[] = [];
  const usedSequences = new Set<number>();

  for (let i = 0; i < files.length; i++) {
    // Try to extract number from filename first
    const fileNum = extractNumberFromFileName(files[i].name);
    const index   = fileNum !== null ? fileNum : startIndex + i;

    if (index > 200) {
      results.push({
        original: files[i].name,
        renamed:  "",
        sequence: index,
        suffix:   "",
        valid:    false,
        error:    `Sequence S${String(index).padStart(4,"0")} exceeds maximum S0200`,
      });
      continue;
    }

    if (usedSequences.has(index)) {
      results.push({
        original: files[i].name,
        renamed:  "",
        sequence: index,
        suffix:   "",
        valid:    false,
        error:    `Duplicate sequence S${String(index).padStart(4,"0")}`,
      });
      continue;
    }

    usedSequences.add(index);
    const suffix  = getSuffixForIndex(index);
    const renamed = buildFileName(locale, speakerId, index);

    results.push({
      original: files[i].name,
      renamed,
      sequence: index,
      suffix,
      valid:    true,
    });
  }

  return results;
}

export function validateBatch(
  files:      File[],
  startIndex: number
): { ok: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors:   string[] = [];

  if (files.length === 0) {
    errors.push("No files uploaded");
    return { ok: false, warnings, errors };
  }

  const endIndex = startIndex + files.length - 1;

  if (startIndex < 1) errors.push("Start sequence must be at least S0001");
  if (endIndex > 200)  errors.push(`End sequence S${String(endIndex).padStart(4,"0")} exceeds maximum S0200`);
  if (files.length !== 200 && startIndex === 1)
    warnings.push(`Uploaded ${files.length} files — expected 200 for a complete batch`);

  // Check for non-WAV files
  const nonWav = files.filter(f => !f.name.toLowerCase().endsWith(".wav"));
  if (nonWav.length > 0)
    errors.push(`${nonWav.length} non-WAV file(s) detected`);

  // Check rule boundaries
  SEQUENCE_RULES.forEach(rule => {
    const ruleStart = Math.max(startIndex, rule.from);
    const ruleEnd   = Math.min(endIndex,   rule.to);
    if (ruleStart <= ruleEnd) {
      const count = ruleEnd - ruleStart + 1;
      const expected = rule.to - rule.from + 1;
      if (count < expected && startIndex <= rule.from && endIndex >= rule.to)
        warnings.push(`Range ${rule.suffix}: ${count}/${expected} files`);
    }
  });

  return { ok: errors.length === 0, warnings, errors };
}

// ── Multi-language preset support ─────────────────────────────────────────────

export interface LanguagePreset {
  locale:   string;
  language: string;
  rules:    SequenceRule[];
}

export const LANGUAGE_PRESETS: LanguagePreset[] = [
  { locale: "DE-DE", language: "German",  rules: SEQUENCE_RULES },
  { locale: "EN-US", language: "English", rules: SEQUENCE_RULES },
  { locale: "AR-SA", language: "Arabic",  rules: SEQUENCE_RULES },
  { locale: "FR-FR", language: "French",  rules: SEQUENCE_RULES },
  { locale: "ES-ES", language: "Spanish", rules: SEQUENCE_RULES },
];
