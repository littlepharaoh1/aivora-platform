/**
 * enterpriseAnnotationState.ts — Enterprise Annotation State Engine
 * Aivora Platform — Phase 15.2
 *
 * Pure functions — deterministic, replay-safe, immutable history.
 * Reuses existing: normalizeBBox, sha256Bytes patterns.
 * Handles 10,000+ annotations via efficient array ops.
 */

import type {
  EnterpriseAnnotation, EnterpriseAnnotationState,
  BBox, Point, Keypoint, AttributeValue,
  Layer, Relationship, QAFlag, AnnotationType,
} from "./annotationTypes";
import { ENTERPRISE_LIMITS } from "./annotationTypes";
import { getClassColor } from "./taxonomyEngine";

export const STATE_VERSION = "15.2.0";

// ── Factory ───────────────────────────────────────────────────────────────────

export function createEnterpriseState(imageId: string): EnterpriseAnnotationState {
  const defaultLayer: Layer = {
    id:         "layer_default",
    name:       "Default",
    visible:    true,
    locked:     false,
    color:      "#22d3ee",
    created_at: new Date().toISOString(),
  };
  return {
    annotations:   [],
    relationships: [],
    layers:        [defaultLayer],
    history:       [],
    future:        [],
    sequence:      0,
    image_id:      imageId,
    version:       STATE_VERSION,
    selected_ids:  [],
    active_layer:  "layer_default",
  };
}

// ── History management (bounded, immutable) ───────────────────────────────────

function pushHistory(state: EnterpriseAnnotationState): EnterpriseAnnotationState {
  const history = [
    ...state.history.slice(-(ENTERPRISE_LIMITS.MAX_HISTORY - 1)),
    [...state.annotations],
  ];
  return { ...state, history, future: [] };
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function normalizeBBox(bbox: BBox): BBox {
  const x = bbox.width  < 0 ? bbox.x + bbox.width  : bbox.x;
  const y = bbox.height < 0 ? bbox.y + bbox.height : bbox.y;
  const w = Math.abs(bbox.width);
  const h = Math.abs(bbox.height);
  return {
    x:      Math.max(0, Math.min(1 - w, x)),
    y:      Math.max(0, Math.min(1 - h, y)),
    width:  Math.min(1, Math.max(ENTERPRISE_LIMITS.MIN_BBOX_SIZE, w)),
    height: Math.min(1, Math.max(ENTERPRISE_LIMITS.MIN_BBOX_SIZE, h)),
  };
}

export function isBBoxValid(bbox: BBox): boolean {
  return bbox.width  >= ENTERPRISE_LIMITS.MIN_BBOX_SIZE &&
         bbox.height >= ENTERPRISE_LIMITS.MIN_BBOX_SIZE &&
         bbox.x >= 0 && bbox.y >= 0 &&
         bbox.x + bbox.width  <= 1 &&
         bbox.y + bbox.height <= 1;
}

export function clampPoint(p: Point): Point {
  return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
}

// Snap point to nearest other annotation vertex
export function snapPoint(
  p: Point,
  annotations: EnterpriseAnnotation[],
  snapDistNorm: number,
): Point {
  let best = p, bestDist = snapDistNorm;
  for(const ann of annotations) {
    const candidates: Point[] = [
      ...(ann.bbox ? [
        { x: ann.bbox.x, y: ann.bbox.y },
        { x: ann.bbox.x + ann.bbox.width, y: ann.bbox.y },
        { x: ann.bbox.x, y: ann.bbox.y + ann.bbox.height },
        { x: ann.bbox.x + ann.bbox.width, y: ann.bbox.y + ann.bbox.height },
      ] : []),
      ...ann.points,
      ...ann.keypoints.map(k => ({ x: k.x, y: k.y })),
    ];
    for(const c of candidates) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if(d < bestDist) { best = c; bestDist = d; }
    }
  }
  return best;
}

// BBox from polygon points
export function bboxFromPoints(points: Point[]): BBox | null {
  if(points.length < 2) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  return { x, y, width: w, height: h };
}

// ── Annotation factory ────────────────────────────────────────────────────────

