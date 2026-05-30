/**
 * annotationTypes.ts — Enterprise Annotation Type System
 * Aivora Platform — Phase 15.2
 *
 * Extends existing BBox with all annotation types.
 * All coords normalized 0→1. Deterministic. Replay-safe.
 */

export const ANNOTATION_ENGINE_VERSION = "15.2.0";

// ── Geometry primitives ───────────────────────────────────────────────────────

export interface Point {
  x: number;  // normalized 0→1
  y: number;  // normalized 0→1
}

export interface BBox {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

// ── Annotation types ──────────────────────────────────────────────────────────

export type AnnotationType =
  | "bbox"
  | "polygon"
  | "polyline"
  | "keypoints"
  | "segmentation"
  | "classification"
  | "multi_label"
  | "attributes"
  | "relationship";

// ── Keypoint ──────────────────────────────────────────────────────────────────

export type KeypointVisibility = 0 | 1 | 2; // 0=hidden,1=occluded,2=visible

export interface Keypoint extends Point {
  name:       string;
  visibility: KeypointVisibility;
  idx:        number;
}

// ── Attribute ─────────────────────────────────────────────────────────────────

export interface AttributeValue {
  key:   string;
  value: string | number | boolean;
  type:  "string" | "number" | "boolean" | "enum";
}

// ── Relationship ──────────────────────────────────────────────────────────────

export interface Relationship {
  subject_id: string;   // annotation id
  object_id:  string;   // annotation id
  predicate:  string;   // e.g. "next_to", "contains", "occludes"
}

// ── Layer ─────────────────────────────────────────────────────────────────────

export interface Layer {
  id:         string;
  name:       string;
  visible:    boolean;
  locked:     boolean;
  color:      string;
  created_at: string;
}

// ── Core Annotation (Enterprise) ─────────────────────────────────────────────

export interface EnterpriseAnnotation {
  // Identity
  id:           string;    // UUID — stable
  sequence:     number;    // monotonic counter — deterministic ordering
  type:         AnnotationType;

  // Label
  class_id:     number;
  class_name:   string;
  class_color:  string;
  layer_id:     string;
  labels:       string[];  // multi-label support

  // Geometry — only relevant fields populated per type
  bbox:         BBox | null;
  points:       Point[];    // polygon, polyline, segmentation
  keypoints:    Keypoint[];
  mask_rle:     string | null;   // run-length encoding for segmentation mask

  // Attributes
  attributes:   AttributeValue[];

  // QA/Review
  confidence:   number;     // 1.0=manual, <1.0=AI-suggested
  is_ai:        boolean;
  is_approved:  boolean;
  qa_flag:      QAFlag | null;
  reviewer_id:  string | null;
  review_note:  string;

  // Context
  frame_index:  number | null;   // null=image, number=video
  image_id:     string;
  checksum:     string | null;   // SHA-256 of geometry

  // Timestamps
  created_at:   string;
  updated_at:   string;
  notes:        string;
}

export type QAFlag =
  | "low_confidence"
  | "occluded"
  | "truncated"
  | "ambiguous"
  | "conflict"
  | "approved";

// ── State ─────────────────────────────────────────────────────────────────────

export const ENTERPRISE_LIMITS = {
  MAX_ANNOTATIONS:  10_000,
  MAX_HISTORY:      100,
  MAX_POLYGON_PTS:  2048,
  MAX_KEYPOINTS:    133,   // COCO full body
  MAX_LAYERS:       50,
  MIN_BBOX_SIZE:    0.002,
  MIN_POLYGON_PTS:  3,
} as const;

export interface EnterpriseAnnotationState {
  annotations:  EnterpriseAnnotation[];
  relationships:Relationship[];
  layers:       Layer[];
  history:      EnterpriseAnnotation[][];
  future:       EnterpriseAnnotation[][];
  sequence:     number;
  image_id:     string;
  version:      string;
  selected_ids: string[];
  active_layer: string;
}

// ── Tool types ────────────────────────────────────────────────────────────────

export type AnnotationTool =
  | "select"
  | "pan"
  | "bbox"
  | "polygon"
  | "polyline"
  | "keypoints"
  | "segmentation"
  | "classification"
  | "multi_label"
  | "attributes"
  | "relationship";

export interface ToolConfig {
  tool:          AnnotationTool;
  class_id:      number;
  class_name:    string;
  class_color:   string;
  layer_id:      string;
  snap_enabled:  boolean;
  snap_distance: number;   // pixels
}

// ── Transform matrix ──────────────────────────────────────────────────────────

export interface Transform {
  scale: number;
  tx:    number;
  ty:    number;
}

// ── Export formats ────────────────────────────────────────────────────────────

export type ExportFormat =
  | "coco"
  | "yolo"
  | "pascal_voc"
  | "jsonl"
  | "aivora_native";

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

export const ANNOTATION_SHORTCUTS: Record<string, string> = {
  "V":         "Select tool",
  "B":         "Bounding Box",
  "P":         "Polygon",
  "L":         "Polyline",
  "K":         "Keypoints",
  "S":         "Segmentation",
  "C":         "Classification",
  "Space":     "Pan tool",
  "Escape":    "Cancel / Deselect",
  "Enter":     "Confirm polygon/polyline",
  "Delete":    "Delete selected",
  "Backspace": "Delete last point (polygon)",
  "Ctrl+Z":    "Undo",
  "Ctrl+Y":    "Redo",
  "Ctrl+S":    "Save",
  "Ctrl+A":    "Select all",
  "Ctrl+D":    "Duplicate selected",
  "+":         "Zoom in",
  "-":         "Zoom out",
  "0":         "Fit to screen",
  "Tab":       "Next annotation",
  "Shift+Tab": "Previous annotation",
  "H":         "Toggle layer visibility",
  "G":         "Toggle grid",
  "R":         "Review mode",
};
