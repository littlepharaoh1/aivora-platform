/**
 * tokenizerGovernance.ts — Versioned Tokenizer Governance
 * Aivora Platform — Phase 8.1
 *
 * Rules:
 *   - Every tokenizer has a version + checksum
 *   - No mutable tokenizer state
 *   - RTL-safe token handling (Arabic bidi)
 *   - Arabic numeral preservation
 *   - Same token_id → same text forever (per version)
 *   - No adaptive vocabulary
 */

export const TOKENIZER_VERSION = "8.1.0";

// ── RTL Detection ─────────────────────────────────────────────────────────────

// Unicode ranges for RTL scripts
const RTL_RANGES: [number, number][] = [
  [0x0600, 0x06FF], // Arabic
  [0x0750, 0x077F], // Arabic Supplement
  [0x08A0, 0x08FF], // Arabic Extended-A
  [0xFB50, 0xFDFF], // Arabic Presentation Forms-A
  [0xFE70, 0xFEFF], // Arabic Presentation Forms-B
  [0x0590, 0x05FF], // Hebrew
];

export function isRTLChar(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return RTL_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export function detectTextDirection(text: string): "rtl" | "ltr" {
  let rtlCount = 0, ltrCount = 0;
  for(const char of text) {
    if(isRTLChar(char)) rtlCount++;
    else if(/[a-zA-Z]/.test(char)) ltrCount++;
  }
  return rtlCount > ltrCount ? "rtl" : "ltr";
}

// ── Arabic Numeral Preservation ───────────────────────────────────────────────

// Arabic-Indic → Western Arabic mapping
const ARABIC_INDIC_MAP: Record<string, string> = {
  "٠":"0","١":"1","٢":"2","٣":"3","٤":"4",
  "٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
};

export function normalizeArabicNumerals(text: string): string {
  return text.replace(/[٠-٩]/g, d => ARABIC_INDIC_MAP[d] ?? d);
}

// ── Token Post-Processing ─────────────────────────────────────────────────────

export interface TokenizerConfig {
  version:        string;
  checksum:       string | null;
  language:       string;
  vocab_size:     number;
  bos_token_id:   number;
  eos_token_id:   number;
  blank_token_id: number;
  pad_token_id:   number;
}

export function postProcessToken(
  text:   string,
  config: TokenizerConfig,
): { text: string; is_rtl: boolean } {
  // Normalize Arabic numerals
  let processed = normalizeArabicNumerals(text);

  // Remove leading space added by some tokenizers
  processed = processed.replace(/^\s/, "");

  // Detect RTL
  const is_rtl = detectTextDirection(processed) === "rtl";

  return { text: processed, is_rtl };
}

// ── Tokenizer Governance Record ───────────────────────────────────────────────

export interface TokenizerGovernanceRecord {
  tokenizer_version:  string;
  tokenizer_checksum: string | null;
  vocab_size:         number;
  rtl_support:        boolean;
  arabic_numerals:    boolean;
  protocol_version:   string;
}

export function buildTokenizerGovernance(
  config: TokenizerConfig,
): TokenizerGovernanceRecord {
  return {
    tokenizer_version:  config.version,
    tokenizer_checksum: config.checksum,
    vocab_size:         config.vocab_size,
    rtl_support:        true,
    arabic_numerals:    true,
    protocol_version:   TOKENIZER_VERSION,
  };
}

// ── Default Whisper Tokenizer Config ──────────────────────────────────────────

export const WHISPER_TOKENIZER_CONFIG: TokenizerConfig = {
  version:        "whisper_v3",
  checksum:       null,         // populated when model loaded
  language:       "multilingual",
  vocab_size:     51865,
  bos_token_id:   50258,
  eos_token_id:   50257,
  blank_token_id: 0,
  pad_token_id:   50256,
};
