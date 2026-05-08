// ════════════════════════════════════════════════════════════════════
// AIVORA — UNIFIED FILE RECORD TYPE
// Single source of truth for all audio files across the platform
// ════════════════════════════════════════════════════════════════════

import type { FullAudioAnalysis } from "../audio/AdvancedAudioAnalyzer";
import type { ComplianceReport } from "../audio/StudioSpecCompliance";

// ─── PIPELINE STATES ──────────────────────────────────────────────

export type PipelineStage =
  | "uploaded"        // file added to system
  | "validated"       // basic format checks done
  | "analyzed"        // DSP analysis complete
  | "compliance"      // compliance check complete
  | "enhanced"        // enhancement applied
  | "qc_pending"      // awaiting QA reviewer
  | "qc_approved"     // QA approved
  | "qc_review"       // QA flagged for second look
  | "qc_rejected"     // QA rejected
  | "ready"           // ready for export
  | "exported"        // delivered to client
  | "archived";       // archived after delivery

export type Decision = "Pending" | "Approved" | "Review" | "Rejected";

// ─── ENHANCEMENT HISTORY ──────────────────────────────────────────

export interface EnhancementOperation {
  id: string;
  type: 
    | "high_pass" 
    | "low_pass" 
    | "notch_50hz" 
    | "notch_60hz"
    | "noise_gate" 
    | "noise_reduction"
    | "de_click" 
    | "normalize" 
    | "true_peak_limit"
    | "trim_silence"
    | "loudness_match";
  parameters: Record<string, number | boolean>;
  appliedAt: string;          // ISO timestamp
  appliedBy: string;          // user/automated
  beforeMetrics?: {
    peakDb: number;
    rmsDb: number;
    noiseDb: number;
    snrDb: number;
    lufsIntegrated: number;
    truePeakDbTp: number;
  };
  afterMetrics?: {
    peakDb: number;
    rmsDb: number;
    noiseDb: number;
    snrDb: number;
    lufsIntegrated: number;
    truePeakDbTp: number;
  };
  improvementDb?: number;     // SNR improvement
}

// ─── QC REVIEW DATA ────────────────────────────────────────────────

export interface QCReview {
  reviewer: string;
  reviewerRole: "Admin" | "Manager" | "QA Reviewer" | "Viewer";
  decision: Decision;
  decidedAt: string;
  notes: string;
  timeSpentSeconds: number;
  flags: Array<{
    category: "noise" | "clipping" | "voice" | "environment" | "specs" | "fraud" | "other";
    description: string;
    severity: "low" | "medium" | "high" | "critical";
  }>;
  // Listening verification
  audioListened: boolean;
  listenedDurationSeconds: number;
  // Linked to QC session
  sessionId?: string;
}

// ─── EXPORT METADATA ───────────────────────────────────────────────

export interface ExportInfo {
  exportedAt: string;
  exportedBy: string;
  exportBatchId: string;
  clientName: string;
  deliveryFormat: string;
  filename: string;             // final delivered filename
  checksumMd5?: string;
  checksumSha256?: string;
  sizeBytes: number;
}

// ─── MAIN FILE RECORD ──────────────────────────────────────────────

export interface FileRecord {
  // ═══ IDENTITY ═══
  id: string;
  fileName: string;
  originalFileName?: string;
  
  // ═══ FILE PROPERTIES ═══
  file?: File;                  // browser File object (in-memory)
  audioBuffer?: AudioBuffer;    // decoded audio (in-memory)
  fileSize?: number;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  
  // ═══ VALIDATION ═══
  status: "Valid" | "Invalid" | "Processing" | string;
  reason: string;
  
  // ═══ PROJECT CONTEXT ═══
  projectId?: string;
  projectName?: string;
  speaker?: string;             // e.g. "D0001"
  speakerRole?: string;
  task?: string;                // wakeword | asr | tts | conversation
  language?: string;
  locale?: string;
  
  // ═══ NAMING (for German/Italian batches) ═══
  index?: number;
  speed?: "slow" | "normal" | "fast";
  expectedNaming?: string;      // matches namingTemplate
  
  // ═══ DSP ANALYSIS (from AdvancedAudioAnalyzer) ═══
  analysis?: FullAudioAnalysis;
  analyzedAt?: string;
  analyzerVersion?: string;
  
  // ═══ COMPLIANCE (from StudioSpecCompliance) ═══
  compliance?: ComplianceReport;
  
  // ═══ LEGACY FIELDS (backward compatibility) ═══
  decision: Decision;
  notes?: string;
  peakDb?: number;
  rmsDb?: number;
  noiseDb?: number;
  snrDb?: number;
  
  // ═══ ENHANCEMENT TRACKING ═══
  enhancements?: EnhancementOperation[];
  enhancedAudioBuffer?: AudioBuffer;
  enhancedFileBlob?: Blob;
  
  // ═══ QC REVIEW ═══
  qc?: QCReview;
  
  // ═══ EXPORT TRACKING ═══
  export?: ExportInfo;
  
  // ═══ PIPELINE STATUS ═══
  stage?: PipelineStage;
  stageHistory?: Array<{
    stage?: PipelineStage;
    enteredAt: string;
    notes?: string;
  }>;
  
