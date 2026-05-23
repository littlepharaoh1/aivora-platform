/**
 * speechObservability.ts — Speech Inference Observability
 * Aivora Platform — Phase 8.7
 *
 * All events: fire-and-forget, payload < 4KB, no recursion.
 */

import { emitEvent } from "../telemetry/emitter";
import { supabase }  from "../supabase";
import type { ASRTranscript } from "./asrTypes";
import type { SpeechQAReport } from "./speechQA";

export const OBSERVABILITY_VERSION = "8.7.0";

// ── Event Emitters ────────────────────────────────────────────────────────────

export function emitInferenceStarted(params: {
  model_id:      string;
  backend:       string;
  correlation_id:string;
  duration_sec:  number;
  chunk_count:   number;
}): void {
  emitEvent({
    event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"info",
    payload:{
      action:       "INFERENCE_STARTED",
      model_id:     params.model_id,
      backend:      params.backend,
      duration_sec: params.duration_sec,
      chunk_count:  params.chunk_count,
      version:      OBSERVABILITY_VERSION,
    },
  });
}

export function emitInferenceCompleted(
  transcript: ASRTranscript,
  latencyMs:  number,
): void {
  emitEvent({
    event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:transcript.correlation_id, severity:"info",
    payload:{
      action:          "INFERENCE_COMPLETED",
      model_id:        transcript.model_id,
      backend:         transcript.backend,
      latency_ms:      latencyMs,
      chunk_count:     transcript.chunk_count,
      input_checksum:  transcript.input_checksum,
      output_checksum: transcript.output_checksum,
      decoder:         transcript.decoder_strategy,
      protocol:        transcript.inference_protocol,
    },
  });
}

export function emitInferenceFailed(params: {
  model_id:      string;
  backend:       string;
  correlation_id:string;
  error:         string;
  latency_ms:    number;
}): void {
  emitEvent({
    event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"error",
    payload:{
      action:     "INFERENCE_FAILED",
      model_id:   params.model_id,
      backend:    params.backend,
      error:      params.error.slice(0, 200),
      latency_ms: params.latency_ms,
    },
  });
}

export function emitChunkProcessed(params: {
  correlation_id:string;
  chunk_index:   number;
  chunk_count:   number;
  tokens_count:  number;
}): void {
  emitEvent({
    event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"info",
    payload:{
      action:       "CHUNK_PROCESSED",
      chunk_index:  params.chunk_index,
      chunk_count:  params.chunk_count,
      tokens_count: params.tokens_count,
    },
  });
}

export function emitTokenAlignmentUpdated(params: {
  correlation_id: string;
  drift_frames:   number;
  word_count:     number;
  rtl_segments:   number;
}): void {
  emitEvent({
    event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"info",
    payload:{
      action:       "TOKEN_ALIGNMENT_UPDATED",
      drift_frames: params.drift_frames,
      word_count:   params.word_count,
      rtl_segments: params.rtl_segments,
    },
  });
}

export function emitStreamFinalized(params: {
  correlation_id:  string;
  session_id:      string;
  chunks_received: number;
  chunks_inferred: number;
}): void {
  emitEvent({
    event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"info",
    payload:{
      action:          "STREAM_FINALIZED",
      session_id:      params.session_id,
      chunks_received: params.chunks_received,
      chunks_inferred: params.chunks_inferred,
    },
  });
}

// ── Telemetry Span ────────────────────────────────────────────────────────────

export async function recordInferenceSpan(
  transcript: ASRTranscript,
  latencyMs:  number,
): Promise<void> {
  try {
    await supabase.from("telemetry_spans").insert({
      span_type:     "INFERENCE",
      worker_type:   "asr_worker",
      correlation_id:transcript.correlation_id,
      status:        "completed",
      start_time:    new Date(Date.now() - latencyMs).toISOString(),
      metadata: {
        model_id:        transcript.model_id,
        backend:         transcript.backend,
        chunk_count:     transcript.chunk_count,
        output_checksum: transcript.output_checksum,
        protocol:        transcript.inference_protocol,
      },
    });
  } catch { /* silent */ }
}
