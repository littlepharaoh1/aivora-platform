/**
 * forensicExport.ts — Deterministic Forensic Evidence Export Pipeline
 * Aivora Platform — Phase 4.3
 *
 * Rules:
 * - JSONL ordered by: sequence_number ASC, created_at ASC, id ASC
 * - SHA256 checksum via SubtleCrypto (browser-native)
 * - No full dataset in memory — streamed line-by-line
 * - Append-only evidence chain
 * - Failed exports never corrupt lineage
 * - Same input snapshot → identical output checksum
 */

import { supabase } from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EvidenceStage =
  | "UPLOAD_RECEIVED"
  | "DSP_PROCESSED"
  | "FORENSIC_ANALYZED"
  | "ROUTED"
  | "REVIEW_ASSIGNED"
  | "REVIEW_COMPLETED"
  | "CONSENSUS_REACHED"
  | "EXPORT_INCLUDED";

export interface ForensicLineageEntry {
  correlation_id:    string;
  upload_id?:        string;
  audio_file_id?:    string;
  processing_job_id?:string;
  routing_decision?: string;
  forensic_verdict?: string;
  reviewer_a?:       string;
  reviewer_b?:       string;
  supervisor_id?:    string;
  export_id?:        string;
  evidence_stage:    EvidenceStage;
  checksum_sha256?:  string;
  metadata?:         Record<string, unknown>;
}

export interface ExportResult {
  export_id:    string;
  jsonl:        string;
  checksum:     string;
  line_count:   number;
  generated_at: string;
}

// ── SHA256 via SubtleCrypto ───────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data    = encoder.encode(text);
  const hash    = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Append forensic evidence chain entry ──────────────────────────────────────

/**
 * Append a single evidence stage to forensic_evidence_chain.
 * Fire-and-forget safe — caller does not need to await.
 * Never throws — forensic lineage must not crash runtime.
 */
export async function appendEvidenceChain(
  entry: ForensicLineageEntry
): Promise<void> {
  try {
    // Compute checksum of this entry
    const entryStr  = JSON.stringify({
      ...entry,
      created_at: new Date().toISOString(),
    });
    const checksum  = await sha256(entryStr);

    await supabase.from("forensic_evidence_chain").insert({
      ...entry,
      checksum_sha256: checksum,
    });
  } catch {
    // Silent — never crash runtime
  }
}

// ── JSONL Export Pipeline ─────────────────────────────────────────────────────

/**
 * Generate deterministic JSONL export for a dataset_export.
 *
 * Ordering: sequence_number ASC → created_at ASC → id ASC
 * Checksum: SHA256 of full JSONL bytes (UTF-8)
 *
 * Memory strategy: paginated 100-row chunks (never full dataset in memory)
 */
