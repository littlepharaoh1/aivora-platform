/**
 * batchExport.ts — Batch ZIP + CSV + JSON Manifest Export
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import type { BatchFileResult, BatchReworkReport } from "./batchSilenceRework";
import type { GateResult } from "./adobeGate";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExportOptions {
  includeReview:   boolean;  // Include REVIEW files
  includeFailed:   boolean;  // Include FAIL files (not recommended)
  format:          "WAV_32_FLOAT";
  participantId:   string;
}

export interface ManifestRow {
  original_filename:         string;
  repaired_filename:         string;
  status:                    string;
  regions_detected:          number;
  regions_repaired:          number;
  before_noise_floor_db:     string;
  after_noise_floor_db:      string;
  silence_realism_score:     string;
  seam_risk_score:           string;
  speech_preservation_score: string;
  reviewer_risk_score:       string;
  adobe_gate_status:         string;
  export_format:             string;
  warnings:                  string;
}

export interface BatchExportResult {
  zipBlob:      Blob;
  csvBlob:      Blob;
  jsonBlob:     Blob;
  zipFilename:  string;
  csvFilename:  string;
  jsonFilename: string;
  includedFiles: number;
  excludedFiles: number;
  totalSizeBytes: number;
}

// ── Simple ZIP Builder ────────────────────────────────────────────────────────

// Minimal ZIP implementation (no external deps)
function makeZip(
  files: {name:string; data:ArrayBuffer|Uint8Array}[]
): ArrayBuffer {
  const enc=new TextEncoder();

  function crc32(buf: Uint8Array): number {
    const table=new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let j=0;j<8;j++) c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);
      table[i]=c;
    }
    let crc=0xFFFFFFFF;
    for(let i=0;i<buf.length;i++) crc=table[(crc^buf[i])&0xFF]^(crc>>>8);
    return (crc^0xFFFFFFFF)>>>0;
  }

  function u16(v:number,buf:Uint8Array,o:number){buf[o]=v&0xFF;buf[o+1]=(v>>8)&0xFF;}
  function u32(v:number,buf:Uint8Array,o:number){
    buf[o]=v&0xFF;buf[o+1]=(v>>8)&0xFF;buf[o+2]=(v>>16)&0xFF;buf[o+3]=(v>>24)&0xFF;
  }

  const localHeaders: Uint8Array[]=[];
  const centralDirs:  Uint8Array[]=[];
  const fileData:     Uint8Array[]=[];
  let   offset=0;
  const offsets: number[]=[];

  const now=new Date();
  const dosDate=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  const dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);

  for(const file of files){
    const data=new Uint8Array(file.data instanceof ArrayBuffer?file.data:file.data.buffer);
    const name=enc.encode(file.name);
    const crc =crc32(data);
    offsets.push(offset);

    // Local file header (30 + name)
    const lh=new Uint8Array(30+name.length);
    u32(0x04034B50,lh,0);  // Signature
    u16(20,lh,4);           // Version needed
    u16(0,lh,6);            // Flags
    u16(0,lh,8);            // Compression (stored)
    u16(dosTime,lh,10);
    u16(dosDate,lh,12);
    u32(crc,lh,14);
    u32(data.length,lh,18);
    u32(data.length,lh,22);
    u16(name.length,lh,26);
    u16(0,lh,28);
    lh.set(name,30);

    localHeaders.push(lh);
    fileData.push(data);
    offset+=lh.length+data.length;

    // Central directory
    const cd=new Uint8Array(46+name.length);
    u32(0x02014B50,cd,0);   // Signature
    u16(20,cd,4);
    u16(20,cd,6);
    u16(0,cd,8);
    u16(0,cd,10);
    u16(dosTime,cd,12);
    u16(dosDate,cd,14);
    u32(crc,cd,16);
    u32(data.length,cd,20);
    u32(data.length,cd,24);
    u16(name.length,cd,28);
    u16(0,cd,30);
    u16(0,cd,32);
    u16(0,cd,34);
    u16(0,cd,36);
    u32(0,cd,38);
    u32(offsets[offsets.length-1],cd,42);
    cd.set(name,46);
    centralDirs.push(cd);
  }

  const cdSize=centralDirs.reduce((s,c)=>s+c.length,0);
  const cdOffset=offset;

  // End of central directory
  const eocd=new Uint8Array(22);
  u32(0x06054B50,eocd,0);
  u16(0,eocd,4);
  u16(0,eocd,6);
  u16(files.length,eocd,8);
  u16(files.length,eocd,10);
  u32(cdSize,eocd,12);
  u32(cdOffset,eocd,16);
  u16(0,eocd,20);

  // Assemble
  const totalSize=offset+cdSize+eocd.length;
  const result=new Uint8Array(totalSize);
  let pos=0;
  for(let i=0;i<localHeaders.length;i++){
    result.set(localHeaders[i],pos); pos+=localHeaders[i].length;
    result.set(fileData[i],    pos); pos+=fileData[i].length;
  }
  for(const cd of centralDirs){ result.set(cd,pos); pos+=cd.length; }
  result.set(eocd,pos);
  return result.buffer;
}

// ── CSV Builder ───────────────────────────────────────────────────────────────

function buildCSV(rows: ManifestRow[]): string {
  if(rows.length===0) return "";
  const headers=Object.keys(rows[0]).join(",");
  const lines=rows.map(row=>
    Object.values(row).map(v=>{
      const s=String(v??""  );
      return s.includes(",")||s.includes('"')||s.includes("\n")
        ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(",")
  );
  return [headers,...lines].join("\n");
}

// ── Manifest Builder ──────────────────────────────────────────────────────────

function buildManifestRow(
  result: BatchFileResult,
  gate?:  GateResult
): ManifestRow {
  return {
    original_filename:         result.originalFilename,
    repaired_filename:         result.repairedFilename,
    status:                    result.status,
    regions_detected:          result.regionsDetected,
    regions_repaired:          result.regionsRepaired,
    before_noise_floor_db:     result.beforeNoiseFloorDb.toFixed(1),
    after_noise_floor_db:      result.afterNoiseFloorDb.toFixed(1),
    silence_realism_score:     result.silenceRealismScore.toFixed(3),
    seam_risk_score:           result.seamRiskScore.toFixed(3),
    speech_preservation_score: result.speechPreservationScore.toFixed(3),
    reviewer_risk_score:       result.reviewerRiskScore.toFixed(3),
    adobe_gate_status:         gate?.gateStatus??"N/A",
    export_format:             result.exportFormat,
    warnings:                  result.warnings.join("; "),
  };
}

// ── Main Batch Export ─────────────────────────────────────────────────────────

export async function exportBatchZip(
  report:  BatchReworkReport,
  gates:   Map<string, GateResult>,
  options: ExportOptions
): Promise<BatchExportResult> {
  const pid       = options.participantId;
  const timestamp = new Date().toISOString().replace(/[:.]/g,"_").slice(0,19);

  // Filter files to include
  const toInclude=report.results.filter(r=>{
    if(r.status==="ERROR")   return false;
    if(r.status==="FAIL"&&!options.includeFailed) return false;
    if(r.status==="REVIEW"&&!options.includeReview) return false;
    if(!r.repairedBlob)      return false;
    const gate=gates.get(r.originalFilename);
    if(gate&&!gate.exportAllowed&&!options.includeFailed) return false;
    return true;
  });

  const excluded=report.results.length-toInclude.length;

  // Build ZIP entries
  const zipEntries: {name:string; data:ArrayBuffer|Uint8Array}[]=[];
  let totalSize=0;

  // Add WAV files
  for(const result of toInclude){
    if(!result.repairedBlob) continue;
    const data=await result.repairedBlob.arrayBuffer();
    zipEntries.push({name:`repaired/${result.repairedFilename}`,data});
    totalSize+=data.byteLength;
  }

  // Build manifest rows
  const allRows=report.results.map(r=>buildManifestRow(r,gates.get(r.originalFilename)));

  // CSV
  const csvContent=buildCSV(allRows);
  const csvBytes  =new TextEncoder().encode(csvContent);
  zipEntries.push({name:`manifest_${pid}_${timestamp}.csv`,data:csvBytes});

  // JSON manifest
  const jsonContent=JSON.stringify({
    participantId:    pid,
    exportedAt:       new Date().toISOString(),
    totalFiles:       report.totalFiles,
    includedFiles:    toInclude.length,
    excludedFiles:    excluded,
    passedFiles:      report.passedFiles,
    reviewFiles:      report.reviewFiles,
    failedFiles:      report.failedFiles,
    avgSilenceRealism: report.avgSilenceRealism.toFixed(3),
    avgSpeechScore:   report.avgSpeechScore.toFixed(3),
    avgReviewerRisk:  report.avgReviewerRisk.toFixed(3),
    exportFormat:     "WAV_32_FLOAT",
    note:             "Adobe-style visual QA simulation — not an official Adobe certification",
    files:            allRows,
  },null,2);
  const jsonBytes=new TextEncoder().encode(jsonContent);
  zipEntries.push({name:`report_${pid}_${timestamp}.json`,data:jsonBytes});

  // Summary TXT
  const summaryLines=[
    `AIVORA FORENSIC SILENCE REPAIR — BATCH SUMMARY`,
    `Participant: ${pid}`,
    `Exported: ${new Date().toISOString()}`,
    ``,
    `Total Files:    ${report.totalFiles}`,
    `Passed QA:      ${report.passedFiles}`,
    `Needs Review:   ${report.reviewFiles}`,
    `Failed:         ${report.failedFiles}`,
    `Errors:         ${report.errorFiles}`,
    ``,
    `Avg Silence Realism:     ${(report.avgSilenceRealism*100).toFixed(1)}%`,
    `Avg Speech Preservation: ${(report.avgSpeechScore*100).toFixed(1)}%`,
    `Avg Reviewer Risk:       ${(report.avgReviewerRisk*100).toFixed(1)}%`,
    ``,
    `Export Format: 32-bit Float WAV (IEEE_FLOAT)`,
    ``,
    `NOTE: Results are from Adobe-style visual QA simulation.`,
    `      This is NOT an official Adobe Audition certification.`,
    ``,
    `Summary: ${report.summary}`,
  ].join("\n");
  const summaryBytes=new TextEncoder().encode(summaryLines);
  zipEntries.push({name:`SUMMARY_${pid}_${timestamp}.txt`,data:summaryBytes});

  // Build ZIP
  const zipBuffer=makeZip(zipEntries);
  const zipBlob  =new Blob([zipBuffer],{type:"application/zip"});
  const csvBlob  =new Blob([csvBytes], {type:"text/csv"});
  const jsonBlob =new Blob([jsonBytes],{type:"application/json"});

  const zipFilename  =`aivora_repaired_${pid}_${timestamp}.zip`;
  const csvFilename  =`manifest_${pid}_${timestamp}.csv`;
  const jsonFilename =`report_${pid}_${timestamp}.json`;

  return {
    zipBlob, csvBlob, jsonBlob,
    zipFilename, csvFilename, jsonFilename,
    includedFiles: toInclude.length,
    excludedFiles: excluded,
    totalSizeBytes: totalSize,
  };
}

// ── Download Helper ───────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url=URL.createObjectURL(blob);
  const a  =document.createElement("a");
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
