/**
 * workerRegistry.ts — Global Worker Registry
 * Aivora Platform — Phase 5.4
 *
 * Tracks all active workers across the platform.
 * No component may spawn workers directly.
 * All worker lifecycle events recorded here.
 */

import type { RuntimeTaskType } from "./runtimeTypes";

export interface WorkerEntry {
  id:            string;
  task_type:     RuntimeTaskType;
  correlation_id:string;
  worker:        Worker;
  allocated_at:  number;
  timeout_ms:    number;
  timeout_handle:ReturnType<typeof setTimeout> | null;
  status:        "ACTIVE" | "IDLE" | "CRASHED" | "RECYCLED";
}

class WorkerRegistry {
  private _workers: Map<string, WorkerEntry> = new Map();

  register(entry: WorkerEntry): void {
    this._workers.set(entry.id, entry);
  }

  unregister(id: string): void {
    this._workers.delete(id);
  }

  get(id: string): WorkerEntry | undefined {
    return this._workers.get(id);
  }

  getAll(): WorkerEntry[] {
    return Array.from(this._workers.values());
  }

  getActiveCount(): number {
    return Array.from(this._workers.values())
      .filter(w => w.status === "ACTIVE").length;
  }

  markCrashed(id: string): void {
    const w = this._workers.get(id);
    if(w) w.status = "CRASHED";
  }

  markRecycled(id: string): void {
    const w = this._workers.get(id);
    if(w) w.status = "RECYCLED";
  }

  terminateAll(): void {
    this._workers.forEach(entry => {
      try {
        if(entry.timeout_handle) clearTimeout(entry.timeout_handle);
        entry.worker.terminate();
        entry.status = "RECYCLED";
      } catch {}
    });
    this._workers.clear();
  }
}

export const workerRegistry = new WorkerRegistry();
