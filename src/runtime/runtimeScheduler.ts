/**
 * runtimeScheduler.ts — Global Runtime Scheduler
 * Aivora Platform — Phase 5.1
 *
 * Architecture:
 * - Singleton — one scheduler per browser session
 * - Deterministic: same pressure + same queue = same decision
 * - Priority queue: CRITICAL → HIGH → NORMAL → LOW (FIFO within tier)
 * - Hard worker ceiling: Desktop=6, Mobile=3, LowMem=1
 * - Auto-timeout: per task type (FORENSIC=15s, REPAIR=60s, etc.)
 * - No worker self-spawning — all allocation through allocateSlot()
 * - Non-blocking tick: setInterval at 250ms (cleared on destroy)
 */

import type {
  RuntimeTask,
  RuntimeTaskType,
  RuntimePriority,
  RuntimeExecutionMode,
  RuntimePressureState,
  SchedulerState,
} from "./runtimeTypes";

import {
  MAX_WORKERS_DESKTOP,
  MAX_WORKERS_MOBILE,
  MAX_WORKERS_LOW_MEM,
  MAX_QUEUE_DEPTH,
  MAX_QUEUE_DEPTH_LOW_MEM,
  TASK_TIMEOUT_MS,
  PRIORITY_ORDER,
  PRESSURE_WEIGHTS,
  PRESSURE_SOFT_THRESHOLD,
  PRESSURE_HARD_THRESHOLD,
  SCHEDULER_TICK_MS,
} from "./runtimeConstants";

// ── Runtime Scheduler ─────────────────────────────────────────────────────────

class RuntimeScheduler {
  private static _instance: RuntimeScheduler | null = null;

  // Queue — sorted on insert
  private _queue:        RuntimeTask[]            = [];
  private _active:       Map<string, RuntimeTask> = new Map();
  private _timeouts:     Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _tickHandle:   ReturnType<typeof setInterval> | null = null;
  private _destroyed     = false;

  // Current state
  private _mode:         RuntimeExecutionMode;
  private _maxWorkers:   number;
  private _pressure:     RuntimePressureState = {
    memory_pressure:  0,
    worker_pressure:  0,
    gpu_pressure:     0,
    raf_pressure:     0,
    queue_pressure:   0,
    overall_pressure: 0,
  };

  // Listeners
  private _stateListeners: Set<(s: SchedulerState) => void> = new Set();

  private constructor() {
    this._mode       = this._detectInitialMode();
    this._maxWorkers = this._modeToMaxWorkers(this._mode);
    this._startTick();
  }

  static getInstance(): RuntimeScheduler {
    if(!RuntimeScheduler._instance || RuntimeScheduler._instance._destroyed) {
      RuntimeScheduler._instance = new RuntimeScheduler();
    }
    return RuntimeScheduler._instance;
  }

  // ── Mode Detection ──────────────────────────────────────────────────────────

  private _detectInitialMode(): RuntimeExecutionMode {
    const mobile = this._isMobile();
    const mem    = (navigator as any).deviceMemory ?? 4;
    const cores  = navigator.hardwareConcurrency ?? 2;

    if(mobile || mem <= 2 || cores <= 2) return "MOBILE_SAFE";
    if(mem >= 8 && cores >= 6)           return "DESKTOP_ULTRA";
    return "DESKTOP_BALANCED";
  }

