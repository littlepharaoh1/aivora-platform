/**
 * runtimeTypes.ts — Runtime Control Plane Type Definitions
 * Aivora Platform — Phase 5.1
 */

// ── Task Types ────────────────────────────────────────────────────────────────

export type RuntimeTaskType =
  | "FORENSIC"
  | "SPECTROGRAM"
  | "REPAIR"
  | "EXPORT"
  | "ANALYTICS"
  | "SIMILARITY"
  | "BATCH"
  | "IMAGE"
  | "VIDEO"
  | "OCR";

export type RuntimePriority =
  | "CRITICAL"
  | "HIGH"
  | "NORMAL"
  | "LOW";

export type RuntimeExecutionMode =
  | "DESKTOP_ULTRA"
  | "DESKTOP_BALANCED"
  | "MOBILE_SAFE"
  | "LOW_MEMORY";

export type RuntimeTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "TIMEOUT"
  | "CANCELLED"
  | "REJECTED";

// ── Pressure State ────────────────────────────────────────────────────────────

export interface RuntimePressureState {
  memory_pressure: number;   // 0→1
  worker_pressure: number;   // 0→1
  gpu_pressure:    number;   // 0→1
  raf_pressure:    number;   // 0→1
  queue_pressure:  number;   // 0→1
  overall_pressure:number;   // 0→1 (weighted)
}

// ── Task Definition ───────────────────────────────────────────────────────────

export interface RuntimeTask {
  id:              string;
  task_type:       RuntimeTaskType;
  priority:        RuntimePriority;
  status:          RuntimeTaskStatus;
  correlation_id:  string;
  queued_at:       number;     // Date.now()
  started_at?:     number;
  completed_at?:   number;
  timeout_ms:      number;
  worker_id?:      string;
  execute:         () => Promise<void>;
  onTimeout?:      () => void;
  onCancel?:       () => void;
}

// ── Worker Record ─────────────────────────────────────────────────────────────

export interface RuntimeWorkerRecord {
  id:         string;
  task_type:  RuntimeTaskType;
  task_id:    string;
  allocated_at:number;
  timeout_handle: ReturnType<typeof setTimeout> | null;
}

// ── Scheduler State ───────────────────────────────────────────────────────────

export interface SchedulerState {
  execution_mode:   RuntimeExecutionMode;
  active_workers:   number;
  max_workers:      number;
  queue_depth:      number;
  pressure:         RuntimePressureState;
}
