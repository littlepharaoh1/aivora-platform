/**
 * datasetPipeline.ts — Dataset Pipeline Orchestration
 * Aivora Platform — Phase 7.3
 *
 * Deterministic DAG execution.
 * Same pipeline_name + same input → same execution order.
 * No autonomous planning. No adaptive routing.
 * All steps explicit + versioned.
 */

import { supabase }  from "../supabase";
import { emitEvent } from "../telemetry/emitter";
import { scheduler } from "../../runtime/runtimeScheduler";

export const PIPELINE_VERSION = "7.3.0";

// ── Pipeline Step Types ───────────────────────────────────────────────────────

export type PipelineStepType =
  | "QUALITY_GATE"
  | "SPLIT_ASSIGNMENT"
  | "EXPORT_JSONL"
  | "VALIDATE_LINEAGE"
  | "COMPUTE_CHECKSUM"
  | "PUBLISH_VERSION";

export interface PipelineStep {
  id:        string;
  type:      PipelineStepType;
  depends:   string[];           // step ids this depends on
  required:  boolean;
}

export interface PipelineDefinition {
  name:     string;
  version:  string;
  steps:    PipelineStep[];
}

// ── Built-in Pipeline Definitions ────────────────────────────────────────────
// All explicit — no runtime-generated DAGs

export const STANDARD_PIPELINE: PipelineDefinition = {
  name:    "standard_dataset_factory",
  version: PIPELINE_VERSION,
  steps: [
    { id:"quality_gate",      type:"QUALITY_GATE",      depends:[],              required:true  },
    { id:"split_assignment",  type:"SPLIT_ASSIGNMENT",  depends:["quality_gate"],required:true  },
    { id:"export_jsonl",      type:"EXPORT_JSONL",      depends:["split_assignment"],required:true },
    { id:"validate_lineage",  type:"VALIDATE_LINEAGE",  depends:["export_jsonl"], required:true  },
    { id:"compute_checksum",  type:"COMPUTE_CHECKSUM",  depends:["export_jsonl"], required:true  },
    { id:"publish_version",   type:"PUBLISH_VERSION",   depends:["validate_lineage","compute_checksum"],required:true},
  ],
};

export const QUICK_EXPORT_PIPELINE: PipelineDefinition = {
  name:    "quick_export",
  version: PIPELINE_VERSION,
  steps: [
    { id:"quality_gate",     type:"QUALITY_GATE",     depends:[],              required:true },
    { id:"split_assignment", type:"SPLIT_ASSIGNMENT", depends:["quality_gate"],required:true },
    { id:"export_jsonl",     type:"EXPORT_JSONL",     depends:["split_assignment"],required:true },
    { id:"compute_checksum", type:"COMPUTE_CHECKSUM", depends:["export_jsonl"], required:true },
  ],
};

// ── Topological Sort (deterministic) ─────────────────────────────────────────

export function topoSort(steps: PipelineStep[]): PipelineStep[] {
  const visited    = new Set<string>();
  const inProgress = new Set<string>(); // cycle detection
  const result:    PipelineStep[] = [];
  const stepMap    = new Map(steps.map(s => [s.id, s]));

  function visit(id: string, depth = 0): void {
    if(depth > 50) throw new Error(`[Pipeline] topoSort depth exceeded — possible cycle at: ${id}`);
    if(visited.has(id)) return;
    if(inProgress.has(id)) throw new Error(`[Pipeline] Circular dependency detected: ${id}`);

    inProgress.add(id);
    const step = stepMap.get(id);
    if(step) {
      // Sort dependencies for determinism
      [...step.depends].sort().forEach(dep => visit(dep, depth + 1));
      result.push(step);
    }
    inProgress.delete(id);
    visited.add(id);
  }

  // Process in stable alphabetical order
  [...steps].sort((a,b) => a.id.localeCompare(b.id)).forEach(s => {
    try { visit(s.id); }
    catch(e) { throw e; } // re-throw cycle errors
  });
  return result;
}

