// @ts-nocheck
/**
 * ForensicSilenceRepair.tsx — Adobe-Grade Silence Repair Panel
 * Aivora Platform
 */
import React, { useState, useRef } from "react";
import { analyzeSilenceForensics } from "../lib/audioForensics/silenceForensics";
import { buildReferenceSilenceProfile, validateReferenceProfile } from "../lib/audioForensics/referenceSilenceProfile";
import { reconstructSilenceWithReference, exportReconstructedWav } from "../lib/audioForensics/silenceReconstructor";
import { simulateAdobeQA } from "../lib/audioForensics/adobeQaSimulator";
import type {
  SilenceForensicsResult, ReferenceSilenceProfile,
  ReconstructionResult, AdobeQAResult,
} from "../lib/audioForensics/types";

// ── Score Badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ label, value, good=true }: { label:string; value:string; good?:boolean }) {
  const color=good?"#10b981":"#ef4444";
  return (
    <div style={{background:"#060e16",border:`1px solid ${color}33`,borderRadius:8,
      padding:"6px 10px",textAlign:"center",minWidth:80}}>
      <div style={{fontSize:11,fontWeight:700,color}}>{value}</div>
      <div style={{fontSize:8,color:"#4a8a9a",marginTop:2}}>{label}</div>
    </div>
  );
}

// ── Purity Bar ────────────────────────────────────────────────────────────────

function PurityBar({ score, label }: { score:number; label:string }) {
  const color=score>0.85?"#10b981":score>0.60?"#f59e0b":"#ef4444";
  return (
    <div style={{marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:9,color:"#a0c4cc"}}>{label}</span>
        <span style={{fontSize:9,color,fontWeight:700}}>{(score*100).toFixed(0)}%</span>
      </div>
      <div style={{height:4,background:"#0f2a3a",borderRadius:2}}>
        <div style={{height:"100%",borderRadius:2,background:color,
          width:`${score*100}%`,transition:"width 0.5s"}}/>
      </div>
    </div>
  );
}

// ── Contamination Tag ─────────────────────────────────────────────────────────

