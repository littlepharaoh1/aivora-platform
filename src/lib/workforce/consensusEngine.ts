/**
 * consensusEngine.ts
 * Aivora Platform — Workforce Consensus Engine
 *
 * PURE, deterministic multi-review resolution. Extends the existing
 * consensus_log concept with explicit tie-breaking + confidence weighting.
 * Same reviews (in any order) → same result.
 */

import type { ConsensusInput, ConsensusResult } from "./workforceTypes";

// Tally verdicts with confidence-weighting. Returns sorted candidates.
interface Candidate {
  verdict:      string;
  count:        number;
  weight:       number;   // sum of confidences
  mean_conf:    number;
}

function tally(reviews: ConsensusInput["reviews"]): Candidate[] {
  const map = new Map<string, { count: number; weight: number }>();
  for(const r of reviews) {
    const cur = map.get(r.verdict) ?? { count: 0, weight: 0 };
    cur.count  += 1;
    cur.weight += Math.max(0, Math.min(1, r.confidence));
    map.set(r.verdict, cur);
  }
  const candidates: Candidate[] = [...map.entries()].map(([verdict, v]) => ({
    verdict,
    count:     v.count,
    weight:    v.weight,
    mean_conf: v.count > 0 ? v.weight / v.count : 0,
  }));

  // Deterministic ordering: by count desc, then weight desc, then verdict asc
  return candidates.sort((a, b) =>
    a.count  !== b.count  ? b.count  - a.count  :
    a.weight !== b.weight ? b.weight - a.weight :
    a.verdict.localeCompare(b.verdict)
  );
}

export function resolveConsensus(input: ConsensusInput): ConsensusResult {
  const reviews = input.reviews;
  const n = reviews.length;

  if(n === 0) {
    return {
      task_id: input.task_id, verdict: null, agreement: 0,
      is_disagreement: false, tie_broken: false, confidence: 0, review_count: 0,
    };
  }

  const candidates = tally(reviews);
  const top    = candidates[0];
  const second = candidates[1];

  // Tie = top two have equal count. Broken deterministically by weight/verdict
  // ordering already applied in tally(), so `top` is the resolved winner.
  const tie_broken = !!second && second.count === top.count;

  // Disagreement = not unanimous
  const is_disagreement = top.count < n;

  const agreement  = top.count / n;
  // Confidence = mean confidence of winning verdict, dampened by agreement level
  const confidence = Math.round(top.mean_conf * agreement * 1000) / 1000;

  return {
    task_id:         input.task_id,
    verdict:         top.verdict,
    agreement:       Math.round(agreement * 1000) / 1000,
    is_disagreement,
    tie_broken,
    confidence,
    review_count:    n,
  };
}

export function resolveConsensusBatch(inputs: ConsensusInput[]): ConsensusResult[] {
  return inputs.map(resolveConsensus);
}

// ── Disagreement analytics across a batch ─────────────────────────────────────

export interface DisagreementStats {
  total:            number;
  disagreements:    number;
  ties:             number;
  unresolved:       number;   // verdict === null
  disagreement_rate:number;
  mean_confidence:  number;
}

export function computeDisagreementStats(results: ConsensusResult[]): DisagreementStats {
  const total = results.length;
  if(total === 0) {
    return { total:0, disagreements:0, ties:0, unresolved:0, disagreement_rate:0, mean_confidence:0 };
  }
  const disagreements = results.filter(r => r.is_disagreement).length;
  const ties          = results.filter(r => r.tie_broken).length;
  const unresolved    = results.filter(r => r.verdict === null).length;
  const confSum       = results.reduce((s, r) => s + r.confidence, 0);
  return {
    total,
    disagreements,
    ties,
    unresolved,
    disagreement_rate: Math.round((disagreements / total) * 1000) / 1000,
    mean_confidence:   Math.round((confSum / total) * 1000) / 1000,
  };
}