// ── Pipeline Runner ───────────────────────────────────────────────────────────

export interface PipelineContext {
  project_name:    string;
  version_id?:     string;
  quality_gate_id?:string;
  export_id?:      string;
  split_seed:      number;
  correlation_id:  string;
}

export interface StepResult {
  step_id:   string;
  step_type: PipelineStepType;
  success:   boolean;
  error?:    string;
  output?:   Record<string, unknown>;
  duration_ms:number;
}

export interface PipelineRunResult {
  run_id:       string;
  pipeline_name:string;
  success:      boolean;
  steps:        StepResult[];
  total_ms:     number;
  started_at:   string;
  completed_at: string;
}

export async function runPipeline(
  definition:  PipelineDefinition,
  context:     PipelineContext,
  stepHandlers:Partial<Record<PipelineStepType, (ctx: PipelineContext) => Promise<Record<string,unknown>>>>,
): Promise<PipelineRunResult> {

  const startedAt = new Date().toISOString();
  const runId     = crypto.randomUUID();
  const t0        = Date.now();
  const results:  StepResult[] = [];

  // Create pipeline_run record
  const { data: runRecord } = await supabase
    .from("pipeline_runs")
    .insert({
      pipeline_name:    definition.name,
      pipeline_version: definition.version,
      project_name:     context.project_name,
      status:           "running",
      started_at:       startedAt,
      version_id:       context.version_id ?? null,
      quality_gate_id:  context.quality_gate_id ?? null,
    })
    .select("id")
    .single();

  const dbRunId = runRecord?.id ?? runId;

  emitEvent({
    event_type:     "ADMIN_ACTION",
    event_source:   "qc_workstation",
    correlation_id: context.correlation_id,
    severity:       "info",
    payload: {
      action:        "PIPELINE_STARTED",
      pipeline_name: definition.name,
      run_id:        dbRunId,
      project_name:  context.project_name,
    },
  });

  // Execute steps in topo order
  const ordered = topoSort(definition.steps);
  let   success = true;

  for(const step of ordered) {
    const stepT0  = Date.now();
    const handler = stepHandlers[step.type];

    if(!handler) {
      results.push({
        step_id:    step.id,
        step_type:  step.type,
        success:    !step.required,
        error:      `no handler for ${step.type}`,
        duration_ms:0,
      });
      if(step.required) { success = false; break; }
      continue;
    }

    try {
      const output = await handler(context);
      results.push({
        step_id:    step.id,
        step_type:  step.type,
        success:    true,
        output,
        duration_ms:Date.now() - stepT0,
      });
    } catch(e) {
      const err = e instanceof Error ? e.message.slice(0, 200) : "unknown";
      results.push({
        step_id:    step.id,
        step_type:  step.type,
        success:    false,
        error:      err,
        duration_ms:Date.now() - stepT0,
      });
      if(step.required) { success = false; break; }
    }
  }

  const completedAt = new Date().toISOString();
  const totalMs     = Date.now() - t0;

  // Update pipeline_run status
  await supabase
    .from("pipeline_runs")
    .update({
      status:       success ? "completed" : "failed",
      completed_at: success ? completedAt : undefined,
      failed_at:    success ? undefined    : completedAt,
      files_processed: results.filter(r => r.success).length,
    })
    .eq("id", dbRunId);

  emitEvent({
    event_type:     "ADMIN_ACTION",
    event_source:   "qc_workstation",
    correlation_id: context.correlation_id,
    severity:       success ? "info" : "error",
    payload: {
      action:        success ? "PIPELINE_COMPLETED" : "PIPELINE_FAILED",
      run_id:        dbRunId,
      total_ms:      totalMs,
      steps_count:   results.length,
    },
  });

  return {
    run_id:       dbRunId,
    pipeline_name:definition.name,
    success,
    steps:        results,
    total_ms:     totalMs,
    started_at:   startedAt,
    completed_at: completedAt,
  };
}
