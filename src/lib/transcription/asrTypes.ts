/**
 * asrTypes.ts — ASR Type Definitions
 * Aivora Platform — Phase 8.1
 *
 * INFERENCE_PROTOCOL_VERSION = "8.1.0"
 * All inference: greedy decoder only (temperature=0, no beam search)
 * All timestamps: deterministic (frame-count based, not performance.now())
 */

export const INFERENCE_PROTOCOL_VERSION = "8.1.0";
export const DECODER_STRATEGY           = "greedy" as const;
export const TEMPERATURE                = 0;        // always 0 — no stochastic
export const MAX_CHUNK_DURATION_SEC     = 30;       // Whisper model limit
export const CHUNK_OVERLAP_SEC          = 0.5;      // deterministic overlap
export const SAMPLE_RATE                = 16000;    // Whisper: 16kHz mono

// ── ASR Model Types ───────────────────────────────────────────────────────────

export type ASRModelId =
  | "whisper_tiny"
  | "whisper_base"
  | "whisper_small"
  | "whisper_medium";

export type ASRLanguage =
  | "ar"    // Arabic
  | "en"    // English
  | "auto"; // auto-detect (deterministic: uses first token)

export type ASRBackend =
  | "webgpu"
  | "webgl2"
  | "wasm_simd"
  | "cpu_worker";

// ── Token Types ───────────────────────────────────────────────────────────────

export interface ASRToken {
  id:           number;
  text:         string;
  start_frame:  number;    // audio frame index (deterministic)
  end_frame:    number;
  start_sec:    number;    // derived from frame_count / sample_rate
  end_sec:      number;
  confidence:   number;    // 0→1 (from logit, not stochastic)
  is_rtl:       boolean;
  // Word-level timestamp fields (populated by Groq Whisper)
  word_start_sec?: number;
  word_end_sec?:   number;
  word_text?:      string;
}

// ── Segment ───────────────────────────────────────────────────────────────────

export interface ASRSegment {
  id:           number;
  text:         string;
  tokens:       ASRToken[];
  start_sec:    number;
  end_sec:      number;
  language:     ASRLanguage;
  is_rtl:       boolean;
  chunk_index:  number;    // which audio chunk produced this
}

// ── Transcript ────────────────────────────────────────────────────────────────

export interface ASRTranscript {
  id:                   string;
  audio_file_id?:       string | null;
  correlation_id:       string;
  model_id:             ASRModelId;
  model_checksum:       string | null;
  tokenizer_version:    string;
  quantization:         string;
  backend:              ASRBackend;
  decoder_strategy:     typeof DECODER_STRATEGY;
  inference_protocol:   typeof INFERENCE_PROTOCOL_VERSION;
  language_detected:    ASRLanguage;
  segments:             ASRSegment[];
  full_text:            string;
  duration_sec:         number;
  chunk_count:          number;
  generated_at:         string;    // ISO timestamp
  input_checksum:       string | null;
  output_checksum:      string | null;
}

// ── Inference Request ─────────────────────────────────────────────────────────

export interface ASRInferenceRequest {
  audio:          Float32Array;  // 16kHz mono
  sample_rate:    number;
  model_id:       ASRModelId;
  language:       ASRLanguage;
  correlation_id: string;
  audio_file_id?: string;
}

// ── Chunk ─────────────────────────────────────────────────────────────────────

export interface AudioChunk {
  index:       number;
  data:        Float32Array;
  start_frame: number;
  end_frame:   number;
  start_sec:   number;
  end_sec:     number;
  is_last:     boolean;
}

// ── Governance ────────────────────────────────────────────────────────────────

export interface ASRGovernanceRecord {
  model_id:             ASRModelId;
  model_checksum:       string | null;
  tokenizer_version:    string;
  tokenizer_checksum:   string | null;
  quantization:         string;
  backend:              ASRBackend;
  decoder_strategy:     string;
  temperature:          number;
  rng_seed:             null;     // always null — no RNG in inference
  chunk_order:          "sequential";
  inference_protocol:   string;
  created_at:           string;
}
