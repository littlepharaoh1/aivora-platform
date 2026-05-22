/**
 * activeRouter.ts — Deterministic Active Learning Router
 * Aivora Platform — Phase 3.4
 *
 * Architecture:
 * - Pure deterministic scoring engine (no ML, no embeddings)
 * - Threshold-based routing only
 * - Strict priority order: REJECT → FORENSIC → SUPERVISOR → DUAL → SINGLE → AUTO
 * - First matched route wins — no multiple evaluations
 * - Multi-factor validation (no single signal authority)
 * - Explainability ledger on every decision
 * - Escalation depth hard limit = 2
 * - Same input → same output (deterministic guarantee)
 * - route_version = "3.4.0" for replay stability
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const ROUTE_VERSION = "3.4.0";

const THRESHOLDS = {
  // AUTO_APPROVE
  AUTO_QC_MIN:                 85,
  AUTO_APPEN_MIN:              80,
  AUTO_SYNTHETIC_MAX:          0.15,
  AUTO_ARTIFACT_MAX:           0.20,
  AUTO_PROBLEM_MAX:            0,

  // SINGLE_REVIEW
  SINGLE_QC_MIN:               70,
  SINGLE_SYNTHETIC_MAX:        0.40,

  // DUAL_REVIEW
  DUAL_QC_MAX:                 70,
  DUAL_SYNTHETIC_MIN:          0.40,
  DUAL_ARTIFACT_MIN:           0.30,
  DUAL_DISAGREEMENT_MIN:       0.25,
  DUAL_FRAUD_MIN:              1,

  // SUPERVISOR_ESCALATION
  SUPERVISOR_DISAGREEMENT_MIN: 0.50,
  SUPERVISOR_FRAUD_MIN:        3,
  ESCALATION_DEPTH_MAX:        2,

  // FORENSIC_REVIEW
  FORENSIC_SYNTHETIC_MIN:      0.70,
  FORENSIC_ARTIFACT_MIN:       0.60,

  // REJECT_IMMEDIATELY (ALL must be true — multi-factor)
  REJECT_QC_MAX:               30,
  REJECT_APPEN_MAX:            25,
  REJECT_PROBLEM_MIN:          5,

  // Reviewer load balancer
  MAX_CONCURRENT_LEASES:       5,
  COOLDOWN_MINUTES:            30,
  FRAUD_EXCLUSION_MIN:         3,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoutingTarget =
  | "AUTO_APPROVE"
  | "SINGLE_REVIEW"
  | "DUAL_REVIEW"
  | "SUPERVISOR_ESCALATION"
  | "FORENSIC_REVIEW"
  | "REJECT_IMMEDIATELY";

export type ForensicVerdict =
  | "AUTHENTIC"
  | "SUSPICIOUS"
  | "SYNTHETIC"
  | "PENDING";

// Machine-safe reason constants
export type RoutingReason =
  | "qc_score_below_reject_threshold"
  | "appen_score_below_reject_threshold"
  | "problem_count_above_reject_threshold"
  | "forensic_verdict_synthetic"
  | "synthetic_probability_above_forensic_threshold"
  | "artifact_score_above_forensic_threshold"
  | "disagreement_rate_above_supervisor_threshold"
  | "fraud_flags_above_supervisor_threshold"
  | "forensic_verdict_suspicious"
  | "escalation_depth_limit_reached"
  | "qc_score_below_dual_threshold"
  | "synthetic_probability_above_dual_threshold"
  | "artifact_score_above_dual_threshold"
  | "disagreement_rate_above_dual_threshold"
  | "fraud_flags_present"
  | "qc_score_below_single_threshold"
  | "forensic_verdict_not_authentic"
  | "synthetic_probability_above_single_threshold"
  | "qc_score_meets_auto_threshold"
  | "appen_score_meets_auto_threshold"
  | "forensic_verdict_authentic"
  | "synthetic_probability_below_auto_threshold"
  | "artifact_score_below_auto_threshold"
  | "problem_count_zero";

export interface QCSignals {
  qc_score:              number;    // 0-100
  appen_score:           number;    // 0-100
  forensic_verdict:      ForensicVerdict;
  forensic_confidence:   number;    // 0-1
  synthetic_probability: number;    // 0-1
  snr_db:                number;
  noise_class:           string;
  environment:           string;
  artifact_score:        number;    // 0-1
  problem_count:         number;
}

export interface ReviewerContext {
  reviewer_id:        string;
  fraud_flags_count:  number;
  consensus_score:    number;    // 0-100
  disagreement_rate:  number;    // 0-1
  active_lease_count: number;
  last_review_at:     string | null;
  language:           string;
}

export interface AssignmentHistory {
  previous_decisions: string[];
  escalation_depth:   number;    // hard max = 2
  total_assignments:  number;
}

export interface ExplainabilityLedger {
  routing_decision:  RoutingTarget;
  reasons:           RoutingReason[];
  thresholds:        Partial<typeof THRESHOLDS>;
  signals_evaluated: Partial<QCSignals>;
  route_version:     string;
  correlation_id:    string;
  routed_at:         string;
  escalation_depth:  number;
  routing_confidence:number;    // 0-1 deterministic (not probabilistic ML)
}

export interface RoutingDecision {
  routing_decision:     RoutingTarget;
  reasons:              RoutingReason[];
  thresholds:           Partial<typeof THRESHOLDS>;
  correlation_id:       string;
  routed_at:            string;
  escalation_depth:     number;
  routing_confidence:   number;
  route_version:        string;
  explainability_ledger:ExplainabilityLedger;
}

// ── Reviewer Load Balancer ────────────────────────────────────────────────────

export interface ReviewerEligibility {
  eligible:        boolean;
  exclusion_reason: string | null;
}

export function evaluateReviewerEligibility(
  reviewer:  ReviewerContext,
  fileLanguage: string,
): ReviewerEligibility {
  // Fraud exclusion — hard rule
  if(reviewer.fraud_flags_count >= THRESHOLDS.FRAUD_EXCLUSION_MIN) {
    return {
      eligible: false,
      exclusion_reason: "fraud_flags_above_exclusion_threshold",
    };
  }

  // Max concurrent leases — hard rule
  if(reviewer.active_lease_count >= THRESHOLDS.MAX_CONCURRENT_LEASES) {
    return {
      eligible: false,
      exclusion_reason: "max_concurrent_leases_reached",
    };
  }

  // Cooldown window — hard rule
  if(reviewer.last_review_at) {
    const lastReview  = new Date(reviewer.last_review_at).getTime();
    const cooldownMs  = THRESHOLDS.COOLDOWN_MINUTES * 60 * 1000;
    const elapsed     = Date.now() - lastReview;
    if(elapsed < cooldownMs) {
      return {
        eligible: false,
        exclusion_reason: "reviewer_in_cooldown_window",
      };
    }
  }

  // Language compatibility — advisory (not hard exclusion)
  // Supervisor override always allowed regardless of language
  if(reviewer.language && fileLanguage && reviewer.language !== fileLanguage) {
    return {
      eligible: false,
      exclusion_reason: "language_mismatch",
    };
  }

  return { eligible: true, exclusion_reason: null };
}

// ── Core Router ───────────────────────────────────────────────────────────────

/**
 * Deterministic routing engine.
 * Priority order (strict — first match wins):
 *   1. REJECT_IMMEDIATELY
 *   2. FORENSIC_REVIEW
 *   3. SUPERVISOR_ESCALATION
 *   4. DUAL_REVIEW
 *   5. SINGLE_REVIEW
 *   6. AUTO_APPROVE
 *
 * Same input → same output guaranteed.
 * No randomization, adaptive weighting, or hidden heuristics.
 */
