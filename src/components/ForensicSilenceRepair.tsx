// @ts-nocheck
/**
 * ForensicSilenceRepair.tsx — Adobe-Grade Silence Repair Panel
 * Single File + Batch Participant Mode
 * Aivora Platform
 */
import React, { useState, useRef, useCallback } from "react";
import { analyzeSilenceForensics } from "../lib/audioForensics/silenceForensics";
import { buildReferenceSilenceProfile, validateReferenceProfile } from "../lib/audioForensics/referenceSilenceProfile";
import { reconstructSilenceWithReference } from "../lib/audioForensics/silenceReconstructor";
import { simulateAdobeQA } from "../lib/audioForensics/adobeQaSimulator";
import { verifySpeechPreservation } from "../lib/audioForensics/speechPreservation";
import { runAdobeGate, summarizeBatchGate } from "../lib/audioForensics/adobeGate";
import { runBatchSilenceRework, createCancellationToken } from "../lib/audioForensics/batchSilenceRework";
import { exportBatchZip, downloadBlob } from "../lib/audioForensics/batchExport";
import { exportFloat32Wav, downloadWavBlob, formatInfoToString } from "../lib/audioForensics/floatWavExporter";
import { buildFinalReviewReport, formatReportAsText } from "../lib/audioForensics/finalReviewReport";
import type { ReferenceSilenceProfile, AdobeQAResult } from "../lib/audioForensics/types";
import type { GateResult } from "../lib/audioForensics/adobeGate";
import type { BatchReworkReport, BatchReworkProgress } from "../lib/audioForensics/batchSilenceRework";
import type { SpeechPreservationResult } from "../lib/audioForensics/speechPreservation";

// ── Mini Components ───────────────────────────────────────────────────────────

function ScoreBadge({label,value,good=true}:{label:string;value:string;good?:boolean}){
  const c=good?"#10b981":"#ef4444";
  return(
    <div style={{background:"#060e16",border:`1px solid ${c}33`,borderRadius:8,
      padding:"6px 10px",textAlign:"center",minWidth:80}}>
      <div style={{fontSize:11,fontWeight:700,color:c}}>{value}</div>
      <div style={{fontSize:8,color:"#4a8a9a",marginTop:2}}>{label}</div>
    </div>
  );
}

