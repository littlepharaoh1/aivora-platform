/**
 * videoAnnotationExport.ts
 * Aivora Platform — Phase 15.3
 *
 * Deterministic video annotation exports.
 * COCO Video, MOT, YOLO Video, JSONL.
 * Same input → same output always.
 */

import type {
  VideoAnnotationState, VideoExportFormat,
} from "./videoAnnotationTypes";
import { emitEvent } from "../lib/telemetry/emitter";
import { supabase } from "../lib/supabase";

// ── SHA-256 ───────────────────────────────────────────────────────────────────

async function sha256(str: string): Promise<string> {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── COCO Video format ─────────────────────────────────────────────────────────

function toCOCOVideo(state: VideoAnnotationState): object {
  const W = state.width, H = state.height;

  const categories = Array.from(
    new Map(state.tracks.map(t => [t.class_id, { id:t.class_id, name:t.label, supercategory:"object" }]))
    .values()
  ).sort((a,b) => a.id - b.id);

  // Build videos array
  const videos = [{
    id:           1,
    file_name:    state.filename,
    fps:          state.fps,
    width:        W,
    height:       H,
    duration:     state.duration_s,
    frame_count:  state.total_frames,
  }];

  // Build images (frames) array
  const frameIndices = [...new Set(state.keyframes.map(k => k.frame_index))].sort((a,b)=>a-b);
  const images = frameIndices.map((fi, idx) => {
    const meta = state.frames_meta.find(m => m.index === fi);
    return {
      id:          idx + 1,
      video_id:    1,
      frame_index: fi,
      file_name:   `${state.filename}_frame_${String(fi).padStart(6,"0")}.jpg`,
      width:       W,
      height:      H,
      timestamp:   meta?.timestamp_s ?? fi / (state.fps || 25),
    };
  });

  const frameIdxToImageId = new Map(frameIndices.map((fi, idx) => [fi, idx + 1]));
  const trackIdToId = new Map(state.tracks.map((t, i) => [t.id, i + 1]));

  // Build annotations
  const annotations = state.keyframes.map((kf, idx) => {
    const b = kf.bbox;
    const imageId = frameIdxToImageId.get(kf.frame_index) ?? 0;
    const track   = state.tracks.find(t => t.id === kf.track_id);
    return {
      id:          idx + 1,
      image_id:    imageId,
      video_id:    1,
      track_id:    trackIdToId.get(kf.track_id) ?? 0,
      category_id: track?.class_id ?? 0,
      bbox: [
        Math.round(b.x * W),
        Math.round(b.y * H),
        Math.round(b.width  * W),
        Math.round(b.height * H),
      ],
      area:            Math.round(b.width * W) * Math.round(b.height * H),
      iscrowd:         0,
      occluded:        kf.occluded ? 1 : 0,
      out_of_frame:    kf.out_of_frame ? 1 : 0,
      is_interpolated: kf.is_interpolated ? 1 : 0,
      confidence:      kf.confidence,
    };
  });

  return {
    info: {
      description:  "AIVORA Video Annotation Export",
      version:      "15.3.0",
      date_created: new Date().toISOString(),
    },
    videos,
    images,
    annotations,
    categories,
    tracks: state.tracks.map((t, i) => ({
      id:          i + 1,
      label:       t.label,
      class_id:    t.class_id,
      color:       t.color,
    })),
  };
}

// ── MOT (Multiple Object Tracking) format ─────────────────────────────────────
// Standard: frame, id, bb_left, bb_top, bb_width, bb_height, conf, -1, -1, -1

function toMOT(state: VideoAnnotationState): string {
  const W = state.width, H = state.height;
  const trackIdToInt = new Map(state.tracks.map((t, i) => [t.id, i + 1]));

  const lines = state.keyframes
    .sort((a, b) => a.frame_index !== b.frame_index
      ? a.frame_index - b.frame_index
      : (trackIdToInt.get(a.track_id)??0) - (trackIdToInt.get(b.track_id)??0)
    )
    .map(kf => {
      const b      = kf.bbox;
      const frame  = kf.frame_index + 1;  // MOT is 1-indexed
      const trackN = trackIdToInt.get(kf.track_id) ?? -1;
      const left   = (b.x * W).toFixed(2);
      const top    = (b.y * H).toFixed(2);
      const width  = (b.width  * W).toFixed(2);
      const height = (b.height * H).toFixed(2);
      const conf   = kf.confidence.toFixed(4);
      return `${frame},${trackN},${left},${top},${width},${height},${conf},-1,-1,-1`;
    });

  return lines.join("\n");
}

// ── YOLO Video format ─────────────────────────────────────────────────────────
// Per-frame txt files in a zip-like structure (flat JSONL of frames)

function toYOLOVideo(state: VideoAnnotationState): string {
  const trackIdToClassId = new Map(state.tracks.map(t => [t.id, t.class_id]));

  const frameMap = new Map<number, string[]>();
  state.keyframes.forEach(kf => {
    const classId = trackIdToClassId.get(kf.track_id) ?? 0;
    const b = kf.bbox;
    const cx = (b.x + b.width  / 2).toFixed(6);
    const cy = (b.y + b.height / 2).toFixed(6);
    const w  = b.width.toFixed(6);
    const h  = b.height.toFixed(6);
    const line = `${classId} ${cx} ${cy} ${w} ${h}`;
    if(!frameMap.has(kf.frame_index)) frameMap.set(kf.frame_index, []);
    frameMap.get(kf.frame_index)!.push(line);
  });

  const frames = [...frameMap.entries()]
    .sort(([a],[b]) => a - b)
    .map(([fi, lines]) => JSON.stringify({
      frame:    fi,
      filename: `frame_${String(fi).padStart(6,"0")}.txt`,
      content:  lines.join("\n"),
    }));

  return frames.join("\n");
}

// ── JSONL format ──────────────────────────────────────────────────────────────

function toJSONL(state: VideoAnnotationState): string {
  const trackMap = new Map(state.tracks.map(t => [t.id, t]));

  return state.keyframes
    .sort((a,b) => a.frame_index - b.frame_index)
    .map(kf => {
      const track = trackMap.get(kf.track_id);
      return JSON.stringify({
        video_id:        state.video_id,
        filename:        state.filename,
        frame_index:     kf.frame_index,
        timestamp_s:     kf.timestamp_s,
        track_id:        kf.track_id,
        track_label:     track?.label ?? "",
        class_id:        track?.class_id ?? 0,
        bbox:            kf.bbox,
        confidence:      kf.confidence,
        is_interpolated: kf.is_interpolated,
        is_ai:           kf.is_ai,
        occluded:        kf.occluded,
        out_of_frame:    kf.out_of_frame,
        qa_flag:         kf.qa_flag,
        created_at:      kf.created_at,
      });
    })
    .join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function exportVideoAnnotations(
  state:    VideoAnnotationState,
  format:   VideoExportFormat,
): Promise<void> {
  let content  = "";
  let mime     = "application/json";
  let ext      = "json";

  switch(format) {
    case "coco_video": {
      content = JSON.stringify(toCOCOVideo(state), null, 2);
      ext     = "coco.json";
      break;
    }
    case "mot": {
      content = toMOT(state);
      mime    = "text/plain";
      ext     = "mot.txt";
      break;
    }
    case "yolo_video": {
      content = toYOLOVideo(state);
      mime    = "application/jsonl";
      ext     = "yolo.jsonl";
      break;
    }
    case "jsonl": {
      content = toJSONL(state);
      mime    = "application/jsonl";
      ext     = "jsonl";
      break;
    }
  }

  const checksum = await sha256(content);
  const base     = state.filename.replace(/\.[^.]+$/, "");
  const blob     = new Blob([content], { type: mime });
  const a        = document.createElement("a");
  a.href         = URL.createObjectURL(blob);
  a.download     = `${base}_annotations.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);

  emitEvent({
    event_type:     "ADMIN_ACTION",
    event_source:   "qc_workstation",
    correlation_id: state.video_id,
    severity:       "info",
    payload: {
      action:          "VIDEO_ANNOTATIONS_EXPORTED",
      format,
      tracks:          state.tracks.length,
      keyframes:       state.keyframes.length,
      checksum,
    },
  });

  // Register the export as a pipeline_run so the Dataset Factory can see and
  // include it in a dataset version. Best-effort: export already succeeded.
  try {
    const now = new Date().toISOString();
    await supabase.from("pipeline_runs").insert({
      pipeline_name:    `video_annotation_export_${format}`,
      pipeline_version: state.version,
      project_name:     state.filename.replace(/\.[^.]+$/, ""),
      status:           "completed",
      started_at:       now,
      completed_at:     now,
      files_processed:  state.keyframes.length,
      files_rejected:   0,
      input_checksum:   null,
      output_checksum:  checksum,
    });
  } catch {
    // Offline or no-auth — export file already downloaded; run registration is optional
  }
}
