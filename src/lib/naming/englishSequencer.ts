/**
 * englishSequencer.ts — English UK Smart Naming Engine (80-sentence batch)
 * Aivora Platform — Independent sequence logic, separate from German 200 format.
 * Format: {code}_S####_{suffix}.wav   (no locale segment)
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
  code:       string;   // e.g. "G0401"
  startIndex: number;   // e.g. 1
}

export const MAX_SEQUENCE = 80;

// ── Official English UK Sequence Rules (80 total) ─────────────────────────────

export const SEQUENCE_RULES: SequenceRule[] = [
  { from:  1, to: 10, task: "dkws",       speed: "slow",   suffix: "dkws_slow"        },
  { from: 11, to: 30, task: "dkws",       speed: "normal", suffix: "dkws_normal"      },
  { from: 31, to: 40, task: "dkws",       speed: "fast",   suffix: "dkws_fast"        },
  { from: 41, to: 45, task: "oneshot200", speed: "slow",   suffix: "oneshot200_slow"  },
  { from: 46, to: 55, task: "oneshot200", speed: "normal", suffix: "oneshot200_normal"},
  { from: 56, to: 60, task: "oneshot200", speed: "fast",   suffix: "oneshot200_fast"  },
  { from: 61, to: 65, task: "oneshot200", speed: "slow",   suffix: "oneshot200_slow"  },
  { from: 66, to: 75, task: "oneshot200", speed: "normal", suffix: "oneshot200_normal"},
  { from: 76, to: 80, task: "oneshot200", speed: "fast",   suffix: "oneshot200_fast"  },
];

export function getSuffixForIndex(index: number): string {
  const rule = SEQUENCE_RULES.find(r => index >= r.from && index <= r.to);
  return rule ? rule.suffix : "dkws_normal";
}

export function getRuleForIndex(index: number): SequenceRule | null {
  return SEQUENCE_RULES.find(r => index >= r.from && index <= r.to) ?? null;
}

export function buildFileName(code: string, index: number): string {
  const suffix = getSuffixForIndex(index);
  const seq    = String(index).padStart(4, "0");
  return `${code}_N${seq}_${suffix}.wav`;
}

// ── Arabic Numeral Converter ──────────────────────────────────────────────────

const ARABIC_TO_WESTERN: Record<string, string> = {
  "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
  "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
  "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4",
  "۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
};

export function convertArabicNumerals(str: string): string {
  return str.replace(/[٠-٩۰-۹]/g, d => ARABIC_TO_WESTERN[d] ?? d);
}

export function extractNumberFromFileName(fileName: string): number | null {
  fileName = convertArabicNumerals(fileName);
  const leadingNum = fileName.match(/^(\d+)[.\s_-]/);
  if (leadingNum) return parseInt(leadingNum[1], 10);

  const appenFormat = fileName.match(/_[SN](\d{3,5})_/);
  if (appenFormat) return parseInt(appenFormat[1], 10);

  return null;
}

export function generateSequence(
  files:   File[],
  options: SequencerOptions
): NamingResult[] {
  const { code, startIndex } = options;
  const results: NamingResult[] = [];
  const usedSequences = new Set<number>();

  for (let i = 0; i < files.length; i++) {
    const fileNum = extractNumberFromFileName(files[i].name);
    const index   = fileNum !== null ? fileNum : startIndex + i;

    if (index > MAX_SEQUENCE) {
      results.push({
        original: files[i].name,
        renamed:  "",
        sequence: index,
        suffix:   "",
        valid:    false,
        error:    `Sequence S${String(index).padStart(4,"0")} exceeds maximum S${String(MAX_SEQUENCE).padStart(4,"0")}`,
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
    const renamed = buildFileName(code, index);

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
  if (endIndex > MAX_SEQUENCE)
    errors.push(`End sequence S${String(endIndex).padStart(4,"0")} exceeds maximum S${String(MAX_SEQUENCE).padStart(4,"0")}`);
  if (files.length !== MAX_SEQUENCE && startIndex === 1)
    warnings.push(`Uploaded ${files.length} files — expected ${MAX_SEQUENCE} for a complete batch`);

  const nonWav = files.filter(f => !f.name.toLowerCase().endsWith(".wav"));
  if (nonWav.length > 0)
    errors.push(`${nonWav.length} non-WAV file(s) detected`);

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
