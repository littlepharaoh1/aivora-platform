/**
 * projectService.test.ts
 * Aivora Platform — Project Management pure-logic tests
 * (workload balancing + role mapping)
 */

import { describe, it, expect } from "vitest";
import { computeWorkloads, suggestAssignee } from "../src/lib/projects/projectService";
import { roleCan, AIVORA_TO_PROJECT_ROLE } from "../src/lib/projects/projectTypes";
import type { ProjectMember, ProjectTask, MemberWorkload } from "../src/lib/projects/projectTypes";

function member(id: string, role: ProjectMember["role"], email = `${id}@x.com`): ProjectMember {
  return { id:`m-${id}`, project_id:"p1", user_id:id, email, role, added_at:"2025-01-01" };
}

function task(assignee: string|null, status: ProjectTask["status"]): ProjectTask {
  return {
    id:crypto.randomUUID(), project_id:"p1", title:"t",
    status, assignee_id:assignee, assignee_email:"", priority:"medium",
    created_at:"2025-01-01", due_at:null,
  };
}

// ── Role mapping ──────────────────────────────────────────────────────────────

describe("AIVORA_TO_PROJECT_ROLE", () => {
  it("maps all 8 platform roles to a project role", () => {
    const roles = Object.values(AIVORA_TO_PROJECT_ROLE);
    expect(roles).toHaveLength(8);
    roles.forEach(r => {
      expect(["admin","manager","reviewer","annotator","viewer"]).toContain(r);
    });
  });

  it("maps owner+admin to admin", () => {
    expect(AIVORA_TO_PROJECT_ROLE.owner).toBe("admin");
    expect(AIVORA_TO_PROJECT_ROLE.admin).toBe("admin");
  });

  it("maps client_viewer to viewer", () => {
    expect(AIVORA_TO_PROJECT_ROLE.client_viewer).toBe("viewer");
  });
});

describe("roleCan", () => {
  it("admin can manage project", () => {
    expect(roleCan("admin", "manage_project")).toBe(true);
  });
  it("viewer cannot annotate", () => {
    expect(roleCan("viewer", "annotate")).toBe(false);
  });
  it("annotator can annotate but not review", () => {
    expect(roleCan("annotator", "annotate")).toBe(true);
    expect(roleCan("annotator", "review")).toBe(false);
  });
  it("everyone can view", () => {
    (["admin","manager","reviewer","annotator","viewer"] as const).forEach(r =>
      expect(roleCan(r, "view")).toBe(true)
    );
  });
});

// ── computeWorkloads ──────────────────────────────────────────────────────────

describe("computeWorkloads", () => {
  it("counts per-member task states", () => {
    const members = [member("u1","annotator"), member("u2","annotator")];
    const tasks = [
      task("u1","assigned"), task("u1","in_progress"), task("u1","completed"),
      task("u2","assigned"),
    ];
    const w = computeWorkloads(members, tasks);
    const u1 = w.find(x=>x.user_id==="u1")!;
    expect(u1.assigned).toBe(1);
    expect(u1.in_progress).toBe(1);
    expect(u1.completed).toBe(1);
    expect(u1.total_active).toBe(2); // assigned + in_progress
    const u2 = w.find(x=>x.user_id==="u2")!;
    expect(u2.total_active).toBe(1);
  });

  it("handles members with no tasks", () => {
    const w = computeWorkloads([member("u1","annotator")], []);
    expect(w[0].total_active).toBe(0);
  });
});

// ── suggestAssignee ───────────────────────────────────────────────────────────

describe("suggestAssignee", () => {
  it("picks least-loaded eligible member", () => {
    const wl: MemberWorkload[] = [
      { user_id:"u1", email:"a@x.com", role:"annotator", assigned:3, in_progress:0, completed:0, total_active:3 },
      { user_id:"u2", email:"b@x.com", role:"annotator", assigned:1, in_progress:0, completed:0, total_active:1 },
    ];
    expect(suggestAssignee(wl)?.user_id).toBe("u2");
  });

  it("excludes viewers", () => {
    const wl: MemberWorkload[] = [
      { user_id:"v", email:"v@x.com", role:"viewer", assigned:0, in_progress:0, completed:0, total_active:0 },
    ];
    expect(suggestAssignee(wl)).toBeNull();
  });

  it("deterministic tie-break by email", () => {
    const wl: MemberWorkload[] = [
      { user_id:"z", email:"z@x.com", role:"annotator", assigned:0, in_progress:0, completed:0, total_active:0 },
      { user_id:"a", email:"a@x.com", role:"annotator", assigned:0, in_progress:0, completed:0, total_active:0 },
    ];
    // Same load → alphabetical email wins
    expect(suggestAssignee(wl)?.email).toBe("a@x.com");
  });

  it("returns null for empty workloads", () => {
    expect(suggestAssignee([])).toBeNull();
  });
});
