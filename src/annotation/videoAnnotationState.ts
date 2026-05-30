/**
 * videoAnnotationState.ts
 * Aivora Platform — Phase 15.3
 *
 * Pure state engine for video annotation.
 * Deterministic interpolation. Bounded history.
 * Reuses: sha256 pattern, emitEvent.
 */

import type {
  VideoAnnotationState, Track, Keyframe,
  ShotSegment, FrameMeta, VBBox, VideoTool,
  VideoHistoryEntry, VideoQAFlag,
} from "./videoAnnotationTypes";
import {
  VIDEO_ANNOTATION_VERSION,
  VIDEO_ANNOTATION_LIMITS,
} from "./videoAnnotationTypes";
import { getClassColor } from "./taxonomyEngine";

// ── Factory ───────────────────────────────────────────────────────────────────

export function createVideoState(params: {
  video_id:  string;
  filename:  string;
  duration_s:number;
  fps:       number;
  width:     number;
  height:    number;
  total_frames:number;
}): VideoAnnotationState {
  const now = new Date().toISOString();
  return {
    version:           VIDEO_ANNOTATION_VERSION,
    video_id:          params.video_id,
    filename:          params.filename,
    duration_s:        params.duration_s,
    fps:               params.fps,
    width:             params.width,
    height:            params.height,
    total_frames:      params.total_frames,
    tracks:            [],
    keyframes:         [],
    shots:             [],
    frames_meta:       [],
    current_frame:     0,
    current_window:    0,
    window_size:       VIDEO_ANNOTATION_LIMITS.MAX_FRAMES,
    window_count:      Math.max(1, Math.ceil(params.total_frames / VIDEO_ANNOTATION_LIMITS.MAX_FRAMES)),
    selected_track_id: null,
    selected_kf_id:    null,
    active_tool:       "bbox",
    history:           [],
    future:            [],
    created_at:        now,
    updated_at:        now,
  };
}

// ── History helpers ───────────────────────────────────────────────────────────

const MAX_HISTORY = 100;

function pushHistory(state: VideoAnnotationState): VideoAnnotationState {
  const entry: VideoHistoryEntry = {
    tracks:    state.tracks,
    keyframes: state.keyframes,
    shots:     state.shots,
  };
  const history = [...state.history.slice(-(MAX_HISTORY - 1)), entry];
  return { ...state, history, future: [], updated_at: new Date().toISOString() };
}

export function undoVideoState(state: VideoAnnotationState): VideoAnnotationState {
  if(state.history.length === 0) return state;
  const history  = [...state.history];
  const prev     = history.pop()!;
  const future   = [
    { tracks:state.tracks, keyframes:state.keyframes, shots:state.shots },
    ...state.future,
  ].slice(0, MAX_HISTORY);
  return { ...state, ...prev, history, future, updated_at: new Date().toISOString() };
}

export function redoVideoState(state: VideoAnnotationState): VideoAnnotationState {
  if(state.future.length === 0) return state;
  const future = [...state.future];
  const next   = future.shift()!;
  const history = [
    ...state.history,
    { tracks:state.tracks, keyframes:state.keyframes, shots:state.shots },
  ].slice(-MAX_HISTORY);
  return { ...state, ...next, history, future, updated_at: new Date().toISOString() };
}

// ── Track management ──────────────────────────────────────────────────────────

export function createTrack(
  state:      VideoAnnotationState,
  label:      string,
  class_id:   number,
): VideoAnnotationState {
  if(state.tracks.length >= VIDEO_ANNOTATION_LIMITS.MAX_TRACKS) return state;
  const s = pushHistory(state);
  const track: Track = {
    id:         crypto.randomUUID(),
    label,
    class_id,
    color:      getClassColor(s.tracks.length),
    created_at: new Date().toISOString(),
    is_active:  true,
    notes:      "",
  };
  return {
    ...s,
    tracks:           [...s.tracks, track],
    selected_track_id:track.id,
  };
}