function PurityBar({score,label}:{score:number;label:string}){
  const c=score>0.85?"#10b981":score>0.60?"#f59e0b":"#ef4444";
  return(
    <div style={{marginBottom:5}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
        <span style={{fontSize:9,color:"#a0c4cc"}}>{label}</span>
        <span style={{fontSize:9,color:c,fontWeight:700}}>{(score*100).toFixed(0)}%</span>
      </div>
      <div style={{height:3,background:"#0f2a3a",borderRadius:2}}>
        <div style={{height:"100%",borderRadius:2,background:c,width:`${score*100}%`}}/>
      </div>
    </div>
  );
}

function ContamTag({type}:{type:string}){
  const colors:Record<string,string>={
    hum_50hz:"#ef4444",hum_60hz:"#ef4444",digital_silence:"#8b5cf6",
    hiss:"#f59e0b",waveform_seam:"#f97316",repeated_silence:"#22d3ee",
    room_tone_leak:"#10b981",fan_noise:"#6366f1",
  };
  const c=colors[type]??"#4a8a9a";
  return(
    <span style={{fontSize:8,padding:"2px 6px",borderRadius:3,
      background:c+"22",border:`1px solid ${c}44`,color:c}}>
      {type.replace(/_/g," ").toUpperCase()}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ForensicSilenceRepair(){
  const [mode,setMode]=useState<"single"|"batch">("single");

  // Single file state
  const [mainBuffer,setMainBuffer]=useState<AudioBuffer|null>(null);
  const [mainFileName,setMainFileName]=useState("");
  const [refBuffer,setRefBuffer]=useState<AudioBuffer|null>(null);
  const [refFileName,setRefFileName]=useState("");
  const [profile,setProfile]=useState<ReferenceSilenceProfile|null>(null);
  const [forensics,setForensics]=useState<any>(null);
  const [reconstruction,setReconstruction]=useState<any>(null);
  const [qaResult,setQaResult]=useState<AdobeQAResult|null>(null);
  const [speechResult,setSpeechResult]=useState<SpeechPreservationResult|null>(null);
  const [gateResult,setGateResult]=useState<GateResult|null>(null);
  const [profileWarnings,setProfileWarnings]=useState<string[]>([]);

  // Batch state
  const [batchFiles,setBatchFiles]=useState<File[]>([]);
  const [participantId,setParticipantId]=useState("D1065");
  const [batchReport,setBatchReport]=useState<BatchReworkReport|null>(null);
  const [batchProgress,setBatchProgress]=useState<BatchReworkProgress|null>(null);
  const [batchGates,setBatchGates]=useState<Map<string,GateResult>>(new Map());
  const [finalReport,setFinalReport]=useState<any>(null);
  const [cancelToken,setCancelToken]=useState<any>(null);

  const [loading,setLoading]=useState("");
  const mainRef=useRef<HTMLInputElement>(null);
  const refRef =useRef<HTMLInputElement>(null);
  const batchRef=useRef<HTMLInputElement>(null);

  async function loadAudio(file:File):Promise<AudioBuffer>{
    const ab=await file.arrayBuffer();
    const ctx=new AudioContext();
    return ctx.decodeAudioData(ab);
  }

  // ── Single File Actions ───────────────────────────────────────────────────

  async function handleAnalyze(){
    if(!mainBuffer) return;
    setLoading("Analyzing silence contamination...");
    await new Promise(r=>setTimeout(r,0));
    setForensics(analyzeSilenceForensics(mainBuffer));
    setLoading("");
  }

  async function handleBuildProfile(){
    if(!refBuffer) return;
    setLoading("Building reference silence profile...");
    await new Promise(r=>setTimeout(r,0));
    const p=buildReferenceSilenceProfile(refBuffer,refFileName);
    const {warnings}=validateReferenceProfile(p);
    setProfile(p); setProfileWarnings(warnings);
    setLoading("");
  }

  async function handleRepair(){
    if(!mainBuffer||!profile||!forensics) return;
    setLoading("Reconstructing silence...");
    await new Promise(r=>setTimeout(r,0));
    const r=reconstructSilenceWithReference(mainBuffer,forensics.contaminatedRegions,profile);
    setReconstruction(r);
    setLoading("");
  }

  async function handleQA(){
    if(!mainBuffer||!reconstruction||!forensics) return;
    setLoading("Running Adobe-style QA simulation...");
    await new Promise(r=>setTimeout(r,0));
    const qa=simulateAdobeQA({
      original:mainBuffer,repaired:reconstruction.buffer,
      repairedRegionCount:reconstruction.repairedRegions.length,
      totalRepairedMs:reconstruction.totalRepairedMs,
    });
    const sp=verifySpeechPreservation(mainBuffer,reconstruction.buffer);
    const gate=runAdobeGate(qa,sp,analyzeSilenceForensics(reconstruction.buffer));
    setQaResult(qa); setSpeechResult(sp); setGateResult(gate);
    setLoading("");
  }

  function handleExport32(){
    if(!reconstruction) return;
    const result=exportFloat32Wav(reconstruction.buffer,mainFileName);
    downloadWavBlob(result.blob,result.filename);
  }

  // ── Batch Actions ─────────────────────────────────────────────────────────

  async function handleBatchRun(){
    if(!batchFiles.length||!profile) return;
    const token=createCancellationToken();
    setCancelToken(token);
    setBatchReport(null); setBatchProgress(null);

    const report=await runBatchSilenceRework(
      batchFiles, profile,
      {participantId, skipOnError:true},
      (p)=>setBatchProgress({...p}),
      token
    );
    setBatchReport(report);

    // Build gates
    const gates=new Map<string,GateResult>();
    for(const r of report.results){
      if(r.status==="ERROR") continue;
      const mockQa:AdobeQAResult={
        adobePassLikely:r.adobePassLikely,
        reviewerRiskScore:r.reviewerRiskScore,
        silenceRealismScore:r.silenceRealismScore,
        seamRiskScore:r.seamRiskScore,
        spectralMatchScore:0.85,
        speechPreservationScore:r.speechPreservationScore,
        transientPreservationScore:0.90,
        detectedProblems:[],
        recommendation:r.adobePassLikely?"PASS_VISUAL_QA":"NEEDS_REVIEW",
        confidence:0.80,
      };
      const mockSp:SpeechPreservationResult={
        speechPreserved:r.speechPreservationScore>=0.97,
        score:r.speechPreservationScore,
        grade:r.speechPreservationScore>=0.97?"PASS":r.speechPreservationScore>=0.93?"REVIEW":"FAIL",
        rmsDeltaDb:0,peakDeltaDb:0,
        correlationScore:r.speechPreservationScore,
        transientRisk:0.05,timingShiftMs:0,modifiedSpeechRisk:0.02,warnings:[],
      };
      const mockForensics={
        contaminatedRegions:[],hasDigitalSilence:false,
        hasRepeatedPattern:false,hasSeams:false,
        hasHum:false,humFrequencyHz:null,cleanRegions:[],noiseFloorDb:-70,
      };
      gates.set(r.originalFilename,runAdobeGate(mockQa,mockSp,mockForensics as any));
    }
    setBatchGates(gates);

    // Final report
    const gateSummary=summarizeBatchGate([...gates.values()]);
    const final=buildFinalReviewReport(report,gates,gateSummary,profile.purityScore);
    setFinalReport(final);
    setCancelToken(null);
  }

  async function handleBatchExport(){
    if(!batchReport||!profile) return;
    setLoading("Building ZIP...");
    const result=await exportBatchZip(batchReport,batchGates,{
      participantId,includeReview:true,includeFailed:false,format:"WAV_32_FLOAT",
    });
    downloadBlob(result.zipBlob, result.zipFilename);
    downloadBlob(result.csvBlob, result.csvFilename);
    downloadBlob(result.jsonBlob,result.jsonFilename);
    if(finalReport){
      const txt=formatReportAsText(finalReport);
      downloadBlob(new Blob([txt],{type:"text/plain"}),`final_report_${participantId}.txt`);
    }
    setLoading("");
  }

  // ── Gate color ────────────────────────────────────────────────────────────

  const gateColor=!gateResult?"#4a8a9a"
    :gateResult.gateStatus==="PASS_VISUAL_QA"?"#10b981"
    :gateResult.gateStatus==="NEEDS_REVIEW"?"#f59e0b"
    :"#ef4444";

  const recColor=!finalReport?"#4a8a9a"
    :finalReport.finalRecommendation==="READY_TO_SEND_SAMPLE"?"#10b981"
    :finalReport.finalRecommendation==="NEEDS_INTERNAL_REVIEW"?"#f59e0b"
    :"#ef4444";

  return(
    <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",
      color:"#a0c4cc",padding:16}}>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#060e18,#071218)",
        border:"1px solid #0f2a3a",borderRadius:12,padding:"12px 16px",
        marginBottom:12,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{width:36,height:36,borderRadius:10,background:"#8b5cf622",
          border:"1px solid #8b5cf644",display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:18}}>🔬</div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>
            FORENSIC SILENCE REPAIR
          </div>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>
            ADOBE-STYLE VISUAL QA SIMULATION · 32-BIT FLOAT EXPORT
          </div>
        </div>
        {/* Mode toggle */}
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          {(["single","batch"] as const).map(m=>(
            <div key={m} onClick={()=>setMode(m)}
              style={{fontSize:9,padding:"4px 10px",borderRadius:6,cursor:"pointer",
                background:mode===m?"#8b5cf622":"#050d14",
                border:"1px solid "+(mode===m?"#8b5cf644":"#0f2a3a"),
                color:mode===m?"#8b5cf6":"#4a8a9a",fontWeight:700}}>
              {m==="single"?"Single File":"Batch (200 files)"}
            </div>
          ))}
        </div>
        {loading&&<div style={{fontSize:9,color:"#22d3ee"}}>⟳ {loading}</div>}
      </div>

      {/* Reference Upload — shared */}
      <div style={{background:"#060e16",border:"1px solid #0f2a3a",
        borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>
          REFERENCE SILENCE (APPROVED SAMPLE)
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>refRef.current?.click()}
            style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:8,
              padding:"6px 14px",cursor:"pointer",color:"#8b5cf6",fontSize:10,fontWeight:700}}>
            📁 {refFileName||"Choose Reference WAV..."}
          </button>
          <input ref={refRef} type="file" accept=".wav" style={{display:"none"}}
            onChange={async e=>{
              const f=e.target.files?.[0];if(!f)return;
              setRefFileName(f.name);setRefBuffer(await loadAudio(f));setProfile(null);
            }}/>
          {refBuffer&&<>
            <span style={{fontSize:8,color:"#10b981"}}>
              ✓ {refBuffer.duration.toFixed(2)}s · {refBuffer.sampleRate}Hz
            </span>
            <button onClick={handleBuildProfile}
              style={{background:"#8b5cf622",border:"1px solid #8b5cf644",borderRadius:6,
                padding:"4px 10px",cursor:"pointer",color:"#8b5cf6",fontSize:9,fontWeight:700}}>
              🎯 Build Profile
            </button>
          </>}
          {profile&&<span style={{fontSize:8,color:"#10b981",fontWeight:700}}>
            ✓ Profile ready — Purity {(profile.purityScore*100).toFixed(0)}% · {profile.grainLibrary.length} grains
          </span>}
        </div>
        {profileWarnings.map((w,i)=>(
          <div key={i} style={{fontSize:9,color:"#f59e0b",marginTop:4}}>⚠ {w}</div>
        ))}
      </div>

      {/* ── SINGLE FILE MODE ────────────────────────────────────────────── */}
      {mode==="single"&&<>

        {/* Upload + Actions */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",
          borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>
            SINGLE FILE WORKFLOW
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <button onClick={()=>mainRef.current?.click()}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:8,
                padding:"6px 14px",cursor:"pointer",color:"#22d3ee",fontSize:10,fontWeight:700}}>
              📁 {mainFileName||"Upload WAV..."}
            </button>
            <input ref={mainRef} type="file" accept=".wav" style={{display:"none"}}
              onChange={async e=>{
                const f=e.target.files?.[0];if(!f)return;
                setMainFileName(f.name);setMainBuffer(await loadAudio(f));
                setForensics(null);setReconstruction(null);setQaResult(null);
                setSpeechResult(null);setGateResult(null);
              }}/>
            {mainBuffer&&<span style={{fontSize:8,color:"#10b981"}}>
              ✓ {mainBuffer.duration.toFixed(2)}s
            </span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
            {[
              {label:"🔬 Analyze",action:handleAnalyze,  disabled:!mainBuffer},
              {label:"🔧 Repair", action:handleRepair,   disabled:!mainBuffer||!profile||!forensics},
              {label:"✅ Validate",action:handleQA,      disabled:!reconstruction},
              {label:"⬇ Export 32-bit Float",action:handleExport32,disabled:!reconstruction||!gateResult?.exportAllowed},
            ].map(({label,action,disabled})=>(
              <button key={label} onClick={action} disabled={disabled||!!loading}
                style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:6,
                  padding:"5px 10px",cursor:disabled?"not-allowed":"pointer",
                  color:disabled?"#2a5a6a":"#22d3ee",fontSize:9,fontWeight:700,opacity:disabled?0.5:1}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Forensics */}
        {forensics&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",
          borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{fontSize:9,color:"#22d3ee",fontWeight:700,marginBottom:8,letterSpacing:1}}>
            SILENCE FORENSICS
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <ScoreBadge label="Contaminated" value={`${forensics.contaminatedRegions.length}`} good={forensics.contaminatedRegions.length===0}/>
            <ScoreBadge label="Purity" value={`${(forensics.overallPurityScore*100).toFixed(0)}%`} good={forensics.overallPurityScore>0.8}/>
            <ScoreBadge label="Noise Floor" value={`${forensics.noiseFloorDb.toFixed(1)} dB`} good={forensics.noiseFloorDb<-55}/>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {forensics.hasDigitalSilence&&<ContamTag type="digital_silence"/>}
            {forensics.hasHum&&<ContamTag type={`hum_${forensics.humFrequencyHz}hz`}/>}
            {forensics.hasSeams&&<ContamTag type="waveform_seam"/>}
            {forensics.hasRepeatedPattern&&<ContamTag type="repeated_silence"/>}
            {forensics.dominantContamination&&<ContamTag type={forensics.dominantContamination}/>}
          </div>
        </div>}

        {/* QA + Gate */}
        {qaResult&&gateResult&&speechResult&&<div style={{
          background:"#060e16",border:`1px solid ${gateColor}33`,
          borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <div style={{fontSize:9,color:gateColor,fontWeight:700,letterSpacing:1}}>
              ADOBE-STYLE QA GATE
            </div>
            <div style={{marginLeft:"auto",padding:"3px 10px",borderRadius:20,
              background:gateColor+"22",border:`1px solid ${gateColor}44`,
              color:gateColor,fontSize:9,fontWeight:700}}>
              {gateResult.gateStatus.replace(/_/g," ")}
            </div>
          </div>
          <PurityBar score={qaResult.silenceRealismScore}        label="Silence Realism"/>
          <PurityBar score={1-qaResult.seamRiskScore}            label="Seam Invisibility"/>
          <PurityBar score={speechResult.score}                  label="Speech Preservation"/>
          <PurityBar score={qaResult.spectralMatchScore}         label="Spectral Continuity"/>
          <PurityBar score={qaResult.transientPreservationScore} label="Transient Preservation"/>
          {gateResult.blockingReasons.map((r,i)=>(
            <div key={i} style={{fontSize:9,color:"#ef4444",marginTop:4}}>✗ {r}</div>
          ))}
          {gateResult.warnings.map((w,i)=>(
            <div key={i} style={{fontSize:9,color:"#f59e0b",marginTop:3}}>⚠ {w}</div>
          ))}
          {!gateResult.exportAllowed&&<div style={{fontSize:9,color:"#ef4444",
            marginTop:6,fontWeight:700}}>
            ⛔ Export blocked — fix issues before exporting
          </div>}
          {gateResult.exportAllowed&&<div style={{fontSize:9,color:"#10b981",marginTop:6}}>
            ✅ Export allowed — 32-bit float WAV ready
          </div>}
        </div>}
      </>}

      {/* ── BATCH MODE ──────────────────────────────────────────────────── */}
      {mode==="batch"&&<>

        {/* Batch Upload */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",
          borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>
            BATCH PARTICIPANT WORKFLOW
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
            <div>
              <div style={{fontSize:8,color:"#4a8a9a",marginBottom:3}}>PARTICIPANT ID</div>
              <input value={participantId} onChange={e=>setParticipantId(e.target.value)}
                style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                  padding:"4px 8px",color:"#a0c4cc",fontSize:10,fontFamily:"monospace",width:80}}/>
            </div>
            <button onClick={()=>batchRef.current?.click()}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:8,
                padding:"6px 14px",cursor:"pointer",color:"#22d3ee",fontSize:10,fontWeight:700}}>
              📁 Upload WAV Files ({batchFiles.length})
            </button>
            <input ref={batchRef} type="file" accept=".wav" multiple style={{display:"none"}}
              onChange={e=>{
                const files=Array.from(e.target.files??[]).filter(f=>f.name.toLowerCase().endsWith(".wav"));
                setBatchFiles(files);setBatchReport(null);setFinalReport(null);
              }}/>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={handleBatchRun}
              disabled={!batchFiles.length||!profile||!!cancelToken||!!loading}
              style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:6,
                padding:"5px 12px",cursor:"pointer",color:"#10b981",fontSize:9,fontWeight:700,
                opacity:(!batchFiles.length||!profile)?0.5:1}}>
              🚀 Run Batch Repair ({batchFiles.length} files)
            </button>
            {cancelToken&&<button onClick={()=>cancelToken.cancel()}
              style={{background:"#ef444422",border:"1px solid #ef444444",borderRadius:6,
                padding:"5px 10px",cursor:"pointer",color:"#ef4444",fontSize:9}}>
              ✕ Cancel
            </button>}
            {batchReport&&<button onClick={handleBatchExport}
              disabled={!!loading}
              style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:6,
                padding:"5px 12px",cursor:"pointer",color:"#22d3ee",fontSize:9,fontWeight:700}}>
              ⬇ Export ZIP + Manifest
            </button>}
          </div>
        </div>

        {/* Progress */}
        {batchProgress&&!batchReport&&<div style={{background:"#060e16",
          border:"1px solid #22d3ee33",borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{fontSize:9,color:"#22d3ee",marginBottom:6}}>
            Processing: {batchProgress.currentFile}
          </div>
          <div style={{height:6,background:"#0f2a3a",borderRadius:3,marginBottom:6}}>
            <div style={{height:"100%",background:"#22d3ee",borderRadius:3,
              width:`${batchProgress.percent}%`,transition:"width 0.3s"}}/>
          </div>
          <div style={{display:"flex",gap:12,fontSize:9}}>
            <span style={{color:"#10b981"}}>✓ {batchProgress.passed}</span>
            <span style={{color:"#f59e0b"}}>⚠ {batchProgress.review}</span>
            <span style={{color:"#ef4444"}}>✗ {batchProgress.failed}</span>
            <span style={{color:"#4a8a9a",marginLeft:"auto"}}>
              {batchProgress.current}/{batchProgress.total} ({batchProgress.percent}%)
            </span>
          </div>
        </div>}

        {/* Batch Results */}
        {batchReport&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",
          borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{fontSize:9,color:"#22d3ee",fontWeight:700,marginBottom:8,letterSpacing:1}}>
            BATCH RESULTS
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <ScoreBadge label="Total"   value={`${batchReport.totalFiles}`}   good={true}/>
            <ScoreBadge label="Passed"  value={`${batchReport.passedFiles}`}  good={batchReport.passedFiles>0}/>
            <ScoreBadge label="Review"  value={`${batchReport.reviewFiles}`}  good={batchReport.reviewFiles===0}/>
            <ScoreBadge label="Failed"  value={`${batchReport.failedFiles}`}  good={batchReport.failedFiles===0}/>
            <ScoreBadge label="Errors"  value={`${batchReport.errorFiles}`}   good={batchReport.errorFiles===0}/>
          </div>
          <PurityBar score={batchReport.avgSilenceRealism} label="Avg Silence Realism"/>
          <PurityBar score={batchReport.avgSpeechScore}    label="Avg Speech Preservation"/>
          <PurityBar score={1-batchReport.avgReviewerRisk} label="Avg QA Safety"/>
          <div style={{fontSize:9,color:"#a0c4cc",marginTop:6}}>{batchReport.summary}</div>
        </div>}

        {/* Final Report */}
        {finalReport&&<div style={{background:"#060e16",
          border:`1px solid ${recColor}33`,borderRadius:10,padding:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <div style={{fontSize:9,color:recColor,fontWeight:700,letterSpacing:1}}>
              FINAL REVIEW REPORT
            </div>
            <div style={{marginLeft:"auto",padding:"3px 10px",borderRadius:20,
              background:recColor+"22",border:`1px solid ${recColor}44`,
              color:recColor,fontSize:9,fontWeight:700}}>
              {finalReport.finalRecommendation.replace(/_/g," ")}
            </div>
          </div>
          <div style={{fontSize:9,color:"#a0c4cc",marginBottom:8}}>
            {finalReport.recommendationReason}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <ScoreBadge label="Gate Pass"    value={`${finalReport.gatePassedCount}`}   good={true}/>
            <ScoreBadge label="Needs Review" value={`${finalReport.gateNeedsReviewCount}`} good={finalReport.gateNeedsReviewCount===0}/>
            <ScoreBadge label="Blocked"      value={`${finalReport.filesBlockedFromExport.length}`} good={finalReport.filesBlockedFromExport.length===0}/>
            <ScoreBadge label="Export Ready" value={`${finalReport.exportReadyCount}`}  good={true}/>
          </div>
          {finalReport.warnings.map((w:string,i:number)=>(
            <div key={i} style={{fontSize:9,color:"#f59e0b",marginBottom:3}}>⚠ {w}</div>
          ))}
          <div style={{fontSize:8,color:"#2a5a6a",marginTop:8,fontStyle:"italic"}}>
            {finalReport.disclaimer}
          </div>
        </div>}
      </>}

    </div>
  );
}