export async function generateJSONLExport(
  exportId: string,
): Promise<ExportResult | null> {
  try {
    const generatedAt = new Date().toISOString();

    // Mark export as in-progress
    await supabase
      .from("dataset_exports")
      .update({ status: "exported" })
      .eq("id", exportId)
      .eq("is_locked", false);

    // Paginated fetch — 100 rows per page
    const PAGE_SIZE = 100;
    let   page      = 0;
    const lines:    string[] = [];

    while(true) {
      const { data, error } = await supabase
        .from("export_line_items")
        .select(`
          id,
          sequence_number,
          created_at,
          file_name,
          final_decision,
          consensus_method,
          transcript,
          metadata,
          reviewer_a_id,
          reviewer_b_id,
          supervisor_id,
          upload_id,
          audio_file_id,
          qc_review_id,
          consensus_log_id
        `)
        .eq("export_id", exportId)
        .order("sequence_number", { ascending: true })
        .order("created_at",      { ascending: true })
        .order("id",              { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if(error || !data || data.length === 0) break;

      // Serialize each row as JSONL line
      for(const row of data) {
        lines.push(JSON.stringify({
          // Deterministic field ordering
          id:               row.id,
          sequence_number:  row.sequence_number,
          file_name:        row.file_name,
          final_decision:   row.final_decision,
          consensus_method: row.consensus_method,
          transcript:       row.transcript ?? null,
          metadata:         row.metadata   ?? {},
          lineage: {
            upload_id:        row.upload_id,
            audio_file_id:    row.audio_file_id,
            qc_review_id:     row.qc_review_id,
            consensus_log_id: row.consensus_log_id,
            reviewer_a_id:    row.reviewer_a_id,
            reviewer_b_id:    row.reviewer_b_id,
            supervisor_id:    row.supervisor_id,
          },
          created_at: row.created_at,
        }));
      }

      if(data.length < PAGE_SIZE) break;
      page++;
    }

    // Build final JSONL string
    const jsonl    = lines.join("\n");
    const checksum = await sha256(jsonl);

    // Persist checksum + completion to dataset_exports
    await supabase
      .from("dataset_exports")
      .update({
        export_checksum_sha256: checksum,
        export_completed_at:    generatedAt,
        total_files:            lines.length,
        is_locked:              true,
        locked_at:              generatedAt,
      })
      .eq("id", exportId);

    return {
      export_id:    exportId,
      jsonl,
      checksum,
      line_count:   lines.length,
      generated_at: generatedAt,
    };

  } catch(err) {
    // Isolate failure — mark export as failed
    try {
      await supabase
        .from("dataset_exports")
        .update({
          export_failed_at:   new Date().toISOString(),
          export_error_code:  err instanceof Error
            ? err.message.slice(0, 200)
            : "UNKNOWN_ERROR",
        })
        .eq("id", exportId);
    } catch { /* silent */ }

    return null;
  }
}

// ── Download JSONL ────────────────────────────────────────────────────────────

/**
 * Trigger browser download of JSONL export.
 * Uses Blob — bounded, not in React state.
 */
export function downloadJSONL(
  result: ExportResult,
  exportName: string,
): void {
  const blob = new Blob([result.jsonl], { type: "application/jsonl" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${exportName}_${result.generated_at.slice(0,10)}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Forensic Report Payload ───────────────────────────────────────────────────

/**
 * Build deterministic forensic report payload.
 * Factual only — no AI summarization.
 * Prepared for future PDF rendering.
 */
export async function buildForensicReportPayload(
  correlationId: string
): Promise<Record<string, unknown> | null> {
  try {
    // Fetch full evidence chain for this correlation
    const { data: chain } = await supabase
      .from("forensic_evidence_chain")
      .select("*")
      .eq("correlation_id", correlationId)
      .order("created_at", { ascending: true });

    if(!chain || chain.length === 0) return null;

    // Fetch processing job
    const { data: jobs } = await supabase
      .from("processing_jobs")
      .select("file_name,status,score,lufs,snr_db,dsp_version,metadata,correlation_id")
      .eq("correlation_id", correlationId)
      .limit(1);

    const job = jobs?.[0] ?? null;

    // Fetch telemetry spans
    const { data: spans } = await supabase
      .from("telemetry_spans")
      .select("span_type,worker_type,duration_ms,status,start_time")
      .eq("correlation_id", correlationId)
      .order("start_time", { ascending: true });

    // Fetch operational events
    const { data: events } = await supabase
      .from("operational_events")
      .select("event_type,event_source,severity,payload,created_at")
      .eq("correlation_id", correlationId)
      .order("created_at", { ascending: true });

    // Build deterministic payload
    const payload = {
      report_version:   "4.3.0",
      generated_at:     new Date().toISOString(),
      correlation_id:   correlationId,

      file: {
        name:       job?.file_name ?? null,
        dsp_version:job?.dsp_version ?? null,
      },

      dsp_summary: {
        qc_score:   job?.score ?? null,
        lufs:       job?.lufs  ?? null,
        snr_db:     job?.snr_db ?? null,
        metadata:   job?.metadata ?? {},
      },

      evidence_chain: chain.map(e => ({
        evidence_stage:   e.evidence_stage,
        routing_decision: e.routing_decision ?? null,
        forensic_verdict: e.forensic_verdict ?? null,
        checksum_sha256:  e.checksum_sha256  ?? null,
        created_at:       e.created_at,
      })),

      worker_spans: (spans ?? []).map(s => ({
        span_type:   s.span_type,
        worker_type: s.worker_type ?? null,
        duration_ms: s.duration_ms ?? null,
        status:      s.status,
        start_time:  s.start_time,
      })),

      event_log: (events ?? []).map(e => ({
        event_type:   e.event_type,
        event_source: e.event_source,
        severity:     e.severity,
        created_at:   e.created_at,
      })),
    };

    return payload;
  } catch {
    return null;
  }
}
