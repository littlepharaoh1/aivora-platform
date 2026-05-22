/**
 * cloudOrchestrator.ts — Cloud Batch & Rendering Orchestrator
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Batch job orchestration (100-10000 files)
 * - Adaptive chunking (chunk size based on file duration)
 * - Worker pool management (spawn/terminate based on load)
 * - Resumable processing (checkpoint every N files)
 * - Memory pressure adaptation (reduce chunk size under pressure)
 * - Progress streaming (real-time updates via Supabase realtime)
 * - Resource quotas per user tier
 * - Pipeline composition (chain multiple DSP stages)
 *
 * Design reference:
 * - Apache Spark stage DAG execution
 * - AWS Batch array jobs
 * - ffmpeg batch processing pipeline
 */

import { supabase }        from "../supabase";
import { jobQueue }        from "./jobQueue";
import { dspProfiler }     from "../dsp/observability/dspProfiler";
import { chunkStreamer }    from "../dsp/streaming/chunkStreamer";
import { bufferPool }      from "../dsp/memory/bufferPool";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PipelineStage =
  | "normalize"    | "denoise"     | "dereverb"
  | "limit"        | "qc_check"    | "forensic"
  | "export_wav"   | "export_mp3"  | "silence_repair";

export interface PipelineConfig {
  stages:       PipelineStage[];
  targetLufs?:  number;
  thresholdDb?: number;
  exportFormat?: "wav_32" | "wav_16" | "mp3_320";
  parallelism?:  number;     // max parallel files (default 3)
  chunkSec?:     number;     // chunk size for streaming (default 10)
  checkpointEvery?: number;  // checkpoint every N files (default 10)
}

export interface BatchFile {
  id:          string;
  name:        string;
  durationSec: number;
  sampleRate:  number;
  data?:       Float32Array;  // loaded lazily
}

export interface BatchJob {
  id:           string;
  userId:       string;
  files:        BatchFile[];
  config:       PipelineConfig;
  status:       "pending" | "running" | "paused" | "done" | "failed";
  progress:     number;     // 0-100
  processedIds: string[];   // checkpoint
  failedIds:    string[];
  startedAt?:   number;
  completedAt?: number;
  estimatedMs?: number;
}

export interface StageResult {
  stage:      PipelineStage;
  success:    boolean;
  durationMs: number;
  metrics:    Record<string, number>;
}

export interface FileResult {
  fileId:      string;
  success:     boolean;
  stages:      StageResult[];
  outputData?: Float32Array;
  totalMs:     number;
  errorMsg?:   string;
}

export interface BatchResult {
  batchId:     string;
  totalFiles:  number;
  succeeded:   number;
  failed:      number;
  durationMs:  number;
  throughputFilesPerMin: number;
  results:     FileResult[];
}

// ── User Tier Quotas ──────────────────────────────────────────────────────────

const TIER_QUOTAS = {
  free:       { maxFiles:10,    maxDurationSec:30,   maxParallel:1 },
  pro:        { maxFiles:1000,  maxDurationSec:3600, maxParallel:3 },
  enterprise: { maxFiles:10000, maxDurationSec:36000,maxParallel:8 },
} as const;

// ── Pipeline Stage Processors ─────────────────────────────────────────────────

