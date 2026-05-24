/**
 * useQAIntelligence.ts — QA Intelligence Data Hooks
 * Aivora Platform — Phase 13
 * ALL data from authoritative DB. Bounded queries. No fake KPIs.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";

// ── Reviewer List ─────────────────────────────────────────────────────────────

export interface ReviewerRow {
  id:           string;
  name:         string;
  email:        string;
  status:       string;
  tier:         string | null;
  total_reviews:number;
  accuracy_rate:number | null;
  created_at:   string;
}

export function useReviewers() {
  const [data,    setData]    = useState<ReviewerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("reviewers")
        .select("id,name,email,status,tier,total_reviews,accuracy_rate,created_at")
        .order("total_reviews", { ascending: false })
        .limit(100);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── QC Reviews ────────────────────────────────────────────────────────────────

export interface QCReviewRow {
  id:            string;
  audio_file_id: string | null;
  reviewer_id:   string | null;
  qc_score:      number | null;
  verdict:       string | null;
  status:        string | null;
  review_time_sec:number | null;
  created_at:    string;
}

export function useRecentQCReviews(limit = 50) {
  const [data,    setData]    = useState<QCReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("qc_reviews")
        .select("id,audio_file_id,reviewer_id,qc_score,verdict,status,review_time_sec,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, [limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── Consensus Log ─────────────────────────────────────────────────────────────

export interface ConsensusRow {
  id:              string;
  audio_file_id:   string | null;
  consensus_score: number | null;
  verdict:         string | null;
  reviewer_count:  number | null;
  escalated:       boolean | null;
  created_at:      string;
}

export function useConsensusLog(limit = 50) {
  const [data,    setData]    = useState<ConsensusRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("consensus_log")
        .select("id,audio_file_id,consensus_score,verdict,reviewer_count,escalated,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, [limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── Task Assignments ──────────────────────────────────────────────────────────

export interface TaskAssignmentRow {
  id:            string;
  reviewer_id:   string | null;
  audio_file_id: string | null;
  status:        string | null;
  assigned_at:   string;
  completed_at:  string | null;
  routing_decision:string | null;
}

export function useTaskAssignments(limit = 50) {
  const [data,    setData]    = useState<TaskAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("task_assignments")
        .select("id,reviewer_id,audio_file_id,status,assigned_at,completed_at,routing_decision")
        .order("assigned_at", { ascending: false })
        .limit(limit);
      setData(rows ?? []);
    } finally { setLoading(false); }
  }, [limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { data, loading, refresh: fetch };
}

// ── QA Summary Stats ──────────────────────────────────────────────────────────

export interface QASummary {
  total_reviews:       number;
  total_reviewers:     number;
  mean_qc_score:       number;
  escalation_rate:     number;
  consensus_rate:      number;
  pending_tasks:       number;
}

export function useQASummary() {
  const [summary,  setSummary]  = useState<QASummary | null>(null);
  const [loading,  setLoading]  = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [reviews, reviewers, tasks, consensus] = await Promise.all([
        supabase.from("qc_reviews").select("qc_score", { count:"exact" }).limit(1),
        supabase.from("reviewers").select("id",         { count:"exact" }).limit(1),
        supabase.from("task_assignments")
          .select("status", { count:"exact" }).eq("status","pending").limit(1),
        supabase.from("consensus_log")
          .select("consensus_score,escalated").limit(200),
      ]);

      const cl = consensus.data ?? [];
      const meanScore = cl.length
        ? cl.reduce((s,r) => s + (r.consensus_score ?? 0), 0) / cl.length : 0;
      const escRate = cl.length
        ? cl.filter(r => r.escalated).length / cl.length : 0;

      setSummary({
        total_reviews:    reviews.count   ?? 0,
        total_reviewers:  reviewers.count ?? 0,
        mean_qc_score:    Math.round(meanScore * 10) / 10,
        escalation_rate:  Math.round(escRate * 1000) / 10,
        consensus_rate:   cl.length > 0
          ? Math.round(cl.filter(r => !r.escalated).length / cl.length * 100) : 0,
        pending_tasks:    tasks.count ?? 0,
      });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { summary, loading, refresh: fetch };
}
