/**
 * offlineQueue.ts — Offline action queue
 * Aivora Platform PWA
 */

export type QueuedActionType =
  | "file_upload"
  | "qc_analysis"
  | "activity_log"
  | "repair_export";

export interface QueuedAction {
  id:        string;
  type:      QueuedActionType;
  payload:   Record<string, unknown>;
  createdAt: string;
  retries:   number;
  status:    "pending" | "syncing" | "failed";
}

const QUEUE_KEY   = "aivora_offline_queue";
const MAX_RETRIES = 3;

export function getQueue(): QueuedAction[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); }
  catch { return []; }
}

function saveQueue(queue: QueuedAction[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

export function enqueueAction(
  type: QueuedActionType, payload: Record<string, unknown>
): QueuedAction {
  const action: QueuedAction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    type, payload,
    createdAt: new Date().toISOString(),
    retries: 0, status: "pending",
  };
  const queue = getQueue();
  queue.push(action);
  saveQueue(queue);
  return action;
}

export function removeAction(id: string): void {
  saveQueue(getQueue().filter(a => a.id !== id));
}

export function markFailed(id: string): void {
  saveQueue(getQueue().map(a =>
    a.id === id ? { ...a, status: "failed" as const, retries: a.retries+1 } : a
  ));
}

export function getPendingCount(): number {
  return getQueue().filter(a => a.status === "pending").length;
}

export function clearCompleted(): void {
  saveQueue(getQueue().filter(a =>
    a.status !== "pending" || a.retries < MAX_RETRIES
  ));
}
