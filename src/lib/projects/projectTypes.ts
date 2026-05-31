/**
 * projectTypes.ts
 * Aivora Platform — Enterprise Project Management Layer
 */

import type { AivoraRole } from "../auth/permissions";

export const PROJECT_MGMT_VERSION = "16.0.0";

export type ProjectRole =
  | "admin" | "manager" | "reviewer" | "annotator" | "viewer";

export const PROJECT_ROLES: ProjectRole[] = [
  "admin", "manager", "reviewer", "annotator", "viewer",
];

export const AIVORA_TO_PROJECT_ROLE: Record<AivoraRole, ProjectRole> = {
  owner:         "admin",
  admin:         "admin",
  manager:       "manager",
  qa_manager:    "manager",
  qa_reviewer:   "reviewer",
  operator:      "annotator",
  contributor:   "annotator",
  client_viewer: "viewer",
};

export type ProjectCapability =
  | "manage_project" | "assign_tasks" | "review" | "annotate" | "view";

export const ROLE_CAPABILITIES: Record<ProjectRole, ProjectCapability[]> = {
  admin:     ["manage_project", "assign_tasks", "review", "annotate", "view"],
  manager:   ["assign_tasks", "review", "annotate", "view"],
  reviewer:  ["review", "annotate", "view"],
  annotator: ["annotate", "view"],
  viewer:    ["view"],
};

export function roleCan(role: ProjectRole, cap: ProjectCapability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(cap) ?? false;
}

export const ROLE_COLORS: Record<ProjectRole, string> = {
  admin:"#ef4444", manager:"#f59e0b", reviewer:"#a855f7",
  annotator:"#22d3ee", viewer:"#6b7280",
};

export type ProjectStatus = "active" | "archived" | "completed";

export interface Project {
  id:                 string;
  owner_id:           string;
  name:               string;
  description:        string;
  status:             ProjectStatus;
  deadline:           string | null;
  dataset_version_id: string | null;
  task_count:         number;
  completed_count:    number;
  created_at:         string;
  updated_at:         string;
}

export interface ProjectMember {
  id:         string;
  project_id: string;
  user_id:    string;
  email:      string;
  role:       ProjectRole;
  added_at:   string;
}

export type TaskStatus =
  | "pending" | "assigned" | "in_progress"
  | "in_review" | "completed" | "rejected";

export const TASK_STATUSES: TaskStatus[] = [
  "pending", "assigned", "in_progress", "in_review", "completed", "rejected",
];

export interface ProjectTask {
  id:            string;
  project_id:    string;
  title:         string;
  status:        TaskStatus;
  assignee_id:   string | null;
  assignee_email:string;
  priority:      "low" | "medium" | "high";
  created_at:    string;
  due_at:        string | null;
}

export type AuditAction =
  | "PROJECT_CREATED" | "PROJECT_UPDATED" | "PROJECT_ARCHIVED"
  | "MEMBER_ADDED" | "MEMBER_REMOVED" | "MEMBER_ROLE_CHANGED"
  | "TASK_CREATED" | "TASK_ASSIGNED" | "TASK_STATUS_CHANGED"
  | "TASK_COMPLETED" | "REVIEW_APPROVED" | "REVIEW_REJECTED";

export interface AuditEvent {
  id:          string;
  project_id:  string | null;
  actor_id:    string;
  actor_email: string;
  action:      AuditAction;
  target_type: string;
  target_id:   string;
  metadata:    Record<string, unknown>;
  checksum:    string;
  created_at:  string;
}

export interface MemberWorkload {
  user_id:      string;
  email:        string;
  role:         ProjectRole;
  assigned:     number;
  in_progress:  number;
  completed:    number;
  total_active: number;
}
