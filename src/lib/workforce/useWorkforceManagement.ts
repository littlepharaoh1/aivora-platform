/**
 * useWorkforceManagement.ts
 * Aivora Platform — Workforce Management Hook
 *
 * Composes the workforce service (DB) with the 5 pure engines, reusing the
 * existing QA reviewer/assignment data. Produces ready-to-render workforce state.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "../../hooks/useAuth";
import {
  fetchWorkerIdentities, fetchCapabilities, fetchSkills,
  upsertCapabilities, setSkill, validateSkill, assembleWorkers,
} from "./workerService";
import {
  computePerformanceBatch,
} from "./performanceEngine";
import type { AssignmentRow, ReviewerStats } from "./performanceEngine";
import {
  computeCapacityBatch, computeTeamCapacity, suggestCapacityTarget,
} from "./capacityPlanner";
import {
  assessFraudBatch,
} from "./fraudDetection";
import type { WorkerActivity } from "./fraudDetection";
import {
  computeTrends,
} from "./workforceAnalytics";
import { supabase } from "../supabase";
import type {
  Worker, WorkerSkill, PerformanceMetrics, CapacityPlan,
  FraudAssessment, WorkforceTrends, SkillType, Availability,
} from "./workforceTypes";

export function useWorkforceManagement() {
  const { user } = useAuth();
  const actor = { id: user?.id ?? "", email: user?.email ?? "" };

  const [workers,     setWorkers]     = useState<Worker[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading,     setLoading]     = useState(false);

  // ── Load: identities + caps + skills + assignments (reuse existing tables) ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [identities, caps, skills, asgRes] = await Promise.all([
        fetchWorkerIdentities(),
        fetchCapabilities(),
        fetchSkills(),
        supabase.from("task_assignments")
          .select("id,reviewer_id,status,assigned_at,completed_at")
          .limit(5000),
      ]);
      setWorkers(assembleWorkers(identities, caps, skills));
      setAssignments((asgRes.data ?? []) as AssignmentRow[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived: run engines over loaded data (memoized, deterministic) ─────────
  const reviewerIds = useMemo(() => workers.map(w => w.identity.id), [workers]);

  const statsById = useMemo(() => {
    const m = new Map<string, ReviewerStats>();
    for(const w of workers) {
      m.set(w.identity.id, {
        id:                  w.identity.id,
        total_reviews:       w.identity.total_reviews,
        total_agreements:    w.identity.total_agreements,
        total_disagreements: w.identity.total_disagreements,
        accuracy_score:      w.identity.accuracy_score,
      });
    }
    return m;
  }, [workers]);

  const performance: PerformanceMetrics[] = useMemo(
    () => computePerformanceBatch(reviewerIds, assignments, statsById),
    [reviewerIds, assignments, statsById],
  );

  const perfById = useMemo(
    () => new Map(performance.map(p => [p.reviewer_id, p])),
    [performance],
  );

  // Active assignments per worker (assigned + in_progress)
  const activeCountById = useMemo(() => {
    const m = new Map<string, number>();
    for(const a of assignments) {
      if(!a.reviewer_id) continue;
      if(a.status === "assigned" || a.status === "in_progress") {
        m.set(a.reviewer_id, (m.get(a.reviewer_id) ?? 0) + 1);
      }
    }
    return m;
  }, [assignments]);

  const capacity: CapacityPlan[] = useMemo(
    () => computeCapacityBatch(workers.map(w => ({
      reviewer_id:           w.identity.id,
      weekly_capacity_hours: w.capabilities?.weekly_capacity_hours ?? 40,
      active_assignments:    activeCountById.get(w.identity.id) ?? 0,
      avg_turnaround_sec:    perfById.get(w.identity.id)?.avg_turnaround_sec ?? 0,
    }))),
    [workers, activeCountById, perfById],
  );

  const teamCapacity = useMemo(() => computeTeamCapacity(capacity), [capacity]);

  // Fraud: build activity from identity counters (advisory)
  const fraud: FraudAssessment[] = useMemo(() => {
    const activities: WorkerActivity[] = workers.map(w => {
      const turnaround = perfById.get(w.identity.id)?.avg_turnaround_sec ?? 0;
      const total = w.identity.total_reviews || 1;
      return {
        reviewer_id:    w.identity.id,
        turnaround_secs: turnaround > 0 ? [turnaround] : [],
        output_hashes:  [],   // hashes not available from counters; speed+agreement drive it
        agreement_rate: total > 0 ? w.identity.total_agreements / total : 0,
        sample_size:    w.identity.total_reviews,
      };
    });
    return assessFraudBatch(activities);
  }, [workers, perfById]);

  const names = useMemo(
    () => Object.fromEntries(workers.map(w => [w.identity.id, w.identity.name])),
    [workers],
  );

  const activeWorkerCount = useMemo(
    () => workers.filter(w => w.identity.is_active).length,
    [workers],
  );

  const trends: WorkforceTrends = useMemo(
    () => computeTrends(performance, fraud, names, activeWorkerCount),
    [performance, fraud, names, activeWorkerCount],
  );

  const capacitySuggestion = useMemo(() => suggestCapacityTarget(capacity), [capacity]);

  // ── Actions (DB writes, audited) ────────────────────────────────────────────
  const actSetSkill = useCallback(async (
    reviewerId: string, skillType: SkillType, proficiency: number,
  ) => {
    const ok = await setSkill(actor, reviewerId, skillType, proficiency);
    if(ok) await load();
    return ok;
  }, [actor, load]);

  const actValidateSkill = useCallback(async (skill: WorkerSkill) => {
    const ok = await validateSkill(actor, skill.id, skill.reviewer_id, skill.skill_type, skill.validation_count);
    if(ok) await load();
    return ok;
  }, [actor, load]);

  const actSetCapabilities = useCallback(async (caps: {
    reviewer_id: string; languages: string[]; certifications: string[];
    availability: Availability; weekly_capacity_hours: number; timezone: string; notes: string;
  }) => {
    const ok = await upsertCapabilities(actor, caps);
    if(ok) await load();
    return ok;
  }, [actor, load]);

  return {
    // state
    workers, assignments, loading,
    // engine outputs
    performance, perfById, capacity, teamCapacity, fraud, trends, capacitySuggestion,
    // actions
    load, actSetSkill, actValidateSkill, actSetCapabilities,
  };
}
