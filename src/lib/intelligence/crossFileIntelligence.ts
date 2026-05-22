/**
 * crossFileIntelligence.ts — Deterministic Cross-File Similarity Engine
 * Aivora Platform — Phase 4.4
 *
 * Rules:
 * - NO embeddings, NO vector DBs, NO ML clustering
 * - Deterministic math only (Euclidean, cosine, threshold buckets)
 * - Partition-bounded: max 100 files per batch
 * - Append-only results (never UPDATE similarity rows)
 * - Same input state → same output scores
 * - Advisory signals only — never auto-ban/auto-reject
 * - similarity_version = "4.4.0" for replay stability
 */

import { supabase } from "../supabase";

// ── Constants ─────────────────────────────────────────────────────────────────

export const SIMILARITY_VERSION = "4.4.0";
const MAX_BATCH_SIZE            = 100; // hard limit — prevent O(N²) explosion

// ── Types ─────────────────────────────────────────────────────────────────────

export type SimilarityType =
  | "RT60_DISTANCE"
  | "ROOM_FINGERPRINT"
  | "MIC_SIGNATURE"
  | "SPECTRAL_VARIANCE"
  | "SYNTHETIC_CLUSTER"
  | "REVIEWER_FRAUD_PATTERN";

export interface FileForensicProfile {
  id:                   string;
  file_name:            string;
  project_name?:        string;
  created_at:           string;
  forensic_verdict?:    string;
  qc_score?:            number;
  dsp_metadata?:        Record<string, unknown>;
}

export interface SimilarityResult {
  file_a_id:          string;
  file_b_id:          string;
  similarity_type:    SimilarityType;
  similarity_score:   number;    // 0.0000 → 1.0000
  metric_breakdown:   Record<string, unknown>;
}

