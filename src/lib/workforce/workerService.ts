/**
 * workerService.ts
 * Aivora Platform — Workforce Service (DB layer)
 *
 * CRUD for worker_capabilities + worker_skills. Reads identity from the
 * existing `reviewers` table. Every mutation records an audit event via the
 * existing auditService. Offline-safe via mutationQueue.
 */

import { supabase }        from "../supabase";
import { enqueueMutation } from "../offline/mutationQueue";
import { recordAudit }     from "../projects/auditService";
import { SKILL_TYPES }     from "./workforceTypes";
import type {
  WorkerCapabilities, WorkerSkill, WorkerIdentity, Worker,
  SkillType, Availability,
} from "./workforceTypes";

interface Actor { id: string; email: string; }

// ── Identity (read from existing reviewers) ───────────────────────────────────

export async function fetchWorkerIdentities(limit = 1000): Promise<WorkerIdentity[]> {
  const { data } = await supabase
    .from("reviewers")
    .select("*")
    .order("total_reviews", { ascending: false })
    .limit(limit);
  return (data ?? []) as WorkerIdentity[];
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export async function fetchCapabilities(): Promise<WorkerCapabilities[]> {
  const { data } = await supabase.from("worker_capabilities").select("*");
  return (data ?? []) as WorkerCapabilities[];
}

export async function upsertCapabilities(
  actor:   Actor,
  caps: {
    reviewer_id:           string;
    languages:             string[];
    certifications:        string[];
    availability:          Availability;
    weekly_capacity_hours: number;
    timezone:              string;
    notes:                 string;
  },
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("worker_capabilities")
      .upsert(caps, { onConflict: "reviewer_id" });
    if(error) throw error;
    await recordAudit({
      project_id:  null,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "MEMBER_ROLE_CHANGED",   // reuse closest existing audit action
      target_type: "worker_capabilities",
      target_id:   caps.reviewer_id,
      metadata:    { availability: caps.availability, capacity: caps.weekly_capacity_hours },
    });
    return true;
  } catch {
    await enqueueMutation({
      mutation_type:  "activity_log_insert",
      correlation_id: caps.reviewer_id,
      payload:        caps as unknown as Record<string, unknown>,
    });
    return false;
  }
}

// ── Skills ────────────────────────────────────────────────────────────────────

export async function fetchSkills(): Promise<WorkerSkill[]> {
  const { data } = await supabase.from("worker_skills").select("*");
  return (data ?? []) as WorkerSkill[];
}

export async function setSkill(
  actor:       Actor,
  reviewerId:  string,
  skillType:   SkillType,
  proficiency: number,
): Promise<boolean> {
  const clamped = Math.max(0, Math.min(1, proficiency));
  try {
    const { error } = await supabase
      .from("worker_skills")
      .upsert(
        { reviewer_id: reviewerId, skill_type: skillType, proficiency: clamped },
        { onConflict: "reviewer_id,skill_type" },
      );
    if(error) throw error;
    await recordAudit({
      project_id:  null,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "MEMBER_ROLE_CHANGED",
      target_type: "worker_skill",
      target_id:   `${reviewerId}:${skillType}`,
      metadata:    { skill: skillType, proficiency: clamped },
    });
    return true;
  } catch {
    await enqueueMutation({
      mutation_type:  "activity_log_insert",
      correlation_id: reviewerId,
      payload:        { reviewer_id: reviewerId, skill_type: skillType, proficiency: clamped },
    });
    return false;
  }
}

// Validate a skill: bump validation_count + stamp time. Records audit.
export async function validateSkill(
  actor:      Actor,
  skillId:    string,
  reviewerId: string,
  skillType:  SkillType,
  currentCount: number,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("worker_skills")
      .update({ validation_count: currentCount + 1, last_validated_at: new Date().toISOString() })
      .eq("id", skillId);
    if(error) throw error;
    await recordAudit({
      project_id:  null,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "REVIEW_APPROVED",
      target_type: "worker_skill",
      target_id:   `${reviewerId}:${skillType}`,
      metadata:    { validation_count: currentCount + 1 },
    });
    return true;
  } catch {
    return false;
  }
}

// ── Join identity + capabilities + skills into full Worker objects ────────────

export function assembleWorkers(
  identities:   WorkerIdentity[],
  capabilities: WorkerCapabilities[],
  skills:       WorkerSkill[],
): Worker[] {
  const capByReviewer   = new Map(capabilities.map(c => [c.reviewer_id, c]));
  const skillsByReviewer= new Map<string, WorkerSkill[]>();
  for(const s of skills) {
    const arr = skillsByReviewer.get(s.reviewer_id) ?? [];
    arr.push(s);
    skillsByReviewer.set(s.reviewer_id, arr);
  }

  return identities.map(identity => ({
    identity,
    capabilities: capByReviewer.get(identity.id) ?? null,
    skills:       skillsByReviewer.get(identity.id) ?? [],
  }));
}

// Skill-matrix coverage helper: which of the 6 skills a worker has (>0 proficiency)
export function skillCoverage(skills: WorkerSkill[]): Record<SkillType, number> {
  const cov = {} as Record<SkillType, number>;
  for(const t of SKILL_TYPES) cov[t] = 0;
  for(const s of skills) cov[s.skill_type] = s.proficiency;
  return cov;
}