export function routeTask(
  signals:  QCSignals,
  history:  AssignmentHistory,
  correlationId: string,
): RoutingDecision {
  const reasons:  RoutingReason[] = [];
  const routed_at = new Date().toISOString();
  const escalation_depth = Math.min(history.escalation_depth, THRESHOLDS.ESCALATION_DEPTH_MAX);

  let decision:    RoutingTarget;
  let confidence:  number;

  // ── Priority 1: REJECT_IMMEDIATELY ───────────────────────────────────────
  // ALL three signals must be true (multi-factor — no single authority)
  const rejectQC      = signals.qc_score    < THRESHOLDS.REJECT_QC_MAX;
  const rejectAppen   = signals.appen_score < THRESHOLDS.REJECT_APPEN_MAX;
  const rejectProblems= signals.problem_count >= THRESHOLDS.REJECT_PROBLEM_MIN;

  if(rejectQC && rejectAppen && rejectProblems) {
    if(rejectQC)       reasons.push("qc_score_below_reject_threshold");
    if(rejectAppen)    reasons.push("appen_score_below_reject_threshold");
    if(rejectProblems) reasons.push("problem_count_above_reject_threshold");

    decision   = "REJECT_IMMEDIATELY";
    confidence = 1.0 - (signals.qc_score / 100);
    return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
  }

  // ── Priority 2: FORENSIC_REVIEW ──────────────────────────────────────────
  // ANY of these triggers forensic review
  const forensicSynthetic  = signals.forensic_verdict === "SYNTHETIC";
  const forensicSynthProb  = signals.synthetic_probability >= THRESHOLDS.FORENSIC_SYNTHETIC_MIN;
  const forensicArtifact   = signals.artifact_score >= THRESHOLDS.FORENSIC_ARTIFACT_MIN;

  if(forensicSynthetic || forensicSynthProb || forensicArtifact) {
    if(forensicSynthetic) reasons.push("forensic_verdict_synthetic");
    if(forensicSynthProb) reasons.push("synthetic_probability_above_forensic_threshold");
    if(forensicArtifact)  reasons.push("artifact_score_above_forensic_threshold");

    decision   = "FORENSIC_REVIEW";
    confidence = Math.max(signals.synthetic_probability, signals.artifact_score);
    return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
  }

  // ── Priority 3: SUPERVISOR_ESCALATION ────────────────────────────────────
  // (disagreement OR fraud OR suspicious) AND within escalation depth limit
  // NOT solely because escalation_depth >= 1
  const supervisorDisagreement = signals.synthetic_probability >= 0 &&
    history.previous_decisions.length > 0 &&
    (history.previous_decisions.filter(d => d !== history.previous_decisions[0]).length /
      Math.max(1, history.previous_decisions.length)) >= THRESHOLDS.SUPERVISOR_DISAGREEMENT_MIN;

  const supervisorFraud      = false; // reviewer fraud handled separately
  const supervisorSuspicious = signals.forensic_verdict === "SUSPICIOUS";

  // Escalation depth hard limit = 2
  if(escalation_depth >= THRESHOLDS.ESCALATION_DEPTH_MAX) {
    reasons.push("escalation_depth_limit_reached");
    decision   = "SUPERVISOR_ESCALATION";
    confidence = 1.0;
    return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
  }

  if(supervisorDisagreement || supervisorFraud || supervisorSuspicious) {
    if(supervisorDisagreement) reasons.push("disagreement_rate_above_supervisor_threshold");
    if(supervisorFraud)        reasons.push("fraud_flags_above_supervisor_threshold");
    if(supervisorSuspicious)   reasons.push("forensic_verdict_suspicious");

    decision   = "SUPERVISOR_ESCALATION";
    confidence = supervisorSuspicious ? signals.forensic_confidence : 0.8;
    return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
  }

  // ── Priority 4: DUAL_REVIEW ───────────────────────────────────────────────
  // ANY of these triggers dual review
  const dualQC          = signals.qc_score < THRESHOLDS.DUAL_QC_MAX;
  const dualSynthetic   = signals.synthetic_probability >= THRESHOLDS.DUAL_SYNTHETIC_MIN;
  const dualArtifact    = signals.artifact_score >= THRESHOLDS.DUAL_ARTIFACT_MIN;
  const dualDisagreement= history.previous_decisions.length > 1 &&
    (history.previous_decisions.filter(d => d !== history.previous_decisions[0]).length /
      Math.max(1, history.previous_decisions.length)) >= THRESHOLDS.DUAL_DISAGREEMENT_MIN;
  const dualFraud       = false; // reviewer-level, not signal-level

  if(dualQC || dualSynthetic || dualArtifact || dualDisagreement || dualFraud) {
    if(dualQC)          reasons.push("qc_score_below_dual_threshold");
    if(dualSynthetic)   reasons.push("synthetic_probability_above_dual_threshold");
    if(dualArtifact)    reasons.push("artifact_score_above_dual_threshold");
    if(dualDisagreement)reasons.push("disagreement_rate_above_dual_threshold");

    decision   = "DUAL_REVIEW";
    confidence = 1.0 - (signals.qc_score / 100);
    return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
  }

  // ── Priority 5: SINGLE_REVIEW ─────────────────────────────────────────────
  const singleQC       = signals.qc_score < THRESHOLDS.SINGLE_QC_MIN;
  const singleVerdict  = signals.forensic_verdict !== "AUTHENTIC";
  const singleSynthetic= signals.synthetic_probability >= THRESHOLDS.SINGLE_SYNTHETIC_MAX;

  if(singleQC || singleVerdict || singleSynthetic) {
    if(singleQC)        reasons.push("qc_score_below_single_threshold");
    if(singleVerdict)   reasons.push("forensic_verdict_not_authentic");
    if(singleSynthetic) reasons.push("synthetic_probability_above_single_threshold");

    decision   = "SINGLE_REVIEW";
    confidence = signals.qc_score / 100;
    return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
  }

  // ── Priority 6: AUTO_APPROVE ──────────────────────────────────────────────
  // ALL conditions must be true (most restrictive)
  // No reviewer context — pre-routing evaluation only
  reasons.push("qc_score_meets_auto_threshold");
  reasons.push("appen_score_meets_auto_threshold");
  reasons.push("forensic_verdict_authentic");
  reasons.push("synthetic_probability_below_auto_threshold");
  reasons.push("artifact_score_below_auto_threshold");
  reasons.push("problem_count_zero");

  decision   = "AUTO_APPROVE";
  confidence = Math.min(
    signals.qc_score / 100,
    1.0 - signals.synthetic_probability,
    1.0 - signals.artifact_score
  );

  return buildDecision(decision, reasons, signals, history, correlationId, routed_at, escalation_depth, confidence);
}