function ContamTag({ type }: { type:string }) {
  const colors: Record<string,string> = {
    hum_50hz:"#ef4444", hum_60hz:"#ef4444",
    digital_silence:"#8b5cf6", hiss:"#f59e0b",
    waveform_seam:"#f97316", repeated_silence:"#22d3ee",
    room_tone_leak:"#10b981", fan_noise:"#6366f1",
  };
  const color=colors[type]??"#4a8a9a";
  return (
    <span style={{fontSize:8,padding:"2px 6px",borderRadius:3,
      background:color+"22",border:`1px solid ${color}44`,color}}>
      {type.replace(/_/g," ").toUpperCase()}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ForensicSilenceRepair() {
  const [mainBuffer,    setMainBuffer]    = useState<AudioBuffer|null>(null);
  const [mainFileName,  setMainFileName]  = useState("");
  const [refBuffer,     setRefBuffer]     = useState<AudioBuffer|null>(null);
  const [refFileName,   setRefFileName]   = useState("");
  const [profile,       setProfile]       = useState<ReferenceSilenceProfile|null>(null);
  const [forensics,     setForensics]     = useState<SilenceForensicsResult|null>(null);
  const [reconstruction,setReconstruction]= useState<ReconstructionResult|null>(null);
  const [qaResult,      setQaResult]      = useState<AdobeQAResult|null>(null);
  const [loading,       setLoading]       = useState("");
  const [profileWarnings, setProfileWarnings] = useState<string[]>([]);

  const mainRef = useRef<HTMLInputElement>(null);
  const refRef  = useRef<HTMLInputElement>(null);

  // ── Load WAV ────────────────────────────────────────────────────────────────

  async function loadAudio(file: File): Promise<AudioBuffer> {
    const ab  = await file.arrayBuffer();
    const ctx = new AudioContext();
    return ctx.decodeAudioData(ab);
  }

  // ── Analyze ─────────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if(!mainBuffer) return;
    setLoading("Analyzing silence contamination...");
    await new Promise(r=>setTimeout(r,0));
    const result=analyzeSilenceForensics(mainBuffer);
    setForensics(result);
    setLoading("");
  }

  // ── Build Profile ────────────────────────────────────────────────────────────

  async function handleBuildProfile() {
    if(!refBuffer) return;
    setLoading("Building reference silence profile...");
    await new Promise(r=>setTimeout(r,0));
    const p=buildReferenceSilenceProfile(refBuffer, refFileName);
    const {valid,warnings}=validateReferenceProfile(p);
    setProfile(p);
    setProfileWarnings(warnings);
    setLoading("");
  }

  // ── Repair ──────────────────────────────────────────────────────────────────

  async function handleRepair() {
    if(!mainBuffer||!profile||!forensics) return;
    setLoading("Reconstructing silence with reference...");
    await new Promise(r=>setTimeout(r,0));
    const result=reconstructSilenceWithReference(
      mainBuffer,
      forensics.contaminatedRegions,
      profile
    );
    setReconstruction(result);
    setLoading("");
  }

  // ── QA Simulate ─────────────────────────────────────────────────────────────

  async function handleQA() {
    if(!mainBuffer||!reconstruction) return;
    setLoading("Running Adobe QA simulation...");
    await new Promise(r=>setTimeout(r,0));
    const result=simulateAdobeQA({
      original:            mainBuffer,
      repaired:            reconstruction.buffer,
      repairedRegionCount: reconstruction.repairedRegions.length,
      totalRepairedMs:     reconstruction.totalRepairedMs,
    });
    setQaResult(result);
    setLoading("");
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  function handleExport() {
    if(!reconstruction) return;
    const {data,fileName}=exportReconstructedWav(reconstruction.buffer, mainFileName);
    const blob=new Blob([data],{type:"audio/wav"});
    const url =URL.createObjectURL(blob);
    const a   =document.createElement("a");
    a.href=url; a.download=fileName; a.click();
    URL.revokeObjectURL(url);
  }

  // ── QA Color ─────────────────────────────────────────────────────────────────

  const qaColor = !qaResult ? "#4a8a9a"
    : qaResult.recommendation==="PASS_VISUAL_QA" ? "#10b981"
    : qaResult.recommendation==="NEEDS_REVIEW"   ? "#f59e0b"
    : qaResult.recommendation==="REPAIR_AGAIN"   ? "#f97316"
    : "#ef4444";

  return (
    <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",
      color:"#a0c4cc",padding:16}}>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#060e18,#071218)",
        border:"1px solid #0f2a3a",borderRadius:12,padding:"12px 16px",
        marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,borderRadius:10,background:"#8b5cf622",
          border:"1px solid #8b5cf644",display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:18}}>🔬</div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>
            FORENSIC SILENCE REPAIR
          </div>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>
            PROFESSIONAL SILENCE RECONSTRUCTION · VISUAL QA SIMULATION
          </div>
        </div>
        {loading&&<div style={{marginLeft:"auto",fontSize:9,color:"#22d3ee",
          animation:"pulse 1s infinite"}}>⟳ {loading}</div>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>

        {/* Upload WAV */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:10,padding:12}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>
            1. UPLOAD WAV FILE
          </div>
          <button onClick={()=>mainRef.current?.click()}
            style={{width:"100%",background:"#22d3ee22",border:"1px solid #22d3ee44",
              borderRadius:8,padding:"8px",cursor:"pointer",color:"#22d3ee",
              fontSize:10,fontWeight:700,marginBottom:6}}>
            📁 {mainFileName||"Choose WAV..."}
          </button>
          <input ref={mainRef} type="file" accept=".wav" style={{display:"none"}}
            onChange={async e=>{
              const f=e.target.files?.[0]; if(!f) return;
              setMainFileName(f.name);
              setMainBuffer(await loadAudio(f));
              setForensics(null);setReconstruction(null);setQaResult(null);
            }}/>
          {mainBuffer&&<div style={{fontSize:8,color:"#10b981"}}>
            ✓ {(mainBuffer.duration).toFixed(2)}s · {mainBuffer.sampleRate}Hz
          </div>}
        </div>

        {/* Upload Reference */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:10,padding:12}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>
            2. UPLOAD REFERENCE SILENCE
          </div>
          <button onClick={()=>refRef.current?.click()}
            style={{width:"100%",background:"#8b5cf622",border:"1px solid #8b5cf644",
              borderRadius:8,padding:"8px",cursor:"pointer",color:"#8b5cf6",
              fontSize:10,fontWeight:700,marginBottom:6}}>
            📁 {refFileName||"Choose Reference WAV..."}
          </button>
          <input ref={refRef} type="file" accept=".wav" style={{display:"none"}}
            onChange={async e=>{
              const f=e.target.files?.[0]; if(!f) return;
              setRefFileName(f.name);
              setRefBuffer(await loadAudio(f));
              setProfile(null);
            }}/>
          {refBuffer&&<div style={{fontSize:8,color:"#10b981"}}>
            ✓ {(refBuffer.duration).toFixed(2)}s · {refBuffer.sampleRate}Hz
          </div>}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {[
          {label:"🔬 Analyze Silence",   action:handleAnalyze,   disabled:!mainBuffer,            color:"#22d3ee"},
          {label:"🎯 Build Profile",     action:handleBuildProfile,disabled:!refBuffer,            color:"#8b5cf6"},
          {label:"🔧 Repair Silence",    action:handleRepair,    disabled:!mainBuffer||!profile||!forensics, color:"#10b981"},
          {label:"✅ Validate Like Adobe",action:handleQA,       disabled:!reconstruction,         color:"#f59e0b"},
          {label:"⬇ Export WAV",         action:handleExport,    disabled:!reconstruction,         color:"#22d3ee"},
        ].map(({label,action,disabled,color})=>(
          <button key={label} onClick={action} disabled={disabled||!!loading}
            style={{background:color+"22",border:`1px solid ${color}44`,borderRadius:8,
              padding:"7px 14px",cursor:disabled?"not-allowed":"pointer",
              color:disabled?"#2a5a6a":color,fontSize:10,fontWeight:700,
              opacity:disabled?0.5:1}}>
            {label}
          </button>
        ))}
      </div>

      {/* Reference Profile */}
      {profile&&<div style={{background:"#060e16",border:"1px solid #8b5cf633",
        borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:9,color:"#8b5cf6",fontWeight:700,marginBottom:8,letterSpacing:1}}>
          REFERENCE SILENCE PROFILE
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:8}}>
          <ScoreBadge label="Purity"      value={`${(profile.purityScore*100).toFixed(0)}%`}   good={profile.purityScore>0.7}/>
          <ScoreBadge label="Grains"      value={`${profile.grainLibrary.length}`}              good={profile.grainLibrary.length>=5}/>
          <ScoreBadge label="Noise Floor" value={`${profile.noiseFloorDb.toFixed(1)} dB`}       good={profile.noiseFloorDb<-60}/>
          <ScoreBadge label="RMS"         value={`${profile.rmsDb.toFixed(1)} dB`}              good={true}/>
          <ScoreBadge label="Sample Rate" value={`${profile.sampleRate}Hz`}                     good={true}/>
        </div>
        {profileWarnings.map((w,i)=>(
          <div key={i} style={{fontSize:9,color:"#f59e0b",marginBottom:3}}>⚠ {w}</div>
        ))}
      </div>}

      {/* Forensics Results */}
      {forensics&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",
        borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:9,color:"#22d3ee",fontWeight:700,marginBottom:8,letterSpacing:1}}>
          SILENCE FORENSICS ANALYSIS
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
          <ScoreBadge label="Total Regions"  value={`${forensics.totalRegions}`}              good={true}/>
          <ScoreBadge label="Contaminated"   value={`${forensics.contaminatedRegions.length}`} good={forensics.contaminatedRegions.length===0}/>
          <ScoreBadge label="Purity"         value={`${(forensics.overallPurityScore*100).toFixed(0)}%`} good={forensics.overallPurityScore>0.8}/>
          <ScoreBadge label="Noise Floor"    value={`${forensics.noiseFloorDb.toFixed(1)} dB`}  good={forensics.noiseFloorDb<-55}/>
        </div>

        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          {forensics.hasDigitalSilence&&<ContamTag type="digital_silence"/>}
          {forensics.hasHum&&<ContamTag type={`hum_${forensics.humFrequencyHz}hz`}/>}
          {forensics.hasSeams&&<ContamTag type="waveform_seam"/>}
          {forensics.hasRepeatedPattern&&<ContamTag type="repeated_silence"/>}
          {forensics.dominantContamination&&<ContamTag type={forensics.dominantContamination}/>}
        </div>

        {forensics.contaminatedRegions.length>0&&(
          <div style={{maxHeight:150,overflowY:"auto"}}>
            {forensics.contaminatedRegions.slice(0,10).map((r,i)=>(
              <div key={i} style={{display:"flex",gap:8,padding:"4px 0",
                borderBottom:"1px solid #0a1a24",alignItems:"center"}}>
                <ContamTag type={r.contaminationType}/>
                <span style={{fontSize:9,color:"#4a8a9a"}}>
                  {r.startMs.toFixed(0)}–{r.endMs.toFixed(0)}ms
                </span>
                <span style={{fontSize:9,color:"#a0c4cc"}}>
                  {r.durationMs.toFixed(0)}ms
                </span>
                <span style={{fontSize:8,color:r.purityScore>0.7?"#10b981":"#ef4444"}}>
                  {(r.purityScore*100).toFixed(0)}% pure
                </span>
                <span style={{fontSize:8,color:"#4a8a9a",marginLeft:"auto"}}>
                  {r.suggestedAction.replace(/_/g," ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Reconstruction Results */}
      {reconstruction&&<div style={{background:"#060e16",border:"1px solid #10b98133",
        borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:9,color:"#10b981",fontWeight:700,marginBottom:8,letterSpacing:1}}>
          RECONSTRUCTION RESULTS
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:8}}>
          <ScoreBadge label="Regions Repaired" value={`${reconstruction.repairedRegions.length}`}        good={true}/>
          <ScoreBadge label="Total Repaired"   value={`${reconstruction.totalRepairedMs.toFixed(0)}ms`} good={true}/>
          <ScoreBadge label="Speech Preserved" value={reconstruction.speechPreserved?"✓ Yes":"⚠ Check"} good={reconstruction.speechPreserved}/>
          <ScoreBadge label="Processing"       value={`${reconstruction.processingMs}ms`}               good={true}/>
        </div>
        {reconstruction.warnings.map((w,i)=>(
          <div key={i} style={{fontSize:9,color:"#f59e0b"}}>⚠ {w}</div>
        ))}
      </div>}

      {/* Adobe QA Results */}
      {qaResult&&<div style={{background:"#060e16",border:`1px solid ${qaColor}33`,
        borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{fontSize:9,color:qaColor,fontWeight:700,letterSpacing:1}}>
            ADOBE QA SIMULATION
          </div>
          <div style={{marginLeft:"auto",padding:"4px 12px",borderRadius:20,
            background:qaColor+"22",border:`1px solid ${qaColor}44`,
            color:qaColor,fontSize:10,fontWeight:700}}>
            {qaResult.recommendation.replace(/_/g," ")}
          </div>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          <ScoreBadge
            label="Adobe Pass"
            value={qaResult.adobePassLikely?"LIKELY ✓":"AT RISK ✗"}
            good={qaResult.adobePassLikely}/>
          <ScoreBadge
            label="Reviewer Risk"
            value={`${(qaResult.reviewerRiskScore*100).toFixed(0)}%`}
            good={qaResult.reviewerRiskScore<0.3}/>
        </div>

        <div style={{marginBottom:10}}>
          <PurityBar score={qaResult.silenceRealismScore}       label="Silence Realism"/>
          <PurityBar score={1-qaResult.seamRiskScore}           label="Seam Invisibility"/>
          <PurityBar score={qaResult.spectralMatchScore}        label="Spectral Continuity"/>
          <PurityBar score={qaResult.speechPreservationScore}   label="Speech Preservation"/>
          <PurityBar score={qaResult.transientPreservationScore}label="Transient Preservation"/>
        </div>

        {qaResult.detectedProblems.length>0&&(
          <div>
            <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4}}>DETECTED PROBLEMS:</div>
            {qaResult.detectedProblems.map((p,i)=>(
              <div key={i} style={{fontSize:9,color:"#f59e0b",marginBottom:3}}>• {p}</div>
            ))}
          </div>
        )}
      </div>}

    </div>
  );
}
