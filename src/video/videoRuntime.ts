/**
 * videoRuntime.ts — Deterministic Video Intelligence Fabric
 * Aivora Platform — Phase 14.2
 *
 * Rules:
 *   - Deterministic frame extraction (same video → same frames)
 *   - Bounded frame windows (MAX_ACTIVE_FRAMES = 120)
 *   - NO full video in RAM
 *   - All compute via Tier 5.1 scheduler
 *   - SHA256 per frame batch + manifest checksum
 *   - Forensic lineage on every extraction
 */

import { scheduler } from "../runtime/runtimeScheduler";
import { emitEvent } from "../lib/telemetry/emitter";
import { supabase }  from "../lib/supabase";
import { sha256Bytes } from "../vision/imageGovernance";

export const VIDEO_RUNTIME_VERSION = "14.2.0";

export const VIDEO_LIMITS = {
  MAX_ACTIVE_FRAMES:  120,
  MAX_FRAME_DIM:      1920,
  MAX_VIDEO_DURATION: 3600,
  DEFAULT_FPS:        1,
  MAX_FPS:            30,
} as const;

export interface VideoFrame {
  index:       number;
  timestamp_s: number;
  width:       number;
  height:      number;
  data:        ImageData;
  checksum:    string | null;
}

export interface VideoExtractionConfig {
  fps:        number;
  max_frames: number;
  start_s?:   number;
  end_s?:     number;
}

export interface VideoExtractionResult {
  frames:            VideoFrame[];
  total_frames:      number;
  duration_s:        number;
  config:            VideoExtractionConfig;
  manifest_checksum: string | null;
  correlation_id:    string;
  protocol:          string;
}

export async function extractFrames(
  file:           File,
  config:         VideoExtractionConfig,
  correlation_id: string,
): Promise<VideoExtractionResult | null> {

  const fps       = Math.min(Math.max(config.fps, 0.1), VIDEO_LIMITS.MAX_FPS);
  const maxFrames = Math.min(config.max_frames, VIDEO_LIMITS.MAX_ACTIVE_FRAMES);
  const resultRef: { current: VideoExtractionResult | null } = { current: null };

  try {
    await new Promise<void>((resolve, reject) => {
      const taskId = scheduler.submit({
        task_type:      "VIDEO",
        priority:       "NORMAL",
        correlation_id,
        execute: async () => {
          let videoEl:   HTMLVideoElement | null = null;
          let objectUrl: string | null           = null;
          try {
            objectUrl        = URL.createObjectURL(file);
            videoEl          = document.createElement("video");
            videoEl.preload  = "metadata";
            videoEl.muted    = true;

            await new Promise<void>((res, rej) => {
              videoEl!.onloadedmetadata = () => res();
              videoEl!.onerror = () => rej(new Error("Video metadata load failed"));
              videoEl!.src = objectUrl!;
            });

            const duration = videoEl.duration;
            if(!isFinite(duration) || duration <= 0) {
              reject(new Error("Invalid video duration")); return;
            }

            const startS = config.start_s ?? 0;
            const endS   = Math.min(config.end_s ?? duration, duration);

            // Deterministic timestamps (3dp — no floating point drift)
            const timestamps: number[] = [];
            const interval = 1 / fps;
            for(let t = startS; t < endS && timestamps.length < maxFrames; t += interval) {
              timestamps.push(Math.round(t * 1000) / 1000);
            }

            const frames: VideoFrame[] = [];
            const canvas = document.createElement("canvas");
            const ctx    = canvas.getContext("2d");
            if(!ctx) { reject(new Error("Canvas 2D unavailable")); return; }

            for(let i = 0; i < timestamps.length; i++) {
              const ts = timestamps[i];
              await new Promise<void>((res, rej) => {
                videoEl!.onseeked = () => res();
                videoEl!.onerror  = () => rej(new Error(`Seek failed at ${ts}s`));
                videoEl!.currentTime = ts;
              });

              let w = videoEl.videoWidth, h = videoEl.videoHeight;
              if(w > VIDEO_LIMITS.MAX_FRAME_DIM || h > VIDEO_LIMITS.MAX_FRAME_DIM) {
                const ratio = VIDEO_LIMITS.MAX_FRAME_DIM / Math.max(w, h);
                w = Math.floor(w * ratio);
                h = Math.floor(h * ratio);
              }

              canvas.width = w; canvas.height = h;
              ctx.drawImage(videoEl, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const checksum  = await sha256Bytes(imageData.data);
              frames.push({ index:i, timestamp_s:ts, width:w, height:h,
                data:imageData, checksum });
            }

            // Manifest checksum
            const manifestStr = frames.map(f =>
              `${f.index}:${f.timestamp_s}:${f.checksum}`).join("|");
            const manifestBuf  = new TextEncoder().encode(manifestStr);
            const manifestHash = await crypto.subtle.digest("SHA-256", manifestBuf);
            const manifestChecksum = Array.from(new Uint8Array(manifestHash))
              .map(b => b.toString(16).padStart(2,"0")).join("");

            resultRef.current = {
              frames, total_frames:frames.length, duration_s:duration,
              config:{ fps, max_frames:maxFrames, start_s:startS, end_s:endS },
              manifest_checksum:manifestChecksum,
              correlation_id, protocol:VIDEO_RUNTIME_VERSION,
            };
            resolve();

          } catch(e) {
            reject(e);
          } finally {
            if(videoEl) { videoEl.pause(); videoEl.src = ""; videoEl.load(); }
            if(objectUrl) URL.revokeObjectURL(objectUrl);
          }
        },
        onTimeout: () => reject(new Error("Video extraction timeout")),
      });
      if(!taskId) reject(new Error("Scheduler rejected"));
    });

    const result = resultRef.current;
    if(!result) return null;

    await persistVideoEvidence(result, correlation_id);
    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id, severity:"info",
      payload:{ action:"VIDEO_FRAMES_EXTRACTED",
        total_frames:result.total_frames, duration_s:result.duration_s,
        fps:result.config.fps, manifest_checksum:result.manifest_checksum,
        protocol:VIDEO_RUNTIME_VERSION },
    });
    return result;

  } catch(e) {
    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id, severity:"error",
      payload:{ action:"VIDEO_EXTRACTION_FAILED",
        error:e instanceof Error ? e.message.slice(0,200) : "unknown" },
    });
    return null;
  }
}

async function persistVideoEvidence(
  result: VideoExtractionResult, corrId: string,
): Promise<void> {
  try {
    await supabase.from("forensic_evidence_chain").insert({
      correlation_id:corrId, evidence_stage:"DSP_PROCESSED",
      metadata:{ modality:"video", total_frames:result.total_frames,
        duration_s:result.duration_s, fps:result.config.fps,
        manifest_checksum:result.manifest_checksum,
        protocol:VIDEO_RUNTIME_VERSION },
    });
  } catch { /* silent */ }
}
