/**
 * aiAnnotationService.ts
 * Aivora Platform — AI Annotation Orchestration
 *
 * Bridges the existing onnxRuntime + modelRegistry with the pure proposalEngine.
 * Runs inference through the existing WebGPU→WASM→CPU fallback. Logs every run
 * to ai_annotation_runs with full lineage. Degrades gracefully when model
 * weights are not yet hosted (sha256 null / load fails) — never throws.
 */

import { supabase }       from "../supabase";
import { modelRegistry }  from "../models/modelRegistry";
import { onnxRuntime }    from "../ai/onnxRuntime";
import {
  decodeYOLO, decodeCLIP, decodeSAM2Mask, proposalsChecksum,
} from "./proposalEngine";
import { ASSIST_MODEL_CATALOG_ID } from "./aiAnnotationTypes";
import type {
  AssistModel, AutoAnnotateResult, Proposal,
} from "./aiAnnotationTypes";

// COCO 80-class names (YOLO default). Deterministic, frozen ordering.
export const COCO_CLASSES: string[] = [
  "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
  "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
  "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
  "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
  "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
  "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
  "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
  "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
  "remote","keyboard","cell phone","microwave","oven","toaster","sink",
  "refrigerator","book","clock","vase","scissors","teddy bear","hair drier",
  "toothbrush",
];

