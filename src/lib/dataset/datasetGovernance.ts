/**
 * datasetGovernance.ts — Dataset Governance Core
 * Aivora Platform — Phase 7.1
 *
 * Rules:
 *   - DATASET_VERSION_PROTOCOL = "7.0.0"
 *   - Splits: deterministic (seeded Fisher-Yates)
 *   - Snapshots: append-only, SHA256
 *   - Quality gates: threshold-based, no ML
 *   - Same seed + same files → same splits forever
 */

import { supabase }  from "../supabase";
import { emitEvent } from "../telemetry/emitter";

export const DATASET_VERSION_PROTOCOL = "7.0.0";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QualityGateConfig {
  gate_name:              string;
  project_name?:          string;
  min_qc_score:           number;
  min_duration_sec:       number;
  max_duration_sec:       number;
  min_snr_db:             number;
  max_lufs:               number;
  min_lufs:               number;
  allowed_verdicts:       string[];
  reject_synthetic:       boolean;
  min_reviewer_consensus: number;
}

export interface SplitConfig {
  seed:        number;
  train_ratio: number;
  val_ratio:   number;
  test_ratio:  number;
}

export type SplitBucket = "train" | "val" | "test";

export interface FileForSplit {
  id:        string;
  file_name: string;
}

export interface SplitAssignment {
  file:   FileForSplit;
  bucket: SplitBucket;
  seq:    number;
}

export interface DatasetVersionInput {
  project_name:    string;
  version_number:  string;
  export_id?:      string;
  quality_gate_id?:string;
  split:           SplitConfig;
  file_count:      number;
  total_duration:  number;
}

// ── Deterministic Split Engine ────────────────────────────────────────────────
// Fisher-Yates with seeded LCG PRNG
// Same seed + same files → identical split every time

function lcgRandom(seed: number): () => number {
  // LCG parameters (Numerical Recipes)
  const A = 1664525;
  const C = 1013904223;
  const M = 2 ** 32;
  let state = seed >>> 0;
  return () => {
    state = (A * state + C) & (M - 1);
    return state / M;
  };
}