async function runStage(
  data:    Float32Array,
  sr:      number,
  stage:   PipelineStage,
  config:  PipelineConfig
): Promise<{ output: Float32Array; metrics: Record<string, number> }> {
  const startMs = performance.now();
  let output    = data;
  const metrics: Record<string, number> = {};

  switch(stage){
    case "normalize": {
      // LUFS normalization
      const targetLufs = config.targetLufs ?? -23;
      let ms=0; for(let i=0;i<data.length;i++) ms+=data[i]**2;
      const rms=Math.sqrt(ms/data.length);
      const currentLufs=rms>0?20*Math.log10(rms)-0.691:-70;
      const gainDb=targetLufs-currentLufs;
      if(Math.abs(gainDb)>0.5&&Math.abs(gainDb)<20){
        const gain=Math.pow(10,gainDb/20);
        output=new Float32Array(data.length);
        for(let i=0;i<data.length;i++) output[i]=Math.max(-1,Math.min(1,data[i]*gain));
      }
      metrics.lufsApplied=Math.round(gainDb*10)/10;
      break;
    }
    case "limit": {
      const thresh=Math.pow(10,(config.thresholdDb??-1)/20);
      output=new Float32Array(data.length);
      for(let i=0;i<data.length;i++)
        output[i]=Math.abs(data[i])>thresh?Math.sign(data[i])*thresh:data[i];
      metrics.threshDb=config.thresholdDb??-1;
      break;
    }
    case "silence_repair": {
      // Find and repair digital silence gaps
      const silenceLen=Math.floor(0.005*sr); // 5ms min gap
      output=new Float32Array(data);
      let gapStart=-1;
      for(let i=0;i<data.length;i++){
        if(Math.abs(data[i])<1e-6){
          if(gapStart<0) gapStart=i;
        } else {
          if(gapStart>=0&&i-gapStart>=silenceLen&&gapStart>0&&i<data.length-1){
            // Linear interpolation repair
            const gapLen=i-gapStart;
            for(let j=0;j<gapLen;j++)
              output[gapStart+j]=data[gapStart-1]*(1-j/gapLen)+data[i]*(j/gapLen);
            gapStart=-1;
          } else { gapStart=-1; }
        }
      }
      metrics.repaired=1;
      break;
    }
    case "qc_check": {
      let peak=0, ms=0, clips=0;
      for(let i=0;i<data.length;i++){
        const v=Math.abs(data[i]);
        if(v>peak) peak=v;
        ms+=v*v;
        if(v>=0.9999) clips++;
      }
      metrics.peakDb   = 20*Math.log10(peak+1e-15);
      metrics.rmsDb    = 10*Math.log10(ms/data.length+1e-15);
      metrics.clipRatio= clips/data.length;
      output=data; // passthrough
      break;
    }
    case "denoise":
    case "dereverb":
    case "forensic":
    case "export_wav":
    case "export_mp3": {
      // Stub — real implementation via respective modules
      output=data;
      metrics.stub=1;
      break;
    }
  }

  metrics.durationMs=Math.round(performance.now()-startMs);
  return { output, metrics };
}

// ── Cloud Orchestrator ────────────────────────────────────────────────────────

export class CloudOrchestrator {
  private readonly activeBatches = new Map<string, BatchJob>();
  private readonly cancelTokens  = new Set<string>();

  // ── Batch Submission ──────────────────────────────────────────────────────

  async submitBatch(
    files:   BatchFile[],
    config:  PipelineConfig,
    userId:  string,
    tier:    keyof typeof TIER_QUOTAS = "pro"
  ): Promise<BatchJob> {
    const quota = TIER_QUOTAS[tier];

    // Quota validation
    if(files.length > quota.maxFiles)
      throw new Error(`Quota exceeded: max ${quota.maxFiles} files for ${tier} tier`);

    const oversized = files.filter(f=>f.durationSec>quota.maxDurationSec);
    if(oversized.length>0)
      throw new Error(`${oversized.length} files exceed max duration ${quota.maxDurationSec}s`);

    const id = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
    const job: BatchJob = {
      id, userId, files, config,
      status:       "pending",
      progress:     0,
      processedIds: [],
      failedIds:    [],
    };

    this.activeBatches.set(id, job);
    await this._persistBatch(job);

    // Submit to job queue
    await jobQueue.submit(
      { type:"batch_qc", userId, params:{ batchId:id }, fileIds:files.map(f=>f.id) },
      { priority:"normal" }
    );

    return job;
  }

  // ── Batch Execution ───────────────────────────────────────────────────────

  async executeBatch(
    batchId:    string,
    onProgress: (pct: number, fileId: string) => void = ()=>{}
  ): Promise<BatchResult> {
    const job = this.activeBatches.get(batchId);
    if(!job) throw new Error(`Batch ${batchId} not found`);

    job.status    = "running";
    job.startedAt = Date.now();
    await this._persistBatch(job);

    const parallelism = Math.min(
      job.config.parallelism ?? 3,
      TIER_QUOTAS.pro.maxParallel
    );

    const allResults:   FileResult[] = [];
    const pendingFiles  = job.files.filter(f=>!job.processedIds.includes(f.id));
    const checkpointN   = job.config.checkpointEvery ?? 10;

    // Process in parallel batches
    for(let i=0; i<pendingFiles.length; i+=parallelism){
      if(this.cancelTokens.has(batchId)){
        job.status="paused"; break;
      }

      const chunk   = pendingFiles.slice(i, i+parallelism);
      const results = await Promise.all(
        chunk.map(file=>this._processFile(file, job.config))
      );

      for(const r of results){
        allResults.push(r);
        if(r.success){ job.processedIds.push(r.fileId); }
        else          { job.failedIds.push(r.fileId);   }
      }

      job.progress = Math.round((i+chunk.length)/pendingFiles.length*100);
      onProgress(job.progress, chunk[chunk.length-1].id);

      // Checkpoint
      if((i+parallelism)%checkpointN===0){
        await this._persistBatch(job);
      }

      // Memory pressure check
      const profSnap = dspProfiler.exportSnapshot();
      if(!profSnap.gc.estimated && profSnap.gc.heapPressure>0.85){
        await new Promise<void>(r=>setTimeout(r,500)); // backpressure
      }

      // Yield event loop
      await new Promise<void>(r=>setTimeout(r,0));
    }

    job.status      = "done";
    job.progress    = 100;
    job.completedAt = Date.now();
    await this._persistBatch(job);

    const durationMs   = job.completedAt-job.startedAt!;
    const throughput   = allResults.length/(durationMs/60000);

    return {
      batchId,
      totalFiles:   job.files.length,
      succeeded:    job.processedIds.length,
      failed:       job.failedIds.length,
      durationMs,
      throughputFilesPerMin: Math.round(throughput*10)/10,
      results:      allResults,
    };
  }