export function deleteTrack(
  state:    VideoAnnotationState,
  trackId:  string,
): VideoAnnotationState {
  const s = pushHistory(state);
  return {
    ...s,
    tracks:           s.tracks.filter(t => t.id !== trackId),
    keyframes:        s.keyframes.filter(k => k.track_id !== trackId),
    selected_track_id:s.selected_track_id === trackId ? null : s.selected_track_id,
  };
}

export function toggleTrackActive(
  state:   VideoAnnotationState,
  trackId: string,
): VideoAnnotationState {
  return {
    ...state,
    tracks: state.tracks.map(t =>
      t.id === trackId ? { ...t, is_active: !t.is_active } : t
    ),
  };
}

export function selectTrack(
  state:   VideoAnnotationState,
  trackId: string | null,
): VideoAnnotationState {
  return { ...state, selected_track_id: trackId, selected_kf_id: null };
}

// ── Keyframe management ───────────────────────────────────────────────────────

export function addKeyframe(
  state:      VideoAnnotationState,
  trackId:    string,
  frameIndex: number,
  bbox:       VBBox,
): VideoAnnotationState {
  if(state.keyframes.length >= VIDEO_ANNOTATION_LIMITS.MAX_KEYFRAMES) return state;
  const s = pushHistory(state);

  // Remove existing keyframe for same track+frame
  const keyframes = s.keyframes.filter(
    k => !(k.track_id === trackId && k.frame_index === frameIndex)
  );

  const meta = s.frames_meta.find(f => f.index === frameIndex);
  const kf: Keyframe = {
    id:              crypto.randomUUID(),
    track_id:        trackId,
    frame_index:     frameIndex,
    timestamp_s:     meta?.timestamp_s ?? frameIndex / (s.fps || 25),
    bbox:            normalizeBBoxV(bbox),
    points:          [],
    confidence:      1.0,
    is_interpolated: false,
    is_ai:           false,
    qa_flag:         null,
    occluded:        false,
    out_of_frame:    false,
    checksum:        null,
    created_at:      new Date().toISOString(),
  };

  return {
    ...s,
    keyframes:      [...keyframes, kf].sort((a,b) => a.frame_index - b.frame_index),
    selected_kf_id: kf.id,
  };
}

export function updateKeyframe(
  state: VideoAnnotationState,
  kfId:  string,
  patch: Partial<Keyframe>,
): VideoAnnotationState {
  const s = pushHistory(state);
  return {
    ...s,
    keyframes: s.keyframes.map(k =>
      k.id === kfId ? { ...k, ...patch } : k
    ),
  };
}

export function deleteKeyframe(
  state: VideoAnnotationState,
  kfId:  string,
): VideoAnnotationState {
  const s = pushHistory(state);
  return {
    ...s,
    keyframes:      s.keyframes.filter(k => k.id !== kfId),
    selected_kf_id: s.selected_kf_id === kfId ? null : s.selected_kf_id,
  };
}

export function setQAFlagVideo(
  state:  VideoAnnotationState,
  kfId:   string,
  flag:   VideoQAFlag | null,
): VideoAnnotationState {
  return updateKeyframe(state, kfId, { qa_flag: flag });
}

// ── Interpolation (deterministic linear) ─────────────────────────────────────

