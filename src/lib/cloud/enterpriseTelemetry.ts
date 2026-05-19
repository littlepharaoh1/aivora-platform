/**
 * enterpriseTelemetry.ts — Enterprise Runtime Telemetry
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Unified telemetry aggregator (DSP + workers + render + cloud)
 * - Time-series metrics storage (ring buffer, 1-hour window)
 * - Anomaly detection (Z-score based)
 * - SLA monitoring (p99 latency, error rate, availability)
 * - Alerting system (threshold-based + trend-based)
 * - Supabase telemetry persistence (sampled, 1% of events)
 * - Export: Prometheus-compatible format
 * - Export: JSON time-series for dashboards
 *
 * Design reference:
 * - Google SRE golden signals (latency, traffic, errors, saturation)
 * - Datadog APM metric pipeline
 * - OpenTelemetry collector model
 */

import { dspProfiler }     from "../dsp/observability/dspProfiler";
import { workerMonitor }   from "../dsp/observability/workerMonitor";
import { renderTelemetry } from "../dsp/observability/renderTelemetry";
import { jobQueue }        from "./jobQueue";
import { supabase }        from "../supabase";

// ── Constants ─────────────────────────────────────────────────────────────────

const RING_MINUTES  = 60;   // 1-hour history
const TICK_MS       = 5000; // collect every 5s
const TICKS_PER_MIN = 60000 / TICK_MS;
const RING_SIZE     = Math.ceil(RING_MINUTES * TICKS_PER_MIN);
const PERSIST_RATE  = 0.01; // 1% sampling for Supabase
const ZSCORE_ANOMALY= 3.0;  // Z-score threshold for anomaly

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelemetrySnapshot {
  timestamp:     number;
  // DSP
  dspStages:     number;
  dspDropped:    number;
  gcHeapMB:      number;
  gcPressure:    number;
  // Workers
  workersHealthy: number;
  workersTotal:   number;
  workerCrashes:  number;
  // Render
  rafFps:        number;
  rafDropRate:   number;
  renderDropped: number;
  // Queue
  jobsPending:   number;
  jobsRunning:   number;
  jobsDone:      number;
  jobsDead:      number;
  jobThroughput: number;
}

export type MetricKey = keyof Omit<TelemetrySnapshot, "timestamp">;

export interface TimeSeriesPoint {
  ts:    number;
  value: number;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface TelemetryAlert {
  id:        string;
  metric:    MetricKey;
  severity:  AlertSeverity;
  message:   string;
  value:     number;
  threshold: number;
  timestamp: number;
  resolved:  boolean;
}

export interface SLAReport {
  period:           string;
  p50LatencyMs:     number;
  p95LatencyMs:     number;
  p99LatencyMs:     number;
  errorRate:        number;
  availability:     number;   // 0-1
  jobThroughput:    number;
  slaBreaches:      number;
}

// ── Alert Rules ───────────────────────────────────────────────────────────────

interface AlertRule {
  metric:    MetricKey;
  threshold: number;
  direction: "above" | "below";
  severity:  AlertSeverity;
  message:   (v: number) => string;
}

const ALERT_RULES: AlertRule[] = [
  {
    metric:"gcPressure", threshold:0.85, direction:"above", severity:"critical",
    message:(v)=>`GC heap pressure critical: ${(v*100).toFixed(0)}%`,
  },
  {
    metric:"gcPressure", threshold:0.70, direction:"above", severity:"warning",
    message:(v)=>`GC heap pressure elevated: ${(v*100).toFixed(0)}%`,
  },
  {
    metric:"rafFps", threshold:30, direction:"below", severity:"warning",
    message:(v)=>`RAF FPS degraded: ${v.toFixed(1)} fps`,
  },
  {
    metric:"rafDropRate", threshold:0.15, direction:"above", severity:"warning",
    message:(v)=>`High frame drop rate: ${(v*100).toFixed(0)}%`,
  },
  {
    metric:"workerCrashes", threshold:1, direction:"above", severity:"critical",
    message:(v)=>`Worker crashes detected: ${v}`,
  },
  {
    metric:"jobsDead", threshold:3, direction:"above", severity:"warning",
    message:(v)=>`Dead letter queue growing: ${v} jobs`,
  },
  {
    metric:"dspDropped", threshold:10, direction:"above", severity:"warning",
    message:(v)=>`DSP frame drops: ${v}`,
  },
];

// ── Ring Buffer for Time Series ───────────────────────────────────────────────

class MetricRing {
  private readonly buf: Float64Array;
  private readonly ts:  Float64Array;
  private head  = 0;
  private count = 0;

  constructor(size = RING_SIZE) {
    this.buf = new Float64Array(size);
    this.ts  = new Float64Array(size);
  }

