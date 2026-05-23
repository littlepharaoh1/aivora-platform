/**
 * workerPool.ts — Global Worker Pool
 * Aivora Platform — Phase 5.4
 *
 * Architecture:
 * - ALL worker allocation MUST go through workerPool.allocate()
 * - No component may call new Worker() directly
 * - Workers are task-specific (not generic reusable workers)
 * - Lease ownership: one task per worker slot
 * - Auto-recycle on timeout or completion
 * - Crash isolation: crashed worker never blocks pool
 * - Lifecycle telemetry on every allocation/release
 */

import { scheduler }              from "./runtimeScheduler";
import { workerRegistry }         from "./workerRegistry";
import type { RuntimeTaskType }   from "./runtimeTypes";
import { TASK_TIMEOUT_MS }        from "./runtimeConstants";

// ── Worker Factory Type ───────────────────────────────────────────────────────

export type WorkerFactory = () => Worker;

// ── Pool Entry ────────────────────────────────────────────────────────────────

interface PoolSlot {
  id:            string;
  task_type:     RuntimeTaskType;
  correlation_id:string;
  worker:        Worker;
  timeout_handle:ReturnType<typeof setTimeout> | null;
  allocated_at:  number;
  onRelease?:    () => void;
}

// ── Worker Pool ───────────────────────────────────────────────────────────────

class WorkerPool {
  private _slots:    Map<string, PoolSlot> = new Map();
  private _destroyed = false;

  /**
   * Allocate a worker slot.
   * Returns slot id or null if pool is saturated.
   *
   * factory: function that returns new Worker instance
   * All workers pass through here — no direct new Worker() allowed.
   */
  allocate(params: {
    task_type:      RuntimeTaskType;
    correlation_id: string;
    factory:        WorkerFactory;
    onRelease?:     () => void;
  }): { slotId: string; worker: Worker } | null {
    if(this._destroyed) return null;

    const state = scheduler.getState();

    // Hard ceiling check
    if(this._slots.size >= state.max_workers) {
      console.warn(
        `[WorkerPool] Pool saturated (${this._slots.size}/${state.max_workers}). ` +
        `Rejecting ${params.task_type}`
      );
      return null;
    }

    const slotId = crypto.randomUUID();
    const worker = params.factory();

    // Crash isolation
    worker.onerror = (e) => {
      console.error(`[WorkerPool] Worker crashed: ${slotId}`, e.message);
      workerRegistry.markCrashed(slotId);
      this._forceRelease(slotId);
    };

    // Timeout guard
    const timeout = setTimeout(() => {
      console.warn(`[WorkerPool] Worker timeout: ${slotId} (${params.task_type})`);
      this._forceRelease(slotId);
    }, TASK_TIMEOUT_MS[params.task_type]);

    const slot: PoolSlot = {
      id:             slotId,
      task_type:      params.task_type,
      correlation_id: params.correlation_id,
      worker,
      timeout_handle: timeout,
      allocated_at:   Date.now(),
      onRelease:      params.onRelease,
    };

    this._slots.set(slotId, slot);

    // Register in global registry
    workerRegistry.register({
      id:             slotId,
      task_type:      params.task_type,
      correlation_id: params.correlation_id,
      worker,
      allocated_at:   Date.now(),
      timeout_ms:     TASK_TIMEOUT_MS[params.task_type],
      timeout_handle: timeout,
      status:         "ACTIVE",
    });

    return { slotId, worker };
  }

  /**
   * Release a worker slot after task completion.
   * Worker is terminated — not reused.
   */
  release(slotId: string): void {
    const slot = this._slots.get(slotId);
    if(!slot) return;

    if(slot.timeout_handle) clearTimeout(slot.timeout_handle);

    try { slot.worker.terminate(); } catch {}

    slot.onRelease?.();
    this._slots.delete(slotId);
    workerRegistry.markRecycled(slotId);
    workerRegistry.unregister(slotId);
  }

  private _forceRelease(slotId: string): void {
    const slot = this._slots.get(slotId);
    if(!slot) return;
    if(slot.timeout_handle) clearTimeout(slot.timeout_handle);
    try { slot.worker.terminate(); } catch {}
    slot.onRelease?.();
    this._slots.delete(slotId);
  }

  getActiveCount(): number {
    return this._slots.size;
  }

  getMaxWorkers(): number {
    return scheduler.getState().max_workers;
  }

  isSaturated(): boolean {
    return this._slots.size >= this.getMaxWorkers();
  }

  destroy(): void {
    this._destroyed = true;
    this._slots.forEach((slot, id) => this._forceRelease(id));
    workerRegistry.terminateAll();
  }
}

export const workerPool = new WorkerPool();
