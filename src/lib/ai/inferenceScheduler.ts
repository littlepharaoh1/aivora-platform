/**
 * inferenceScheduler.ts — Deterministic Inference Scheduler
 * Aivora Platform — Phase 6B.4
 *
 * Explicit route table — no runtime-adaptive selection.
 * Same task + same tier → same model + same runtime.
 * Wraps onnxRuntime.run() with validation + policy checks.
 */

import { policyManager }           from "../../runtime/executionPolicies";
import { onnxRuntime }              from "./onnxRuntime";
import { modelRegistry }            from "../models/modelRegistry";
import { emitEvent }                from "../telemetry/emitter";
import { checkTensorAllocation }    from "./tensorMemory";
import { checkInputSize }           from "./aiSafetyConstraints";
import type { ModelTask, ModelRuntime } from "../models/modelRegistry";
import type { InferenceResponse }   from "./onnxRuntime";

export interface InferenceRoute {
  task:              ModelTask;
  preferred_runtime: ModelRuntime;
  version:           string;
}

// Explicit route table — deterministic, versioned
export const INFERENCE_ROUTES: Record<ModelTask, InferenceRoute> = {
  vad:           { task:"vad",           preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  denoise:       { task:"denoise",       preferred_runtime:"wasm_native",  version:"6B.4.0" },
  enhance:       { task:"enhance",       preferred_runtime:"onnx_webgpu", version:"6B.4.0" },
  separate:      { task:"separate",      preferred_runtime:"onnx_webgpu", version:"6B.4.0" },
  speaker_embed: { task:"speaker_embed", preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  room_embed:    { task:"room_embed",    preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  noise_classify:{ task:"noise_classify",preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  // Vision tasks — AI-Assisted Annotation Layer (WebGPU preferred, WASM fallback)
  object_detect: { task:"object_detect", preferred_runtime:"onnx_webgpu", version:"18.0.0" },
  segment:       { task:"segment",       preferred_runtime:"onnx_webgpu", version:"18.0.0" },
  text_detect:   { task:"text_detect",   preferred_runtime:"onnx_webgpu", version:"18.0.0" },
  image_classify:{ task:"image_classify",preferred_runtime:"onnx_webgpu", version:"18.0.0" },
};

export interface ScheduledInferenceRequest {
  task:          ModelTask;
  input:         Float32Array;
  sampleRate:    number;
  correlationId: string;
}

export interface ScheduledInferenceResult {
  response:       InferenceResponse | null;
  route:          InferenceRoute;
  model_id:       string | null;
  skipped_reason: string | null;
}

export async function scheduleInference(
  req: ScheduledInferenceRequest
): Promise<ScheduledInferenceResult> {

  const route  = INFERENCE_ROUTES[req.task];
  const tier   = policyManager.getMode();
  const policy = policyManager.getCurrent();

  // Input size check
  const sizeCheck = checkInputSize(req.input.length, req.sampleRate);
  if(!sizeCheck.allowed) {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id: req.correlationId, severity:"warn",
      payload:{ action:"INFERENCE_SKIPPED", reason:sizeCheck.reason, task:req.task },
    });
    return { response:null, route, model_id:null, skipped_reason:sizeCheck.reason };
  }

  // Tensor bounds check
  const tensorCheck = checkTensorAllocation({
    dims:[1, req.input.length], dtype:"float32",
    description:`inference_input_${req.task}`,
  });
  if(!tensorCheck.allowed) {
    return { response:null, route, model_id:null, skipped_reason:tensorCheck.reason };
  }

  // Policy check
  const taskAllowed =
    req.task === "vad"      ? true :
    req.task === "denoise"  ? policy.repair_enabled :
    req.task === "enhance"  ? policy.repair_enabled :
    policy.analytics_enabled;

  if(!taskAllowed) {
    return { response:null, route, model_id:null,
      skipped_reason:`task_${req.task}_disabled_in_${tier}` };
  }

  // Model selection (deterministic)
  const runtimes: ModelRuntime[] = [route.preferred_runtime, "onnx_wasm", "js_fallback"];
  const model = modelRegistry.getBestForTask(req.task, runtimes, tier);

  if(!model) {
    return { response:null, route, model_id:null,
      skipped_reason:`no_model_for_${req.task}_in_${tier}` };
  }

  // Execute via governed onnxRuntime
  const response = await onnxRuntime.run({
    modelId:       model.id,
    correlationId: req.correlationId,
    inputs: {
      input: { data:req.input, dims:[1, req.input.length], type:"float32" },
    },
  });

  return { response, route, model_id:model.id, skipped_reason:null };
}