  push(value: number, timestamp: number): void {
    this.buf[this.head % RING_SIZE] = value;
    this.ts[this.head  % RING_SIZE] = timestamp;
    this.head++;
    if(this.count < RING_SIZE) this.count++;
  }

  getLast(n: number): TimeSeriesPoint[] {
    const count  = Math.min(n, this.count);
    const result: TimeSeriesPoint[] = [];
    const base   = (this.head - count + RING_SIZE*100) % RING_SIZE;
    for(let i=0;i<count;i++){
      const idx=(base+i)%RING_SIZE;
      result.push({ ts:this.ts[idx], value:this.buf[idx] });
    }
    return result;
  }

  mean(n = this.count): number {
    const pts=this.getLast(n);
    return pts.length>0 ? pts.reduce((s,p)=>s+p.value,0)/pts.length : 0;
  }

  std(n = this.count): number {
    const pts=this.getLast(n); if(pts.length<2) return 0;
    const m=pts.reduce((s,p)=>s+p.value,0)/pts.length;
    return Math.sqrt(pts.reduce((s,p)=>s+(p.value-m)**2,0)/pts.length);
  }

  percentile(p: number, n = this.count): number {
    const pts=[...this.getLast(n)].sort((a,b)=>a.value-b.value);
    return pts.length>0?pts[Math.floor(p*(pts.length-1))].value:0;
  }

  get length(): number { return this.count; }
}

// ── Enterprise Telemetry ──────────────────────────────────────────────────────

export class EnterpriseTelemetry {
  private readonly rings    = new Map<MetricKey, MetricRing>();
  private readonly alerts:  TelemetryAlert[] = [];
  private tickTimer:        ReturnType<typeof setInterval>|null = null;
  private tickCount         = 0;

  constructor() {
    // Pre-allocate rings for all metrics
    const keys: MetricKey[] = [
      "dspStages","dspDropped","gcHeapMB","gcPressure",
      "workersHealthy","workersTotal","workerCrashes",
      "rafFps","rafDropRate","renderDropped",
      "jobsPending","jobsRunning","jobsDone","jobsDead","jobThroughput",
    ];
    for(const k of keys) this.rings.set(k, new MetricRing());
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if(this.tickTimer) return;
    this.tickTimer=setInterval(()=>this._collect(), TICK_MS);
    this._collect(); // immediate first collection
  }

  stop(): void {
    if(this.tickTimer){ clearInterval(this.tickTimer); this.tickTimer=null; }
  }

  // ── Collection ────────────────────────────────────────────────────────────

  private async _collect(): Promise<void> {
    this.tickCount++;
    const now = performance.now();

    // Gather from all observability modules
    const dspSnap    = dspProfiler.exportSnapshot();
    const workerSnap = workerMonitor.exportSnapshot();
    const renderSnap = renderTelemetry.exportSnapshot();
    const queueStats = jobQueue.getStats();

    const snap: TelemetrySnapshot = {
      timestamp:      Date.now(),
      // DSP
      dspStages:      dspSnap.stages.length,
      dspDropped:     dspSnap.totalDropped,
      gcHeapMB:       dspSnap.gc.usedJSHeapMB,
      gcPressure:     dspSnap.gc.heapPressure,
      // Workers
      workersHealthy: workerSnap.workers.filter(w=>w.status==="healthy").length,
      workersTotal:   workerSnap.workers.length,
      workerCrashes:  workerSnap.workers.reduce((s,w)=>s+w.crashCount,0),
      // Render
      rafFps:         renderSnap.rafFps,
      rafDropRate:    renderSnap.rafDropRate,
      renderDropped:  renderSnap.totalDropped,
      // Queue
      jobsPending:    queueStats.pending,
      jobsRunning:    queueStats.running,
      jobsDone:       queueStats.done,
      jobsDead:       queueStats.dead,
      jobThroughput:  queueStats.throughput,
    };

    // Push to rings
    for(const [key, ring] of this.rings){
      ring.push((snap[key as keyof TelemetrySnapshot] as number)??0, now);
    }

    // Run alert rules
    this._checkAlerts(snap);

    // Sampled persistence
    if(Math.random()<PERSIST_RATE){
      await this._persist(snap).catch(()=>{});
    }
  }

  // ── Alerting ──────────────────────────────────────────────────────────────

  private _checkAlerts(snap: TelemetrySnapshot): void {
    for(const rule of ALERT_RULES){
      const value   = snap[rule.metric] as number;
      const breach  = rule.direction==="above" ? value>rule.threshold : value<rule.threshold;

      if(breach){
        // Check if alert already active for this metric
        const existing=this.alerts.find(a=>a.metric===rule.metric&&!a.resolved);
        if(!existing){
          this.alerts.push({
            id:        `alert_${Date.now()}_${rule.metric}`,
            metric:    rule.metric,
            severity:  rule.severity,
            message:   rule.message(value),
            value,
            threshold: rule.threshold,
            timestamp: Date.now(),
            resolved:  false,
          });
        }
      } else {
        // Resolve existing alert
        const existing=this.alerts.find(a=>a.metric===rule.metric&&!a.resolved);
        if(existing) existing.resolved=true;
      }
    }

    // Cap alert history
    if(this.alerts.length>500) this.alerts.splice(0,100);
  }