  // ═══ TIMESTAMPS ═══
  uploadedAt?: string;
  lastModifiedAt?: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────

export function createFileRecord(file: File, projectId?: string): FileRecord {
  const now = new Date().toISOString();
  return {
    id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    fileName: file.name,
    originalFileName: file.name,
    file,
    fileSize: file.size,
    status: "Processing",
    reason: "",
    projectId,
    decision: "Pending",
    enhancements: [],
    stage: "uploaded",
    stageHistory: [{ stage: "uploaded", enteredAt: now }],
    uploadedAt: now,
    lastModifiedAt: now,
  };
}

export function advanceStage(
  record: FileRecord,
  newStage: PipelineStage,
  notes?: string
): FileRecord {
  const now = new Date().toISOString();
  return {
    ...record,
    stage: newStage,
    stageHistory: [
      ...(record.stageHistory || []),
      { stage: newStage, enteredAt: now, notes },
    ],
    lastModifiedAt: now,
  };
}

export function getStageProgress(stage: PipelineStage): number {
  const order: PipelineStage[] = [
    "uploaded", "validated", "analyzed", "compliance", "enhanced",
    "qc_pending", "qc_approved", "ready", "exported", "archived"
  ];
  const idx = order.indexOf(stage);
  return idx < 0 ? 0 : Math.round((idx / (order.length - 1)) * 100);
}

export function getStageColor(stage: PipelineStage): string {
  switch (stage) {
    case "uploaded": return "#64748b";
    case "validated": return "#22d3ee";
    case "analyzed": return "#3b82f6";
    case "compliance": return "#8b5cf6";
    case "enhanced": return "#a855f7";
    case "qc_pending": return "#f59e0b";
    case "qc_approved": return "#10b981";
    case "qc_review": return "#f59e0b";
    case "qc_rejected": return "#ef4444";
    case "ready": return "#10b981";
    case "exported": return "#22d3ee";
    case "archived": return "#475569";
    default: return "#64748b";
  }
}

export function getStageLabel(stage: PipelineStage): string {
  const labels: Record<PipelineStage, string> = {
    uploaded: "Uploaded",
    validated: "Validated",
    analyzed: "Analyzed",
    compliance: "Compliance Checked",
    enhanced: "Enhanced",
    qc_pending: "Pending QA",
    qc_approved: "QA Approved",
    qc_review: "QA Flagged",
    qc_rejected: "QA Rejected",
    ready: "Ready for Export",
    exported: "Delivered",
    archived: "Archived",
  };
  return labels[stage] || stage;
}

// ─── BATCH STATISTICS ─────────────────────────────────────────────

export interface BatchStats {
  total: number;
  byStage: Record<PipelineStage, number>;
  byDecision: Record<Decision, number>;
  byVerdict: { READY: number; REVIEW: number; REJECT: number };
  byGrade: Record<string, number>;
  
  // Quality metrics
  averageScore: number;
  averageSnr: number;
  averageNoiseFloor: number;
  averageLufs: number;
  
  // Common issues
  topIssues: Array<{ id: string; title: string; count: number }>;
  
  // Throughput
  uploadedToday: number;
  processedToday: number;
  exportedToday: number;
  
  // Time tracking
  averageProcessingTimeMin: number;
}

export function computeBatchStats(records: FileRecord[]): BatchStats {
  const byStage: Record<string, number> = {};
  const byDecision: Record<string, number> = { Pending: 0, Approved: 0, Review: 0, Rejected: 0 };
  const byVerdict = { READY: 0, REVIEW: 0, REJECT: 0 };
  const byGrade: Record<string, number> = {};
  
  let scoreSum = 0, scoreCount = 0;
  let snrSum = 0, snrCount = 0;
  let noiseSum = 0, noiseCount = 0;
  let lufsSum = 0, lufsCount = 0;
  
  const issueCounts: Record<string, { id: string; title: string; count: number }> = {};
  
  const today = new Date().toISOString().slice(0, 10);
  let uploadedToday = 0, processedToday = 0, exportedToday = 0;
  
  for (const r of records) {
    if (r.stage) { byStage[r.stage] = (byStage[r.stage] || 0) + 1; }
    byDecision[r.decision] = (byDecision[r.decision] || 0) + 1;
    
    if (r.compliance) {
      byVerdict[r.compliance.verdict]++;
      byGrade[r.compliance.grade] = (byGrade[r.compliance.grade] || 0) + 1;
      scoreSum += r.compliance.score;
      scoreCount++;
      
      // Track issues
      for (const issue of [...r.compliance.hardRejects, ...r.compliance.issues]) {
        if (!issueCounts[issue.id]) {
          issueCounts[issue.id] = { id: issue.id, title: issue.title, count: 0 };
        }
        issueCounts[issue.id].count++;
      }
    }
    
    if (r.analysis) {
      snrSum += r.analysis.snrDb;
      snrCount++;
      noiseSum += r.analysis.noise.floorDb;
      noiseCount++;
      lufsSum += r.analysis.lufs.integrated;
      lufsCount++;
    }
    
    if (r.uploadedAt?.startsWith(today)) uploadedToday++;
    if (r.analyzedAt?.startsWith(today)) processedToday++;
    if (r.export?.exportedAt?.startsWith(today)) exportedToday++;
  }
  
  const topIssues = Object.values(issueCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  return {
    total: records.length,
    byStage: byStage as any,
    byDecision: byDecision as any,
    byVerdict,
    byGrade,
    averageScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
    averageSnr: snrCount > 0 ? +(snrSum / snrCount).toFixed(1) : 0,
    averageNoiseFloor: noiseCount > 0 ? +(noiseSum / noiseCount).toFixed(1) : 0,
    averageLufs: lufsCount > 0 ? +(lufsSum / lufsCount).toFixed(1) : 0,
    topIssues,
    uploadedToday,
    processedToday,
    exportedToday,
    averageProcessingTimeMin: 0, // computed elsewhere if needed
  };
}
