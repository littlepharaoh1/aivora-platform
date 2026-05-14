/**
 * dspQueue.ts — Professional DSP Job Queue Engine
 * Aivora Platform — Phase 4
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type JobPriority = "critical" | "high" | "normal" | "low";
export type JobType =
  | "ANALYZE_QC"
  | "COMPUTE_FFT"
  | "COMPUTE_VAD"
  | "COMPUTE_SNR"
  | "COMPUTE_RT60"
  | "COMPUTE_MFCC"
  | "COMPUTE_SPECTROGRAM"
  | "BATCH_QC"
  | "NOISE_REDUCE"
  | "TIME_STRETCH";

export interface JobProgress {
  jobId:    string;
  percent:  number;
  step:     string;
  elapsed:  number;
}

export interface DSPJob {
  id:         string;
  type:       JobType;
  priority:   JobPriority;
  payload:    Record<string, unknown>;
  status:     JobStatus;
  progress:   number;
  step:       string;
  createdAt:  number;
  startedAt?: number;
  endedAt?:   number;
  retries:    number;
  maxRetries: number;
  timeout:    number;
  error?:     string;
  result?:    unknown;
  onProgress?: (p: JobProgress) => void;
  onComplete?: (result: unknown) => void;
  onError?:   (error: Error) => void;
}

export interface QueueStats {
  total:      number;
  pending:    number;
  running:    number;
  completed:  number;
  failed:     number;
  cancelled:  number;
  avgDuration: number;
  throughput:  number;
}

// ── Priority weights ──────────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  critical: 4,
  high:     3,
  normal:   2,
  low:      1,
};

// ── DSP Queue Engine ──────────────────────────────────────────────────────────

class DSPQueueEngine {
  private jobs        = new Map<string, DSPJob>();
  private running     = new Set<string>();
  private counter     = 0;
  private maxConcurrent: number;
  private processing  = false;
  private durations:  number[] = [];
  private startTime   = Date.now();

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  // ── Enqueue ─────────────────────────────────────────────────────────────────

  enqueue(params: {
    type:        JobType;
    payload:     Record<string, unknown>;
    priority?:   JobPriority;
    timeout?:    number;
    maxRetries?: number;
    onProgress?: (p: JobProgress) => void;
    onComplete?: (result: unknown) => void;
    onError?:    (error: Error) => void;
  }): string {
    const id: string = `job_${++this.counter}_${Date.now()}`;

    const job: DSPJob = {
      id,
      type:       params.type,
      priority:   params.priority   ?? "normal",
      payload:    params.payload,
      status:     "pending",
      progress:   0,
      step:       "queued",
      createdAt:  Date.now(),
      retries:    0,
      maxRetries: params.maxRetries ?? 2,
      timeout:    params.timeout    ?? 30000,
      onProgress: params.onProgress,
      onComplete: params.onComplete,
      onError:    params.onError,
    };

    this.jobs.set(id, job);
    this.tick();
    return id;
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === "running") {
      this.running.delete(jobId);
    }
    job.status  = "cancelled";
    job.endedAt = Date.now();
    return true;
  }

  cancelAll(): void {
    for (const [id] of this.jobs) this.cancel(id);
  }

  // ── Get Job ─────────────────────────────────────────────────────────────────

  getJob(jobId: string): DSPJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  // ── Queue processing ─────────────────────────────────────────────────────────

  private tick(): void {
    if (this.processing) return;
    this.processing = true;
    setTimeout(() => {
      this.process();
      this.processing = false;
    }, 0);
  }

  private getNextJob(): DSPJob | null {
    let best: DSPJob | null = null;
    let bestScore = -1;

    for (const [, job] of this.jobs) {
      if (job.status !== "pending") continue;
      const age   = (Date.now() - job.createdAt) / 1000;
      const score = PRIORITY_WEIGHT[job.priority] * 10 + age;
      if (score > bestScore) { bestScore = score; best = job; }
    }
    return best;
  }

  private async process(): Promise<void> {
    while (this.running.size < this.maxConcurrent) {
      const job = this.getNextJob();
      if (!job) break;
      this.executeJob(job);
    }
  }

  private async executeJob(job: DSPJob): Promise<void> {
    job.status    = "running";
    job.startedAt = Date.now();
    job.step      = "starting";
    this.running.add(job.id);

    const timeoutId = setTimeout(() => {
      if (job.status === "running") {
        this.failJob(job, new Error(`Job timeout after ${job.timeout}ms`));
      }
    }, job.timeout);

    try {
      const result = await this.runJob(job);
      clearTimeout(timeoutId);

        const cancelled = this.jobs.get(job.id)?.status === "cancelled";
      if (cancelled) return;

      job.status   = "completed";
      job.endedAt  = Date.now();
      job.progress = 100;
      job.result   = result;

      const duration = job.endedAt - (job.startedAt ?? job.endedAt);
      this.durations.push(duration);
      if (this.durations.length > 100) this.durations.shift();

      job.onComplete?.(result);
    } catch(e) {
      clearTimeout(timeoutId);
      const err = e instanceof Error ? e : new Error(String(e));

      if (job.retries < job.maxRetries) {
        job.retries++;
        job.status = "pending";
        job.step   = `retry ${job.retries}/${job.maxRetries}`;
        this.running.delete(job.id);
        setTimeout(() => this.tick(), 1000 * job.retries);
        return;
      }

      this.failJob(job, err);
    } finally {
      this.running.delete(job.id);
      // Process next jobs
      setTimeout(() => this.tick(), 0);
    }
  }

  private failJob(job: DSPJob, error: Error): void {
    job.status  = "failed";
    job.endedAt = Date.now();
    job.error   = error.message;
    this.running.delete(job.id);
    job.onError?.(error);
  }

  private updateProgress(job: DSPJob, percent: number, step: string): void {
    job.progress = percent;
    job.step     = step;
    job.onProgress?.({
      jobId:   job.id,
      percent,
      step,
      elapsed: Date.now() - (job.startedAt ?? Date.now()),
    });
  }

  private async runJob(job: DSPJob): Promise<unknown> {
    const samples    = job.payload["samples"]    as Float32Array | undefined;
    const sampleRate = job.payload["sampleRate"] as number       | undefined;

    if (!samples || !sampleRate) {
      throw new Error("Missing samples or sampleRate in job payload");
    }

    switch (job.type) {

      case "COMPUTE_SNR": {
        this.updateProgress(job, 50, "Computing SNR");
        return this.computeSNR(samples, sampleRate);
      }

      case "COMPUTE_VAD": {
        this.updateProgress(job, 50, "Voice Activity Detection");
        return this.computeVAD(samples, sampleRate);
      }

      case "COMPUTE_RT60": {
        this.updateProgress(job, 50, "RT60 Analysis");
        return this.computeRT60(samples, sampleRate);
      }

      case "COMPUTE_FFT": {
        this.updateProgress(job, 50, "FFT Analysis");
        return this.computeFFT(samples, sampleRate,
          job.payload["fftSize"] as number ?? 2048);
      }

      case "ANALYZE_QC": {
        this.updateProgress(job, 10, "SNR");
        const snr  = this.computeSNR(samples, sampleRate);
        this.updateProgress(job, 30, "VAD");
        const vad  = this.computeVAD(samples, sampleRate);
        this.updateProgress(job, 55, "FFT");
        const fft  = this.computeFFT(samples, sampleRate, 2048);
        this.updateProgress(job, 75, "RT60");
        const rt60 = this.computeRT60(samples, sampleRate);
        this.updateProgress(job, 95, "Finalizing");
        return { snr, vad, fft, rt60 };
      }

      case "BATCH_QC": {
        const files = job.payload["files"] as Float32Array[];
        const results = [];
        for (let i = 0; i < files.length; i++) {
          this.updateProgress(job,
            Math.round((i / files.length) * 100),
            `File ${i+1}/${files.length}`
          );
          results.push(this.computeSNR(files[i], sampleRate));
        }
        return results;
      }

      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  // ── DSP Implementations ──────────────────────────────────────────────────────

  private computeSNR(samples: Float32Array, sr: number) {
    const frameSize = Math.round(0.02 * sr);
    const hopSize   = Math.round(0.01 * sr);
    const energies: number[] = [];
    for (let i = 0; i + frameSize <= samples.length; i += hopSize) {
      let e = 0;
      for (let j = 0; j < frameSize; j++) e += samples[i+j]**2;
      energies.push(e / frameSize);
    }
    energies.sort((a,b) => a-b);
    const cut    = Math.max(1, Math.floor(energies.length * 0.1));
    const noise  = energies.slice(0, cut).reduce((s,v) => s+v, 0) / cut;
    const signal = energies.slice(-cut).reduce((s,v) => s+v, 0) / cut;
    return {
      snrDb:       noise > 0 ? Math.min(80, 10*Math.log10(signal/noise)) : 60,
      noiseFloorDb: noise > 0 ? 10*Math.log10(noise) : -120,
    };
  }

  private computeVAD(samples: Float32Array, sr: number) {
    const frameSize = Math.round(0.02 * sr);
    const hopSize   = Math.round(0.01 * sr);
    const energies: number[] = [];
    for (let i = 0; i + frameSize <= samples.length; i += hopSize) {
      let e = 0;
      for (let j = 0; j < frameSize; j++) e += samples[i+j]**2;
      energies.push(e / frameSize);
    }
    const sorted = [...energies].sort((a,b) => a-b);
    const cut    = Math.max(1, Math.floor(sorted.length * 0.1));
    const noise  = sorted.slice(0, cut).reduce((s,v) => s+v, 0) / cut;
    const thresh = noise * 6;
    const speechFrames = energies.filter(e => e > thresh).length;
    return { speechRatio: energies.length > 0 ? speechFrames/energies.length : 0 };
  }

  private computeRT60(samples: Float32Array, sr: number) {
    let totalE = 0;
    for (let i = 0; i < samples.length; i++) totalE += samples[i]**2;
    let cumE = 0, t5 = -1, t35 = -1;
    for (let i = 0; i < samples.length; i++) {
      cumE += samples[i]**2;
      const edc = 10*Math.log10((totalE-cumE+1e-10)/(totalE+1e-10));
      if (t5  < 0 && edc <= -5)  t5  = i/sr;
      if (t35 < 0 && edc <= -35) t35 = i/sr;
    }
    const rt60Ms = (t5 >= 0 && t35 > t5) ? (t35-t5)*2*1000 : 0;
    return { rt60Ms, environment: rt60Ms < 150 ? "studio" : rt60Ms < 500 ? "room" : "bathroom" };
  }

  private computeFFT(samples: Float32Array, sr: number, fftSize: number) {
    const re  = new Float64Array(fftSize);
    const im  = new Float64Array(fftSize);
    const len = Math.min(fftSize, samples.length);
    for (let i = 0; i < len; i++)
      re[i] = samples[i] * 0.5*(1-Math.cos(2*Math.PI*i/(len-1)));
    // Simple FFT
    const n = re.length;
    for (let i=1,j=0; i<n; i++) {
      let bit=n>>1;
      for(;j&bit;bit>>=1) j^=bit;
      j^=bit;
      if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
    }
    for(let len2=2;len2<=n;len2<<=1){
      const ang=(-2*Math.PI)/len2,wRe=Math.cos(ang),wIm=Math.sin(ang);
      for(let i=0;i<n;i+=len2){
        let cRe=1,cIm=0;
        for(let j=0;j<len2>>1;j++){
          const uRe=re[i+j],uIm=im[i+j];
          const vRe=re[i+j+len2/2]*cRe-im[i+j+len2/2]*cIm;
          const vIm=re[i+j+len2/2]*cIm+im[i+j+len2/2]*cRe;
          re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;
          re[i+j+len2/2]=uRe-vRe;im[i+j+len2/2]=uIm-vIm;
          const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;
        }
      }
    }
    const mag = new Float32Array(fftSize/2);
    for(let i=0;i<fftSize/2;i++) mag[i]=Math.sqrt(re[i]**2+im[i]**2);
    const binHz = sr/fftSize;
    const h50   = Math.round(50/binHz);
    const h60   = Math.round(60/binHz);
    const avg   = mag.reduce((s,v)=>s+v,0)/mag.length;
    return {
      humDetected: (mag[h50]||0) > avg*8 || (mag[h60]||0) > avg*8,
      humFreq:     (mag[h50]||0) > (mag[h60]||0) ? 50 : 60,
    };
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  getStats(): QueueStats {
    const jobs     = [...this.jobs.values()];
    const completed = jobs.filter(j => j.status === "completed");
    const avgDur   = this.durations.length > 0
      ? this.durations.reduce((s,v) => s+v, 0) / this.durations.length : 0;
    const elapsed  = (Date.now() - this.startTime) / 1000;

    return {
      total:      jobs.length,
      pending:    jobs.filter(j => j.status === "pending").length,
      running:    jobs.filter(j => j.status === "running").length,
      completed:  completed.length,
      failed:     jobs.filter(j => j.status === "failed").length,
      cancelled:  jobs.filter(j => j.status === "cancelled").length,
      avgDuration: Math.round(avgDur),
      throughput:  elapsed > 0 ? Math.round(completed.length / elapsed * 60) : 0,
    };
  }

  clearCompleted(): void {
    for (const [id, job] of this.jobs)
      if (job.status === "completed" || job.status === "cancelled")
        this.jobs.delete(id);
  }

  get activeCount(): number { return this.running.size; }
  get pendingCount(): number {
    return [...this.jobs.values()].filter(j => j.status === "pending").length;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const dspQueue = new DSPQueueEngine(3);

// ── Helper ────────────────────────────────────────────────────────────────────

export function enqueueAnalysis(
  samples:    Float32Array,
  sampleRate: number,
  type:       JobType = "ANALYZE_QC",
  priority:   JobPriority = "normal",
  onProgress?: (p: JobProgress) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    dspQueue.enqueue({
      type,
      priority,
      payload:    { samples, sampleRate },
      onProgress,
      onComplete: resolve,
      onError:    reject,
    });
  });
}
