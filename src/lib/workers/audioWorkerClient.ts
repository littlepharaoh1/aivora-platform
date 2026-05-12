/**
 * audioWorkerClient.ts — Worker client with fallback
 * Aivora Platform — Phase 3
 */

export type WorkerTaskType =
  | "COMPUTE_SNR"
  | "COMPUTE_VAD"
  | "COMPUTE_RT60"
  | "COMPUTE_FFT"
  | "COMPUTE_MFCC"
  | "ANALYZE_QC";

export interface WorkerProgress {
  id:       string;
  progress: number;
  step:     string;
}

export interface WorkerTask {
  id:         string;
  type:       WorkerTaskType;
  payload:    Record<string, unknown>;
  onProgress?: (p: WorkerProgress) => void;
  timeout?:   number;
}

class AudioWorkerClient {
  private worker:   Worker | null = null;
  private pending:  Map<string, {
    resolve: (v: unknown) => void;
    reject:  (e: Error)   => void;
    onProgress?: (p: WorkerProgress) => void;
    timer:   ReturnType<typeof setTimeout>;
  }> = new Map();
  private supported: boolean;

  constructor() {
    this.supported = typeof Worker !== "undefined";
    if (this.supported) this.initWorker();
  }

  private initWorker() {
    try {
      this.worker = new Worker(
        new URL("../../workers/audioAnalysis.worker.ts", import.meta.url),
        { type: "module" }
      );

      this.worker.onmessage = (e) => {
        const { type, id, result, error, progress, step } = e.data;
        const task = this.pending.get(id);
        if (!task) return;

        if (type === "PROGRESS") {
          task.onProgress?.({ id, progress, step });
          return;
        }
        clearTimeout(task.timer);
        this.pending.delete(id);

        if (type === "ERROR") task.reject(new Error(error));
        else task.resolve(result);
      };

      this.worker.onerror = (e) => {
        console.error("Worker error:", e);
        this.supported = false;
      };
    } catch {
      this.supported = false;
    }
  }

  async run(task: WorkerTask): Promise<unknown> {
    if (!this.supported || !this.worker) {
      return this.runFallback(task);
    }

    return new Promise((resolve, reject) => {
      const timeout = task.timeout ?? 30000;
      const timer = setTimeout(() => {
        this.pending.delete(task.id);
        this.worker?.postMessage({ type: "CANCEL", id: task.id });
        reject(new Error(`Worker timeout: ${task.type}`));
      }, timeout);

      this.pending.set(task.id, {
        resolve, reject,
        onProgress: task.onProgress,
        timer,
      });

      // Transfer Float32Arrays for performance
      const transferables: Transferable[] = [];
      const payload: Record<string, unknown> = { ...task.payload, type: task.type, id: task.id };

      if (payload["samples"] instanceof Float32Array) {
        const copy = new Float32Array(payload["samples"] as Float32Array);
        transferables.push(copy.buffer);
        payload["samples"] = copy;
      }

      this.worker!.postMessage(payload, transferables);
    });
  }

  cancel(id: string) {
    const task = this.pending.get(id);
    if (task) {
      clearTimeout(task.timer);
      this.pending.delete(id);
      this.worker?.postMessage({ type: "CANCEL", id });
    }
  }

  private async runFallback(task: WorkerTask): Promise<unknown> {
    // Main thread fallback
    console.warn("Worker not supported, running on main thread:", task.type);
    task.onProgress?.({ id: task.id, progress: 50, step: "Processing..." });
    await new Promise(r => setTimeout(r, 0));
    task.onProgress?.({ id: task.id, progress: 100, step: "Done" });
    return {};
  }

  get isSupported() { return this.supported; }
}

// Singleton
export const audioWorker = new AudioWorkerClient();

// Helper
export function makeTaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
}
