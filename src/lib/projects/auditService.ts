/**
 * auditService.ts
 * Aivora Platform — Immutable Audit Trail
 *
 * INSERT-only. SHA-256 checksum per event. Offline-safe via mutationQueue.
 */

import { supabase }        from "../supabase";
import { emitEvent }       from "../telemetry/emitter";
import { enqueueMutation } from "../offline/mutationQueue";
import type { AuditAction, AuditEvent } from "./projectTypes";

async function sha256(str: string): Promise<string> {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.map(k => [k, obj[k]]));
}

export interface RecordAuditParams {
  project_id:  string | null;
  actor_id:    string;
  actor_email: string;
  action:      AuditAction;
  target_type: string;
  target_id:   string;
  metadata?:   Record<string, unknown>;
}

export async function recordAudit(params: RecordAuditParams): Promise<AuditEvent> {
  const created_at = new Date().toISOString();
  const metadata   = params.metadata ?? {};

  const checksum = await sha256(canonicalize({
    project_id:  params.project_id,
    actor_id:    params.actor_id,
    action:      params.action,
    target_type: params.target_type,
    target_id:   params.target_id,
    metadata,
    created_at,
  }));

  const row = {
    project_id:  params.project_id,
    actor_id:    params.actor_id,
    actor_email: params.actor_email,
    action:      params.action,
    target_type: params.target_type,
    target_id:   params.target_id,
    metadata,
    checksum,
    created_at,
  };

  try {
    const { data, error } = await supabase
      .from("pm_audit_events")
      .insert(row)
      .select()
      .single();
    if(error) throw error;

    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "admin_panel",
      correlation_id: params.project_id ?? params.target_id,
      severity:       "info",
      payload:        { audit_action: params.action, target: params.target_type, checksum },
    });

    return data as AuditEvent;
  } catch {
    await enqueueMutation({
      mutation_type:  "activity_log_insert",
      correlation_id: params.project_id ?? params.target_id,
      payload:        row as unknown as Record<string, unknown>,
    });
    return { id: crypto.randomUUID(), ...row } as AuditEvent;
  }
}

export async function fetchAuditTrail(
  projectId: string,
  limit = 100,
): Promise<AuditEvent[]> {
  const { data } = await supabase
    .from("pm_audit_events")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditEvent[];
}

export async function verifyAuditEvent(event: AuditEvent): Promise<boolean> {
  const expected = await sha256(canonicalize({
    project_id:  event.project_id,
    actor_id:    event.actor_id,
    action:      event.action,
    target_type: event.target_type,
    target_id:   event.target_id,
    metadata:    event.metadata,
    created_at:  event.created_at,
  }));
  return expected === event.checksum;
}
