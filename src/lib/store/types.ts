// ============================================================================
// Aivora Platform - Central Store Types
// ============================================================================

import type { ComplianceReport } from "../audio/StudioSpecCompliance";

// ============================================================================
// PIPELINE STAGES
// ============================================================================

export type PipelineStage =
  | "uploaded"
  | "analyzing"
  | "analyzed"
  | "enhancing"
  | "enhanced"
  | "qc_pending"
  | "qc_in_review"
  | "qc_passed"
  | "qc_failed"
  | "ready_to_deliver"
  | "delivered"
  | "rejected";

export const PIPELINE_STAGES: PipelineStage[] = [
  "uploaded",
  "analyzing",
  "analyzed",
  "enhancing",
  "enhanced",
  "qc_pending",
  "qc_in_review",
  "qc_passed",
  "qc_failed",
  "ready_to_deliver",
  "delivered",
  "rejected",
];

// ============================================================================
// DSP ANALYSIS RESULT
// ============================================================================

export interface DspAnalysisResult {
  sampleRate: number;
  bitDepth: number;
  channels: number;
  duration: number;
  peakDbfs: number;
  truePeakDbtp: number;
  rmsDbfs: number;
  lufsIntegrated: number;
  lufsShortTerm: number;
  loudnessRange: number;
  snrDb: number;
  noiseFloorDbfs: number;
  dynamicRangeDb: number;
  hum50Hz: { detected: boolean; level: number };
  hum60Hz: { detected: boolean; level: number };
  clipping: { hard: number; soft: number; transient: number };
  voiceActivity: { ratio: number; segments: number };
  acousticEnvironment: "studio" | "treated_room" | "untreated_room" | "outdoor" | "noisy";
  rt60: number;
  spectralBands: { band: string; energy: number }[];
  silenceLeadingMs: number;
  silenceTrailingMs: number;
  analyzedAt: number;
  durationMs: number;
}

// ============================================================================
// ENHANCEMENT OPERATIONS
// ============================================================================

export type EnhancementOperation =
  | "high_pass_filter"
  | "low_pass_filter"
  | "hum_notch_filter"
  | "spectral_noise_reduction"
  | "true_peak_limiter"
  | "loudness_normalize"
  | "silence_padding"
  | "convert_32bit"
  | "convert_48khz"
  | "trim_silence"
  | "fade_in"
  | "fade_out"
  | "denoise";

export interface EnhancementStep {
  id: string;
  operation: EnhancementOperation;
  params: Record<string, any>;
  appliedAt: number;
  durationMs: number;
}

// ============================================================================
// QC REVIEW
// ============================================================================

export type QcVerdict = "approved" | "rejected" | "needs_rework";

export interface QcReview {
  reviewerId: string;
  reviewerName?: string;
  reviewedAt: number;
  verdict: QcVerdict;
  notes?: string;
  flaggedIssues?: string[];
  audioQualityScore?: number;
  contentAccuracyScore?: number;
}

// ============================================================================
// EXPORT INFO
// ============================================================================

export interface ExportInfo {
  exportId: string;
  exportedAt: number;
  packageVersion: string;
  includedInDelivery: boolean;
  finalFilename: string;
  finalPath: string;
  checksums: { md5: string; sha256: string };
}

// ============================================================================
// CENTRAL FILE RECORD
// ============================================================================

export interface FileRecord {
  id: string;
  filename: string;
  displayName?: string;
  size: number;
  uploadedAt: number;
  blobId: string;
  mimeType?: string;
  stage: PipelineStage;
  stageHistory: { stage: PipelineStage; at: number }[];
  dspAnalysis?: DspAnalysisResult;
  compliance?: ComplianceReport;
  enhancements: EnhancementStep[];
  enhancedBlobId?: string;
  normalized32BitBlobId?: string;
  qcReview?: QcReview;
  germanNaming?: {
    contributorId?: string;
    sessionNumber?: string;
    speakingStyle?: "fast" | "normal" | "slow";
    fullDeliveryName?: string;
    isValid: boolean;
    validationErrors?: string[];
  };
  exportInfo?: ExportInfo;
  errors: string[];
  warnings: string[];
  tags: string[];
  customMetadata: Record<string, any>;
}

// ============================================================================
// BATCH METADATA
// ============================================================================

export interface BatchMetadata {
  batchId: string;
  batchName: string;
  clientName?: string;
  projectCode?: string;
  studioProfile: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// BATCH STATS
// ============================================================================

export interface BatchStats {
  total: number;
  byStage: Record<PipelineStage, number>;
  ready: number;
  review: number;
  rejected: number;
  passed: number;
  averageScore: number;
  averageSnrDb: number;
  averageNoiseFloorDbfs: number;
  averageLufs: number;
  topRejectionReasons: { reason: string; count: number }[];
}

// ============================================================================
// HELPERS
// ============================================================================

export function createEmptyStats(): BatchStats {
  const byStage = {} as Record<PipelineStage, number>;
  PIPELINE_STAGES.forEach((s) => (byStage[s] = 0));
  return {
    total: 0,
    byStage,
    ready: 0,
    review: 0,
    rejected: 0,
    passed: 0,
    averageScore: 0,
    averageSnrDb: 0,
    averageNoiseFloorDbfs: 0,
    averageLufs: 0,
    topRejectionReasons: [],
  };
}

export function computeBatchStats(records: FileRecord[]): BatchStats {
  const stats = createEmptyStats();
  stats.total = records.length;
  if (records.length === 0) return stats;

  records.forEach((r) => {
    stats.byStage[r.stage] = (stats.byStage[r.stage] || 0) + 1;
  });

  let scoreSum = 0;
  let snrSum = 0;
  let noiseSum = 0;
  let lufsSum = 0;
  let metricsCount = 0;

  const rejectionReasons: Record<string, number> = {};

  records.forEach((r) => {
    const v = r.compliance?.verdict;
    if (v === "READY") stats.ready++;
    else if (v === "REVIEW") stats.review++;
    else if (v === "REJECT") stats.rejected++;
    if (v === "READY" || v === "REVIEW") stats.passed++;

    if (r.compliance?.score !== undefined) {
      scoreSum += r.compliance.score;
    }
    if (r.dspAnalysis) {
      snrSum += r.dspAnalysis.snrDb || 0;
      noiseSum += r.dspAnalysis.noiseFloorDbfs || 0;
      lufsSum += r.dspAnalysis.lufsIntegrated || 0;
      metricsCount++;
    }

    r.compliance?.hardRejects?.forEach((h: any) => {
      const key = h.title || h.code || "Unknown";
      rejectionReasons[key] = (rejectionReasons[key] || 0) + 1;
    });
    r.compliance?.issues
      ?.filter((i: any) => i.severity === "major")
      .forEach((m: any) => {
        const key = m.title || m.code || "Unknown";
        rejectionReasons[key] = (rejectionReasons[key] || 0) + 1;
      });
  });

  stats.averageScore = records.length > 0 ? scoreSum / records.length : 0;
  if (metricsCount > 0) {
    stats.averageSnrDb = snrSum / metricsCount;
    stats.averageNoiseFloorDbfs = noiseSum / metricsCount;
    stats.averageLufs = lufsSum / metricsCount;
  }

  stats.topRejectionReasons = Object.entries(rejectionReasons)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return stats;
}

export function newBlobId(): string {
  return `blob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
