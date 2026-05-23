/**
 * formatAdapters.ts — Enterprise Format Adapters
 * Aivora Platform — Phase 7.5
 *
 * Deterministic serializers for all supported formats.
 * Same record → same output for every format.
 * No adaptive formatting. No ML-generated fields.
 */

import type { DatasetRecord, DatasetManifest } from "./datasetRuntime";

export type ExportFormat =
  | "openai_jsonl"      // OpenAI fine-tuning
  | "chatml"            // ChatML format
  | "sharegpt"          // ShareGPT
  | "alpaca"            // Alpaca instruction
  | "whisper_manifest"  // OpenAI Whisper
  | "nemo_manifest"     // NVIDIA NeMo
  | "huggingface"       // HuggingFace datasets
  | "aivora_native";    // Aivora internal

export interface AdapterResult {
  format:        ExportFormat;
  content:       string;
  file_extension:string;
  mime_type:     string;
  record_count:  number;
}

// ── Field Helpers ─────────────────────────────────────────────────────────────

function audioPath(r: DatasetRecord): string {
  return `/audio/${r.file_name}`;
}

function durationStr(sec: number | null): string {
  if(!sec) return "0.0";
  return sec.toFixed(2);
}

// ── OpenAI JSONL ──────────────────────────────────────────────────────────────

function toOpenAIRecord(r: DatasetRecord): string {
  return JSON.stringify({
    messages: [
      { role:"system",    content:"You are an audio quality analyst." },
      { role:"user",      content:`Analyze audio file: ${r.file_name}` },
      { role:"assistant", content:JSON.stringify({
          qc_score:   r.qc_score,
          verdict:    r.forensic_verdict ?? "PENDING",
          duration:   r.duration_sec,
          snr_db:     r.snr_db,
          lufs:       r.lufs,
        }),
      },
    ],
    metadata: {
      id:           r.id,
      split:        r.split_bucket,
      sequence:     r.sequence_number,
      checksum:     r.record_checksum,
      protocol:     r.protocol_version,
    },
  });
}

// ── Whisper Manifest ──────────────────────────────────────────────────────────

function toWhisperRecord(r: DatasetRecord): string {
  return JSON.stringify({
    audio_filepath: audioPath(r),
    duration:       r.duration_sec ?? 0,
    text:           "",   // transcript populated by whisper pipeline
    metadata: {
      id:       r.id,
      split:    r.split_bucket,
      qc_score: r.qc_score,
    },
  });
}

// ── NeMo Manifest ─────────────────────────────────────────────────────────────

function toNeMoRecord(r: DatasetRecord): string {
  return JSON.stringify({
    audio_filepath: audioPath(r),
    duration:       r.duration_sec ?? 0,
    text:           "",
    offset:         0,
    sample_rate:    r.sample_rate ?? 16000,
    orig_sr:        r.sample_rate ?? 16000,
  });
}

// ── Alpaca ────────────────────────────────────────────────────────────────────

function toAlpacaRecord(r: DatasetRecord): string {
  return JSON.stringify({
    instruction: "Evaluate the quality of this audio file.",
    input:       r.file_name,
    output:      JSON.stringify({
      verdict:  r.forensic_verdict ?? "PENDING",
      qc_score: r.qc_score,
      snr_db:   r.snr_db,
    }),
    metadata: { id:r.id, split:r.split_bucket },
  });
}

// ── HuggingFace ───────────────────────────────────────────────────────────────

function toHuggingFaceRecord(r: DatasetRecord): string {
  return JSON.stringify({
    id:               r.id,
    file_name:        r.file_name,
    audio_path:       audioPath(r),
    split:            r.split_bucket,
    sequence:         r.sequence_number,
    duration_sec:     r.duration_sec,
    sample_rate:      r.sample_rate,
    channels:         r.channels,
    qc_score:         r.qc_score,
    lufs:             r.lufs,
    snr_db:           r.snr_db,
    forensic_verdict: r.forensic_verdict,
    protocol_version: r.protocol_version,
    record_checksum:  r.record_checksum,
  });
}

// ── Aivora Native ─────────────────────────────────────────────────────────────

function toAivoraNativeRecord(r: DatasetRecord): string {
  return JSON.stringify(r);
}

// ── Main Adapter ──────────────────────────────────────────────────────────────

export function adaptRecords(
  records: DatasetRecord[],
  format:  ExportFormat,
): AdapterResult {
  const serializers: Record<ExportFormat, (r: DatasetRecord) => string> = {
    openai_jsonl:     toOpenAIRecord,
    chatml:           toOpenAIRecord,      // ChatML uses same structure
    sharegpt:         toOpenAIRecord,
    alpaca:           toAlpacaRecord,
    whisper_manifest: toWhisperRecord,
    nemo_manifest:    toNeMoRecord,
    huggingface:      toHuggingFaceRecord,
    aivora_native:    toAivoraNativeRecord,
  };

  const extensions: Record<ExportFormat, string> = {
    openai_jsonl:"jsonl", chatml:"jsonl", sharegpt:"jsonl",
    alpaca:"jsonl", whisper_manifest:"jsonl", nemo_manifest:"jsonl",
    huggingface:"jsonl", aivora_native:"jsonl",
  };

  const serialize = serializers[format];
  const content   = records.map(serialize).join("\n");

  return {
    format,
    content,
    file_extension: extensions[format],
    mime_type:      "application/jsonl",
    record_count:   records.length,
  };
}

export function downloadAdaptedExport(
  result:        AdapterResult,
  versionNumber: string,
): void {
  const blob = new Blob([result.content], { type:result.mime_type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `dataset_v${versionNumber}_${result.format}.${result.file_extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
