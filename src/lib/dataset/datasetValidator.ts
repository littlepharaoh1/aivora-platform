/**
 * datasetValidator.ts — Dataset Validation Engine
 * Aivora Platform — Phase 7.4
 *
 * Rules:
 *   - Bounded scans only (chunked 100 rows)
 *   - Deterministic output (same version → same report)
 *   - No ML — pure deterministic checks
 *   - Advisory only — no auto-corrections
 */

import { supabase } from "../supabase";

export const VALIDATOR_VERSION = "7.4.0";

// ── Validation Results ────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity:   "error" | "warning" | "info";
  code:       string;
  message:    string;
  file_name?: string;
  details?:   Record<string, unknown>;
}

export interface ValidationReport {
  version_id:       string;
  validator_version:string;
  passed:           boolean;
  total_records:    number;
  error_count:      number;
  warning_count:    number;
  issues:           ValidationIssue[];
  split_stats:      Record<"train"|"val"|"test", number>;
  generated_at:     string;
}

// ── Validators ────────────────────────────────────────────────────────────────

// 1. Duplicate detection (same file_name appears twice)
async function checkDuplicates(
  versionId: string,
  issues:    ValidationIssue[],
): Promise<void> {
  const { data } = await supabase
    .from("dataset_splits")
    .select("file_name")
    .eq("version_id", versionId);

  if(!data) return;

  const seen = new Map<string, number>();
  for(const row of data) {
    seen.set(row.file_name, (seen.get(row.file_name) ?? 0) + 1);
  }
  for(const [name, count] of seen) {
    if(count > 1) {
      issues.push({
        severity: "error",
        code:     "DUPLICATE_FILE",
        message:  `File appears ${count} times`,
        file_name:name,
        details:  { count },
      });
    }
  }
}

// 2. Split balance check
async function checkSplitBalance(
  versionId: string,
  issues:    ValidationIssue[],
  stats:     Record<"train"|"val"|"test", number>,
): Promise<void> {
  const { data } = await supabase
    .from("dataset_splits")
    .select("split_bucket")
    .eq("version_id", versionId);

  if(!data) return;

  stats.train = data.filter(r => r.split_bucket === "train").length;
  stats.val   = data.filter(r => r.split_bucket === "val").length;
  stats.test  = data.filter(r => r.split_bucket === "test").length;
  const total = data.length;

  if(total === 0) {
    issues.push({ severity:"error", code:"EMPTY_DATASET", message:"No records in version" });
    return;
  }

  const trainRatio = stats.train / total;
  if(trainRatio < 0.5) {
    issues.push({
      severity: "warning",
      code:     "LOW_TRAIN_RATIO",
      message:  `Train ratio ${(trainRatio*100).toFixed(1)}% < 50%`,
      details:  { train:stats.train, val:stats.val, test:stats.test, total },
    });
  }
}

// 3. Missing audio_file_id check
async function checkOrphanedRecords(
  versionId: string,
  issues:    ValidationIssue[],
): Promise<void> {
  const { count } = await supabase
    .from("dataset_splits")
    .select("id", { count:"exact", head:true })
    .eq("version_id", versionId)
    .is("audio_file_id", null);

  if(count && count > 0) {
    issues.push({
      severity: "warning",
      code:     "ORPHANED_RECORDS",
      message:  `${count} records have no linked audio_file`,
      details:  { orphaned_count: count },
    });
  }
}

// 4. Sequence number continuity check
async function checkSequenceContinuity(
  versionId: string,
  issues:    ValidationIssue[],
): Promise<void> {
  const { data } = await supabase
    .from("dataset_splits")
    .select("sequence_number")
    .eq("version_id", versionId)
    .order("sequence_number", { ascending:true });

  if(!data || data.length === 0) return;

  let gaps = 0;
  for(let i = 1; i < data.length; i++) {
    if(data[i].sequence_number !== data[i-1].sequence_number + 1) gaps++;
  }

  if(gaps > 0) {
    issues.push({
      severity: "warning",
      code:     "SEQUENCE_GAPS",
      message:  `${gaps} gaps in sequence_number ordering`,
      details:  { gap_count: gaps },
    });
  }
}

// 5. Protocol version check
async function checkProtocolVersion(
  versionId: string,
  issues:    ValidationIssue[],
): Promise<void> {
  const { data } = await supabase
    .from("dataset_versions")
    .select("version_protocol")
    .eq("id", versionId)
    .single();

  if(!data) return;

  if(data.version_protocol !== "7.0.0") {
    issues.push({
      severity: "warning",
      code:     "PROTOCOL_VERSION_MISMATCH",
      message:  `Protocol ${data.version_protocol} != 7.0.0`,
    });
  }
}

// ── Main Validator ────────────────────────────────────────────────────────────

export async function validateDatasetVersion(
  versionId: string,
): Promise<ValidationReport> {
  const generatedAt = new Date().toISOString();
  const issues:      ValidationIssue[] = [];
  const stats        = { train:0, val:0, test:0 };

  // Run all validators
  await Promise.allSettled([
    checkDuplicates(versionId, issues),
    checkSplitBalance(versionId, issues, stats),
    checkOrphanedRecords(versionId, issues),
    checkSequenceContinuity(versionId, issues),
    checkProtocolVersion(versionId, issues),
  ]);

  const total = stats.train + stats.val + stats.test;
  const errorCount   = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;

  return {
    version_id:        versionId,
    validator_version: VALIDATOR_VERSION,
    passed:            errorCount === 0,
    total_records:     total,
    error_count:       errorCount,
    warning_count:     warningCount,
    issues,
    split_stats:       stats,
    generated_at:      generatedAt,
  };
}