export function interpolateTrack(
  state:   VideoAnnotationState,
  trackId: string,
): VideoAnnotationState {
  const trackKFs = state.keyframes
    .filter(k => k.track_id === trackId && !k.is_interpolated)
    .sort((a, b) => a.frame_index - b.frame_index);

  if(trackKFs.length < 2) return state;

  const interpolated: Keyframe[] = [];
  const now = new Date().toISOString();

  for(let i = 0; i < trackKFs.length - 1; i++) {
    const kfA = trackKFs[i];
    const kfB = trackKFs[i + 1];
    const gap  = kfB.frame_index - kfA.frame_index;

    if(gap <= 1 || gap > VIDEO_ANNOTATION_LIMITS.INTERPOLATION_MAX) continue;

    for(let f = kfA.frame_index + 1; f < kfB.frame_index; f++) {
      // Already has manual keyframe?
      const exists = state.keyframes.find(
        k => k.track_id === trackId && k.frame_index === f && !k.is_interpolated
      );
      if(exists) continue;

      const t = (f - kfA.frame_index) / gap; // 0→1 linear

      // Linear interpolation of bbox
      const bbox: VBBox = {
        x:      kfA.bbox.x      + (kfB.bbox.x      - kfA.bbox.x)      * t,
        y:      kfA.bbox.y      + (kfB.bbox.y      - kfA.bbox.y)      * t,
        width:  kfA.bbox.width  + (kfB.bbox.width  - kfA.bbox.width)  * t,
        height: kfA.bbox.height + (kfB.bbox.height - kfA.bbox.height) * t,
      };

      const meta = state.frames_meta.find(fm => fm.index === f);
      interpolated.push({
        id:              crypto.randomUUID(),
        track_id:        trackId,
        frame_index:     f,
        timestamp_s:     meta?.timestamp_s ?? f / (state.fps || 25),
        bbox,
        points:          [],
        confidence:      kfA.confidence + (kfB.confidence - kfA.confidence) * t,
        is_interpolated: true,
        is_ai:           false,
        qa_flag:         null,
        occluded:        false,
        out_of_frame:    false,
        checksum:        null,
        created_at:      now,
      });
    }
  }

  if(interpolated.length === 0) return state;

  // Remove old interpolated frames for this track, add new ones
  const keyframes = [
    ...state.keyframes.filter(k => !(k.track_id === trackId && k.is_interpolated)),
    ...interpolated,
  ].sort((a, b) => a.frame_index - b.frame_index);

  return { ...state, keyframes, updated_at: now };
}

// ── Shot segments ─────────────────────────────────────────────────────────────

export function addShot(
  state:       VideoAnnotationState,
  startFrame:  number,
  endFrame:    number,
  label:       string,
): VideoAnnotationState {
  const shot: ShotSegment = {
    id:          crypto.randomUUID(),
    start_frame: startFrame,
    end_frame:   endFrame,
    label,
    notes:       "",
  };
  return { ...state, shots: [...state.shots, shot] };
}

export function deleteShot(
  state:  VideoAnnotationState,
  shotId: string,
): VideoAnnotationState {
  return { ...state, shots: state.shots.filter(s => s.id !== shotId) };
}

// ── Frame navigation ──────────────────────────────────────────────────────────

export function goToFrame(
  state: VideoAnnotationState,
  frame: number,
): VideoAnnotationState {
  const clamped = Math.max(0, Math.min(state.total_frames - 1, frame));
  return { ...state, current_frame: clamped };
}

export function setTool(
  state: VideoAnnotationState,
  tool:  VideoTool,
): VideoAnnotationState {
  return { ...state, active_tool: tool };
}

