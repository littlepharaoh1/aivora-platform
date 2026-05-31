/**
 * projectService.ts
 * Aivora Platform — Project Management Service
 *
 * CRUD for projects, members, tasks. Every mutating action records an
 * immutable audit event. Offline-safe via mutationQueue.
 * Reuses: supabase, recordAudit, mutationQueue.
 */

import { supabase }        from "../supabase";
import { enqueueMutation } from "../offline/mutationQueue";
import { recordAudit }     from "./auditService";
import { AIVORA_TO_PROJECT_ROLE } from "./projectTypes";
import type {
  Project, ProjectMember, ProjectRole, ProjectStatus,
  MemberWorkload,
} from "./projectTypes";
import type { AivoraRole } from "../auth/permissions";

interface Actor { id: string; email: string; }

// ── Projects ──────────────────────────────────────────────────────────────────

export async function createProject(
  actor:       Actor,
  name:        string,
  description: string,
  deadline:    string | null,
): Promise<Project | null> {
  const row = {
    owner_id:    actor.id,
    name,
    description,
    status:      "active" as ProjectStatus,
    deadline,
    task_count:      0,
    completed_count: 0,
  };

  try {
    const { data, error } = await supabase
      .from("pm_projects").insert(row).select().single();
    if(error) throw error;

    await recordAudit({
      project_id:  data.id,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "PROJECT_CREATED",
      target_type: "project",
      target_id:   data.id,
      metadata:    { name },
    });
    return data as Project;
  } catch {
    await enqueueMutation({
      mutation_type:  "project_insert",
      correlation_id: actor.id,
      payload:        row as unknown as Record<string, unknown>,
    });
    return null;
  }
}

export async function updateProject(
  actor:   Actor,
  id:      string,
  patch:   Partial<Pick<Project, "name"|"description"|"deadline"|"status"|"dataset_version_id">>,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("pm_projects").update(patch).eq("id", id);
    if(error) throw error;
    await recordAudit({
      project_id:  id,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      patch.status === "archived" ? "PROJECT_ARCHIVED" : "PROJECT_UPDATED",
      target_type: "project",
      target_id:   id,
      metadata:    patch as Record<string, unknown>,
    });
    return true;
  } catch {
    await enqueueMutation({
      mutation_type:  "project_update",
      correlation_id: id,
      payload:        { id, ...patch } as Record<string, unknown>,
    });
    return false;
  }
}

export async function fetchProjects(): Promise<Project[]> {
  const { data } = await supabase
    .from("pm_projects").select("*")
    .order("created_at", { ascending: false }).limit(100);
  return (data ?? []) as Project[];
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function addMember(
  actor:      Actor,
  projectId:  string,
  userId:     string,
  email:      string,
  role:       ProjectRole,
): Promise<ProjectMember | null> {
  const row = { project_id: projectId, user_id: userId, email, role };
  try {
    const { data, error } = await supabase
      .from("pm_members").insert(row).select().single();
    if(error) throw error;
    await recordAudit({
      project_id:  projectId,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "MEMBER_ADDED",
      target_type: "member",
      target_id:   userId,
      metadata:    { email, role },
    });
    return data as ProjectMember;
  } catch {
    await enqueueMutation({
      mutation_type:  "member_insert",
      correlation_id: projectId,
      payload:        row as unknown as Record<string, unknown>,
    });
    return null;
  }
}

export async function changeMemberRole(
  actor:     Actor,
  projectId: string,
  memberId:  string,
  userId:    string,
  newRole:   ProjectRole,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("pm_members").update({ role: newRole }).eq("id", memberId);
    if(error) throw error;
    await recordAudit({
      project_id:  projectId,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "MEMBER_ROLE_CHANGED",
      target_type: "member",
      target_id:   userId,
      metadata:    { new_role: newRole },
    });
    return true;
  } catch {
    return false;
  }
}

