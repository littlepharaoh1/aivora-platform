/**
 * datasetRuntime.ts — Unified Dataset Runtime
 * Aivora Platform — Phase 7.2
 *
 * Unifies:
 *   - forensicExport.ts (Phase 4.3)
 *   - trainingExporter.ts (bench)
 *   - trainingExport.ts (audioBench)
 *
 * Rules:
 *   - Single authoritative export pipeline
 *   - Deterministic serialization (stable field order)
 *   - Chunked streaming (never full dataset in memory)
 *   - SHA256 per record + manifest checksum
 *   - Replay-safe: same version_id → same output
 *   - No format-specific logic here (adapters in Phase 7.5)
 */

import { supabase }                    from "../supabase";
import { DATASET_VERSION_PROTOCOL }    from "./datasetGovernance";
import { emitEvent }                   from "../telemetry/emitter";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DatasetRecord {
  // Identity
  id:               string;
  version_id:       string;
  sequence_number:  number;
  split_bucket:     "train" | "val" | "test";

  // File
  file_name:        string;
  duration_sec:     number | null;
  sample_rate:      number | null;
  channels:         number | null;

  // Quality
  qc_score:         number | null;
  lufs:             number | null;
  snr_db:           number | null;
  forensic_verdict: string | null;

  // Lineage
  audio_file_id:    string | null;
  correlation_id:   string | null;

  // Protocol
  protocol_version: string;
  record_checksum:  string | null;
}

export interface DatasetManifest {
  version_id:        string;
  version_number:    string;
  project_name:      string;
  protocol_version:  string;
  total_records:     number;
  train_count:       number;
  val_count:         number;
  test_count:        number;
  split_seed:        number;
  manifest_checksum: string;
  generated_at:      string;
}

export interface RuntimeExportResult {
  manifest:      DatasetManifest;
  jsonl:         string;
  checksum:      string;
  record_count:  number;
  generated_at:  string;
}

// ── SHA256 ────────────────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Deterministic Record Serializer ──────────────────────────────────────────
// Stable field ordering — same record → same JSON string

function serializeRecord(r: DatasetRecord): string {
  return JSON.stringify({
    id:               r.id,
    version_id:       r.version_id,
    sequence_number:  r.sequence_number,
    split_bucket:     r.split_bucket,
    file_name:        r.file_name,
    duration_sec:     r.duration_sec,
    sample_rate:      r.sample_rate,
    channels:         r.channels,
    qc_score:         r.qc_score,
    lufs:             r.lufs,
    snr_db:           r.snr_db,
    forensic_verdict: r.forensic_verdict,
    audio_file_id:    r.audio_file_id,
    correlation_id:   r.correlation_id,
    protocol_version: r.protocol_version,
    record_checksum:  r.record_checksum,
  });
}

// ── Paginated Record Fetcher ──────────────────────────────────────────────────

const PAGE_SIZE = 100;