export function setFramesMeta(
  state:  VideoAnnotationState,
  frames: FrameMeta[],
): VideoAnnotationState {
  return { ...state, frames_meta: frames };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

export function normalizeBBoxV(bbox: VBBox): VBBox {
  const x = bbox.width  < 0 ? bbox.x + bbox.width  : bbox.x;
  const y = bbox.height < 0 ? bbox.y + bbox.height : bbox.y;
  const w = Math.abs(bbox.width);
  const h = Math.abs(bbox.height);
  return {
    x:      Math.max(0, Math.min(1 - w, x)),
    y:      Math.max(0, Math.min(1 - h, y)),
    width:  Math.min(1, Math.max(0.002, w)),
    height: Math.min(1, Math.max(0.002, h)),
  };
}

// ── Keyframes for current frame ───────────────────────────────────────────────

export function getFrameKeyframes(
  state:       VideoAnnotationState,
  frameIndex:  number,
): Keyframe[] {
  return state.keyframes.filter(k => k.frame_index === frameIndex);
}

export function getTrackAtFrame(
  state:      VideoAnnotationState,
  trackId:    string,
  frameIndex: number,
): Keyframe | null {
  return state.keyframes.find(
    k => k.track_id === trackId && k.frame_index === frameIndex
  ) ?? null;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface VideoAnnotationStats {
  total_tracks:        number;
  total_keyframes:     number;
  interpolated:        number;
  manual:              number;
  flagged:             number;
  approved:            number;
  frames_annotated:    number;
  mean_confidence:     number;
}

export function computeVideoStats(state: VideoAnnotationState): VideoAnnotationStats {
  const kfs = state.keyframes;
  const manual       = kfs.filter(k => !k.is_interpolated).length;
  const interpolated = kfs.filter(k => k.is_interpolated).length;
  const flagged      = kfs.filter(k => k.qa_flag && k.qa_flag !== "approved").length;
  const approved     = kfs.filter(k => k.qa_flag === "approved").length;
  const frames       = new Set(kfs.map(k => k.frame_index)).size;
  const confSum      = kfs.reduce((s, k) => s + k.confidence, 0);

  return {
    total_tracks:     state.tracks.length,
    total_keyframes:  kfs.length,
    interpolated,
    manual,
    flagged,
    approved,
    frames_annotated: frames,
    mean_confidence:  kfs.length > 0 ? confSum / kfs.length : 0,
  };
}

// ── Windowing (long-video support) ────────────────────────────────────────────
// frame_index is ALWAYS absolute across the whole video.
// extractFrames returns relative indices (0-based per window) — callers must
// convert via windowToAbsolute() before storing keyframes.

export interface WindowBounds {
  window:       number;
  start_frame:  number;   // absolute, inclusive
  end_frame:    number;   // absolute, exclusive
  start_s:      number;   // for extractFrames config
  end_s:        number;
}

// Compute the absolute frame + time bounds for a given window index.
export function getWindowBounds(
  state:  VideoAnnotationState,
  window: number,
): WindowBounds {
  const w           = Math.max(0, Math.min(state.window_count - 1, window));
  const start_frame = w * state.window_size;
  const end_frame   = Math.min(start_frame + state.window_size, state.total_frames);
  const fps         = state.fps || 25;
  return {
    window:      w,
    start_frame,
    end_frame,
    start_s:     start_frame / fps,
    end_s:       end_frame   / fps,
  };
}

// Convert a relative (per-window) frame index to absolute.
export function windowToAbsolute(
  state:         VideoAnnotationState,
  window:        number,
  relativeIndex: number,
): number {
  return window * state.window_size + relativeIndex;
}

// Which window does an absolute frame belong to?
export function frameToWindow(
  state:       VideoAnnotationState,
  absoluteIdx: number,
): number {
  return Math.floor(absoluteIdx / state.window_size);
}

// Switch the active window. Clamps to valid range. Resets current_frame to the
// first frame of the new window. Does NOT touch tracks/keyframes (they persist).
export function goToWindow(
  state:  VideoAnnotationState,
  window: number,
): VideoAnnotationState {
  const w = Math.max(0, Math.min(state.window_count - 1, window));
  const bounds = getWindowBounds(state, w);
  return {
    ...state,
    current_window: w,
    current_frame:  bounds.start_frame,
  };
}

// Replace frames_meta for the current window, converting relative→absolute.
// Called after extractFrames returns a window's frames.
export function applyWindowFramesMeta(
  state:       VideoAnnotationState,
  window:      number,
  relativeMeta:{ index:number; timestamp_s:number; width:number; height:number; checksum:string|null }[],
): VideoAnnotationState {
  const absMeta: FrameMeta[] = relativeMeta.map(m => ({
    index:       windowToAbsolute(state, window, m.index),
    timestamp_s: m.timestamp_s,   // already absolute (extractFrames uses real ts)
    width:       m.width,
    height:      m.height,
    checksum:    m.checksum,
  }));
  return { ...state, frames_meta: absMeta };
}
