/**
 * emitter.ts — Deterministic Telemetry Emitter
 * Aivora Platform — Phase 4.1
 *
 * Rules:
 * - ALL writes: fire-and-forget (never awaited in hot paths)
 * - ALL writes: wrapped in try/catch (never throws)
 * - NO recursive telemetry (emitter never logs itself)
 * - NO PII (no audio, no transcripts, no tokens)
 * - Payload: max 4KB (enforced by DB trigger + client pre-check)
 * - Span metadata: max 2KB
 * - Event types: enum-safe constants only
 */

import { supabase } from "../supabase";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DSP_VERSION   = "3.1.0";
export const ROUTE_VERSION = "3.4.0";

const MAX_PAYLOAD_BYTES  = 4096;
const MAX_METADATA_BYTES = 2048;

// ── Event Type Taxonomy ───────────────────────────────────────────────────────

export type EventType =
  | "FILE_LOAD_STARTED"
  | "FILE_LOAD_COMPLETED"
  | "QC_ANALYSIS_COMPLETED"
  | "WORKER_STARTED"
  | "WORKER_COMPLETED"
  | "WORKER_TIMEOUT"
  | "WORKER_CRASHED"
  | "ROUTE_DECISION"
  | "LEASE_ACQUIRED"
  | "LEASE_EXPIRED"
  | "DLQ_MOVED"
  | "REPAIR_STARTED"
  | "REPAIR_COMPLETED"
  | "EXPORT_GENERATED"
  | "EXPORT_FAILED"
  | "INDEXEDDB_ENQUEUE"
  | "INDEXEDDB_REPLAY"
  | "INDEXEDDB_CORRUPTED"
  | "AUDIOCONTEXT_SUSPENDED"
  | "AUDIOCONTEXT_RESUMED"
  | "ADMIN_ACTION";

export type EventSource =
  | "qc_workstation"
  | "batch_analyzer"
  | "repair_pipeline"
  | "export_pipeline"
  | "routing_engine"
  | "offline_queue"
  | "audio_context"
  | "admin_panel"
  | "forensic_worker";

export type Severity = "debug" | "info" | "warn" | "error" | "critical";

export type SpanType =
  | "QC_ANALYSIS"
  | "FORENSIC_WORKER"
  | "REPAIR_PIPELINE"
  | "EXPORT_PIPELINE"
  | "QUEUE_REPLAY"
  | "ROUTING_EVALUATION";

export type WorkerType =
  | "SYNTHETIC"
  | "MIC"
  | "ROOM"
  | "ARTIFACT"
  | "STFT"
  | "SPECTROGRAM";

// ── Size Guard ────────────────────────────────────────────────────────────────

function safePayload(
  payload: Record<string, unknown>,
  maxBytes: number
): Record<string, unknown> {
  try {
    const size = new Blob([JSON.stringify(payload)]).size;
    if(size <= maxBytes) return payload;
    // Truncate to summary only
    return {
      _truncated: true,
      _original_size_bytes: size,
      _max_bytes: maxBytes,
    };
  } catch {
    return { _truncated: true, _error: "size_check_failed" };
  }
}

// ── Core Emit ────────────────────────────────────────────────────────────────

/**
 * Emit an operational event — fire-and-forget.
 * NEVER await this in hot paths.
 * NEVER call this from within a telemetry callback.
 */
export function emitEvent(params: {
  event_type:     EventType;
  event_source:   EventSource;
  correlation_id: string;
  user_id?:       string;
  severity?:      Severity;
  payload?:       Record<string, unknown>;
  route_version?: string;
  dsp_version?:   string;
}): void {
  // Fire-and-forget — never throws
  Promise.resolve().then(async () => {
    try {
      const payload = safePayload(
        params.payload ?? {},
        MAX_PAYLOAD_BYTES
      );
      await supabase.from("operational_events").insert({
        correlation_id: params.correlation_id,
        user_id:        params.user_id ?? null,
        event_type:     params.event_type,
        event_source:   params.event_source,
        severity:       params.severity ?? "info",
        payload,
        route_version:  params.route_version ?? null,
        dsp_version:    params.dsp_version   ?? DSP_VERSION,
      });
    } catch {
      // Silently swallow — telemetry must never crash runtime
    }
  });
}

// ── Span Tracking ─────────────────────────────────────────────────────────────

export interface SpanHandle {
  complete: (status?: "completed"|"timeout"|"crashed",
             metadata?: Record<string, unknown>) => void;
}

/**
 * Start a telemetry span — returns handle to complete it.
 * NEVER await startSpan() result in hot paths.
 */
export function startSpan(params: {
  correlation_id: string;
  span_type:      SpanType;
  worker_type?:   WorkerType;
  metadata?:      Record<string, unknown>;
}): SpanHandle {
  const startTime = new Date().toISOString();
  let spanId: string | null = null;

  // Insert span asynchronously
  Promise.resolve().then(async () => {
    try {
      const metadata = safePayload(
        params.metadata ?? {},
        MAX_METADATA_BYTES
      );
      const { data } = await supabase
        .from("telemetry_spans")
        .insert({
          correlation_id: params.correlation_id,
          span_type:      params.span_type,
          worker_type:    params.worker_type ?? null,
          start_time:     startTime,
          status:         "running",
          metadata,
        })
        .select("id")
        .single();
      if(data) spanId = data.id;
    } catch {
      // Silent — telemetry failure must not block execution
    }
  });

  return {
    complete(
      status:   "completed"|"timeout"|"crashed" = "completed",
      metadata: Record<string, unknown> = {}
    ) {
      Promise.resolve().then(async () => {
        try {
          if(!spanId) return;
          const safeMeta = safePayload(metadata, MAX_METADATA_BYTES);
          await supabase
            .from("telemetry_spans")
            .update({
              end_time: new Date().toISOString(),
              status,
              metadata: safeMeta,
            })
            .eq("id", spanId);
        } catch {
          // Silent
        }
      });
    },
  };
}