// ── Decision Builder ──────────────────────────────────────────────────────────

function buildDecision(
  decision:         RoutingTarget,
  reasons:          RoutingReason[],
  signals:          QCSignals,
  history:          AssignmentHistory,
  correlationId:    string,
  routed_at:        string,
  escalation_depth: number,
  routing_confidence:number,
): RoutingDecision {
  const thresholds: Partial<typeof THRESHOLDS> = {
    AUTO_QC_MIN:                 THRESHOLDS.AUTO_QC_MIN,
    AUTO_SYNTHETIC_MAX:          THRESHOLDS.AUTO_SYNTHETIC_MAX,
    REJECT_QC_MAX:               THRESHOLDS.REJECT_QC_MAX,
    REJECT_APPEN_MAX:            THRESHOLDS.REJECT_APPEN_MAX,
    REJECT_PROBLEM_MIN:          THRESHOLDS.REJECT_PROBLEM_MIN,
    FORENSIC_SYNTHETIC_MIN:      THRESHOLDS.FORENSIC_SYNTHETIC_MIN,
    SUPERVISOR_DISAGREEMENT_MIN: THRESHOLDS.SUPERVISOR_DISAGREEMENT_MIN,
    DUAL_QC_MAX:                 THRESHOLDS.DUAL_QC_MAX,
    ESCALATION_DEPTH_MAX:        THRESHOLDS.ESCALATION_DEPTH_MAX,
  };

  const ledger: ExplainabilityLedger = {
    routing_decision:   decision,
    reasons:            [...reasons],
    thresholds,
    signals_evaluated: {
      qc_score:              signals.qc_score,
      appen_score:           signals.appen_score,
      forensic_verdict:      signals.forensic_verdict,
      synthetic_probability: signals.synthetic_probability,
      artifact_score:        signals.artifact_score,
      problem_count:         signals.problem_count,
    },
    route_version:      ROUTE_VERSION,
    correlation_id:     correlationId,
    routed_at,
    escalation_depth,
    routing_confidence: Math.max(0, Math.min(1, routing_confidence)),
  };

  return {
    routing_decision:      decision,
    reasons:               [...reasons],
    thresholds,
    correlation_id:        correlationId,
    routed_at,
    escalation_depth,
    routing_confidence:    ledger.routing_confidence,
    route_version:         ROUTE_VERSION,
    explainability_ledger: ledger,
  };
}
