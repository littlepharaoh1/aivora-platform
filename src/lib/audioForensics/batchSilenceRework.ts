/**
 * batchSilenceRework.ts — 200-file Batch Silence Rework Engine
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import { analyzeSilenceForensics } from "./silenceForensics";
import { reconstructSilenceWithReference } from "./silenceReconstructor";
import { simulateAdobeQA } from "./adobeQaSimulator";
import { verifySpeechPreservation } from "./speechPreservation";
import { exportFloat32Wav } from "./floatWavExporter";
import type { ReferenceSilenceProfile } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BatchFileStatus = "PASS"|"REVIEW"|"FAIL"|"ERROR"|"SKIPPED";

export interface BatchFileResult {
  originalFilename:      string;
  repairedFilename:      string;
  status:                BatchFileStatus;
  regionsDetected:       number;
  regionsRepaired:       number;
  adobePassLikely:       boolean;
  reviewerRiskScore:     number;
  silenceRealismScore:   number;
  seamRiskScore:         number;
  speechPreservationScore: number;
  beforeNoiseFloorDb:    number;
  afterNoiseFloorDb:     number;
  exportFormat:          "WAV_32_FLOAT";
  repairedBlob?:         Blob;
  warnings:              string[];
  error?:                string;
  processingMs:          number;
}

export interface BatchReworkOptions {
  participantId:     string;
  maxConcurrent?:    number;        // Default 1 (sequential for memory safety)
  skipOnError?:      boolean;       // Default true
  exportFormat?:     "WAV_32_FLOAT";
  minPassScore?:     number;        // Default 0.80
}

export interface BatchReworkProgress {
  current:           number;
  total:             number;
  percent:           number;
  currentFile:       string;
  passed:            number;
  review:            number;
  failed:            number;
  errors:            number;
  estimatedMs?:      number;
}

export interface BatchReworkReport {
  participantId:     string;
  totalFiles:        number;
  repairedFiles:     number;
  passedFiles:       number;
  reviewFiles:       number;
  failedFiles:       number;
  errorFiles:        number;
  avgSilenceRealism: number;
  avgSpeechScore:    number;
  avgReviewerRisk:   number;
  results:           BatchFileResult[];
  summary:           string;
  warnings:          string[];
  processingMs:      number;
  createdAt:         string;
}

export interface CancellationToken {
  cancelled: boolean;
  cancel():  void;
}

export function createCancellationToken(): CancellationToken {
  const token={cancelled:false, cancel(){ this.cancelled=true; }};
  return token;
}

// ── Per-file Processor ────────────────────────────────────────────────────────

async function processFile(
  file:    File,
  profile: ReferenceSilenceProfile,
  opts:    BatchReworkOptions
): Promise<BatchFileResult> {
  const startMs=Date.now();
  const warnings: string[]=[];
  const baseName=file.name.replace(/\.wav$/i,"");
  const repairedFilename=`${baseName}_repaired_32f.wav`;

  try {
    // Decode
    const ab  = await file.arrayBuffer();
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(ab);

    // Sample rate check
    if(buffer.sampleRate!==profile.sampleRate){
      warnings.push(`Sample rate mismatch: ${buffer.sampleRate}Hz vs reference ${profile.sampleRate}Hz`);
    }

    // Analyze silence
    const forensics=analyzeSilenceForensics(buffer);
    const beforeNoiseFloor=forensics.noiseFloorDb;

    // Repair
    let repairedBuffer=buffer;
    let regionsRepaired=0;

    if(forensics.contaminatedRegions.length>0){
      const reconstruction=reconstructSilenceWithReference(
        buffer, forensics.contaminatedRegions, profile
      );
      repairedBuffer=reconstruction.buffer;
      regionsRepaired=reconstruction.repairedRegions.length;
      warnings.push(...reconstruction.warnings);
    }

    // After forensics
    const afterForensics=analyzeSilenceForensics(repairedBuffer);
    const afterNoiseFloor=afterForensics.noiseFloorDb;

    // Adobe QA
    const qa=simulateAdobeQA({
      original:            buffer,
      repaired:            repairedBuffer,
      repairedRegionCount: regionsRepaired,
      totalRepairedMs:     forensics.contaminatedRegions.reduce((s,r)=>s+r.durationMs,0),
    });

    // Speech preservation
    const speech=verifySpeechPreservation(buffer, repairedBuffer);
    warnings.push(...speech.warnings);

    // Export 32-bit float
    const exported=exportFloat32Wav(repairedBuffer, file.name);

    // Status
    const minScore=opts.minPassScore??0.80;
    let status: BatchFileStatus;

    if(qa.recommendation==="RE_RECORD_REQUIRED"||speech.grade==="FAIL"){
      status="FAIL";
    } else if(
      qa.adobePassLikely&&
      speech.score>=0.97&&
      qa.silenceRealismScore>=minScore&&
      qa.seamRiskScore<=0.20
    ){
      status="PASS";
    } else if(qa.recommendation==="NEEDS_REVIEW"||speech.grade==="REVIEW"){
      status="REVIEW";
    } else {
      status="REVIEW";
    }

    // Close AudioContext
    await ctx.close();

    return {
      originalFilename:       file.name,
      repairedFilename,
      status,
      regionsDetected:        forensics.contaminatedRegions.length,
      regionsRepaired,
      adobePassLikely:        qa.adobePassLikely,
      reviewerRiskScore:      qa.reviewerRiskScore,
      silenceRealismScore:    qa.silenceRealismScore,
      seamRiskScore:          qa.seamRiskScore,
      speechPreservationScore: speech.score,
      beforeNoiseFloorDb:     beforeNoiseFloor,
      afterNoiseFloorDb:      afterNoiseFloor,
      exportFormat:           "WAV_32_FLOAT",
      repairedBlob:           exported.blob,
      warnings,
      processingMs:           Date.now()-startMs,
    };

  } catch(e){
    return {
      originalFilename:       file.name,
      repairedFilename,
      status:                 "ERROR",
      regionsDetected:        0,
      regionsRepaired:        0,
      adobePassLikely:        false,
      reviewerRiskScore:      1.0,
      silenceRealismScore:    0,
      seamRiskScore:          1.0,
      speechPreservationScore: 0,
      beforeNoiseFloorDb:     -120,
      afterNoiseFloorDb:      -120,
      exportFormat:           "WAV_32_FLOAT",
      warnings,
      error:   e instanceof Error?e.message:String(e),
      processingMs: Date.now()-startMs,
    };
  }
}

// ── Main Batch Engine ─────────────────────────────────────────────────────────

export async function runBatchSilenceRework(
  files:      File[],
  profile:    ReferenceSilenceProfile,
  options:    BatchReworkOptions,
  onProgress?: (p: BatchReworkProgress) => void,
  token?:     CancellationToken
): Promise<BatchReworkReport> {
  const startMs  = Date.now();
  const results: BatchFileResult[]=[];
  const warnings: string[]=[];
  let passed=0,review=0,failed=0,errors=0;

  for(let i=0;i<files.length;i++){
    // Check cancellation
    if(token?.cancelled){
      warnings.push(`Batch cancelled after ${i} files`);
      break;
    }

    const file=files[i];

    // Progress
    onProgress?.({
      current:     i+1,
      total:       files.length,
      percent:     Math.round(((i+1)/files.length)*100),
      currentFile: file.name,
      passed, review, failed, errors,
      estimatedMs: i>0
        ? Math.round((Date.now()-startMs)/i*(files.length-i))
        : undefined,
    });

    // Process
    const result=await processFile(file, profile, options);
    results.push(result);

    // Count
    if(result.status==="PASS")   passed++;
    else if(result.status==="REVIEW") review++;
    else if(result.status==="FAIL")   failed++;
    else if(result.status==="ERROR")  errors++;

    // Yield to UI
    await new Promise(r=>setTimeout(r,0));
  }

  // Aggregate
  const processed=results.filter(r=>r.status!=="ERROR"&&r.status!=="SKIPPED");
  const avgRealism=processed.length>0
    ? processed.reduce((s,r)=>s+r.silenceRealismScore,0)/processed.length : 0;
  const avgSpeech=processed.length>0
    ? processed.reduce((s,r)=>s+r.speechPreservationScore,0)/processed.length : 0;
  const avgRisk=processed.length>0
    ? processed.reduce((s,r)=>s+r.reviewerRiskScore,0)/processed.length : 1;

  const summary=
    errors>0&&passed===0 ? "All files failed — check reference profile" :
    failed>files.length*0.3 ? "High failure rate — consider re-recording" :
    review>0 ? `${passed} passed, ${review} need review, ${failed} failed` :
    `All ${passed} files passed Adobe-style QA simulation`;

  return {
    participantId:     options.participantId,
    totalFiles:        files.length,
    repairedFiles:     passed+review,
    passedFiles:       passed,
    reviewFiles:       review,
    failedFiles:       failed,
    errorFiles:        errors,
    avgSilenceRealism: avgRealism,
    avgSpeechScore:    avgSpeech,
    avgReviewerRisk:   avgRisk,
    results,
    summary,
    warnings,
    processingMs:      Date.now()-startMs,
    createdAt:         new Date().toISOString(),
  };
}
