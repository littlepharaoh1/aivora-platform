/**
 * finalReviewReport.ts — Adobe-Style Final Review Report
 * Internal use only — NOT an official Adobe certification
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import type { BatchReworkReport } from "./batchSilenceRework";
import type { GateResult, BatchGateSummary } from "./adobeGate";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FinalRecommendation =
  | "READY_TO_SEND_SAMPLE"
  | "NEEDS_INTERNAL_REVIEW"
  | "DO_NOT_SEND";

export interface FinalReviewReport {
  participantId:            string;
  generatedAt:              string;
  totalFiles:               number;
  passedFiles:              number;
  reviewFiles:              number;
  failedFiles:              number;
  errorFiles:               number;
  referenceProfilePurity:   number;
  avgSilenceRealismScore:   number;
  avgSeamRisk:              number;
  avgSpeechPreservation:    number;
  avgReviewerRisk:          number;
  gatePassedCount:          number;
  gateNeedsReviewCount:     number;
  gateFailCount:            number;
  gateReRecordCount:        number;
  filesRequiringReview:     string[];
  filesBlockedFromExport:   string[];
  repairedRegionCount:      number;
  finalRecommendation:      FinalRecommendation;
  recommendationReason:     string;
  exportReadyCount:         number;
  warnings:                 string[];
  disclaimer:               string;
}

// ── Recommendation Logic ──────────────────────────────────────────────────────

function computeRecommendation(
  report:       BatchReworkReport,
  gateSummary:  BatchGateSummary,
  refPurity:    number
): { rec: FinalRecommendation; reason: string } {
  const total=report.totalFiles;
  if(total===0) return {rec:"DO_NOT_SEND",reason:"No files processed"};

  const failRate =(report.failedFiles+report.errorFiles)/total;
  const passRate = report.passedFiles/total;
  const avgRealism=report.avgSilenceRealism;
  const avgSpeech =report.avgSpeechScore;

  // DO_NOT_SEND conditions
  if(failRate>0.30)
    return {rec:"DO_NOT_SEND",reason:`High failure rate: ${(failRate*100).toFixed(0)}% of files failed QA`};
  if(avgSpeech<0.90)
    return {rec:"DO_NOT_SEND",reason:`Average speech preservation too low: ${(avgSpeech*100).toFixed(0)}%`};
  if(avgRealism<0.65)
    return {rec:"DO_NOT_SEND",reason:`Average silence realism too low: ${(avgRealism*100).toFixed(0)}%`};
  if(refPurity<0.50)
    return {rec:"DO_NOT_SEND",reason:"Reference silence profile purity too low — repair quality unreliable"};
  if(gateSummary.blocked>total*0.20)
    return {rec:"DO_NOT_SEND",reason:`Too many blocked files: ${gateSummary.blocked}/${total}`};

  // NEEDS_INTERNAL_REVIEW conditions
  if(report.reviewFiles>total*0.15)
    return {rec:"NEEDS_INTERNAL_REVIEW",reason:`${report.reviewFiles} files need manual review before delivery`};
  if(avgRealism<0.85)
    return {rec:"NEEDS_INTERNAL_REVIEW",reason:`Silence realism slightly below target: ${(avgRealism*100).toFixed(0)}%`};
  if(avgSpeech<0.97)
    return {rec:"NEEDS_INTERNAL_REVIEW",reason:`Speech preservation needs verification: ${(avgSpeech*100).toFixed(0)}%`};
  if(gateSummary.needsReview>0)
    return {rec:"NEEDS_INTERNAL_REVIEW",reason:`${gateSummary.needsReview} files have QA warnings`};

  // READY_TO_SEND_SAMPLE
  return {
    rec:"READY_TO_SEND_SAMPLE",
    reason:`${report.passedFiles}/${total} files passed Adobe-style visual QA simulation`
  };
}

// ── Main Report Builder ───────────────────────────────────────────────────────

export function buildFinalReviewReport(
  report:      BatchReworkReport,
  gates:       Map<string, GateResult>,
  gateSummary: BatchGateSummary,
  refPurity:   number
): FinalReviewReport {
  const warnings: string[]=[];

  // Files requiring review
  const requireReview=report.results
    .filter(r=>r.status==="REVIEW"||gates.get(r.originalFilename)?.gateStatus==="NEEDS_REVIEW")
    .map(r=>r.originalFilename);

  // Files blocked from export
  const blocked=report.results
    .filter(r=>{
      const gate=gates.get(r.originalFilename);
      return gate&&!gate.exportAllowed;
    })
    .map(r=>r.originalFilename);

  // Total repaired regions
  const totalRepaired=report.results.reduce((s,r)=>s+r.regionsRepaired,0);

  // Avg seam risk
  const processed=report.results.filter(r=>r.status!=="ERROR");
  const avgSeam=processed.length>0
    ? processed.reduce((s,r)=>s+r.seamRiskScore,0)/processed.length : 0;

  // Warnings
  if(refPurity<0.70)
    warnings.push(`Reference profile purity is low (${(refPurity*100).toFixed(0)}%) — consider using a cleaner reference`);
  if(report.errorFiles>0)
    warnings.push(`${report.errorFiles} files could not be processed due to errors`);
  if(blocked.length>0)
    warnings.push(`${blocked.length} files are blocked from export — repair or re-record required`);
  if(report.avgSilenceRealism<0.85)
    warnings.push("Average silence realism below recommended threshold — manual review advised");

  const {rec,reason}=computeRecommendation(report,gateSummary,refPurity);

  return {
    participantId:            report.participantId,
    generatedAt:              new Date().toISOString(),
    totalFiles:               report.totalFiles,
    passedFiles:              report.passedFiles,
    reviewFiles:              report.reviewFiles,
    failedFiles:              report.failedFiles,
    errorFiles:               report.errorFiles,
    referenceProfilePurity:   refPurity,
    avgSilenceRealismScore:   report.avgSilenceRealism,
    avgSeamRisk:              avgSeam,
    avgSpeechPreservation:    report.avgSpeechScore,
    avgReviewerRisk:          report.avgReviewerRisk,
    gatePassedCount:          gateSummary.passed,
    gateNeedsReviewCount:     gateSummary.needsReview,
    gateFailCount:            gateSummary.failRepair,
    gateReRecordCount:        gateSummary.reRecord,
    filesRequiringReview:     requireReview,
    filesBlockedFromExport:   blocked,
    repairedRegionCount:      totalRepaired,
    finalRecommendation:      rec,
    recommendationReason:     reason,
    exportReadyCount:         gateSummary.exportReady,
    warnings,
    disclaimer: "This report uses Adobe-style visual QA simulation. It is NOT an official Adobe Audition certification or endorsement.",
  };
}

// ── Report Formatter ──────────────────────────────────────────────────────────

export function formatReportAsText(r: FinalReviewReport): string {
  const lines=[
    "═══════════════════════════════════════════════",
    " AIVORA FORENSIC SILENCE REPAIR — FINAL REPORT",
    "═══════════════════════════════════════════════",
    `Participant:  ${r.participantId}`,
    `Generated:    ${new Date(r.generatedAt).toLocaleString()}`,
    "",
    "── FILE SUMMARY ────────────────────────────────",
    `Total Files:       ${r.totalFiles}`,
    `Passed QA:         ${r.passedFiles}`,
    `Needs Review:      ${r.reviewFiles}`,
    `Failed:            ${r.failedFiles}`,
    `Errors:            ${r.errorFiles}`,
    `Export Ready:      ${r.exportReadyCount}`,
    `Blocked:           ${r.filesBlockedFromExport.length}`,
    `Repaired Regions:  ${r.repairedRegionCount}`,
    "",
    "── QUALITY SCORES ──────────────────────────────",
    `Ref Profile Purity:     ${(r.referenceProfilePurity*100).toFixed(1)}%`,
    `Avg Silence Realism:    ${(r.avgSilenceRealismScore*100).toFixed(1)}%`,
    `Avg Speech Preserved:   ${(r.avgSpeechPreservation*100).toFixed(1)}%`,
    `Avg Seam Risk:          ${(r.avgSeamRisk*100).toFixed(1)}%`,
    `Avg Reviewer Risk:      ${(r.avgReviewerRisk*100).toFixed(1)}%`,
    "",
    "── GATE RESULTS ────────────────────────────────",
    `Pass Visual QA:    ${r.gatePassedCount}`,
    `Needs Review:      ${r.gateNeedsReviewCount}`,
    `Fail Repair:       ${r.gateFailCount}`,
    `Re-Record:         ${r.gateReRecordCount}`,
    "",
    r.filesRequiringReview.length>0
      ? `── FILES NEEDING REVIEW ─────────────────────────\n${r.filesRequiringReview.slice(0,10).map(f=>`  • ${f}`).join("\n")}`
      : "",
    r.filesBlockedFromExport.length>0
      ? `── BLOCKED FILES ────────────────────────────────\n${r.filesBlockedFromExport.slice(0,10).map(f=>`  ✗ ${f}`).join("\n")}`
      : "",
    r.warnings.length>0
      ? `── WARNINGS ─────────────────────────────────────\n${r.warnings.map(w=>`  ⚠ ${w}`).join("\n")}`
      : "",
    "",
    "── FINAL RECOMMENDATION ────────────────────────",
    `  ${r.finalRecommendation}`,
    `  ${r.recommendationReason}`,
    "",
    "── DISCLAIMER ──────────────────────────────────",
    `  ${r.disclaimer}`,
    "═══════════════════════════════════════════════",
  ].filter(l=>l!==undefined);
  return lines.join("\n");
}