  // ── Anomaly Detection (Z-score) ───────────────────────────────────────────

  detectAnomalies(metric: MetricKey, windowTicks=12*TICKS_PER_MIN): {
    isAnomaly: boolean;
    zScore:    number;
    current:   number;
  } {
    const ring    = this.rings.get(metric);
    if(!ring || ring.length<10) return { isAnomaly:false, zScore:0, current:0 };

    const current = ring.getLast(1)[0]?.value ?? 0;
    const mean    = ring.mean(Math.min(windowTicks, ring.length));
    const std     = ring.std(Math.min(windowTicks, ring.length));
    const zScore  = std>0 ? (current-mean)/std : 0;

    return { isAnomaly:Math.abs(zScore)>ZSCORE_ANOMALY, zScore:Math.round(zScore*100)/100, current };
  }

  // ── SLA Report ────────────────────────────────────────────────────────────

  getSLAReport(periodMinutes=60): SLAReport {
    const ticks   = Math.min(Math.ceil(periodMinutes*TICKS_PER_MIN), RING_SIZE);
    const rafRing = this.rings.get("rafFps")!;
    const errRing = this.rings.get("rafDropRate")!;

    const p50  = rafRing.percentile(0.50, ticks);
    const p95  = rafRing.percentile(0.95, ticks);
    const p99  = rafRing.percentile(0.99, ticks);
    const errR = errRing.mean(ticks);

    // Availability: % of ticks where FPS > 30
    const fpsPts  = rafRing.getLast(ticks);
    const avail   = fpsPts.length>0
      ? fpsPts.filter(p=>p.value>=30).length/fpsPts.length : 0;

    const jt      = this.rings.get("jobThroughput")!.mean(ticks);
    const breaches = this.alerts.filter(a=>a.severity==="critical"&&
      Date.now()-a.timestamp<periodMinutes*60*1000).length;

    return {
      period:       `${periodMinutes}min`,
      p50LatencyMs: Math.round(1000/Math.max(1,p50)),
      p95LatencyMs: Math.round(1000/Math.max(1,p95)),
      p99LatencyMs: Math.round(1000/Math.max(1,p99)),
      errorRate:    Math.round(errR*1000)/1000,
      availability: Math.round(avail*1000)/1000,
      jobThroughput:Math.round(jt*10)/10,
      slaBreaches:  breaches,
    };
  }

  // ── Query API ─────────────────────────────────────────────────────────────

  getTimeSeries(metric: MetricKey, points=60): TimeSeriesPoint[] {
    return this.rings.get(metric)?.getLast(points) ?? [];
  }

  getActiveAlerts():    TelemetryAlert[] { return this.alerts.filter(a=>!a.resolved); }
  getAllAlerts():        TelemetryAlert[] { return [...this.alerts]; }
  getAlertsByLevel(s: AlertSeverity): TelemetryAlert[] {
    return this.alerts.filter(a=>a.severity===s&&!a.resolved);
  }

  // ── Prometheus Export ─────────────────────────────────────────────────────

  exportPrometheus(): string {
    const lines: string[] = ["# HELP aivora_telemetry Aivora platform metrics", "# TYPE aivora_telemetry gauge"];
    for(const [key, ring] of this.rings){
      if(ring.length>0){
        const last=ring.getLast(1)[0];
        lines.push(`aivora_${key}{platform="browser"} ${last.value} ${last.ts|0}`);
      }
    }
    return lines.join("\n");
  }

  // ── JSON Export ───────────────────────────────────────────────────────────

  exportJSON(points=60): Record<MetricKey, TimeSeriesPoint[]> {
    const result: Record<string, TimeSeriesPoint[]> = {};
    for(const [key] of this.rings) result[key]=this.getTimeSeries(key,points);
    return result as Record<MetricKey, TimeSeriesPoint[]>;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async _persist(snap: TelemetrySnapshot): Promise<void> {
    await supabase.from("processing_jobs").insert({
      id:          `telemetry_${snap.timestamp}`,
      user_id:     "system",
      file_name:   "telemetry_snapshot",
      status:      "done",
      score:       Math.round(snap.gcPressure*100),
      metadata:    snap,
      completed_at:new Date(snap.timestamp).toISOString(),
    });
  }
}

export const enterpriseTelemetry = new EnterpriseTelemetry();
enterpriseTelemetry.start();