export function createAnnotation(params: {
  type:        AnnotationType;
  class_id:    number;
  class_name:  string;
  class_color: string;
  layer_id:    string;
  image_id:    string;
  sequence:    number;
  bbox?:       BBox;
  points?:     Point[];
  keypoints?:  Keypoint[];
  labels?:     string[];
  attributes?: AttributeValue[];
  frame_index?:number | null;
}): EnterpriseAnnotation {
  const now = new Date().toISOString();
  return {
    id:           crypto.randomUUID(),
    sequence:     params.sequence,
    type:         params.type,
    class_id:     params.class_id,
    class_name:   params.class_name,
    class_color:  params.class_color,
    layer_id:     params.layer_id,
    labels:       params.labels ?? [params.class_name],
    bbox:         params.bbox ?? null,
    points:       params.points ?? [],
    keypoints:    params.keypoints ?? [],
    mask_rle:     null,
    attributes:   params.attributes ?? [],
    confidence:   1.0,
    is_ai:        false,
    is_approved:  true,
    qa_flag:      null,
    reviewer_id:  null,
    review_note:  "",
    frame_index:  params.frame_index ?? null,
    image_id:     params.image_id,
    checksum:     null,
    created_at:   now,
    updated_at:   now,
    notes:        "",
  };
}

// ── State mutations (pure) ────────────────────────────────────────────────────

export function addAnnotation(
  state: EnterpriseAnnotationState,
  ann:   EnterpriseAnnotation,
): EnterpriseAnnotationState {
  if(state.annotations.length >= ENTERPRISE_LIMITS.MAX_ANNOTATIONS) return state;
  const s = pushHistory(state);
  return {
    ...s,
    annotations: [...s.annotations, ann],
    sequence:    s.sequence + 1,
    selected_ids:[ann.id],
  };
}

