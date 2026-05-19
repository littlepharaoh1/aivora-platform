/**
 * trainingExporter.ts — Training Data Export Pipeline
 * Aivora Audio Infrastructure Platform
 *
 * Exports verified benchmark results as training data:
 * - JSONL format (OpenAI fine-tuning compatible)
 * - HuggingFace datasets format
 * - Preference pairs (DPO/RLHF format)
 * - Quality-filtered export (min score threshold)
 * - Metadata-rich records for reproducibility
 */

import type { VerifierResult } from "./oracleValidator";
import type { MetricId }       from "./benchmarkMarketplace";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExportFormat =
  | "jsonl_openai"       // OpenAI fine-tuning format
  | "jsonl_preference"   // DPO preference pairs
  | "huggingface"        // HuggingFace datasets JSON
  | "csv"                // Simple CSV for analysis
  | "aivora_native";     // Aivora internal format

export interface ExportOptions {
  format:           ExportFormat;
  minScore?:        number;     // filter by minimum score (default 0)
  maxEntries?:      number;     // cap entries (default unlimited)
  includeMetrics?:  boolean;    // include raw metrics (default true)
  includeMetadata?: boolean;    // include task metadata (default true)
  splitRatio?:      number;     // train/val split 0-1 (default 0.9)
}

export interface ExportRecord {
  id:           string;
  taskId:       string;
  modelName:    string;
  score:        number;
  passed:       boolean;
  metrics:      Record<MetricId, number>;
  verified:     boolean;
  timestamp:    number;
  inputHash:    string;
}

export interface ExportBundle {
  format:       ExportFormat;
  trainContent: string;
  valContent:   string;
  totalRecords: number;
  trainRecords: number;
  valRecords:   number;
  filteredOut:  number;
  exportedAt:   number;
  checksum:     string;
}

// ── Record Builder ────────────────────────────────────────────────────────────

function buildRecord(r: VerifierResult): ExportRecord {
  return {
    id:        `${r.taskId}_${r.submissionId}_${r.timestamp}`,
    taskId:    r.taskId,
    modelName: r.submissionId,
    score:     r.score,
    passed:    r.passed,
    metrics:   r.metrics,
    verified:  r.verified,
    timestamp: r.timestamp,
    inputHash: r.inputHash,
  };
}

// ── JSONL OpenAI Format ───────────────────────────────────────────────────────

function toJSONLOpenAI(records: ExportRecord[]): string {
  return records.map(r => JSON.stringify({
    messages: [
      {
        role:    "system",
        content: "You are an audio quality evaluator. Analyze the audio processing result and provide quality assessment.",
      },
      {
        role:    "user",
        content: `Task: ${r.taskId}\nAudio hash: ${r.inputHash}\nEvaluate this audio processing result.`,
      },
      {
        role:    "assistant",
        content: [
          `Score: ${r.score}/100`,
          `Status: ${r.passed?"PASS":"FAIL"}`,
          `Metrics: ${Object.entries(r.metrics).map(([k,v])=>`${k}=${v}`).join(", ")}`,
          `Verified: ${r.verified?"oracle-verified":"self-reported"}`,
        ].join("\n"),
      },
    ],
    metadata: { taskId:r.taskId, score:r.score, verified:r.verified },
  })).join("\n");
}

// ── JSONL Preference Pairs (DPO) ──────────────────────────────────────────────

function toJSONLPreference(records: ExportRecord[]): string {
  // Sort by score descending
  const sorted  = [...records].sort((a,b)=>b.score-a.score);
  const pairs:  string[] = [];

  // Create preference pairs: high score vs low score
  const high = sorted.filter(r=>r.score>=70);
  const low  = sorted.filter(r=>r.score<50);

  for(let i=0;i<Math.min(high.length,low.length);i++){
    const chosen  = high[i];
    const rejected= low[i];
    pairs.push(JSON.stringify({
      prompt:   `Task: ${chosen.taskId}\nInput: ${chosen.inputHash}`,
      chosen:   `Score: ${chosen.score}/100 | ${Object.entries(chosen.metrics).map(([k,v])=>`${k}=${v}`).join(" | ")}`,
      rejected: `Score: ${rejected.score}/100 | ${Object.entries(rejected.metrics).map(([k,v])=>`${k}=${v}`).join(" | ")}`,
      reward:   chosen.score/100,
      metadata: { chosenId:chosen.id, rejectedId:rejected.id, verified:chosen.verified },
    }));
  }

  return pairs.join("\n");
}

// ── HuggingFace Format ────────────────────────────────────────────────────────