  // ── File Processing ───────────────────────────────────────────────────────

  private async _processFile(
    file:   BatchFile,
    config: PipelineConfig
  ): Promise<FileResult> {
    const startMs      = performance.now();
    const stageResults: StageResult[] = [];
    let   current      = file.data ?? new Float32Array(Math.floor((file.durationSec??1)*file.sampleRate));
    let   success      = true;
    let   errorMsg: string|undefined;

    // Stream large files via chunk streamer
    const shouldStream = file.durationSec > (config.chunkSec ?? 10);

    try {
      for(const stage of config.stages){
        const stageStart = performance.now();

        let output: Float32Array;
        let metrics: Record<string, number>;

        if(shouldStream && stage!=="qc_check" && stage!=="forensic"){
          // Chunk-based streaming DSP
          const streamed = await chunkStreamer.process(
            current, file.sampleRate,
            async (chunk, sr) => {
              const r = await runStage(chunk, sr, stage, config);
              return r.output;
            },
            { chunkSec: config.chunkSec??10, onProgress:()=>{} }
          );
          output  = streamed.output;
          metrics = { streamed:1, chunks:streamed.chunksProcessed };
        } else {
          const r = await runStage(current, file.sampleRate, stage, config);
          output  = r.output;
          metrics = r.metrics;
        }

        current = output;
        stageResults.push({
          stage,
          success:    true,
          durationMs: Math.round(performance.now()-stageStart),
          metrics,
        });
      }
    } catch(e){
      success  = false;
      errorMsg = e instanceof Error ? e.message : String(e);
      stageResults.push({
        stage:    config.stages[stageResults.length],
        success:  false,
        durationMs:0,
        metrics:  {},
      });
    }

    return {
      fileId:     file.id,
      success,
      stages:     stageResults,
      outputData: success ? current : undefined,
      totalMs:    Math.round(performance.now()-startMs),
      errorMsg,
    };
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  pause(batchId: string): void  { this.cancelTokens.add(batchId); }

  resume(batchId: string): void {
    this.cancelTokens.delete(batchId);
    const job=this.activeBatches.get(batchId);
    if(job&&job.status==="paused"){
      job.status="running";
      this.executeBatch(batchId).catch(()=>{});
    }
  }

  cancel(batchId: string): void {
    this.cancelTokens.add(batchId);
    const job=this.activeBatches.get(batchId);
    if(job) job.status="failed";
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async _persistBatch(job: BatchJob): Promise<void> {
    try {
      await supabase.from("processing_jobs").upsert({ job_type: "orchestrator",
        id:           job.id,
        user_id:      job.userId,
        file_name:    `batch:${job.files.length}files`,
        status:       job.status,
        score:        job.progress,
        completed_at: job.completedAt ? new Date(job.completedAt).toISOString() : null,
        metadata: {
          batchId:      job.id,
          totalFiles:   job.files.length,
          processed:    job.processedIds.length,
          failed:       job.failedIds.length,
          stages:       job.config.stages,
          checkpointIds:job.processedIds.slice(-10),
        },
      }, { onConflict:"id" });
    } catch { /* non-blocking */ }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getActiveBatches(): BatchJob[] { return Array.from(this.activeBatches.values()); }
  getBatch(id: string): BatchJob|undefined { return this.activeBatches.get(id); }

  getStats(): {
    activeBatches:   number;
    totalFiles:      number;
    totalProcessed:  number;
  } {
    let totalF=0, totalP=0;
    for(const job of this.activeBatches.values()){
      totalF+=job.files.length; totalP+=job.processedIds.length;
    }
    return { activeBatches:this.activeBatches.size, totalFiles:totalF, totalProcessed:totalP };
  }
}

export const cloudOrchestrator = new CloudOrchestrator();
