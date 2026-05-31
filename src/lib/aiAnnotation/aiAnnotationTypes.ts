/**
 * aiAnnotationTypes.ts
 * Aivora Platform — AI-Assisted Annotation Layer
 *
 * Enhances manual annotation with model proposals. Never replaces the manual
 * workflow — proposals require human approval before becoming annotations.
 * All proposal decoding is deterministic.
 */

export const AI_ANNOTATION_VERSION = "18.0.0";

// ── Model roles in the assist pipeline ────────────────────────────────────────

export type AssistModel =
  | "yolo"           // object proposals (bounding boxes)
  | "sam2"           // segmentation proposals (masks)
  | "grounding_dino" // text-guided detection
  | "clip";          // semantic classification

export const ASSIST_MODELS: AssistModel[] = [
  "yolo", "sam2", "grounding_dino", "clip",
];

export const ASSIST_MODEL_LABELS: Record<AssistModel, string> = {
  yolo:           "YOLO — Object Proposals",
  sam2:           "SAM2 — Segmentation",
  grounding_dino: "Grounding DINO — Text-Guided",
  clip:           "CLIP — Classification",
};

// Maps assist model → MODEL_CATALOG id (registered in the existing registry)
export const ASSIST_MODEL_CATALOG_ID: Record<AssistModel, string> = {
  yolo:           "yolov8n-detect",
  sam2:           "sam2-hiera-tiny",
  grounding_dino: "grounding-dino-tiny",
  clip:           "clip-vit-b32",
};

// ── Proposal (a single suggested annotation, pre-approval) ────────────────────

export type ProposalKind = "bbox" | "mask" | "class";

export interface ProposalBBox {
  x: number; y: number; width: number; height: number;  // normalized 0..1
}

export interface Proposal {
  id:          string;
  kind:        ProposalKind;
  source:      AssistModel;
  class_id:    number;
  class_name:  string;
  confidence:  number;             // 0..1
  bbox:        ProposalBBox | null;
  // Mask as normalized polygon points (deterministic decode of SAM2 output)
  mask_points: { x: number; y: number }[] | null;
  // For CLIP: ranked class candidates
  candidates:  { class_name: string; score: number }[] | null;
}

// ── Approval workflow ─────────────────────────────────────────────────────────

export type ApprovalDecision = "pending" | "accepted" | "rejected" | "edited";

export interface ApprovalItem {
  proposal:  Proposal;
  decision:  ApprovalDecision;
}

export interface ApprovalState {
  asset_id:  string;
  items:     ApprovalItem[];
  // Confidence threshold below which proposals are hidden by default
  min_confidence: number;
}

// ── Auto-annotate run result ──────────────────────────────────────────────────

export interface AutoAnnotateResult {
  asset_id:        string;
  model:           AssistModel;
  model_id:        string;
  model_version:   string;
  backend:         string;          // which fallback tier ran
  proposals:       Proposal[];
  input_checksum:  string | null;
  output_checksum: string | null;
  duration_ms:     number;
  ran_inference:   boolean;         // false if model weights not yet available
  message:         string;          // human-readable status
}

// ── Confidence visualization bands ────────────────────────────────────────────

export type ConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(c: number): ConfidenceBand {
  if(c >= 0.75) return "high";
  if(c >= 0.5)  return "medium";
  return "low";
}

export const CONFIDENCE_COLORS: Record<ConfidenceBand, string> = {
  high:   "#22c55e",
  medium: "#f59e0b",
  low:    "#ef4444",
};

// ── Effort metrics (success criterion: 60% reduction) ─────────────────────────

export interface EffortMetrics {
  total_proposals:   number;
  accepted:          number;
  rejected:          number;
  edited:            number;
  // Effort saved = accepted proposals (didn't need manual drawing)
  // as a fraction of total annotations on the asset.
  effort_reduction:  number;        // 0..1
}

export function computeEffortMetrics(items: ApprovalItem[]): EffortMetrics {
  const accepted = items.filter(i => i.decision === "accepted").length;
  const rejected = items.filter(i => i.decision === "rejected").length;
  const edited   = items.filter(i => i.decision === "edited").length;
  const total    = items.length;
  // Accepted + edited both save effort (edited = adjusted, not drawn from scratch).
  // Reduction is measured against the work that resulted in a kept annotation.
  const kept = accepted + edited;
  const effort_reduction = total > 0 ? kept / total : 0;
  return {
    total_proposals: total,
    accepted, rejected, edited,
    effort_reduction: Math.round(effort_reduction * 1000) / 1000,
  };
}
