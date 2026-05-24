import { emitEvent } from "../lib/telemetry/emitter";
import { supabase }   from "../lib/supabase";

export function emitImageLoaded(params: {
  correlation_id:string; width:number; height:number;
  tile_count:number; checksum:string|null;
}): void {
  emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"info",
    payload:{ action:"IMAGE_LOADED", modality:"image",
      width:params.width, height:params.height,
      tile_count:params.tile_count, checksum:params.checksum } });
}

export function emitImageInferenceComplete(params: {
  correlation_id:string; model_id:string;
  latency_ms:number; result_checksum:string|null;
}): void {
  emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
    correlation_id:params.correlation_id, severity:"info",
    payload:{ action:"IMAGE_INFERENCE_COMPLETE", modality:"image",
      model_id:params.model_id, latency_ms:params.latency_ms,
      result_checksum:params.result_checksum } });
}

export async function recordImageSpan(params: {
  correlation_id:string; model_id:string; latency_ms:number;
}): Promise<void> {
  try {
    await supabase.from("telemetry_spans").insert({
      span_type:"INFERENCE", worker_type:"image_worker",
      correlation_id:params.correlation_id, status:"completed",
      start_time:new Date(Date.now()-params.latency_ms).toISOString(),
      metadata:{ model_id:params.model_id, modality:"image" },
    });
  } catch { /* silent */ }
}
