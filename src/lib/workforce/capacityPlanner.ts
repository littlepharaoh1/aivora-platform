/**
 * capacityPlanner.ts
 * Aivora Platform — Workforce Capacity Planner
 *
 * PURE, deterministic. Computes available hours, projected workload, and
 * overload risk from worker capacity + active assignments + observed turnaround.
 * No DB access — callers supply the data.
 */

import type { CapacityPlan, OverloadRisk } from "./workforceTypes";

export interface CapacityInput {
  reviewer_id:           string;
  weekly_capacity_hours: number;
  active_assignments:    number;     // assigned + in_progress
  avg_turnaround_sec:    number;     // from performanceEngine
}

// Default per-task estimate when a worker has no turnaround history yet.
// 30 minutes is a conservative neutral assumption for a single annotation task.
export const DEFAULT_TASK_SECONDS = 1800;

function riskFromUtilization(util: number): OverloadRisk {
  if(util <= 0.5)  return "none";
  if(util <= 0.75) return "low";
  if(util <= 1.0)  return "medium";
  if(util <= 1.25) return "high";
  return "critical";
}

export function computeCapacity(input: CapacityInput): CapacityPlan {
  const perTaskSec = input.avg_turnaround_sec > 0
    ? input.avg_turnaround_sec
    : DEFAULT_TASK_SECONDS;

  const projectedHours = (input.active_assignments * perTaskSec) / 3600;
  const capacity       = Math.max(0, input.weekly_capacity_hours);
  const utilization    = capacity > 0 ? projectedHours / capacity : (projectedHours > 0 ? Infinity : 0);
  const availableHours = capacity - projectedHours;

  return {
    reviewer_id:           input.reviewer_id,
    weekly_capacity_hours: capacity,
    active_assignments:    input.active_assignments,
    projected_hours:       Math.round(projectedHours * 100) / 100,
    utilization:           isFinite(utilization) ? Math.round(utilization * 1000) / 1000 : 999,
    overload_risk:         riskFromUtilization(utilization),
    available_hours:       Math.round(availableHours * 100) / 100,
  };
}

export function computeCapacityBatch(inputs: CapacityInput[]): CapacityPlan[] {
  return inputs.map(computeCapacity);
}

// ── Assignment suggestion — least-utilized worker with spare capacity ─────────
// Deterministic: lowest utilization, tie-break by reviewer_id.

export function suggestCapacityTarget(plans: CapacityPlan[]): CapacityPlan | null {
  const eligible = plans.filter(p => p.overload_risk !== "critical" && p.available_hours > 0);
  if(eligible.length === 0) return null;
  return [...eligible].sort((a, b) =>
    a.utilization !== b.utilization
      ? a.utilization - b.utilization
      : a.reviewer_id.localeCompare(b.reviewer_id)
  )[0];
}

// ── Team-level rollup ─────────────────────────────────────────────────────────

export interface TeamCapacity {
  total_capacity_hours:  number;
  total_projected_hours: number;
  team_utilization:      number;
  overloaded_count:      number;   // high + critical
  available_count:       number;   // workers with spare hours
}

export function computeTeamCapacity(plans: CapacityPlan[]): TeamCapacity {
  const totalCap  = plans.reduce((s, p) => s + p.weekly_capacity_hours, 0);
  const totalProj = plans.reduce((s, p) => s + p.projected_hours, 0);
  return {
    total_capacity_hours:  Math.round(totalCap * 100) / 100,
    total_projected_hours: Math.round(totalProj * 100) / 100,
    team_utilization:      totalCap > 0 ? Math.round((totalProj / totalCap) * 1000) / 1000 : 0,
    overloaded_count:      plans.filter(p => p.overload_risk === "high" || p.overload_risk === "critical").length,
    available_count:       plans.filter(p => p.available_hours > 0).length,
  };
}
