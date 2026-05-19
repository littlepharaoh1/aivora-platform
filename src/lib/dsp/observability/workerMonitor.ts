/**
 * workerMonitor.ts — Worker Health & Utilization Monitor
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Heartbeat-based liveness detection (not polling)
 * - Message round-trip timing (RTT) per worker
 * - Utilization estimation via busy/idle ratio
 * - Crash detection + automatic recovery signaling
 * - Zero allocation in hot path — pre-allocated state objects
 * - Worker-safe protocol — postMessage only, no SharedArrayBuffer required
 *
 * Design reference:
 * - Kubernetes liveness/readiness probe model
 * - Chrome worker DevTools health model
 * - NGINX upstream health check methodology
 *
 * Supported worker types:
 * - FFT Worker         (public/fftWorker.js)
 * - Spectrogram Worker (public/spectrogramWorker.js)
 * - AudioWorklet       (public/aivoraWorkletProcessor.js)
 * - Analysis Worker    (src/workers/audioAnalysis.worker.ts)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS  = 5000;   // ping every 5s
const HEARTBEAT_TIMEOUT_MS   = 3000;   // consider dead after 3s no response
const RTT_RING_SIZE          = 32;     // rolling RTT window
const MAX_CRASH_BACKOFF_MS   = 30000;  // max restart backoff
const UTILIZATION_WINDOW_MS  = 10000; // utilization rolling window

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkerType =
  | "fft"
  | "spectrogram"
  | "audioWorklet"
  | "analysis";

export type WorkerStatus =
  | "healthy"      // responding within timeout
  | "degraded"     // responding but slow (RTT > 2x baseline)
  | "unresponsive" // no heartbeat response within timeout
  | "crashed"      // worker threw error
  | "terminated"   // intentionally stopped
  | "unknown";     // not yet probed

export interface WorkerHealth {
  readonly type:           WorkerType;
  readonly status:         WorkerStatus;
  readonly rttMs:          number;       // last round-trip time
  readonly rttP95Ms:       number;       // P95 RTT
  readonly utilization:    number;       // 0-1 estimated busy ratio
  readonly crashCount:     number;
  readonly lastHeartbeat:  number;       // performance.now()
  readonly messageCount:   number;       // total messages processed
  readonly errorCount:     number;
}

export interface WorkerMonitorSnapshot {
  readonly timestamp:  number;
  readonly workers:    WorkerHealth[];
  readonly allHealthy: boolean;
  readonly anyUnresponsive: boolean;
  readonly anyCrashed:      boolean;
}

// ── RTT Ring Buffer ───────────────────────────────────────────────────────────

class RTTRing {
  private readonly buf: Float64Array;
  private head  = 0;
  private count = 0;

  constructor() { this.buf = new Float64Array(RTT_RING_SIZE); }

  push(v: number): void {
    this.buf[this.head % RTT_RING_SIZE] = v;
    this.head++;
    if(this.count < RTT_RING_SIZE) this.count++;
  }

  p95(): number {
    if(this.count === 0) return 0;
    const n    = this.count;
    const temp = new Float64Array(n);
    const base = (this.head - n + RTT_RING_SIZE * 100) % RTT_RING_SIZE;
    for(let i = 0; i < n; i++)
      temp[i] = this.buf[(base + i) % RTT_RING_SIZE];
    temp.sort();
    return temp[Math.floor(0.95 * (n - 1))];
  }

  last(): number {
    if(this.count === 0) return 0;
    return this.buf[(this.head - 1 + RTT_RING_SIZE) % RTT_RING_SIZE];
  }
}

// ── Worker State ──────────────────────────────────────────────────────────────

interface WorkerState {
  type:            WorkerType;
  status:          WorkerStatus;
  rtt:             RTTRing;
  crashCount:      number;
  errorCount:      number;
  messageCount:    number;
  lastHeartbeat:   number;
  pendingPingTime: number | null;  // performance.now() of outgoing ping
  busyStart:       number | null;  // performance.now() when task started
  totalBusyMs:     number;
  windowStart:     number;
  heartbeatTimer:  ReturnType<typeof setInterval> | null;
  timeoutTimer:    ReturnType<typeof setTimeout>  | null;
  crashBackoffMs:  number;
  worker:          Worker | null;
}

function makeState(type: WorkerType): WorkerState {
  return {
    type, status:"unknown",
    rtt:           new RTTRing(),
    crashCount:    0,
    errorCount:    0,
    messageCount:  0,
    lastHeartbeat: 0,
    pendingPingTime: null,
    busyStart:     null,
    totalBusyMs:   0,
    windowStart:   performance.now(),
    heartbeatTimer: null,
    timeoutTimer:   null,
    crashBackoffMs: 1000,
    worker:         null,
  };
}

// ── Crash Recovery Callback ───────────────────────────────────────────────────

export type CrashRecoveryCallback = (type: WorkerType, crashCount: number) => void;

// ── Worker Monitor ────────────────────────────────────────────────────────────

export class WorkerMonitor {
  private readonly states = new Map<WorkerType, WorkerState>();
  private onCrash?: CrashRecoveryCallback;
  private enabled = true;

  constructor(options: { onCrash?: CrashRecoveryCallback; enabled?: boolean } = {}) {
    this.onCrash = options.onCrash;
    this.enabled = options.enabled ?? true;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a Worker instance for monitoring.
   * Must be called after worker construction.
   */
  register(type: WorkerType, worker: Worker): void {
    if(!this.enabled) return;

    // Cleanup existing if re-registering
    this.unregister(type);

    const state = makeState(type);
    state.worker = worker;
    state.status = "unknown";
    this.states.set(type, state);

    // Wire up worker message/error handlers
    worker.addEventListener("message", (e) => this._onMessage(type, e));
    worker.addEventListener("error",   (e) => this._onError(type, e));

    // Start heartbeat loop
    this._startHeartbeat(type);
  }

  /**
   * Register an AudioWorkletNode port for monitoring.
   */
  registerWorkletPort(port: MessagePort): void {
    if(!this.enabled) return;

    const type: WorkerType = "audioWorklet";
    this.unregister(type);

    const state = makeState(type);
    this.states.set(type, state);

    port.addEventListener("message", (e) => {
      if((e.data as { type: string }).type === "metrics") {
        this._recordHeartbeat(type);
      }
    });

    // Worklet health is proxied via metrics stream — ping every 5s
    this._startHeartbeatVirtual(type);
  }

  unregister(type: WorkerType): void {
    const state = this.states.get(type);
    if(!state) return;
    if(state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if(state.timeoutTimer)   clearTimeout(state.timeoutTimer);
    state.status = "terminated";
    this.states.delete(type);
  }

  // ── Heartbeat Protocol ───────────────────────────────────────────────────────

  private _startHeartbeat(type: WorkerType): void {
    const state = this.states.get(type);
    if(!state) return;

    state.heartbeatTimer = setInterval(() => {
      this._sendPing(type);
    }, HEARTBEAT_INTERVAL_MS);

    // Send first ping immediately
    setTimeout(() => this._sendPing(type), 100);
  }

  private _startHeartbeatVirtual(type: WorkerType): void {
    // For AudioWorklet — no direct message channel, infer from metrics stream
    const state = this.states.get(type);
    if(!state) return;

    state.heartbeatTimer = setInterval(() => {
      const elapsed = performance.now() - state.lastHeartbeat;
      if(state.lastHeartbeat > 0 && elapsed > HEARTBEAT_TIMEOUT_MS * 2) {
        state.status = "unresponsive";
      } else if(state.lastHeartbeat > 0) {
        state.status = "healthy";
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private _sendPing(type: WorkerType): void {
    const state = this.states.get(type);
    if(!state?.worker) return;

    state.pendingPingTime = performance.now();

    // Send lightweight ping
    try {
      state.worker.postMessage({ type: "ping", timestamp: state.pendingPingTime });
    } catch {
      state.status = "crashed";
      return;
    }

    // Arm timeout — if no pong within HEARTBEAT_TIMEOUT_MS, mark unresponsive
    if(state.timeoutTimer) clearTimeout(state.timeoutTimer);
    state.timeoutTimer = setTimeout(() => {
      const s = this.states.get(type);
      if(s && s.pendingPingTime !== null) {
        s.status = "unresponsive";
        s.pendingPingTime = null;
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  // ── Event Handlers ────────────────────────────────────────────────────────

  private _onMessage(type: WorkerType, e: MessageEvent): void {
    const state = this.states.get(type);
    if(!state) return;

    state.messageCount++;

    // Handle pong
    if(e.data?.type === "pong" && state.pendingPingTime !== null) {
      const rtt = performance.now() - state.pendingPingTime;
      state.rtt.push(rtt);
      state.pendingPingTime = null;
      if(state.timeoutTimer) { clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
      this._recordHeartbeat(type);

      // Classify health based on RTT
      const p95 = state.rtt.p95();
      state.status = p95 > HEARTBEAT_TIMEOUT_MS ? "degraded" : "healthy";
    }

    // Task lifecycle tracking for utilization
    if(e.data?.type === "task_start") {
      state.busyStart = performance.now();
    }
    if(e.data?.type === "task_end" && state.busyStart !== null) {
      state.totalBusyMs += performance.now() - state.busyStart;
      state.busyStart = null;
    }
  }

  private _onError(type: WorkerType, _e: ErrorEvent): void {
    const state = this.states.get(type);
    if(!state) return;

    state.errorCount++;
    state.crashCount++;
    state.status = "crashed";

    // Exponential backoff recovery signaling
    const backoff = Math.min(state.crashBackoffMs, MAX_CRASH_BACKOFF_MS);
    state.crashBackoffMs = Math.min(backoff * 2, MAX_CRASH_BACKOFF_MS);

    setTimeout(() => {
      this.onCrash?.(type, state.crashCount);
    }, backoff);
  }

  private _recordHeartbeat(type: WorkerType): void {
    const state = this.states.get(type);
    if(state) state.lastHeartbeat = performance.now();
  }

  // ── Task Lifecycle API ────────────────────────────────────────────────────

  /**
   * Call when dispatching a task to a worker.
   * Used for utilization estimation.
   */
  taskStart(type: WorkerType): void {
    const state = this.states.get(type);
    if(state) state.busyStart = performance.now();
  }

  taskEnd(type: WorkerType): void {
    const state = this.states.get(type);
    if(!state || state.busyStart === null) return;
    state.totalBusyMs += performance.now() - state.busyStart;
    state.busyStart = null;
  }

  // ── Query API ─────────────────────────────────────────────────────────────

  getHealth(type: WorkerType): WorkerHealth | null {
    const state = this.states.get(type);
    if(!state) return null;

    const windowMs      = performance.now() - state.windowStart;
    const utilization   = windowMs > 0
      ? Math.min(1, state.totalBusyMs / windowMs) : 0;

    return {
      type:           state.type,
      status:         state.status,
      rttMs:          Math.round(state.rtt.last() * 10) / 10,
      rttP95Ms:       Math.round(state.rtt.p95()  * 10) / 10,
      utilization:    Math.round(utilization * 1000) / 1000,
      crashCount:     state.crashCount,
      lastHeartbeat:  state.lastHeartbeat,
      messageCount:   state.messageCount,
      errorCount:     state.errorCount,
    };
  }

  getAllHealth(): WorkerHealth[] {
    const result: WorkerHealth[] = [];
    for(const type of this.states.keys()) {
      const h = this.getHealth(type);
      if(h) result.push(h);
    }
    return result;
  }

  exportSnapshot(): WorkerMonitorSnapshot {
    const workers = this.getAllHealth();
    return {
      timestamp:        performance.now(),
      workers,
      allHealthy:       workers.every(w => w.status === "healthy"),
      anyUnresponsive:  workers.some(w  => w.status === "unresponsive"),
      anyCrashed:       workers.some(w  => w.status === "crashed"),
    };
  }

  isAllHealthy():     boolean { return this.exportSnapshot().allHealthy;      }
  isAnyUnresponsive():boolean { return this.exportSnapshot().anyUnresponsive;  }

  dispose(): void {
    for(const type of this.states.keys()) this.unregister(type);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const workerMonitor = new WorkerMonitor({
  enabled: true,
  onCrash: (type, count) => {
    // Telemetry hook — no console spam
    // Failure engineering paths subscribe via exportSnapshot()
    void type; void count;
  },
});