export function computeDeterministicSplits(
  files:  FileForSplit[],
  config: SplitConfig,
): SplitAssignment[] {
  if(files.length === 0) return [];

  // Validate ratios sum to 1.0
  const total = config.train_ratio + config.val_ratio + config.test_ratio;
  if(Math.abs(total - 1.0) > 0.001) {
    throw new Error(`Split ratios must sum to 1.0, got ${total}`);
  }

  const rand = lcgRandom(config.seed);

  // Sort first for deterministic input order
  const sorted = [...files].sort((a, b) => a.id.localeCompare(b.id));

  // Fisher-Yates shuffle with seeded PRNG
  const shuffled = [...sorted];
  for(let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Assign buckets
  const n         = shuffled.length;
  const nTrain    = Math.round(n * config.train_ratio);
  const nVal      = Math.round(n * config.val_ratio);

  return shuffled.map((file, idx) => ({
    file,
    bucket: idx < nTrain ? "train"
          : idx < nTrain + nVal ? "val"
          : "test",
    seq: idx,
  }));
}

// ── Quality Gate Evaluator ────────────────────────────────────────────────────

export interface FileQualityMetrics {
  qc_score?:          number;
  duration_sec?:      number;
  snr_db?:            number;
  lufs?:              number;
  forensic_verdict?:  string;
  reviewer_consensus?:number;
}

export interface QualityGateResult {
  passed:  boolean;
  reasons: string[];
}

export function evaluateQualityGate(
  metrics: FileQualityMetrics,
  gate:    QualityGateConfig,
): QualityGateResult {
  const reasons: string[] = [];

  if(metrics.qc_score !== undefined && metrics.qc_score < gate.min_qc_score)
    reasons.push(`qc_score ${metrics.qc_score} < ${gate.min_qc_score}`);

  if(metrics.duration_sec !== undefined) {
    if(metrics.duration_sec < gate.min_duration_sec)
      reasons.push(`duration ${metrics.duration_sec}s < ${gate.min_duration_sec}s`);
    if(metrics.duration_sec > gate.max_duration_sec)
      reasons.push(`duration ${metrics.duration_sec}s > ${gate.max_duration_sec}s`);
  }

  if(metrics.snr_db !== undefined && metrics.snr_db < gate.min_snr_db)
    reasons.push(`snr ${metrics.snr_db}dB < ${gate.min_snr_db}dB`);

  if(metrics.lufs !== undefined) {
    if(metrics.lufs > gate.max_lufs)
      reasons.push(`lufs ${metrics.lufs} > ${gate.max_lufs}`);
    if(metrics.lufs < gate.min_lufs)
      reasons.push(`lufs ${metrics.lufs} < ${gate.min_lufs}`);
  }

  if(metrics.forensic_verdict && !gate.allowed_verdicts.includes(metrics.forensic_verdict))
    reasons.push(`verdict ${metrics.forensic_verdict} not in allowed list`);

  if(gate.reject_synthetic && metrics.forensic_verdict === "SYNTHETIC")
    reasons.push("synthetic audio rejected");

  if(metrics.reviewer_consensus !== undefined &&
     metrics.reviewer_consensus < gate.min_reviewer_consensus)
    reasons.push(`consensus ${metrics.reviewer_consensus} < ${gate.min_reviewer_consensus}`);

  return { passed: reasons.length === 0, reasons };
}

// ── SHA256 ────────────────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Dataset Version Creator ───────────────────────────────────────────────────

export async function createDatasetVersion(
  input:       DatasetVersionInput,
  splits:      SplitAssignment[],
  corrId:      string,
): Promise<string | null> {
  try {
    // Compute snapshot checksum
    const snapshotStr = JSON.stringify({
      project_name:   input.project_name,
      version_number: input.version_number,
      split_seed:     input.split.seed,
      file_count:     input.file_count,
      protocol:       DATASET_VERSION_PROTOCOL,
    });
    const checksum = await sha256(snapshotStr);

    // Insert version
    const { data: ver, error: verErr } = await supabase
      .from("dataset_versions")
      .insert({
        project_name:       input.project_name,
        version_number:     input.version_number,
        version_protocol:   DATASET_VERSION_PROTOCOL,
        snapshot_checksum:  checksum,
        total_files:        input.file_count,
        total_duration_sec: input.total_duration,
        split_seed:         input.split.seed,
        split_train_ratio:  input.split.train_ratio,
        split_val_ratio:    input.split.val_ratio,
        split_test_ratio:   input.split.test_ratio,
        quality_gate_id:    input.quality_gate_id ?? null,
        export_id:          input.export_id ?? null,
        status:             "draft",
      })
      .select("id")
      .single();

    if(verErr || !ver) {
      console.error("[DatasetGovernance] Version create failed:", verErr);
      return null;
    }

    // Insert splits in chunks
    const CHUNK = 100;
    for(let i = 0; i < splits.length; i += CHUNK) {
      const chunk = splits.slice(i, i + CHUNK).map(s => ({
        version_id:      ver.id,
        audio_file_id:   s.file.id || null,
        file_name:       s.file.file_name,
        split_bucket:    s.bucket,
        sequence_number: s.seq,
        split_seed:      input.split.seed,
        split_version:   DATASET_VERSION_PROTOCOL,
      }));
      await supabase.from("dataset_splits").insert(chunk);
    }

    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "qc_workstation",
      correlation_id: corrId,
      severity:       "info",
      payload: {
        action:          "DATASET_VERSION_CREATED",
        version_id:      ver.id,
        version_number:  input.version_number,
        project_name:    input.project_name,
        file_count:      input.file_count,
        snapshot_checksum: checksum,
      },
    });

    return ver.id;
  } catch(e) {
    console.error("[DatasetGovernance] createDatasetVersion failed:", e);
    return null;
  }
}

// ── Quality Gate CRUD ─────────────────────────────────────────────────────────

export async function createQualityGate(
  config: QualityGateConfig
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("quality_gates")
      .insert(config)
      .select("id")
      .single();
    if(error) { console.error("[QualityGate] Create failed:", error); return null; }
    return data.id;
  } catch { return null; }
}

export async function getQualityGate(
  gateId: string
): Promise<QualityGateConfig | null> {
  try {
    const { data } = await supabase
      .from("quality_gates")
      .select("*")
      .eq("id", gateId)
      .single();
    return data as QualityGateConfig ?? null;
  } catch { return null; }
}
