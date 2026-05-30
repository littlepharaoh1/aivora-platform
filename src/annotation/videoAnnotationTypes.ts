/**
 * videoAnnotationTypes.ts
 * Aivora Platform — Phase 15.3
 *
 * Enterprise Video Annotation Type System.
 * Deterministic. Replay-safe. Offline-first.
 */

export const VIDEO_ANNOTATION_VERSION = "15.3.0";

export const VIDEO_ANNOTATION_LIMITS = {
  MAX_TRACKS:        500,
  MAX_KEYFRAMES:     10_000,
  MAX_FRAMES:        120,
  MAX_FRAME_DIM:     1920,
  MAX_VIDEO_HOURS:   2,
  INTERPOLATION_MAX: 300,  // max frames to interpolate between keyframes
} as const;

// ── Geometry (normalized 0→1) ─────────────────────────────────────────────────

export interface VBBox {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

export interface VPoint {
  x: number;
  y: number;
}

// ── Track — persistent object identity across frames ─────────────────────────

export interface Track {
  id:          string;    // UUID — stable across all frames
  label:       string;    // class name
  class_id:    number;
  color:       string;    // hex — deterministic from track index
  created_at:  string;
  is_active:   boolean;
  notes:       string;
}

// ── Keyframe — annotation at a specific frame ─────────────────────────────────

export interface Keyframe {
  id:            string;   // UUID
  track_id:      string;
  frame_index:   number;   // 0-based
  timestamp_s:   number;   // deterministic 3dp
  bbox:          VBBox;
  points:        VPoint[]; // polygon/polyline if needed
  confidence:    number;
  is_interpolated:boolean; // true = auto-generated, false = manual
  is_ai:         boolean;
  qa_flag:       VideoQAFlag | null;
  occluded:      boolean;
  out_of_frame:  boolean;
  checksum:      string | null;
  created_at:    string;
}

// ── QA Flags ──────────────────────────────────────────────────────────────────

export type VideoQAFlag =
  | "low_confidence"
  | "occluded"
  | "out_of_frame"
  | "id_switch"
  | "missed_detection"
  | "false_positive"
  | "approved";

// ── Shot segment ──────────────────────────────────────────────────────────────

export interface ShotSegment {
  id:           string;
  start_frame:  number;
  end_frame:    number;
  label:        string;
  notes:        string;
}

// ── Frame metadata ────────────────────────────────────────────────────────────

export interface FrameMeta {
  index:       number;
  timestamp_s: number;
  width:       number;
  height:      number;
  checksum:    string | null;
}

// ── Full video annotation state ───────────────────────────────────────────────

export interface VideoAnnotationState {
  version:          string;
  video_id:         string;
  filename:         string;
  duration_s:       number;
  fps:              number;
  width:            number;
  height:           number;
  total_frames:     number;

  tracks:           Track[];
  keyframes:        Keyframe[];
  shots:            ShotSegment[];
  frames_meta:      FrameMeta[];

  // Editor state
  current_frame:    number;
  selected_track_id:string | null;
  selected_kf_id:   string | null;
  active_tool:      VideoTool;

  // History (bounded)
  history:          VideoHistoryEntry[];
  future:           VideoHistoryEntry[];

  // Persistence
  created_at:       string;
  updated_at:       string;
}

export type VideoTool = "select" | "bbox" | "pan";

export interface VideoHistoryEntry {
  tracks:    Track[];
  keyframes: Keyframe[];
  shots:     ShotSegment[];
}

// ── Export formats ────────────────────────────────────────────────────────────

export type VideoExportFormat = "coco_video" | "mot" | "yolo_video" | "jsonl";

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

export const VIDEO_SHORTCUTS: Record<string, string> = {
  "←/→":         "Prev/Next frame",
  "Shift+←/→":   "Jump 10 frames",
  "Space":        "Play/Pause",
  "B":            "BBox tool",
  "V":            "Select tool",
  "I":            "Set keyframe",
  "Delete":       "Delete selected",
  "Ctrl+Z":       "Undo",
  "Ctrl+Y":       "Redo",
  "N":            "New track",
  "T":            "Toggle track active",
  "Escape":       "Cancel / Deselect",
  "0":            "Go to frame 0",
  "End":          "Go to last frame",
  "PageUp":       "Jump +100 frames",
  "PageDown":     "Jump -100 frames",
};
