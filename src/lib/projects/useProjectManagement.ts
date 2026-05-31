/**
 * useProjectManagement.ts
 * Aivora Platform — Project Management Hook
 *
 * Combines projectService + audit + RBAC. Exposes project state and guarded
 * actions to the UI. Determines the caller's project role from membership,
 * falling back to the platform ROLE_MAP (reuse, no parallel role system).
 */

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_MAP } from "../auth/adminAllowlist";
import {
  fetchProjects, createProject, updateProject,
  fetchMembers, addMember, changeMemberRole, removeMember,
  createTask, assignTask, changeTaskStatus,
  computeWorkloads, suggestAssignee, projectRoleFromAivora,
} from "./projectService";
import { fetchAuditTrail } from "./auditService";
import { roleCan } from "./projectTypes";
import type {
  Project, ProjectMember, ProjectTask, ProjectRole,
  ProjectCapability, AuditEvent, MemberWorkload,
} from "./projectTypes";
import type { AivoraRole } from "../auth/permissions";

export function useProjectManagement() {
  const { user } = useAuth();
  const actor = { id: user?.id ?? "", email: user?.email ?? "" };

  const [projects, setProjects] = useState<Project[]>([]);
  const [members,  setMembers]  = useState<ProjectMember[]>([]);
  const [tasks,    setTasks]    = useState<ProjectTask[]>([]);
  const [audit,    setAudit]    = useState<AuditEvent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  // ── Determine the caller's role within the active project ───────────────────
  const myMembership = members.find(m => m.user_id === actor.id);
  const platformRole: AivoraRole =
    (ROLE_MAP[actor.email] as AivoraRole) ?? "client_viewer";
  const myRole: ProjectRole =
    myMembership?.role ?? projectRoleFromAivora(platformRole);

  const can = useCallback(
    (cap: ProjectCapability) => roleCan(myRole, cap),
    [myRole],
  );

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try { setProjects(await fetchProjects()); }
    finally { setLoading(false); }
  }, []);

  const openProject = useCallback(async (projectId: string) => {
    setActiveId(projectId);
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        fetchMembers(projectId),
        fetchAuditTrail(projectId),
      ]);
      setMembers(m);
      setAudit(a);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // ── Guarded actions ───────────────────────────────────────────────────────-
  const actNewProject = useCallback(async (
    name: string, description: string, deadline: string | null,
  ) => {
    if(!can("manage_project")) return null;
    const p = await createProject(actor, name, description, deadline);
    if(p) await loadProjects();
    return p;
  }, [actor, can, loadProjects]);

  const actArchiveProject = useCallback(async (id: string) => {
    if(!can("manage_project")) return false;
    const ok = await updateProject(actor, id, { status: "archived" });
    if(ok) await loadProjects();
    return ok;
  }, [actor, can, loadProjects]);

  const actAddMember = useCallback(async (
    userId: string, email: string, role: ProjectRole,
  ) => {
    if(!activeId || !can("manage_project")) return null;
    const m = await addMember(actor, activeId, userId, email, role);
    if(m) await openProject(activeId);
    return m;
  }, [actor, activeId, can, openProject]);

  const actChangeMemberRole = useCallback(async (
    memberId: string, userId: string, role: ProjectRole,
  ) => {
    if(!activeId || !can("manage_project")) return false;
    const ok = await changeMemberRole(actor, activeId, memberId, userId, role);
    if(ok) await openProject(activeId);
    return ok;
  }, [actor, activeId, can, openProject]);

  const actRemoveMember = useCallback(async (memberId: string, userId: string) => {
    if(!activeId || !can("manage_project")) return false;
    const ok = await removeMember(actor, activeId, memberId, userId);
    if(ok) await openProject(activeId);
    return ok;
  }, [actor, activeId, can, openProject]);

  const actCreateTask = useCallback(async (
    title: string, priority: "low"|"medium"|"high", dueAt: string | null,
  ) => {
    if(!activeId || !can("assign_tasks")) return null;
    const t = await createTask(actor, activeId, title, priority, dueAt);
    if(t) setTasks(prev => [t, ...prev]);
    return t;
  }, [actor, activeId, can]);

  const actAssignTask = useCallback(async (
    taskId: string, assigneeId: string, assigneeEmail: string,
  ) => {
    if(!activeId || !can("assign_tasks")) return false;
    const ok = await assignTask(actor, activeId, taskId, assigneeId, assigneeEmail);
    if(ok) {
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, assignee_id: assigneeId, assignee_email: assigneeEmail, status: "assigned" }
          : t
      ));
      await openProject(activeId);
    }
    return ok;
  }, [actor, activeId, can, openProject]);

  const actChangeTaskStatus = useCallback(async (
    taskId: string, status: ProjectTask["status"],
  ) => {
    if(!activeId) return false;
    // annotators can move their own tasks; reviewers/managers can change any
    if(!can("annotate")) return false;
    const ok = await changeTaskStatus(actor, activeId, taskId, status);
    if(ok) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    return ok;
  }, [actor, activeId, can]);

  // ── Derived ───────────────────────────────────────────────────────────────-
  const workloads: MemberWorkload[] = computeWorkloads(members, tasks);
  const activeProject = projects.find(p => p.id === activeId) ?? null;

  return {
    // state
    projects, members, tasks, audit, workloads,
    activeId, activeProject, loading,
    myRole, can,
    // loaders
    loadProjects, openProject, setTasks,
    // actions
    actNewProject, actArchiveProject,
    actAddMember, actChangeMemberRole, actRemoveMember,
    actCreateTask, actAssignTask, actChangeTaskStatus,
    // helpers
    suggestAssignee,
  };
}