// ── Convenience Emitters ──────────────────────────────────────────────────────

/** File load lifecycle */
export const telemetry = {

  fileLoadStarted(correlationId: string, userId: string, fileName: string) {
    emitEvent({
      event_type:     "FILE_LOAD_STARTED",
      event_source:   "qc_workstation",
      correlation_id: correlationId,
      user_id:        userId,
      severity:       "info",
      payload:        { file_name: fileName },
      dsp_version:    DSP_VERSION,
    });
  },

  fileLoadCompleted(correlationId: string, userId: string, params: {
    fileName:   string;
    durationSec:number;
    sampleRate: number;
    channels:   number;
    fileSizeKb: number;
  }) {
    emitEvent({
      event_type:     "FILE_LOAD_COMPLETED",
      event_source:   "qc_workstation",
      correlation_id: correlationId,
      user_id:        userId,
      severity:       "info",
      payload:        params,
      dsp_version:    DSP_VERSION,
    });
  },

  qcAnalysisCompleted(correlationId: string, userId: string, params: {
    qc_score:    number;
    appen_score: number;
    duration_ms: number;
    problem_count:number;
  }) {
    emitEvent({
      event_type:     "QC_ANALYSIS_COMPLETED",
      event_source:   "qc_workstation",
      correlation_id: correlationId,
      user_id:        userId,
      severity:       "info",
      payload:        params,
      dsp_version:    DSP_VERSION,
    });
  },

  workerStarted(correlationId: string, workerType: WorkerType) {
    emitEvent({
      event_type:     "WORKER_STARTED",
      event_source:   "forensic_worker",
      correlation_id: correlationId,
      severity:       "debug",
      payload:        { worker_type: workerType },
    });
  },

  workerCompleted(correlationId: string, workerType: WorkerType, durationMs: number) {
    emitEvent({
      event_type:     "WORKER_COMPLETED",
      event_source:   "forensic_worker",
      correlation_id: correlationId,
      severity:       "info",
      payload:        { worker_type: workerType, duration_ms: durationMs },
    });
  },

  workerTimeout(correlationId: string, workerType: WorkerType) {
    emitEvent({
      event_type:     "WORKER_TIMEOUT",
      event_source:   "forensic_worker",
      correlation_id: correlationId,
      severity:       "warn",
      payload:        { worker_type: workerType },
    });
  },

  workerCrashed(correlationId: string, workerType: WorkerType, error: string) {
    emitEvent({
      event_type:     "WORKER_CRASHED",
      event_source:   "forensic_worker",
      correlation_id: correlationId,
      severity:       "error",
      payload:        { worker_type: workerType, error: error.slice(0, 200) },
    });
  },

  routeDecision(correlationId: string, userId: string, params: {
    routing_decision: string;
    reasons:          string[];
    routing_confidence:number;
    escalation_depth: number;
    route_version:    string;
  }) {
    emitEvent({
      event_type:     "ROUTE_DECISION",
      event_source:   "routing_engine",
      correlation_id: correlationId,
      user_id:        userId,
      severity:       "info",
      payload:        params,
      route_version:  params.route_version,
    });
  },

  repairStarted(correlationId: string, userId: string, operations: string[]) {
    emitEvent({
      event_type:     "REPAIR_STARTED",
      event_source:   "repair_pipeline",
      correlation_id: correlationId,
      user_id:        userId,
      severity:       "info",
      payload:        { operations },
    });
  },

  repairCompleted(correlationId: string, userId: string, params: {
    operations_count: number;
    duration_ms:      number;
    changed:          boolean;
  }) {
    emitEvent({
      event_type:     "REPAIR_COMPLETED",
      event_source:   "repair_pipeline",
      correlation_id: correlationId,
      user_id:        userId,
      severity:       "info",
      payload:        params,
    });
  },

  audioContextSuspended(correlationId: string) {
    emitEvent({
      event_type:     "AUDIOCONTEXT_SUSPENDED",
      event_source:   "audio_context",
      correlation_id: correlationId,
      severity:       "warn",
      payload:        { platform: navigator.userAgent.slice(0, 100) },
    });
  },

  audioContextResumed(correlationId: string) {
    emitEvent({
      event_type:     "AUDIOCONTEXT_RESUMED",
      event_source:   "audio_context",
      correlation_id: correlationId,
      severity:       "info",
      payload:        {},
    });
  },

  indexedDbCorrupted(idempotencyKey: string, reason: string) {
    emitEvent({
      event_type:     "INDEXEDDB_CORRUPTED",
      event_source:   "offline_queue",
      correlation_id: idempotencyKey,
      severity:       "error",
      payload:        { reason: reason.slice(0, 200) },
    });
  },
};
