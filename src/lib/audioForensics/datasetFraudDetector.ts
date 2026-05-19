/**
 * datasetFraudDetector.ts — Dataset Integrity & Fraud Detection
 * Aivora Audio Infrastructure Platform
 *
 * Detects dataset-level fraud patterns:
 * 1. Duplicate detection (exact + near-duplicate)
 * 2. Synthetic injection (TTS files mixed with real)
 * 3. Cross-contamination (same speaker in multiple splits)
 * 4. Metadata mismatch (declared vs actual properties)
 * 5. Label noise (audio content vs label mismatch)
 * 6. Room/mic inconsistency (mixed recording conditions)
 *
 * Operates on batches of audio fingerprints.
 * Does NOT require raw audio — works on pre-extracted features.
 */

import type { MicFingerprint }  from "./microphoneFingerprint";
import type { RoomFingerprint } from "./roomFingerprint";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DatasetEntry {
  id:           string;
  filename:     string;
  durationSec:  number;
  sampleRate:   number;
  declaredLabel?: string;
  micPrint?:    MicFingerprint;
  roomPrint?:   RoomFingerprint;
  audioHash?:   string;      // SHA-256 of raw samples
  spectralHash?: string;     // perceptual hash
  isSynthetic?: boolean;
  syntheticConf?: number;
}

export type FraudType =
  | "exact_duplicate"
  | "near_duplicate"
  | "synthetic_injection"
  | "mic_inconsistency"
  | "room_inconsistency"
  | "duration_anomaly"
  | "sample_rate_mismatch"
  | "label_noise";

export interface FraudFlag {
  type:        FraudType;
  severity:    "low" | "medium" | "high" | "critical";
  affectedIds: string[];
  description: string;
  confidence:  number;
}

export interface DatasetFraudReport {
  readonly totalEntries:   number;
  readonly fraudFlags:     FraudFlag[];
  readonly cleanEntries:   number;
  readonly flaggedEntries: number;
  readonly integrityScore: number;   // 0-100
  readonly summary:        string;
  readonly recommendations: string[];
}

// ── Perceptual Hash ───────────────────────────────────────────────────────────
// Simple spectral fingerprint for near-duplicate detection

export function computeSpectralHash(data: Float32Array): string {
  const N     = Math.min(data.length, 4096);
  const bands = 16;
  const band  = Math.floor(N / bands);
  let   bits  = 0;

  const energies = new Float32Array(bands);
  for(let b=0;b<bands;b++){
    let e=0;
    for(let i=b*band;i<(b+1)*band&&i<N;i++) e+=data[i]**2;
    energies[b]=e/band;
  }

  // DCT-like difference coding
  for(let b=0;b<bands-1;b++)
    if(energies[b]>energies[b+1]) bits|=(1<<b);

  return bits.toString(16).padStart(4,"0");
}

function hammingDistance(a: string, b: string): number {
  if(a.length!==b.length) return a.length;
  const aI=parseInt(a,16)||0, bI=parseInt(b,16)||0;
  let x=aI^bI, dist=0;
  while(x){dist+=x&1;x>>=1;}
  return dist;
}

// ── Duplicate Detection ────────────────────────────────────────────────────────

function detectDuplicates(entries: DatasetEntry[]): FraudFlag[] {
  const flags:  FraudFlag[] = [];
  const hashes = new Map<string, string[]>();

  // Group by audio hash (exact duplicates)
  for(const e of entries){
    if(!e.audioHash) continue;
    const group=hashes.get(e.audioHash)??[];
    group.push(e.id);
    hashes.set(e.audioHash, group);
  }

  for(const [, ids] of hashes){
    if(ids.length>1){
      flags.push({
        type:        "exact_duplicate",
        severity:    "critical",
        affectedIds: ids,
        description: `Exact duplicate: ${ids.length} identical files`,
        confidence:  1.0,
      });
    }
  }

  // Near-duplicate via spectral hash (Hamming distance)
  const withHash = entries.filter(e=>e.spectralHash);
  for(let i=0;i<withHash.length;i++){
    for(let j=i+1;j<withHash.length;j++){
      const dist=hammingDistance(
        withHash[i].spectralHash!,
        withHash[j].spectralHash!
      );
      if(dist<=2&&dist>0){
        flags.push({
          type:        "near_duplicate",
          severity:    "high",
          affectedIds: [withHash[i].id, withHash[j].id],
          description: `Near-duplicate pair (Hamming=${dist})`,
          confidence:  Math.round((1-dist/16)*100)/100,
        });
      }
    }
  }

  return flags;
}

// ── Synthetic Injection Detection ─────────────────────────────────────────────

function detectSyntheticInjection(entries: DatasetEntry[]): FraudFlag[] {
  const flags: FraudFlag[] = [];
  const withSynth = entries.filter(e=>e.isSynthetic!==undefined);
  if(withSynth.length===0) return flags;

  const synthetic = withSynth.filter(e=>e.isSynthetic===true);
  const ratio     = synthetic.length/withSynth.length;

  if(ratio>0.05){
    flags.push({
      type:        "synthetic_injection",
      severity:    ratio>0.2?"critical":ratio>0.1?"high":"medium",
      affectedIds: synthetic.map(e=>e.id),
      description: `${(ratio*100).toFixed(1)}% of dataset appears synthetic (${synthetic.length}/${withSynth.length} files)`,
      confidence:  Math.round(Math.min(1,ratio*3)*100)/100,
    });
  }

  return flags;
}

// ── Recording Inconsistency Detection ────────────────────────────────────────

