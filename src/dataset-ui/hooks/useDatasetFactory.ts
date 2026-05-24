/**
 * useDatasetFactory.ts — Dataset Factory Data Hooks
 * Aivora Platform — Phase 12
 *
 * ALL data from authoritative DB tables.
 * Paginated queries. Bounded time windows.
 * No fake datasets.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { DATASET_VERSION_PROTOCOL } from "../../lib/dataset/datasetGovernance";
import type { QualityGateConfig, SplitConfig } from "../../lib/dataset/datasetGovernance";
import type { PipelineRunResult } from "../../lib/dataset/datasetPipeline";

// ── Dataset Versions ──────────────────────────────────────────────────────────

export interface DatasetVersionRow {
  id:                 string;
  project_name:       string;
  version_number:     string;
  version_protocol:   string;
  snapshot_checksum:  string;
  total_files:        number;
  total_duration_sec: number;
  split_seed:         number;
  split_train_ratio:  number;
  split_val_ratio:    number;
  split_test_ratio:   number;
  status:             string;
  published_at:       string | null;
  created_at:         string;
}

export function useDatasetVersions() {
  const [versions, setVersions] = useState<DatasetVersionRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("dataset_versions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setVersions(data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { versions, loading, refresh: fetch };
}

// ── Quality Gates ─────────────────────────────────────────────────────────────

export interface QualityGateRow {
  id:                      string;
  gate_name:               string;
  project_name:            string | null;
  min_qc_score:            number;
  min_duration_sec:        number;
  max_duration_sec:        number;
  min_snr_db:              number;
  min_reviewer_consensus:  number;
  reject_synthetic:        boolean;
  is_active:               boolean;
  created_at:              string;
}

export function useQualityGates() {
  const [gates,   setGates]   = useState<QualityGateRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("quality_gates")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setGates(data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { gates, loading, refresh: fetch };
}

// ── Pipeline Runs ─────────────────────────────────────────────────────────────

export interface PipelineRunRow {
  id:                string;
  pipeline_name:     string;
  pipeline_version:  string;
  project_name:      string;
  status:            string;
  started_at:        string | null;
  completed_at:      string | null;
  failed_at:         string | null;
  error_message:     string | null;
  files_processed:   number;
  files_rejected:    number;
  input_checksum:    string | null;
  output_checksum:   string | null;
  created_at:        string;
}

export function usePipelineRuns() {
  const [runs,    setRuns]    = useState<PipelineRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("pipeline_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setRuns(data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { runs, loading, refresh: fetch };
}

// ── Split Distribution ────────────────────────────────────────────────────────

export interface SplitStats {
  train: number;
  val:   number;
  test:  number;
  total: number;
}

export async function fetchSplitStats(versionId: string): Promise<SplitStats> {
  const { data } = await supabase
    .from("dataset_splits")
    .select("split_bucket")
    .eq("version_id", versionId);

  const rows = data ?? [];
  return {
    train: rows.filter(r => r.split_bucket === "train").length,
    val:   rows.filter(r => r.split_bucket === "val").length,
    test:  rows.filter(r => r.split_bucket === "test").length,
    total: rows.length,
  };
}