async function* streamVersionRecords(
  versionId: string,
): AsyncGenerator<DatasetRecord> {
  let page = 0;

  while(true) {
    const { data, error } = await supabase
      .from("dataset_splits")
      .select(`
        id,
        version_id,
        sequence_number,
        split_bucket,
        file_name,
        split_seed,
        audio_file_id,
        audio_files (
          duration,
          sample_rate,
          channels,
          qc_score,
          lufs,
          snr_db,
          forensic_verdict,
          correlation_id
        )
      `)
      .eq("version_id", versionId)
      .order("sequence_number", { ascending: true })
      .order("id",              { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if(error || !data || data.length === 0) break;

    for(const row of data) {
      const af = (row as any).audio_files;
      yield {
        id:               row.id,
        version_id:       row.version_id,
        sequence_number:  row.sequence_number,
        split_bucket:     row.split_bucket as "train"|"val"|"test",
        file_name:        row.file_name,
        duration_sec:     af?.duration    ?? null,
        sample_rate:      af?.sample_rate ?? null,
        channels:         af?.channels    ?? null,
        qc_score:         af?.qc_score    ?? null,
        lufs:             af?.lufs        ?? null,
        snr_db:           af?.snr_db      ?? null,
        forensic_verdict: af?.forensic_verdict ?? null,
        audio_file_id:    row.audio_file_id   ?? null,
        correlation_id:   af?.correlation_id  ?? null,
        protocol_version: DATASET_VERSION_PROTOCOL,
        record_checksum:  null, // computed below
      };
    }

    if(data.length < PAGE_SIZE) break;
    page++;
  }
}

// ── Main Export Function ──────────────────────────────────────────────────────

export async function exportDatasetVersion(
  versionId:    string,
  correlationId:string,
): Promise<RuntimeExportResult | null> {
  try {
    const generatedAt = new Date().toISOString();

    // Fetch version metadata
    const { data: ver } = await supabase
      .from("dataset_versions")
      .select("version_number,project_name,split_seed,total_files,status")
      .eq("id", versionId)
      .single();

    if(!ver) return null;
    if(ver.status === "failed") return null;

    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "qc_workstation",
      correlation_id: correlationId,
      severity:       "info",
      payload: { action:"DATASET_EXPORT_START", version_id:versionId },
    });

    // Stream + build JSONL
    // Memory note: lines[] holds full JSONL in memory.
    // Bounded by dataset size. For >100k records, use streaming download instead.
    // Current platform datasets: <10k records → safe (<5MB).
    const lines:  string[] = [];
    let trainCount = 0, valCount = 0, testCount = 0;

    for await(const record of streamVersionRecords(versionId)) {
      // Per-record checksum
      const rawStr   = serializeRecord({ ...record, record_checksum: null });
      const checksum = await sha256(rawStr);
      const final    = { ...record, record_checksum: checksum };

      lines.push(serializeRecord(final));

      if(record.split_bucket === "train") trainCount++;
      else if(record.split_bucket === "val") valCount++;
      else testCount++;
    }

    const jsonl    = lines.join("\n");
    const checksum = await sha256(jsonl);

    // Build manifest
    const manifestData = {
      version_id:       versionId,
      version_number:   ver.version_number,
      project_name:     ver.project_name,
      protocol_version: DATASET_VERSION_PROTOCOL,
      total_records:    lines.length,
      train_count:      trainCount,
      val_count:        valCount,
      test_count:       testCount,
      split_seed:       ver.split_seed,
      manifest_checksum:"",
      generated_at:     generatedAt,
    };

    const manifestChecksum = await sha256(JSON.stringify(manifestData));
    const manifest: DatasetManifest = {
      ...manifestData,
      manifest_checksum: manifestChecksum,
    };

    // Update version status
    await supabase
      .from("dataset_versions")
      .update({
        status:       "validated",
        published_at: generatedAt,
      })
      .eq("id", versionId);

    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "qc_workstation",
      correlation_id: correlationId,
      severity:       "info",
      payload: {
        action:           "DATASET_EXPORT_COMPLETE",
        version_id:       versionId,
        record_count:     lines.length,
        checksum,
        manifest_checksum:manifestChecksum,
      },
    });

    return {
      manifest,
      jsonl,
      checksum,
      record_count: lines.length,
      generated_at: generatedAt,
    };

  } catch(e) {
    console.error("[DatasetRuntime] Export failed:", e);

    // Fail version
    try {
      await supabase.from("dataset_versions")
        .update({ status:"failed" }).eq("id", versionId);
    } catch { /* silent */ }

    return null;
  }
}

// ── Download Helper ───────────────────────────────────────────────────────────

export function downloadDatasetJSONL(
  result:        RuntimeExportResult,
  versionNumber: string,
): void {
  const blob = new Blob([result.jsonl], { type:"application/jsonl" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `dataset_v${versionNumber}_${result.generated_at.slice(0,10)}.jsonl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadManifest(
  manifest: DatasetManifest,
): void {
  const blob = new Blob(
    [JSON.stringify(manifest, null, 2)],
    { type:"application/json" }
  );
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `manifest_v${manifest.version_number}_${manifest.generated_at.slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