  private _isMobile(): boolean {
    return (
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 2 && window.innerWidth < 1024)
    );
  }

  private _modeToMaxWorkers(mode: RuntimeExecutionMode): number {
    switch(mode) {
      case "DESKTOP_ULTRA":    return MAX_WORKERS_DESKTOP;
      case "DESKTOP_BALANCED": return 4;
      case "MOBILE_SAFE":      return MAX_WORKERS_MOBILE;
      case "LOW_MEMORY":       return MAX_WORKERS_LOW_MEM;
    }
  }

  private _maxQueueDepth(): number {
    return this._mode === "LOW_MEMORY"
      ? MAX_QUEUE_DEPTH_LOW_MEM
      : MAX_QUEUE_DEPTH;
  }

  // ── Task Submission ─────────────────────────────────────────────────────────

  /**
   * Submit a task to the scheduler.
   * Returns task id or null if rejected (queue full / hard pressure).
   */
  submit(params: {
    task_type:      RuntimeTaskType;
    priority:       RuntimePriority;
    correlation_id: string;
    execute:        () => Promise<void>;
    onTimeout?:     () => void;
    onCancel?:      () => void;
  }): string | null {
    if(this._destroyed) return null;

    // Hard reject on queue full
    if(this._queue.length >= this._maxQueueDepth()) {
      console.warn(`[Scheduler] Queue full (${this._queue.length}). Rejecting ${params.task_type}`);
      return null;
    }

    // Hard reject on hard pressure + LOW priority
    if(
      this._pressure.overall_pressure >= PRESSURE_HARD_THRESHOLD &&
      params.priority === "LOW"
    ) {
      console.warn(`[Scheduler] Hard pressure. Rejecting LOW priority ${params.task_type}`);
      return null;
    }

    const task: RuntimeTask = {
      id:             crypto.randomUUID(),
      task_type:      params.task_type,
      priority:       params.priority,
      status:         "QUEUED",
      correlation_id: params.correlation_id,
      queued_at:      Date.now(),
      timeout_ms:     TASK_TIMEOUT_MS[params.task_type],
      execute:        params.execute,
      onTimeout:      params.onTimeout,
      onCancel:       params.onCancel,
    };

    // Insert in priority order (FIFO within same priority)
    const insertIdx = this._queue.findIndex(
      q => PRIORITY_ORDER[q.priority] > PRIORITY_ORDER[task.priority]
    );
    if(insertIdx === -1) {
      this._queue.push(task);
    } else {
      this._queue.splice(insertIdx, 0, task);
    }

    this._notifyListeners();
    return task.id;
  }

  /**
   * Cancel a queued task by id.
   * Running tasks are NOT interrupted (use onTimeout for that).
   */
  cancel(taskId: string): void {
    const idx = this._queue.findIndex(t => t.id === taskId);
    if(idx >= 0) {
      const task = this._queue[idx];
      task.status = "CANCELLED";
      task.onCancel?.();
      this._queue.splice(idx, 1);
      this._notifyListeners();
    }
  }

  // ── Scheduler Tick ──────────────────────────────────────────────────────────

  private _startTick(): void {
    this._tickHandle = setInterval(() => {
      if(this._destroyed) return;
      this._tick();
    }, SCHEDULER_TICK_MS);
  }

  private _tick(): void {
    // Update pressure
    this._updatePressure();

    // Soft pressure: pause LOW tasks
    if(this._pressure.overall_pressure >= PRESSURE_SOFT_THRESHOLD) {
      // Drain CRITICAL + HIGH only
      while(
        this._active.size < this._maxWorkers &&
        this._queue.length > 0 &&
        this._queue[0].priority !== "LOW" &&
        this._queue[0].priority !== "NORMAL"
      ) {
        this._dispatch(this._queue.shift()!);
      }
      return;
    }

    // Normal: drain queue up to worker ceiling
    while(
      this._active.size < this._maxWorkers &&
      this._queue.length > 0
    ) {
      this._dispatch(this._queue.shift()!);
    }
  }

  private _dispatch(task: RuntimeTask): void {
    task.status     = "RUNNING";
    task.started_at = Date.now();
    this._active.set(task.id, task);

    // Timeout guard
    const timeout = setTimeout(() => {
      if(!this._active.has(task.id)) return;
      task.status       = "TIMEOUT";
      task.completed_at = Date.now();
      this._active.delete(task.id);
      this._timeouts.delete(task.id);
      task.onTimeout?.();
      this._notifyListeners();
    }, task.timeout_ms);

    this._timeouts.set(task.id, timeout);

    // Execute — never blocks tick
    task.execute().then(() => {
      if(!this._active.has(task.id)) return; // already timed out
      task.status       = "COMPLETED";
      task.completed_at = Date.now();
      this._active.delete(task.id);
      clearTimeout(this._timeouts.get(task.id));
      this._timeouts.delete(task.id);
      this._notifyListeners();
    }).catch(() => {
      if(!this._active.has(task.id)) return;
      task.status       = "CANCELLED";
      task.completed_at = Date.now();
      this._active.delete(task.id);
      clearTimeout(this._timeouts.get(task.id));
      this._timeouts.delete(task.id);
      this._notifyListeners();
    });
  }

  // ── Pressure Calculation ────────────────────────────────────────────────────

  private _updatePressure(): void {
    const workerP = this._active.size / Math.max(1, this._maxWorkers);
    const queueP  = this._queue.length / Math.max(1, this._maxQueueDepth());

    // Memory pressure via performance.memory (Chrome only)
    let memP = 0;
    const mem = (performance as any).memory;
    if(mem) {
      memP = mem.usedJSHeapSize / Math.max(1, mem.jsHeapSizeLimit);
    }

    this._pressure = {
      memory_pressure:  this._clamp(memP),
      worker_pressure:  this._clamp(workerP),
      gpu_pressure:     this._pressure.gpu_pressure, // updated externally
      raf_pressure:     this._pressure.raf_pressure,  // updated externally
      queue_pressure:   this._clamp(queueP),
      overall_pressure: this._clamp(
        memP    * PRESSURE_WEIGHTS.memory +
        workerP * PRESSURE_WEIGHTS.worker +
        this._pressure.gpu_pressure * PRESSURE_WEIGHTS.gpu +
        this._pressure.raf_pressure * PRESSURE_WEIGHTS.raf +
        queueP  * PRESSURE_WEIGHTS.queue
      ),
    };

    // Auto mode adjustment
    if(this._pressure.overall_pressure >= PRESSURE_HARD_THRESHOLD) {
      this._setMode("LOW_MEMORY");
    } else if(this._pressure.overall_pressure >= PRESSURE_SOFT_THRESHOLD) {
      if(this._mode === "DESKTOP_ULTRA") this._setMode("DESKTOP_BALANCED");
    }
  }

  private _setMode(mode: RuntimeExecutionMode): void {
    if(this._mode === mode) return;
    this._mode       = mode;
    this._maxWorkers = this._modeToMaxWorkers(mode);
    this._notifyListeners();
  }

  // ── External Pressure Updates ───────────────────────────────────────────────

  updateGpuPressure(v: number): void {
    this._pressure.gpu_pressure = this._clamp(v);
  }

  updateRafPressure(v: number): void {
    this._pressure.raf_pressure = this._clamp(v);
  }

  // ── State Query ─────────────────────────────────────────────────────────────

  getState(): SchedulerState {
    return {
      execution_mode: this._mode,
      active_workers: this._active.size,
      max_workers:    this._maxWorkers,
      queue_depth:    this._queue.length,
      pressure:       { ...this._pressure },
    };
  }

  getPressure(): RuntimePressureState {
    return { ...this._pressure };
  }

  // ── Listeners ───────────────────────────────────────────────────────────────

  onStateChange(cb: (s: SchedulerState) => void): () => void {
    this._stateListeners.add(cb);
    return () => this._stateListeners.delete(cb);
  }

  private _notifyListeners(): void {
    const state = this.getState();
    this._stateListeners.forEach(cb => {
      try { cb(state); } catch {}
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  destroy(): void {
    this._destroyed = true;
    if(this._tickHandle) clearInterval(this._tickHandle);
    this._timeouts.forEach(t => clearTimeout(t));
    this._active.forEach(task => {
      task.status = "CANCELLED";
      task.onCancel?.();
    });
    this._queue  = [];
    this._active.clear();
    this._timeouts.clear();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _clamp(v: number): number {
    if(!isFinite(v) || isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const scheduler = RuntimeScheduler.getInstance();
export { RuntimeScheduler };