export function updateAnnotation(
  state: EnterpriseAnnotationState,
  id:    string,
  patch: Partial<EnterpriseAnnotation>,
): EnterpriseAnnotationState {
  const idx = state.annotations.findIndex(a => a.id === id);
  if(idx < 0) return state;
  const s = pushHistory(state);
  const updated = {
    ...s.annotations[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const annotations = [...s.annotations];
  annotations[idx] = updated;
  return { ...s, annotations };
}

export function deleteAnnotations(
  state: EnterpriseAnnotationState,
  ids:   string[],
): EnterpriseAnnotationState {
  if(ids.length === 0) return state;
  const s = pushHistory(state);
  return {
    ...s,
    annotations:  s.annotations.filter(a => !ids.includes(a.id)),
    relationships:s.relationships.filter(
      r => !ids.includes(r.subject_id) && !ids.includes(r.object_id)
    ),
    selected_ids: [],
  };
}

export function duplicateAnnotations(
  state: EnterpriseAnnotationState,
  ids:   string[],
): EnterpriseAnnotationState {
  const toDup = state.annotations.filter(a => ids.includes(a.id));
  if(toDup.length === 0) return state;
  const s = pushHistory(state);
  const now = new Date().toISOString();
  let seq = s.sequence;
  const duped = toDup.map(a => ({
    ...a,
    id:         crypto.randomUUID(),
    sequence:   ++seq,
    bbox:       a.bbox ? { ...a.bbox, x: a.bbox.x + 0.01, y: a.bbox.y + 0.01 } : null,
    points:     a.points.map(p => ({ x: p.x + 0.01, y: p.y + 0.01 })),
    created_at: now,
    updated_at: now,
  }));
  return {
    ...s,
    annotations: [...s.annotations, ...duped],
    sequence:    seq,
    selected_ids:duped.map(a => a.id),
  };
}

export function selectAnnotations(
  state: EnterpriseAnnotationState,
  ids:   string[],
): EnterpriseAnnotationState {
  return { ...state, selected_ids: ids };
}

export function selectAll(
  state: EnterpriseAnnotationState,
): EnterpriseAnnotationState {
  return { ...state, selected_ids: state.annotations.map(a => a.id) };
}

export function setQAFlag(
  state:  EnterpriseAnnotationState,
  id:     string,
  flag:   QAFlag | null,
): EnterpriseAnnotationState {
  return updateAnnotation(state, id, { qa_flag: flag });
}

export function setAttributes(
  state:      EnterpriseAnnotationState,
  id:         string,
  attributes: AttributeValue[],
): EnterpriseAnnotationState {
  return updateAnnotation(state, id, { attributes });
}

export function addRelationship(
  state: EnterpriseAnnotationState,
  rel:   Relationship,
): EnterpriseAnnotationState {
  return { ...state, relationships: [...state.relationships, rel] };
}

// ── Layer management ──────────────────────────────────────────────────────────

export function addLayer(
  state: EnterpriseAnnotationState,
  name:  string,
): EnterpriseAnnotationState {
  if(state.layers.length >= ENTERPRISE_LIMITS.MAX_LAYERS) return state;
  const layer: Layer = {
    id:         `layer_${crypto.randomUUID().slice(0,8)}`,
    name,
    visible:    true,
    locked:     false,
    color:      getClassColor(state.layers.length),
    created_at: new Date().toISOString(),
  };
  return { ...state, layers: [...state.layers, layer] };
}

export function toggleLayerVisibility(
  state:   EnterpriseAnnotationState,
  layerId: string,
): EnterpriseAnnotationState {
  return {
    ...state,
    layers: state.layers.map(l =>
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ),
  };
}

export function setActiveLayer(
  state:   EnterpriseAnnotationState,
  layerId: string,
): EnterpriseAnnotationState {
  return { ...state, active_layer: layerId };
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────

export function undoState(
  state: EnterpriseAnnotationState,
): EnterpriseAnnotationState {
  if(state.history.length === 0) return state;
  const history = [...state.history];
  const prev    = history.pop()!;
  const future  = [state.annotations, ...state.future]
    .slice(0, ENTERPRISE_LIMITS.MAX_HISTORY);
  return { ...state, annotations: prev, history, future, selected_ids: [] };
}

export function redoState(
  state: EnterpriseAnnotationState,
): EnterpriseAnnotationState {
  if(state.future.length === 0) return state;
  const future = [...state.future];
  const next   = future.shift()!;
  const history = [...state.history, state.annotations]
    .slice(-ENTERPRISE_LIMITS.MAX_HISTORY);
  return { ...state, annotations: next, history, future, selected_ids: [] };
}

// ── Hit testing ───────────────────────────────────────────────────────────────

export function hitTestAnnotation(
  ann: EnterpriseAnnotation,
  nx:  number,
  ny:  number,
  tol: number = 0.008,
): boolean {
  // BBox hit
  if(ann.bbox) {
    const { x, y, width, height } = ann.bbox;
    if(nx >= x - tol && nx <= x + width + tol &&
       ny >= y - tol && ny <= y + height + tol) return true;
  }
  // Polygon/polyline — point-in-polygon or near edge
  if(ann.points.length >= 3 && ann.type !== "polyline") {
    let inside = false;
    const pts = ann.points;
    for(let i=0, j=pts.length-1; i<pts.length; j=i++) {
      if(((pts[i].y > ny) !== (pts[j].y > ny)) &&
         nx < (pts[j].x - pts[i].x) * (ny - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) {
        inside = !inside;
      }
    }
    if(inside) return true;
  }
  // Polyline — near any segment
  if(ann.points.length >= 2) {
    for(let i = 0; i < ann.points.length - 1; i++) {
      const a = ann.points[i], b = ann.points[i+1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx*dx + dy*dy;
      if(len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((nx-a.x)*dx + (ny-a.y)*dy) / len2));
      const cx = a.x + t*dx, cy = a.y + t*dy;
      if(Math.hypot(nx-cx, ny-cy) < tol) return true;
    }
  }
  // Keypoints
  for(const kp of ann.keypoints) {
    if(Math.hypot(nx - kp.x, ny - kp.y) < tol) return true;
  }
  return false;
}

export function hitTestAll(
  annotations: EnterpriseAnnotation[],
  nx: number, ny: number,
  tol: number = 0.008,
): EnterpriseAnnotation | null {
  // Reverse order — top annotation first
  for(let i = annotations.length - 1; i >= 0; i--) {
    if(hitTestAnnotation(annotations[i], nx, ny, tol)) return annotations[i];
  }
  return null;
}
