/**
 * visionQA.ts — Vision QA Intelligence
 * Aivora Platform — Phase 14.5
 *
 * Advisory only — no autonomous corrections.
 * Deterministic math. No ML decisions.
 * Same evidence → same advisory output.
 */

export const VISION_QA_VERSION = "14.5.0";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VisionQACode =
  | "BBOX_OVERLAP"
  | "BBOX_OUT_OF_BOUNDS"
  | "EMPTY_ANNOTATION"
  | "LOW_CONFIDENCE"
  | "RESOLUTION_MISMATCH"
  | "TEMPORAL_DRIFT"
  | "ANNOTATION_DISAGREEMENT"
  | "MISSING_CATEGORY"
  | "DUPLICATE_ANNOTATION";

export interface VisionQAIssue {
  code:        VisionQACode;
  severity:    "error" | "warning" | "info";
  message:     string;
  record_id?:  string;
  details?:    Record<string, unknown>;
}

export interface VisionQAReport {
  version:        string;
  passed:         boolean;
  total_records:  number;
  error_count:    number;
  warning_count:  number;
  issues:         VisionQAIssue[];
  mean_confidence:number;
  generated_at:   string;
}

// ── BBox Overlap Detection ────────────────────────────────────────────────────
// IoU: Intersection over Union — deterministic

export function computeIoU(
  a: { x:number; y:number; width:number; height:number },
  b: { x:number; y:number; width:number; height:number },
): number {
  const ax2 = a.x + a.width,  ay2 = a.y + a.height;
  const bx2 = b.x + b.width,  by2 = b.y + b.height;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const union = aArea + bArea - intersection;

  return union > 0 ? intersection / union : 0;
}

// ── BBox Validators ───────────────────────────────────────────────────────────

export function checkBBoxBounds(
  bbox: { x:number; y:number; width:number; height:number },
  recordId: string,
): VisionQAIssue[] {
  const issues: VisionQAIssue[] = [];
  const { x, y, width, height } = bbox;

  if(x < 0 || y < 0 || x + width > 1 || y + height > 1) {
    issues.push({
      code:     "BBOX_OUT_OF_BOUNDS",
      severity: "error",
      message:  `BBox out of bounds: x=${x.toFixed(3)} y=${y.toFixed(3)} w=${width.toFixed(3)} h=${height.toFixed(3)}`,
      record_id:recordId,
      details:  { x, y, width, height },
    });
  }
  return issues;
}

export function checkBBoxOverlaps(
  annotations: { x:number; y:number; width:number; height:number; id:number }[],
  recordId:    string,
  iouThreshold = 0.9,
): VisionQAIssue[] {
  const issues: VisionQAIssue[] = [];

  for(let i = 0; i < annotations.length; i++) {
    for(let j = i + 1; j < annotations.length; j++) {
      const iou = computeIoU(annotations[i], annotations[j]);
      if(iou >= iouThreshold) {
        issues.push({
          code:     "BBOX_OVERLAP",
          severity: "warning",
          message:  `High IoU ${iou.toFixed(3)} between annotations ${annotations[i].id} and ${annotations[j].id}`,
          record_id:recordId,
          details:  { iou, ann_a:annotations[i].id, ann_b:annotations[j].id },
        });
      }
    }
  }
  return issues;
}

// ── Confidence Check ──────────────────────────────────────────────────────────

export function checkAnnotationConfidence(
  annotations: { id:number; confidence:number }[],
  recordId:    string,
  minConf = 0.3,
): VisionQAIssue[] {
  const low = annotations.filter(a => a.confidence < minConf);
  if(low.length === 0) return [];
  return [{
    code:     "LOW_CONFIDENCE",
    severity: "warning",
    message:  `${low.length} annotations below confidence threshold ${minConf}`,
    record_id:recordId,
    details:  { low_count:low.length, threshold:minConf },
  }];
}

// ── Empty Annotation Check ────────────────────────────────────────────────────

export function checkEmptyAnnotations(
  annotations: unknown[],
  recordId:    string,
): VisionQAIssue[] {
  if(annotations.length === 0) return [{
    code:     "EMPTY_ANNOTATION",
    severity: "info",
    message:  "No annotations on this record",
    record_id:recordId,
  }];
  return [];
}

// ── Full Vision QA Report ─────────────────────────────────────────────────────

export interface VisionRecordForQA {
  id:          string;
  annotations?: { id:number; x:number; y:number;
                  width:number; height:number;
                  confidence:number; category_id:number }[];
}

export function generateVisionQAReport(
  records: VisionRecordForQA[],
): VisionQAReport {
  const allIssues: VisionQAIssue[] = [];
  let   totalConf = 0, confCount = 0;

  for(const record of records) {
    const anns = record.annotations ?? [];

    allIssues.push(...checkEmptyAnnotations(anns, record.id));

    for(const ann of anns) {
      allIssues.push(...checkBBoxBounds(ann, record.id));
      totalConf += ann.confidence;
      confCount++;
    }

    allIssues.push(...checkBBoxOverlaps(anns, record.id));
    allIssues.push(...checkAnnotationConfidence(anns, record.id));
  }

  const meanConf = confCount > 0 ? totalConf / confCount : 0;

  return {
    version:         VISION_QA_VERSION,
    passed:          allIssues.filter(i => i.severity === "error").length === 0,
    total_records:   records.length,
    error_count:     allIssues.filter(i => i.severity === "error").length,
    warning_count:   allIssues.filter(i => i.severity === "warning").length,
    issues:          allIssues,
    mean_confidence: Math.round(meanConf * 10000) / 10000,
    generated_at:    new Date().toISOString(),
  };
}
