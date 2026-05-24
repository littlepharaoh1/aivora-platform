/**
 * orchestrationEngine.ts — Deterministic Orchestration Engine
 * Aivora Platform — Phase 15.2
 *
 * Pre-code safety check:
 * ✅ deterministic: topoSort + explicit step handlers
 * ✅ bounded: MAX_RETRIES=3, MAX_STEPS=50
 * ✅ no autonomous planning — all steps explicit
 * ✅ no adaptive replanning — fixed DAG only
 * ✅ scheduler integration via Tier 5
 * ✅ telemetry on every step
 * ✅ replay safe: same plan → same execution order
 *
 * FORBIDDEN patterns (from agentOrchestrator.ts):
 * ❌ autonomous agent decisions
 * ❌ adaptive step insertion
 * ❌ hidden routing
 */

import { scheduler }  from "../../runtime/runtimeScheduler";
import { emitEvent }  from "../telemetry/emitter";
import { supabase }   from "../supabase";
import { topoSortGraph } from "./projectGraph";
import type { ProjectNode, ProjectEdge } from "./projectGraph";

export const ORCHESTRATION_VERSION = "15.2.0";

// ── Hard Limits ───────────────────────────────────────────────────────────────

export const ORCHESTRATION_LIMITS = {
  MAX_STEPS:      50,
  MAX_RETRIES:    3,      // matches mutationQueue.ts pattern
  STEP_TIMEOUT_MS:30_000,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrchestrationStepType =
  | "VALIDATE_INPUTS"
  | "RUN_QUALITY_GATE"
  | "BUILD_DATASET"
  | "RUN_PIPELINE"
  | "EXPORT_DATASET"
  | "NOTIFY_COMPLETE";

export interface OrchestrationStep {
  id:       string;
  type:     OrchestrationStepType;
  depends:  string[];
  required: boolean;
  retry_count: number;
}

export interface OrchestrationPlan {
  id:           string;
  name:         string;
  version:      string;
  project_id:   string;
  steps:        OrchestrationStep[];
  created_at:   string;
}

export interface StepExecutionResult {
  step_id:    string;
  success:    boolean;
  retries:    number;
  duration_ms:number;
  error?:     string;
}

export interface OrchestrationResult {
  plan_id:     string;
  success:     boolean;
  steps:       StepExecutionResult[];
  total_ms:    number;
  started_at:  string;
  finished_at: string;
  protocol:    string;
}

// ── Deterministic Plan Execution ──────────────────────────────────────────────

export async function executePlan(
  plan:         OrchestrationPlan,
  handlers:     Partial<Record<OrchestrationStepType,
                  (step: OrchestrationStep) => Promise<void>>>,
  correlationId:string,
): Promise<OrchestrationResult> {

  const startedAt = new Date().toISOString();
  const t0        = Date.now();
  const results:  StepExecutionResult[] = [];

  // Enforce MAX_STEPS
  const steps = plan.steps.slice(0, ORCHESTRATION_LIMITS.MAX_STEPS);

  // Deterministic execution order via topoSort
  const nodes: ProjectNode[] = steps.map(s => ({
    id:s.id, type:"pipeline_run", label:s.type,
    status:"pending", created_at:plan.created_at,
  }));
  const edges: ProjectEdge[] = steps.flatMap(s =>
    s.depends.map(d => ({ from_id:d, to_id:s.id, edge_type:"produces" as const }))
  );

  const { order, has_cycles } = topoSortGraph(nodes, edges);

  if(has_cycles) {
    return {
      plan_id:plan.id, success:false, steps:[],
      total_ms:0, started_at:startedAt,
      finished_at:new Date().toISOString(),
      protocol:ORCHESTRATION_VERSION,
    };
  }

  let overallSuccess = true;

  // Execute in topo order
  for(const stepId of order) {
    const step    = steps.find(s => s.id === stepId);
    if(!step) continue;

    const handler = handlers[step.type];
    const stepT0  = Date.now();
    let   retries = 0;
    let   success = false;
    let   lastErr = "";

    // Bounded retries — no unbounded loops
    while(retries <= ORCHESTRATION_LIMITS.MAX_RETRIES && !success) {
      try {
        if(handler) {
          // Submit via scheduler — not direct execution
          await new Promise<void>((resolve, reject) => {
            const taskId = scheduler.submit({
              task_type:      "BATCH",
              priority:       "NORMAL",
              correlation_id: correlationId,
              execute:        async () => { await handler(step); resolve(); },
              onTimeout:      () => reject(new Error(`Step ${step.id} timeout`)),
            });
            if(!taskId) reject(new Error("Scheduler rejected"));
          });
        }
        success = true;
      } catch(e) {
        lastErr = e instanceof Error ? e.message.slice(0,200) : "unknown";
        retries++;
      }
    }

    results.push({
      step_id:     step.id,
      success,
      retries,
      duration_ms: Date.now() - stepT0,
      error:       success ? undefined : lastErr,
    });

    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:correlationId,
      severity:success?"info":"error",
      payload:{
        action:  success?"STEP_COMPLETE":"STEP_FAILED",
        step_id: step.id, step_type:step.type,
        retries, plan_id:plan.id,
      },
    });

    if(!success && step.required) { overallSuccess = false; break; }
  }

  const finishedAt = new Date().toISOString();

  // Persist execution record
  try {
    await supabase.from("pipeline_runs").insert({
      pipeline_name:    plan.name,
      pipeline_version: ORCHESTRATION_VERSION,
      project_name:     plan.project_id,
      status:           overallSuccess ? "completed" : "failed",
      started_at:       startedAt,
      completed_at:     overallSuccess ? finishedAt : undefined,
      failed_at:        overallSuccess ? undefined   : finishedAt,
      files_processed:  results.filter(r => r.success).length,
    });
  } catch { /* silent */ }

  return {
    plan_id:     plan.id,
    success:     overallSuccess,
    steps:       results,
    total_ms:    Date.now() - t0,
    started_at:  startedAt,
    finished_at: finishedAt,
    protocol:    ORCHESTRATION_VERSION,
  };
}

// ── Standard Plan Factory ─────────────────────────────────────────────────────
// Creates explicit deterministic plans — no autonomous generation

export function createDatasetProductionPlan(
  projectId: string,
): OrchestrationPlan {
  return {
    id:         crypto.randomUUID(),
    name:       "dataset_production",
    version:    ORCHESTRATION_VERSION,
    project_id: projectId,
    created_at: new Date().toISOString(),
    steps: [
      { id:"validate",   type:"VALIDATE_INPUTS",  depends:[],           required:true,  retry_count:0 },
      { id:"gate",       type:"RUN_QUALITY_GATE",  depends:["validate"], required:true,  retry_count:1 },
      { id:"build",      type:"BUILD_DATASET",     depends:["gate"],     required:true,  retry_count:1 },
      { id:"pipeline",   type:"RUN_PIPELINE",      depends:["build"],    required:true,  retry_count:2 },
      { id:"export",     type:"EXPORT_DATASET",    depends:["pipeline"], required:true,  retry_count:1 },
      { id:"notify",     type:"NOTIFY_COMPLETE",   depends:["export"],   required:false, retry_count:0 },
    ],
  };
}