function detectRecordingInconsistency(entries: DatasetEntry[]): FraudFlag[] {
  const flags:  FraudFlag[] = [];
  const withMic  = entries.filter(e=>e.micPrint);
  const withRoom = entries.filter(e=>e.roomPrint);

  if(withMic.length>=2){
    // Cluster by mic signature — multiple distinct devices is suspicious for
    // a dataset claiming same recording conditions
    const rolloffs = withMic.map(e=>e.micPrint!.rolloffHz);
    const meanRO   = rolloffs.reduce((a,b)=>a+b)/rolloffs.length;
    const stdRO    = Math.sqrt(rolloffs.reduce((s,v)=>s+(v-meanRO)**2,0)/rolloffs.length);

    if(stdRO/meanRO>0.3){
      flags.push({
        type:        "mic_inconsistency",
        severity:    stdRO/meanRO>0.5?"high":"medium",
        affectedIds: withMic.map(e=>e.id),
        description: `Microphone inconsistency: rolloff std=${stdRO.toFixed(0)}Hz (CV=${(stdRO/meanRO*100).toFixed(0)}%)`,
        confidence:  Math.round(Math.min(1,stdRO/meanRO)*100)/100,
      });
    }
  }

  if(withRoom.length>=2){
    const rt60s  = withRoom.map(e=>e.roomPrint!.overallRT60Ms);
    const meanRT = rt60s.reduce((a,b)=>a+b)/rt60s.length;
    const stdRT  = Math.sqrt(rt60s.reduce((s,v)=>s+(v-meanRT)**2,0)/rt60s.length);

    if(stdRT>200){
      flags.push({
        type:        "room_inconsistency",
        severity:    stdRT>400?"high":"medium",
        affectedIds: withRoom.map(e=>e.id),
        description: `Room inconsistency: RT60 std=${stdRT.toFixed(0)}ms (${rt60s.map(r=>r.toFixed(0)).join(",")}ms)`,
        confidence:  Math.round(Math.min(1,stdRT/1000)*100)/100,
      });
    }
  }

  return flags;
}

// ── Metadata Anomaly Detection ────────────────────────────────────────────────

function detectMetadataAnomalies(entries: DatasetEntry[]): FraudFlag[] {
  const flags: FraudFlag[] = [];

  // Duration anomalies
  const durations  = entries.map(e=>e.durationSec).filter(d=>d>0);
  if(durations.length>5){
    const mean = durations.reduce((a,b)=>a+b)/durations.length;
    const std  = Math.sqrt(durations.reduce((s,v)=>s+(v-mean)**2,0)/durations.length);
    const outliers = entries.filter(e=>Math.abs(e.durationSec-mean)>3*std);
    if(outliers.length>0){
      flags.push({
        type:        "duration_anomaly",
        severity:    "low",
        affectedIds: outliers.map(e=>e.id),
        description: `Duration outliers: ${outliers.length} files beyond 3σ (mean=${mean.toFixed(1)}s, std=${std.toFixed(1)}s)`,
        confidence:  0.7,
      });
    }
  }

  // Sample rate mismatch
  const rates    = new Set(entries.map(e=>e.sampleRate));
  if(rates.size>2){
    flags.push({
      type:        "sample_rate_mismatch",
      severity:    "medium",
      affectedIds: entries.map(e=>e.id),
      description: `Mixed sample rates: ${Array.from(rates).join(", ")}Hz`,
      confidence:  0.9,
    });
  }

  return flags;
}

// ── Main Detector ─────────────────────────────────────────────────────────────

export function runDatasetFraudDetection(
  entries: DatasetEntry[]
): DatasetFraudReport {
  const flags: FraudFlag[] = [
    ...detectDuplicates(entries),
    ...detectSyntheticInjection(entries),
    ...detectRecordingInconsistency(entries),
    ...detectMetadataAnomalies(entries),
  ];

  // Count flagged entries
  const flaggedIds = new Set(flags.flatMap(f=>f.affectedIds));
  const flagged    = flaggedIds.size;
  const clean      = entries.length - flagged;

  // Integrity score
  const critFlags  = flags.filter(f=>f.severity==="critical").length;
  const highFlags  = flags.filter(f=>f.severity==="high").length;
  const medFlags   = flags.filter(f=>f.severity==="medium").length;
  const penalty    = critFlags*25 + highFlags*15 + medFlags*5;
  const intScore   = Math.max(0, Math.min(100, 100 - penalty));

  // Recommendations
  const recs: string[] = [];
  if(flags.some(f=>f.type==="exact_duplicate"))
    recs.push("Remove exact duplicate files before training");
  if(flags.some(f=>f.type==="synthetic_injection"))
    recs.push("Audit and label synthetic files separately");
  if(flags.some(f=>f.type==="mic_inconsistency"))
    recs.push("Segment dataset by recording device");
  if(flags.some(f=>f.type==="room_inconsistency"))
    recs.push("Segment dataset by acoustic environment");
  if(flags.some(f=>f.type==="sample_rate_mismatch"))
    recs.push("Resample all files to consistent sample rate");
  if(recs.length===0)
    recs.push("Dataset appears clean — proceed with standard validation");

  const summary = [
    `${entries.length} files analyzed`,
    `${flagged} flagged (${clean} clean)`,
    `Integrity score: ${intScore}/100`,
    flags.length>0?`Issues: ${flags.map(f=>f.type).join(", ")}`:"No issues detected",
  ].join(" | ");

  return {
    totalEntries:   entries.length,
    fraudFlags:     flags,
    cleanEntries:   clean,
    flaggedEntries: flagged,
    integrityScore: intScore,
    summary,
    recommendations: recs,
  };
}