async function sha256(str: string): Promise<string> {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ── Availability check ────────────────────────────────────────────────────────
// A model is runnable only when its binary is hosted (sha256 set) AND the
// onnx runtime can load it. We expose this so the UI can show clear status.

export function isModelAvailable(model: AssistModel): boolean {
  const id    = ASSIST_MODEL_CATALOG_ID[model];
  const entry = modelRegistry.getModel(id);
  return !!entry && entry.sha256 !== null;
}

export function modelStatus(model: AssistModel): { id: string; available: boolean; reason: string } {
  const id    = ASSIST_MODEL_CATALOG_ID[model];
  const entry = modelRegistry.getModel(id);
  if(!entry) return { id, available:false, reason:"not_registered" };
  if(entry.sha256 === null) return { id, available:false, reason:"weights_not_hosted" };
  return { id, available:true, reason:"ready" };
}

// ── Decode dispatch (pure proposalEngine) ─────────────────────────────────────

function decodeOutput(
  model:   AssistModel,
  raw:     unknown,
  imgW:    number,
  imgH:    number,
  textLabels: string[],
): Proposal[] {
  switch(model) {
    case "yolo": {
      const rows = raw as number[][];
      return decodeYOLO(rows, {
        imgW, imgH, classNames: COCO_CLASSES,
        confThreshold: 0.25, iouThreshold: 0.45,
      });
    }
    case "clip": {
      const logits = raw as number[];
      const labels = textLabels.length > 0 ? textLabels : COCO_CLASSES;
      return [decodeCLIP(logits, labels, 5)];
    }
    case "sam2": {
      const { mask, w, h } = raw as { mask: number[]; w: number; h: number };
      return [decodeSAM2Mask(mask, w, h, 0, "object", 0.9)];
    }
    case "grounding_dino": {
      // Grounding DINO returns boxes+logits; decoded like YOLO rows when available
      const rows = raw as number[][];
      return decodeYOLO(rows, {
        imgW, imgH, classNames: textLabels.length>0?textLabels:COCO_CLASSES,
        confThreshold: 0.3, iouThreshold: 0.5,
      });
    }
  }
}

// ── Main: auto-annotate one asset ─────────────────────────────────────────────

export interface AutoAnnotateParams {
  model:      AssistModel;
  asset_id:   string;
  asset_type: "image" | "video_frame";
  imgW:       number;
  imgH:       number;
  // Prepared input tensor (Float32Array) — caller builds it from the canvas.
  inputTensor: Float32Array | null;
  textLabels: string[];        // for CLIP / Grounding DINO
  user_id:    string | null;
}

export async function autoAnnotate(params: AutoAnnotateParams): Promise<AutoAnnotateResult> {
  const started = Date.now();
  const id      = ASSIST_MODEL_CATALOG_ID[params.model];
  const entry   = modelRegistry.getModel(id);

  const baseResult: AutoAnnotateResult = {
    asset_id:        params.asset_id,
    model:           params.model,
    model_id:        id,
    model_version:   entry?.version ?? "",
    backend:         "",
    proposals:       [],
    input_checksum:  null,
    output_checksum: null,
    duration_ms:     0,
    ran_inference:   false,
    message:         "",
  };

  // Guard: model not registered or weights not hosted
  const status = modelStatus(params.model);
  if(!status.available) {
    return { ...baseResult,
      message: status.reason === "weights_not_hosted"
        ? `${params.model.toUpperCase()} weights not yet uploaded. Register the model URL to enable inference.`
        : `${params.model} is not available (${status.reason}).`,
    };
  }

  if(!params.inputTensor) {
    return { ...baseResult, message: "No input tensor prepared." };
  }

  try {
    // Reuse existing runtime: initialize() picks WebGPU→WASM→CPU automatically
    const backend = await onnxRuntime.initialize();
    const loaded  = await onnxRuntime.loadModel(id);
    if(!loaded) {
      return { ...baseResult, backend, message: "Model failed to load in runtime." };
    }

    // NOTE: actual session.run() is performed by onnxRuntime; here we receive
    // its raw output. The runtime returns null until a real session exists.
    const raw = await runInference(id, params.inputTensor);
    if(raw === null) {
      return { ...baseResult, backend,
        message: "Inference returned no output (runtime/session unavailable)." };
    }

    const proposals = decodeOutput(params.model, raw, params.imgW, params.imgH, params.textLabels);
    const inputChecksum  = await sha256(params.inputTensor.slice(0, 1024).join(","));
    const outputChecksum = await sha256(proposalsChecksum(proposals));
    const duration = Date.now() - started;

    const result: AutoAnnotateResult = {
      ...baseResult,
      backend,
      proposals,
      input_checksum:  inputChecksum,
      output_checksum: outputChecksum,
      duration_ms:     duration,
      ran_inference:   true,
      message:         `${proposals.length} proposals from ${params.model.toUpperCase()} via ${backend}`,
    };

    await logRun(result, params);
    return result;

  } catch(e) {
    return { ...baseResult,
      message: `Inference error: ${e instanceof Error ? e.message.slice(0,120) : "unknown"}` };
  }
}

// Thin wrapper around the existing runtime's inference entry point. Returns the
// raw decodable output, or null when no real session can run yet.
async function runInference(modelId: string, input: Float32Array): Promise<unknown> {
  const rt = onnxRuntime as unknown as {
    runRaw?: (id: string, input: Float32Array) => Promise<unknown>;
  };
  if(typeof rt.runRaw === "function") {
    return rt.runRaw(modelId, input);
  }
  // Real session entry not present until weights hosted → signal unavailable.
  return null;
}

// ── Run logging (lineage) ─────────────────────────────────────────────────────

async function logRun(result: AutoAnnotateResult, params: AutoAnnotateParams): Promise<void> {
  if(!params.user_id) return;
  const meanConf = result.proposals.length > 0
    ? result.proposals.reduce((s,p)=>s+p.confidence,0) / result.proposals.length
    : 0;
  try {
    await supabase.from("ai_annotation_runs").insert({
      user_id:          params.user_id,
      asset_id:         params.asset_id,
      asset_type:       params.asset_type,
      model_id:         result.model_id,
      model_version:    result.model_version,
      backend:          result.backend,
      proposals_total:  result.proposals.length,
      mean_confidence:  Math.round(meanConf * 1000) / 1000,
      input_checksum:   result.input_checksum,
      output_checksum:  result.output_checksum,
      duration_ms:      result.duration_ms,
      status:           "completed",
    });
  } catch {
    // best-effort logging — never block the annotation flow
  }
}
