/**
 * platformAnalytics.ts — Platform Usage Analytics
 * Tracks processing events for platform health monitoring
 */

export interface AnalyticsEvent {
  type:      string;
  userId?:   string;
  metadata:  Record<string, string|number|boolean>;
  timestamp: number;
}

class PlatformAnalytics {
  private queue: AnalyticsEvent[] = [];
  private maxQueue = 100;

  track(type: string, metadata: Record<string, string|number|boolean> = {}, userId?: string): void {
    const event: AnalyticsEvent = {
      type,
      userId,
      metadata,
      timestamp: Date.now(),
    };
    this.queue.push(event);
    if(this.queue.length > this.maxQueue) this.queue.shift();

    // Log in dev
    if(import.meta.env.DEV) {
      console.log(`[Analytics] ${type}`, metadata);
    }
  }

  // Track audio processing
  trackProcessing(op: string, durationMs: number, score: number, passed: boolean): void {
    this.track("audio_processing", { op, durationMs, score, passed });
  }

  // Track bench run
  trackBenchRun(taskId: string, score: number, passed: boolean): void {
    this.track("bench_run", { taskId, score, passed });
  }

  // Track export
  trackExport(format: string, durationSec: number, safe: boolean): void {
    this.track("export", { format, durationSec, safe });
  }

  // Track tool open
  trackToolOpen(tool: string): void {
    this.track("tool_open", { tool });
  }

  getRecentEvents(n=20): AnalyticsEvent[] {
    return this.queue.slice(-n);
  }

  getSummary(): Record<string, number> {
    const counts: Record<string,number> = {};
    for(const e of this.queue) {
      counts[e.type] = (counts[e.type]??0) + 1;
    }
    return counts;
  }

  clear(): void { this.queue = []; }
}

export const analytics = new PlatformAnalytics();