// ── Safe Math Helpers ─────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1): number {
  if(!isFinite(v) || isNaN(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

function safeSqrt(v: number): number {
  return v <= 0 ? 0 : Math.sqrt(v);
}

// ── Algorithm 1: RT60 Distance (Euclidean on 6-band vectors) ──────────────────

function computeRT60Distance(
  metaA: Record<string, unknown>,
  metaB: Record<string, unknown>,
): SimilarityResult | null {
  try {
    const roomA = (metaA?.forensic as any)?.room?.rt60_bands as Record<string, number> | null;
    const roomB = (metaB?.forensic as any)?.room?.rt60_bands as Record<string, number> | null;

    if(!roomA || !roomB) return null;

    const bands = ["125", "250", "500", "1000", "2000", "4000"];
    let sumSq = 0;
    let count = 0;

    for(const b of bands) {
      const a = roomA[b] ?? 0;
      const bv = roomB[b] ?? 0;
      sumSq += (a - bv) ** 2;
      count++;
    }

    if(count === 0) return null;

    const euclidean   = safeSqrt(sumSq / count);
    const MAX_RT60_D  = 2.0; // max realistic RT60 difference in seconds
    const score       = clamp(1 - euclidean / MAX_RT60_D);

    return {
      file_a_id:        "",
      file_b_id:        "",
      similarity_type:  "RT60_DISTANCE",
      similarity_score: Math.round(score * 10000) / 10000,
      metric_breakdown: {
        version:        SIMILARITY_VERSION,
        formula:        "1 - sqrt(mean_squared_diff_per_band) / MAX_RT60_D",
        max_rt60_diff:  MAX_RT60_D,
        euclidean_dist: Math.round(euclidean * 10000) / 10000,
        bands_compared: count,
        rt60_a:         roomA,
        rt60_b:         roomB,
      },
    };
  } catch { return null; }
}

// ── Algorithm 2: Room Fingerprint (category match + RT60 threshold) ───────────

function computeRoomFingerprint(
  metaA: Record<string, unknown>,
  metaB: Record<string, unknown>,
): SimilarityResult | null {
  try {
    const catA = (metaA?.forensic as any)?.room?.category as string | null;
    const catB = (metaB?.forensic as any)?.room?.category as string | null;
    const rt60A = (metaA?.forensic as any)?.room?.rt60_overall as number | null;
    const rt60B = (metaB?.forensic as any)?.room?.rt60_overall as number | null;

    if(!catA || !catB) return null;

    const categoryMatch = catA === catB ? 1.0 : 0.0;
    const RT60_THRESHOLD = 0.15; // seconds — same room if within 150ms

    let rt60Score = 0;
    if(rt60A !== null && rt60B !== null) {
      const diff = Math.abs(rt60A - rt60B);
      rt60Score  = clamp(1 - diff / RT60_THRESHOLD);
    }

    // Weighted: 60% category match, 40% RT60 proximity
    const score = clamp(categoryMatch * 0.6 + rt60Score * 0.4);

    return {
      file_a_id:        "",
      file_b_id:        "",
      similarity_type:  "ROOM_FINGERPRINT",
      similarity_score: Math.round(score * 10000) / 10000,
      metric_breakdown: {
        version:          SIMILARITY_VERSION,
        formula:          "0.6 * category_match + 0.4 * rt60_proximity",
        category_a:       catA,
        category_b:       catB,
        category_match:   categoryMatch,
        rt60_a:           rt60A,
        rt60_b:           rt60B,
        rt60_threshold_s: RT60_THRESHOLD,
        rt60_score:       Math.round(rt60Score * 10000) / 10000,
      },
    };
  } catch { return null; }
}

// ── Algorithm 3: Mic Signature (cosine similarity on noise + rolloff) ─────────

function computeMicSignature(
  metaA: Record<string, unknown>,
  metaB: Record<string, unknown>,
): SimilarityResult | null {
  try {
    const micA = (metaA?.forensic as any)?.mic as any | null;
    const micB = (metaB?.forensic as any)?.mic as any | null;

    if(!micA || !micB) return null;

    const noiseA   = micA.noise_floor_db ?? -60;
    const noiseB   = micB.noise_floor_db ?? -60;
    const rolloffA = micA.rolloff_hz     ?? 8000;
    const rolloffB = micB.rolloff_hz     ?? 8000;

    // Normalized vectors (2-dim: noise_floor, rolloff)
    const normNoiseA   = clamp((noiseA + 80) / 80);  // -80→0dB maps to 0→1
    const normNoiseB   = clamp((noiseB + 80) / 80);
    const normRolloffA = clamp(rolloffA / 24000);     // 0→24kHz maps to 0→1
    const normRolloffB = clamp(rolloffB / 24000);

    // Cosine similarity on 2-dim normalized vector
    const dot  = normNoiseA * normNoiseB + normRolloffA * normRolloffB;
    const magA = safeSqrt(normNoiseA ** 2 + normRolloffA ** 2);
    const magB = safeSqrt(normNoiseB ** 2 + normRolloffB ** 2);
    const cos  = magA > 0 && magB > 0
      ? clamp(dot / (magA * magB))
      : 0;

    return {
      file_a_id:        "",
      file_b_id:        "",
      similarity_type:  "MIC_SIGNATURE",
      similarity_score: Math.round(cos * 10000) / 10000,
      metric_breakdown: {
        version:          SIMILARITY_VERSION,
        formula:          "cosine_similarity(normalized_2d_mic_vector)",
        noise_floor_a_db: noiseA,
        noise_floor_b_db: noiseB,
        rolloff_a_hz:     rolloffA,
        rolloff_b_hz:     rolloffB,
        norm_vector_a:    [normNoiseA, normRolloffA],
        norm_vector_b:    [normNoiseB, normRolloffB],
        cosine:           Math.round(cos * 10000) / 10000,
      },
    };
  } catch { return null; }
}

// ── Algorithm 4: Spectral Variance (QC metric comparison) ────────────────────

function computeSpectralVariance(
  metaA: Record<string, unknown>,
  metaB: Record<string, unknown>,
): SimilarityResult | null {
  try {
    const qcA = (metaA?.qc as any)?.metrics as any | null;
    const qcB = (metaB?.qc as any)?.metrics as any | null;

    if(!qcA || !qcB) return null;

    const lufsA  = qcA.lufs  ?? -23;
    const lufsB  = qcB.lufs  ?? -23;
    const snrA   = qcA.snr_db ?? 30;
    const snrB   = qcB.snr_db ?? 30;

    // Normalized differences
    const lufsDiff = Math.abs(lufsA - lufsB) / 20;   // 20dB = max diff
    const snrDiff  = Math.abs(snrA  - snrB)  / 40;   // 40dB = max diff

    const score = clamp(1 - (lufsDiff * 0.5 + snrDiff * 0.5));

    return {
      file_a_id:        "",
      file_b_id:        "",
      similarity_type:  "SPECTRAL_VARIANCE",
      similarity_score: Math.round(score * 10000) / 10000,
      metric_breakdown: {
        version:       SIMILARITY_VERSION,
        formula:       "1 - 0.5*norm_lufs_diff - 0.5*norm_snr_diff",
        lufs_a:        lufsA,
        lufs_b:        lufsB,
        snr_a:         snrA,
        snr_b:         snrB,
        lufs_diff_norm:Math.round(lufsDiff * 10000) / 10000,
        snr_diff_norm: Math.round(snrDiff  * 10000) / 10000,
      },
    };
  } catch { return null; }
}

// ── Algorithm 5: Synthetic Cluster (threshold bucket comparison) ──────────────

function computeSyntheticCluster(
  metaA: Record<string, unknown>,
  metaB: Record<string, unknown>,
): SimilarityResult | null {
  try {
    const synthA = (metaA?.forensic as any)?.synthetic_probability as number | null;
    const synthB = (metaB?.forensic as any)?.synthetic_probability as number | null;

    if(synthA === null || synthB === null) return null;

    // Threshold buckets: LOW (0-0.3), MEDIUM (0.3-0.7), HIGH (0.7-1.0)
    function bucket(v: number): 0|1|2 {
      if(v < 0.3) return 0;
      if(v < 0.7) return 1;
      return 2;
    }

    const bucketA = bucket(synthA);
    const bucketB = bucket(synthB);

    // Same bucket = high similarity
    const bucketMatch  = bucketA === bucketB ? 1.0 : 0.0;
    // Absolute proximity within range
    const proximity    = clamp(1 - Math.abs(synthA - synthB));
    const score        = clamp(bucketMatch * 0.7 + proximity * 0.3);

    return {
      file_a_id:        "",
      file_b_id:        "",
      similarity_type:  "SYNTHETIC_CLUSTER",
      similarity_score: Math.round(score * 10000) / 10000,
      metric_breakdown: {
        version:          SIMILARITY_VERSION,
        formula:          "0.7*bucket_match + 0.3*proximity",
        buckets:          ["LOW:0-0.3", "MEDIUM:0.3-0.7", "HIGH:0.7-1.0"],
        synthetic_prob_a: synthA,
        synthetic_prob_b: synthB,
        bucket_a:         bucketA,
        bucket_b:         bucketB,
        bucket_match:     bucketMatch,
        proximity:        Math.round(proximity * 10000) / 10000,
      },
    };
  } catch { return null; }
}

// ── Partition Key Builder ─────────────────────────────────────────────────────

function buildPartitionKey(
  projectName: string,
  createdAt:   string,
  roomCategory:string,
): string {
  const date    = new Date(createdAt);
  const year    = date.getFullYear();
  const week    = Math.ceil(
    (date.getTime() - new Date(year, 0, 1).getTime())
    / (7 * 24 * 3600 * 1000)
  );
  const safeProject = (projectName || "unknown").replace(/[^a-zA-Z0-9]/g, "_");
  const safeRoom    = (roomCategory || "unknown").replace(/[^a-zA-Z0-9]/g, "_");
  return `${safeProject}_${year}W${String(week).padStart(2,"0")}_${safeRoom}`;
}

// ── Main Batch Engine ─────────────────────────────────────────────────────────

/**
 * Run cross-file similarity batch for a project partition.
 * Max 100 files. Append-only results.
 * Deterministic: same files → same scores.
 */
export async function runSimilarityBatch(params: {
  projectName:  string;
  roomCategory?: string;
  dateFrom?:    string;
  dateTo?:      string;
  correlationId?:string;
}): Promise<{ batch_id: string; pairs_computed: number } | null> {
  try {
    const batchId = crypto.randomUUID();

    // Fetch bounded file set (max 100)
    let query = supabase
      .from("audio_files")
      .select("id,file_name,project_name,created_at,forensic_verdict,qc_score,dsp_metadata")
      .eq("project_name", params.projectName)
      .not("dsp_metadata", "eq", "{}")
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH_SIZE);

    if(params.dateFrom) query = query.gte("created_at", params.dateFrom);
    if(params.dateTo)   query = query.lte("created_at", params.dateTo);

    const { data: files, error } = await query;
    if(error || !files || files.length < 2) return null;

    const results: object[] = [];
    let   pairsComputed = 0;

    // O(N²/2) — bounded by MAX_BATCH_SIZE=100 → max 4950 pairs
    for(let i = 0; i < files.length; i++) {
      for(let j = i + 1; j < files.length; j++) {
        const fileA = files[i];
        const fileB = files[j];
        const metaA = (fileA.dsp_metadata as Record<string, unknown>) ?? {};
        const metaB = (fileB.dsp_metadata as Record<string, unknown>) ?? {};

        const roomCatA = (metaA?.forensic as any)?.room?.category ?? "unknown";
        const partKey  = buildPartitionKey(
          params.projectName,
          fileA.created_at,
          params.roomCategory ?? roomCatA,
        );

        // Run all applicable algorithms
        const algorithms = [
          computeRT60Distance,
          computeRoomFingerprint,
          computeMicSignature,
          computeSpectralVariance,
          computeSyntheticCluster,
        ];

        for(const algo of algorithms) {
          const r = algo(metaA, metaB);
          if(!r) continue;

          results.push({
            batch_id:           batchId,
            file_a_id:          fileA.id,
            file_b_id:          fileB.id,
            similarity_type:    r.similarity_type,
            similarity_score:   r.similarity_score,
            similarity_version: SIMILARITY_VERSION,
            metric_breakdown:   r.metric_breakdown,
            partition_key:      partKey,
            correlation_id:     params.correlationId ?? null,
          });
        }
        pairsComputed++;
      }
    }

    // Batch insert (chunked 50 rows at a time)
    const CHUNK = 50;
    for(let k = 0; k < results.length; k += CHUNK) {
      const chunk = results.slice(k, k + CHUNK);
      await supabase.from("file_similarity_matrix").insert(chunk);
    }

    return { batch_id: batchId, pairs_computed: pairsComputed };
  } catch {
    return null;
  }
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

/**
 * Get highest-similarity pairs for a batch.
 * Read-only — never computes.
 */
export async function getSimilarityPairs(
  batchId:        string,
  similarityType: SimilarityType,
  minScore        = 0.80,
): Promise<object[]> {
  try {
    const { data } = await supabase
      .from("file_similarity_matrix")
      .select("file_a_id,file_b_id,similarity_score,metric_breakdown,computed_at")
      .eq("batch_id",         batchId)
      .eq("similarity_type",  similarityType)
      .gte("similarity_score", minScore)
      .order("similarity_score", { ascending: false })
      .limit(50);
    return data ?? [];
  } catch { return []; }
}