export async function removeMember(
  actor:     Actor,
  projectId: string,
  memberId:  string,
  userId:    string,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("pm_members").delete().eq("id", memberId);
    if(error) throw error;
    await recordAudit({
      project_id:  projectId,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "MEMBER_REMOVED",
      target_type: "member",
      target_id:   userId,
      metadata:    {},
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchMembers(projectId: string): Promise<ProjectMember[]> {
  const { data } = await supabase
    .from("pm_members").select("*")
    .eq("project_id", projectId)
    .order("added_at", { ascending: true });
  return (data ?? []) as ProjectMember[];
}

// Map a platform AivoraRole to its project-level role (reuse, no parallel system).
export function projectRoleFromAivora(role: AivoraRole): ProjectRole {
  return AIVORA_TO_PROJECT_ROLE[role] ?? "viewer";
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
// Reuses the existing task_assignments table. The PM layer adds project scoping
// and audit. task_assignments columns: id, reviewer_id, audio_file_id, status,
// assigned_at, completed_at, routing_decision.

import type { ProjectTask, TaskStatus } from "./projectTypes";

export async function createTask(
  actor:     Actor,
  projectId: string,
  title:     string,
  priority:  "low" | "medium" | "high" = "medium",
  dueAt:     string | null = null,
): Promise<ProjectTask | null> {
  const id  = crypto.randomUUID();
  const now = new Date().toISOString();
  const task: ProjectTask = {
    id, project_id: projectId, title,
    status: "pending", assignee_id: null, assignee_email: "",
    priority, created_at: now, due_at: dueAt,
  };

  // Persisted via task_assignments (existing table) keyed by project metadata.
  const row = {
    id,
    reviewer_id:      null,
    audio_file_id:    null,
    status:           "pending",
    assigned_at:      now,
    routing_decision: JSON.stringify({ project_id: projectId, title, priority, due_at: dueAt }),
  };

  try {
    const { error } = await supabase.from("task_assignments").insert(row);
    if(error) throw error;
    await recordAudit({
      project_id:  projectId,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "TASK_CREATED",
      target_type: "task",
      target_id:   id,
      metadata:    { title, priority },
    });
    return task;
  } catch {
    await enqueueMutation({
      mutation_type:  "processing_job_insert",
      correlation_id: projectId,
      payload:        row as unknown as Record<string, unknown>,
    });
    return task;
  }
}

export async function assignTask(
  actor:        Actor,
  projectId:    string,
  taskId:       string,
  assigneeId:   string,
  assigneeEmail:string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("task_assignments")
      .update({ reviewer_id: assigneeId, status: "assigned" })
      .eq("id", taskId);
    if(error) throw error;
    await recordAudit({
      project_id:  projectId,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      "TASK_ASSIGNED",
      target_type: "task",
      target_id:   taskId,
      metadata:    { assignee: assigneeEmail },
    });
    return true;
  } catch {
    return false;
  }
}

export async function changeTaskStatus(
  actor:     Actor,
  projectId: string,
  taskId:    string,
  status:    TaskStatus,
): Promise<boolean> {
  const completed_at = status === "completed" ? new Date().toISOString() : null;
  try {
    const { error } = await supabase
      .from("task_assignments")
      .update({ status, ...(completed_at ? { completed_at } : {}) })
      .eq("id", taskId);
    if(error) throw error;
    await recordAudit({
      project_id:  projectId,
      actor_id:    actor.id,
      actor_email: actor.email,
      action:      status === "completed" ? "TASK_COMPLETED" : "TASK_STATUS_CHANGED",
      target_type: "task",
      target_id:   taskId,
      metadata:    { status },
    });
    return true;
  } catch {
    return false;
  }
}

// ── Workload balancing ────────────────────────────────────────────────────────
// Pure function: given members and their tasks, compute per-member load and
// suggest the least-loaded eligible member. Deterministic.

export function computeWorkloads(
  members: ProjectMember[],
  tasks:   ProjectTask[],
): MemberWorkload[] {
  return members.map(m => {
    const mine        = tasks.filter(t => t.assignee_id === m.user_id);
    const assigned    = mine.filter(t => t.status === "assigned").length;
    const in_progress = mine.filter(t => t.status === "in_progress").length;
    const completed   = mine.filter(t => t.status === "completed").length;
    return {
      user_id:      m.user_id,
      email:        m.email,
      role:         m.role,
      assigned,
      in_progress,
      completed,
      total_active: assigned + in_progress,
    };
  });
}

// Suggest the least-loaded member who can annotate (annotator/reviewer/manager/admin).
// Deterministic tie-break: lowest total_active, then alphabetical email.
export function suggestAssignee(
  workloads: MemberWorkload[],
): MemberWorkload | null {
  const eligible = workloads.filter(w =>
    w.role === "annotator" || w.role === "reviewer" ||
    w.role === "manager"   || w.role === "admin"
  );
  if(eligible.length === 0) return null;
  return [...eligible].sort((a, b) =>
    a.total_active !== b.total_active
      ? a.total_active - b.total_active
      : a.email.localeCompare(b.email)
  )[0];
}
