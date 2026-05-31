/**
 * auditService.test.ts
 * Aivora Platform — Audit Trail Tests
 *
 * Tests the pure, deterministic parts: canonicalization + checksum verification.
 * (DB insert paths are integration-level and not unit-tested here.)
 */

import { describe, it, expect } from "vitest";
import { canonicalize, verifyAuditEvent } from "../src/lib/projects/auditService";
import type { AuditEvent } from "../src/lib/projects/projectTypes";

// ── canonicalize ──────────────────────────────────────────────────────────────

describe("canonicalize", () => {
  it("produces identical output regardless of key order", () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const z = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(z);
  });

  it("is stable across calls (deterministic)", () => {
    const obj = { action: "TASK_CREATED", target_id: "t1", metadata: { x: 1 } };
    expect(canonicalize(obj)).toBe(canonicalize(obj));
  });

  it("distinguishes different values", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });

  it("distinguishes different keys", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ b: 1 }));
  });

  it("handles nested objects deterministically", () => {
    const a = canonicalize({ meta: { x: 1, y: 2 }, id: "1" });
    const b = canonicalize({ id: "1", meta: { x: 1, y: 2 } });
    expect(a).toBe(b);
  });
});

// ── verifyAuditEvent ──────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id:          "evt-1",
    project_id:  "proj-1",
    actor_id:    "user-1",
    actor_email: "a@b.com",
    action:      "PROJECT_CREATED",
    target_type: "project",
    target_id:   "proj-1",
    metadata:    {},
    checksum:    "",
    created_at:  "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("verifyAuditEvent", () => {
  it("returns true for an event with a correct checksum", async () => {
    // Build event, compute its real checksum the same way the service does
    const { canonicalize: c } = await import("../src/lib/projects/auditService");
    const evt = makeEvent();
    // Recompute checksum via the same canonical fields
    const buf = new TextEncoder().encode(c({
      project_id:  evt.project_id,
      actor_id:    evt.actor_id,
      action:      evt.action,
      target_type: evt.target_type,
      target_id:   evt.target_id,
      metadata:    evt.metadata,
      created_at:  evt.created_at,
    }));
    const hash = await crypto.subtle.digest("SHA-256", buf);
    evt.checksum = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    expect(await verifyAuditEvent(evt)).toBe(true);
  });

  it("returns false when checksum is tampered", async () => {
    const evt = makeEvent({ checksum: "deadbeef" });
    expect(await verifyAuditEvent(evt)).toBe(false);
  });

  it("returns false when action is altered after checksum", async () => {
    const evt = makeEvent();
    // Compute valid checksum for original
    const buf = new TextEncoder().encode(canonicalize({
      project_id:  evt.project_id,
      actor_id:    evt.actor_id,
      action:      evt.action,
      target_type: evt.target_type,
      target_id:   evt.target_id,
      metadata:    evt.metadata,
      created_at:  evt.created_at,
    }));
    const hash = await crypto.subtle.digest("SHA-256", buf);
    evt.checksum = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    // Now tamper the action — checksum no longer matches
    evt.action = "PROJECT_ARCHIVED";
    expect(await verifyAuditEvent(evt)).toBe(false);
  });
});
