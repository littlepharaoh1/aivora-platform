/**
 * workforceTypes.ts
 * Aivora Platform — Workforce Management OS
 *
 * Extends the existing `reviewers` table (identity + performance + fraud).
 * Adds skill matrix, capacity, and the computed-engine result shapes.
 * All engine outputs are deterministic.
 */

export const WORKFORCE_VERSION = "17.0.0";

// ── Skill matrix ──────────────────────────────────────────────────────────────

export type SkillType =
  | "image"          // Image Annotation
  | "video"          // Video Annotation
  | "audio"          // Audio Annotation
  | "transcription"  // Transcription
  | "ocr"            // OCR
  | "qa_review";     // QA Review

export const SKILL_TYPES: SkillType[] = [
  "image", "video", "audio", "transcription", "ocr", "qa_review",
];

export const SKILL_LABELS: Record<SkillType, string> = {
  image:         "Image Annotation",
  video:         "Video Annotation",
  audio:         "Audio Annotation",
  transcription: "Transcription",
  ocr:           "OCR",
  qa_review:     "QA Review",
};

export interface WorkerSkill {
  id:                string;
  reviewer_id:       string;
  skill_type:        SkillType;
  proficiency:       number;   // 0.0 .. 1.0
  validation_count:  number;
  last_validated_at: string | null;
  created_at:        string;
  updated_at:        string;
}

// ── Capabilities (capacity + languages + certs) ───────────────────────────────

export type Availability = "available" | "busy" | "away" | "offline";

export const AVAILABILITY_VALUES: Availability[] = [
  "available", "busy", "away", "offline",
];

export interface WorkerCapabilities {
  id:                    string;
  reviewer_id:           string;
  languages:             string[];
  certifications:        string[];
  availability:          Availability;
  weekly_capacity_hours: number;
  timezone:              string;
  notes:                 string;
  created_at:            string;
  updated_at:            string;
}

// ── Worker identity (mirrors existing `reviewers` columns) ────────────────────

export interface WorkerIdentity {
  id:                  string;
  name:                string;
  email:               string;
  role:                string | null;
  is_active:           boolean;
  accuracy_score:      number | null;
  consensus_score:     number | null;
  avg_latency_seconds: number | null;
  total_reviews:       number;
  total_agreements:    number;
  total_disagreements: number;
  total_escalations:   number;
  fraud_flags_count:   number;
  fast_completions:    number;
  overwrite_count:     number;
  last_active_at:      string | null;
  last_review_at:      string | null;
}

// Full worker = identity + capabilities + skills (joined view)
export interface Worker {
  identity:     WorkerIdentity;
  capabilities: WorkerCapabilities | null;
  skills:       WorkerSkill[];
}

// ── Performance Engine output ─────────────────────────────────────────────────

export interface PerformanceMetrics {
  reviewer_id:        string;
  throughput:         number;   // completed assignments / period
  acceptance_rate:    number;   // 0..1  (accepted / reviewed)
  qa_score:           number;   // 0..1  (accuracy)
  rework_rate:        number;   // 0..1  (reworked / completed)
  disagreement_rate:  number;   // 0..1  (disagreements / reviews)
  avg_turnaround_sec: number;   // mean seconds per assignment
  sample_size:        number;
}

// ── Capacity Planner output ───────────────────────────────────────────────────

export type OverloadRisk = "none" | "low" | "medium" | "high" | "critical";

export interface CapacityPlan {
  reviewer_id:        string;
  weekly_capacity_hours: number;
  active_assignments: number;
  projected_hours:    number;   // active * avg_turnaround
  utilization:        number;   // projected / capacity (0..1+)
  overload_risk:      OverloadRisk;
  available_hours:    number;   // capacity - projected (can be negative)
}

// ── Consensus Engine output ───────────────────────────────────────────────────

export interface ConsensusInput {
  task_id:  string;
  reviews:  { reviewer_id: string; verdict: string; confidence: number }[];
}

export interface ConsensusResult {
  task_id:        string;
  verdict:        string | null;   // agreed verdict, or null if unresolved
  agreement:      number;          // 0..1 fraction agreeing with majority
  is_disagreement:boolean;
  tie_broken:     boolean;
  confidence:     number;          // weighted confidence of the chosen verdict
  review_count:   number;
}

// ── Fraud Detection output ────────────────────────────────────────────────────

export type FraudSignalType =
  | "suspicious_speed"
  | "copy_pattern"
  | "repeated_output"
  | "abnormal_agreement";

export interface FraudSignal {
  reviewer_id: string;
  signal:      FraudSignalType;
  severity:    number;     // 0..1
  detail:      string;
}

export interface FraudAssessment {
  reviewer_id:  string;
  signals:      FraudSignal[];
  risk_score:   number;    // 0..1 aggregate
  flagged:      boolean;
}

// ── Workforce Analytics output ────────────────────────────────────────────────

export interface RankingEntry {
  reviewer_id: string;
  name:        string;
  score:       number;
  rank:        number;
}

export interface WorkforceTrends {
  worker_ranking:    RankingEntry[];
  reviewer_ranking:  RankingEntry[];
  mean_qa_score:     number;
  mean_throughput:   number;
  total_active:      number;
  flagged_count:     number;
}