function toHuggingFace(records: ExportRecord[]): string {
  const dataset = {
    dataset_info: {
      name:        "aivora_audio_bench",
      version:     "1.0.0",
      description: "Audio processing benchmark results from Aivora Platform",
      features: {
        id:        { dtype:"string" },
        task_id:   { dtype:"string" },
        score:     { dtype:"float32" },
        passed:    { dtype:"bool" },
        verified:  { dtype:"bool" },
        timestamp: { dtype:"int64" },
        metrics:   { dtype:"dict" },
      },
      num_rows: records.length,
    },
    data: records.map(r=>({
      id:        r.id,
      task_id:   r.taskId,
      model:     r.modelName,
      score:     r.score,
      passed:    r.passed,
      verified:  r.verified,
      timestamp: r.timestamp,
      input_hash:r.inputHash,
      metrics:   r.metrics,
    })),
  };
  return JSON.stringify(dataset, null, 2);
}

// ── CSV Format ────────────────────────────────────────────────────────────────

function toCSV(records: ExportRecord[]): string {
  if(records.length===0) return "";

  const allMetrics = Array.from(new Set(records.flatMap(r=>Object.keys(r.metrics))));
  const header     = ["id","task_id","model","score","passed","verified","timestamp",...allMetrics];

  const rows = records.map(r=>[
    r.id, r.taskId, r.modelName,
    r.score, r.passed?1:0, r.verified?1:0, r.timestamp,
    ...allMetrics.map(m=>r.metrics[m as MetricId]??0),
  ]);

  return [
    header.join(","),
    ...rows.map(row=>row.map(v=>`"${v}"`).join(",")),
  ].join("\n");
}

// ── Aivora Native Format ──────────────────────────────────────────────────────

function toAivoraNative(records: ExportRecord[]): string {
  return records.map(r=>JSON.stringify({
    schema:    "aivora_bench_v1",
    ...r,
    exportedAt: Date.now(),
  })).join("\n");
}

// ── Checksum ──────────────────────────────────────────────────────────────────

function simpleChecksum(content: string): string {
  let h=0;
  for(let i=0;i<content.length;i++){h=(h<<5)-h+content.charCodeAt(i);h|=0;}
  return Math.abs(h).toString(16).padStart(8,"0");
}

// ── Main Exporter ─────────────────────────────────────────────────────────────

export class TrainingExporter {

  export(
    results:  VerifierResult[],
    options:  ExportOptions
  ): ExportBundle {
    const minScore   = options.minScore   ?? 0;
    const maxEntries = options.maxEntries ?? Infinity;
    const splitRatio = options.splitRatio ?? 0.9;

    // Build + filter records
    const allRecords  = results.map(buildRecord);
    const filtered    = allRecords.filter(r=>r.score>=minScore).slice(0,maxEntries);
    const filteredOut = allRecords.length - filtered.length;

    // Train/val split
    const splitIdx   = Math.floor(filtered.length*splitRatio);
    const trainRecs  = filtered.slice(0, splitIdx);
    const valRecs    = filtered.slice(splitIdx);

    // Serialize
    let trainContent: string;
    let valContent:   string;

    switch(options.format){
      case "jsonl_openai":
        trainContent = toJSONLOpenAI(trainRecs);
        valContent   = toJSONLOpenAI(valRecs);
        break;
      case "jsonl_preference":
        trainContent = toJSONLPreference(trainRecs);
        valContent   = toJSONLPreference(valRecs);
        break;
      case "huggingface":
        trainContent = toHuggingFace(trainRecs);
        valContent   = toHuggingFace(valRecs);
        break;
      case "csv":
        trainContent = toCSV(trainRecs);
        valContent   = toCSV(valRecs);
        break;
      default:
        trainContent = toAivoraNative(trainRecs);
        valContent   = toAivoraNative(valRecs);
    }

    return {
      format:       options.format,
      trainContent,
      valContent,
      totalRecords: filtered.length,
      trainRecords: trainRecs.length,
      valRecords:   valRecs.length,
      filteredOut,
      exportedAt:   Date.now(),
      checksum:     simpleChecksum(trainContent+valContent),
    };
  }

  /**
   * Download train/val files as browser downloads.
   */
  download(bundle: ExportBundle, baseName = "aivora_bench"): void {
    const ext = bundle.format==="csv"?"csv":
                bundle.format==="huggingface"?"json":"jsonl";

    for(const [suffix,content] of [
      ["train",bundle.trainContent],
      ["val",  bundle.valContent],
    ] as [string,string][]) {
      if(!content) continue;
      const blob = new Blob([content],{type:"application/json"});
      const a    = document.createElement("a");
      a.href     = URL.createObjectURL(blob);
      a.download = `${baseName}_${suffix}.${ext}`;
      a.click();
    }
  }
}

export const trainingExporter = new TrainingExporter();
