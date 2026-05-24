import { scheduler } from "../runtime/runtimeScheduler";
import { emitEvent }  from "../lib/telemetry/emitter";
import { supabase }   from "../lib/supabase";
import {
  IMAGE_GOVERNANCE_VERSION, IMAGE_LIMITS,
  checkImageGovernance, extractTiles, sha256Bytes,
} from "./imageGovernance";
import type { ImageMetadata, ImageTile, ImageGovernanceRecord } from "./imageGovernance";

export const IMAGE_RUNTIME_VERSION = "14.1.0";

export interface ImageLoadResult {
  imageData:      ImageData;
  metadata:       ImageMetadata;
  tiles:          ImageTile[];
  governance:     ImageGovernanceRecord;
  correlation_id: string;
}

export async function loadAndGovernImage(
  file: File, correlation_id: string,
): Promise<ImageLoadResult | null> {

  if(file.size > IMAGE_LIMITS.MAX_IMAGE_BYTES) {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id, severity:"error",
      payload:{ action:"IMAGE_REJECTED", reason:"file_too_large",
        size_mb:(file.size/1024/1024).toFixed(1) } });
    return null;
  }

  const resultRef: { current: ImageLoadResult | null } = { current: null };

  try {
    await new Promise<void>((resolve, reject) => {
      const taskId = scheduler.submit({
        task_type: "IMAGE", priority: "NORMAL", correlation_id,
        execute: async () => {
          let bitmap: ImageBitmap | null = null;
          try {
            bitmap = await createImageBitmap(file);
            const { width, height } = bitmap;

            const dc = checkImageGovernance(width, height, file.size);
            if(!dc.allowed) { reject(new Error(dc.reason ?? "governance rejected")); return; }

            let targetW = width, targetH = height;
            const resize = width > IMAGE_LIMITS.MAX_DIM || height > IMAGE_LIMITS.MAX_DIM;
            if(resize) {
              const ratio = IMAGE_LIMITS.MAX_DIM / Math.max(width, height);
              targetW = Math.floor(width * ratio);
              targetH = Math.floor(height * ratio);
            }

            const canvas = new OffscreenCanvas(targetW, targetH);
            const ctx    = canvas.getContext("2d");
            if(!ctx) { reject(new Error("OffscreenCanvas 2D unavailable")); return; }

            ctx.drawImage(bitmap, 0, 0, targetW, targetH);
            const imageData = ctx.getImageData(0, 0, targetW, targetH);
            const checksum  = await sha256Bytes(imageData.data);
            const tiles     = extractTiles(imageData);

            const metadata: ImageMetadata = {
              width:targetW, height:targetH, channels:4, format:"rgba",
              byte_size:imageData.data.length, checksum, tile_count:tiles.length,
              created_at:new Date().toISOString(),
              governance_version:IMAGE_GOVERNANCE_VERSION,
            };
            const governance: ImageGovernanceRecord = {
              image_checksum:checksum, width:targetW, height:targetH,
              tile_count:tiles.length, resize_applied:resize, exif_stripped:true,
              governance_version:IMAGE_GOVERNANCE_VERSION, protocol:IMAGE_RUNTIME_VERSION,
            };

            resultRef.current = { imageData, metadata, tiles, governance, correlation_id };
            resolve();
          } catch(e) {
            reject(e);
          } finally {
            bitmap?.close();
          }
        },
        onTimeout: () => reject(new Error("Image load timeout")),
      });
      if(!taskId) reject(new Error("Scheduler rejected"));
    });

    const result = resultRef.current;
    if(!result) return null;

    await persistImageEvidence(result, correlation_id);
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id, severity:"info",
      payload:{ action:"IMAGE_LOADED", width:result.metadata.width,
        height:result.metadata.height, tile_count:result.metadata.tile_count,
        checksum:result.metadata.checksum, protocol:IMAGE_RUNTIME_VERSION } });

    return result;

  } catch(e) {
    emitEvent({ event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id, severity:"error",
      payload:{ action:"IMAGE_LOAD_FAILED",
        error:e instanceof Error ? e.message.slice(0,200) : "unknown" } });
    return null;
  }
}

async function persistImageEvidence(result: ImageLoadResult, corrId: string): Promise<void> {
  try {
    await supabase.from("forensic_evidence_chain").insert({
      correlation_id:corrId, evidence_stage:"DSP_PROCESSED",
      metadata:{ modality:"image", image_checksum:result.metadata.checksum,
        width:result.metadata.width, height:result.metadata.height,
        tile_count:result.metadata.tile_count, exif_stripped:true,
        resize_applied:result.governance.resize_applied,
        protocol:IMAGE_RUNTIME_VERSION },
    });
  } catch { /* silent */ }
}

export function renderImageToCanvas(imageData: ImageData, canvas: HTMLCanvasElement): void {
  canvas.width = imageData.width; canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  ctx.putImageData(imageData, 0, 0);
}

export function renderTileGrid(
  tiles: ImageTile[], canvas: HTMLCanvasElement, imgW: number, imgH: number,
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scaleX = canvas.width / imgW;
  const scaleY = canvas.height / imgH;
  ctx.strokeStyle = "#22d3ee44"; ctx.lineWidth = 1;
  tiles.forEach(t => ctx.strokeRect(t.x*scaleX, t.y*scaleY, t.width*scaleX, t.height*scaleY));
  ctx.fillStyle = "#22d3ee"; ctx.font = "10px monospace";
  ctx.fillText(`${tiles.length} tiles`, 4, 14);
}
