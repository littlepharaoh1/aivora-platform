/**
 * useAnalyticsData.ts — Analytics Data Hooks
 * Aivora Platform — Phase 10
 *
 * ALL data from materialized views ONLY.
 * Paginated + time-windowed queries.
 * NO hot-table scans. NO fake data.
 * Same DB snapshot → same dashboard output.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";

// ── Time Window ───────────────────────────────────────────────────────────────

export type TimeWindow = "7d" | "30d" | "90d";

export function getDateFrom(window: TimeWindow): string {
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── DSP Execution Timing ──────────────────────────────────────────────────────

export interface DSPTimingRow {
  execution_date:  string;
  span_type:       string;
  worker_type:     string;
  total_spans:     number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  timeout_count:   number;
  crash_count:     number;
  timeout_rate_pct:number;
}

export function useDSPTiming(window: TimeWindow = "30d") {
  const [data,    setData]    = useState<DSPTimingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows, error: err } = await supabase
        .from("dsp_execution_timing")
        .select("*")
        .gte("execution_date", getDateFrom(window))
        .order("execution_date", { ascending: true })
        .limit(500);
      if(err) throw err;
      setData(rows ?? []);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally { setLoading(false); }
  }, [window]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, error, refresh: fetch };
}

// ── Forensic Verdict Distribution ─────────────────────────────────────────────

export interface VerdictRow {
  verdict_date:    string;
  project_name:    string;
  forensic_verdict:string;
  file_count:      number;
  avg_qc_score:    number;
}

export function useForensicVerdicts(window: TimeWindow = "30d") {
  const [data,    setData]    = useState<VerdictRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows, error: err } = await supabase
        .from("forensic_verdict_distribution")
        .select("*")
        .gte("verdict_date", getDateFrom(window))
        .order("verdict_date", { ascending: true })
        .limit(500);
      if(err) throw err;
      setData(rows ?? []);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally { setLoading(false); }
  }, [window]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, error, refresh: fetch };
}

// ── Routing Decision Distribution ─────────────────────────────────────────────

export interface RoutingRow {
  decision_date:   string;
  routing_decision:string;
  decision_count:  number;
  avg_confidence:  number;
}

export function useRoutingDecisions(window: TimeWindow = "30d") {
  const [data,    setData]    = useState<RoutingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("routing_decision_distribution")
        .select("*")
        .gte("decision_date", getDateFrom(window))
        .order("decision_date", { ascending: true })
        .limit(500);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, [window]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── Reviewer Throughput ───────────────────────────────────────────────────────

export interface ReviewerThroughputRow {
  reviewer_name:         string;
  review_date:           string;
  reviews_completed:     number;
  avg_review_seconds:    number;
  escalation_rate_pct:   number;
  reassignment_rate_pct: number;
}

export function useReviewerThroughput(window: TimeWindow = "30d") {
  const [data,    setData]    = useState<ReviewerThroughputRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("reviewer_throughput_daily")
        .select("reviewer_name,review_date,reviews_completed,avg_review_seconds,escalation_rate_pct,reassignment_rate_pct")
        .gte("review_date", getDateFrom(window))
        .order("review_date", { ascending: true })
        .limit(500);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, [window]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── Fraud Heatmap ─────────────────────────────────────────────────────────────

export interface FraudHeatmapRow {
  reviewer_name:     string;
  reviewer_email:    string;
  fraud_flags_count: number;
  accuracy_score:    number;
  consensus_score:   number;
  fraud_risk_level:  string;
  total_reviews:     number;
  disagreement_rate_pct: number;
}

export function useFraudHeatmap() {
  const [data,    setData]    = useState<FraudHeatmapRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("fraud_heatmap")
        .select("reviewer_name,reviewer_email,fraud_flags_count,accuracy_score,consensus_score,fraud_risk_level,total_reviews,disagreement_rate_pct")
        .order("fraud_flags_count", { ascending: false })
        .limit(100);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── Queue Retry Analytics ─────────────────────────────────────────────────────

export interface QueueRetryRow {
  job_date:           string;
  job_type:           string;
  total_jobs:         number;
  completed_jobs:     number;
  failed_jobs:        number;
  dlq_jobs:           number;
  avg_retry_count:    number;
  expired_lease_count:number;
}

export function useQueueRetry(window: TimeWindow = "30d") {
  const [data,    setData]    = useState<QueueRetryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("queue_retry_analytics")
        .select("*")
        .gte("job_date", getDateFrom(window))
        .order("job_date", { ascending: true })
        .limit(500);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, [window]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}
