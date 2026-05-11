/**
 * activityTracker.ts — Enterprise Activity Tracking
 * Aivora Platform — Operational Audit System
 */

import { supabase } from "../supabase";

// ── Device Detection ──────────────────────────────────────────────────────────

function detectDevice(): {
  deviceType: string;
  os: string;
  browser: string;
  screenResolution: string;
  timezone: string;
} {
  const ua = navigator.userAgent;

  // Device type
  const deviceType =
    /iPad/.test(ua) ? "iPad" :
    /iPhone/.test(ua) ? "iPhone" :
    /Android.*Mobile/.test(ua) ? "Android Phone" :
    /Android/.test(ua) ? "Android Tablet" :
    /Macintosh/.test(ua) ? "MacBook" :
    /Windows/.test(ua) ? "Windows PC" :
    /Linux/.test(ua) ? "Linux PC" : "Unknown Device";

  // OS
  const os =
    /iPhone OS ([\d_]+)/.test(ua) ? `iOS ${ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g,".")}` :
    /Android ([\d.]+)/.test(ua) ? `Android ${ua.match(/Android ([\d.]+)/)?.[1]}` :
    /Windows NT ([\d.]+)/.test(ua) ? `Windows ${ua.match(/Windows NT ([\d.]+)/)?.[1]}` :
    /Mac OS X ([\d_]+)/.test(ua) ? `macOS ${ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g,".")}` :
    /Linux/.test(ua) ? "Linux" : "Unknown OS";

  // Browser
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari" :
    "Unknown Browser";

  const screenResolution = `${screen.width}x${screen.height}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return { deviceType, os, browser, screenResolution, timezone };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Session Management ────────────────────────────────────────────────────────

let _sessionId: string | null = null;

export function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = generateId();
  }
  return _sessionId;
}

export function startSession(): void {
  _sessionId = generateId();
}

export function endSession(): void {
  _sessionId = null;
}

// ── Event Types ───────────────────────────────────────────────────────────────

export type EventType =
  | "login_success" | "login_failed" | "logout"
  | "session_started" | "session_restored" | "session_expired"
  | "tab_opened" | "module_opened" | "module_closed"
  | "file_uploaded" | "file_analyzed" | "batch_started" | "batch_completed"
  | "qc_score_generated" | "issue_detected" | "repair_applied"
  | "wav_exported" | "zip_exported" | "report_exported"
  | "naming_started" | "naming_completed" | "naming_validation_failed"
  | "drive_delivery_started" | "drive_delivery_completed" | "drive_delivery_failed"
  | "app_loaded" | "build_version_loaded" | "error_occurred" | "crash_detected";

export interface TrackEventOptions {
  eventType:  EventType;
  module?:    string;
  metadata?:  Record<string, unknown>;
  userId?:    string;
  userEmail?: string;
  userRole?:  string;
}

// ── Main Track Function ───────────────────────────────────────────────────────

export async function trackEvent(opts: TrackEventOptions): Promise<void> {
  try {
    const device = detectDevice();
    const sessionId = getSessionId();

    // Safe IP hash from timezone+screen (no real IP collection)
    const ipHash = hashString(
      device.timezone + device.screenResolution + navigator.language
    );

    const payload = {
      session_id:       sessionId,
      user_id:          opts.userId    ?? "anonymous",
      user_email:       opts.userEmail ?? "anonymous",
      role:             opts.userRole  ?? "unknown",
      event_type:       opts.eventType,
      module:           opts.module    ?? "platform",
      device_type:      device.deviceType,
      os:               device.os,
      browser:          device.browser,
      screen_resolution: device.screenResolution,
      timezone:         device.timezone,
      ip_hash:          ipHash,
      metadata:         opts.metadata  ?? {},
      created_at:       new Date().toISOString(),
    };

    // Try Supabase first
    const { error } = await supabase
      .from("activity_logs")
      .insert(payload);

    if (error) {
      // Fallback to localStorage queue
      queueToLocalStorage(payload);
    }
  } catch {
    // Silent fail — never break the app
  }
}

export async function trackError(
  error: Error,
  module?: string,
  userId?: string
): Promise<void> {
  await trackEvent({
    eventType: "error_occurred",
    module,
    userId,
    metadata: {
      message: error.message,
      stack:   error.stack?.slice(0, 500),
    },
  });
}

// ── LocalStorage Fallback ─────────────────────────────────────────────────────

const LS_KEY = "aivora_activity_queue";

function queueToLocalStorage(payload: Record<string, unknown>): void {
  try {
    const existing = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    existing.push(payload);
    // Keep max 100 events
    if (existing.length > 100) existing.splice(0, existing.length - 100);
    localStorage.setItem(LS_KEY, JSON.stringify(existing));
  } catch {}
}

export function getQueuedEvents(): Record<string, unknown>[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch { return []; }
}

export function clearQueue(): void {
  localStorage.removeItem(LS_KEY);
}
