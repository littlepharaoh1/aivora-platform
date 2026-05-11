// @ts-nocheck
import React, { useState, useRef } from "react";
import { analyzeAudioBuffer, scoreAnalysis } from "../lib/audio/AdvancedAudioAnalyzer";
import { analyzeAudioQuality } from "../lib/audioQc/audioAnalyzerCore";
import { detectDigitalGaps } from "../lib/audioQc/silenceRestorer";
import { openQCReport } from "../lib/audioQc/report/pdfReporter";
import { Upload, BarChart3, CheckCircle2, XCircle, AlertTriangle, FileText, Download } from "lucide-react";
import { useGlobalAudio } from "../lib/store/GlobalAudioContext";

const PROFILES = {
  wakeword:     { label:"Wake Word",    icon:"🎙️", color:"#22d3ee" },
  asr:          { label:"ASR / Speech", icon:"🗣️", color:"#10b981" },
  tts:          { label:"TTS Training", icon:"🔊", color:"#f59e0b" },
  conversation: { label:"Conversation", icon:"💬", color:"#8b5cf6" },
};

function verdictColor(v) {
  return v==="READY"?"#10b981":v==="REVIEW"?"#f59e0b":"#ef4444";
}
function scoreColor(s) {
  return s>=90?"#22d3ee":s>=75?"#10b981":s>=60?"#f59e0b":s>=40?"#f97316":"#ef4444";
}

async function analyzeFile(file, pk) {
  const ab  = await file.arrayBuffer();
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(ab);
  const analysis  = await analyzeAudioBuffer(buf);
  const scored    = scoreAnalysis(analysis, pk);
  const mono      = buf.getChannelData(0);
  const qcResult  = await analyzeAudioQuality(mono, buf.sampleRate, pk);
  const gaps      = detectDigitalGaps(buf);
  const internalGaps = gaps.filter(g=>g.type==="internal").length;

  return {
    name:     file.name,
    size:     (file.size/1024).toFixed(1)+"KB",
    pk,
    score:    scored.total,
    grade:    scored.grade,
    verdict:  scored.verdict,
    dur:      analysis.duration.toFixed(2)+"s",
    lufs:     qcResult.metrics.lufs.toFixed(1),
    snr:      qcResult.metrics.snrDb.toFixed(1),
    noise:    qcResult.metrics.noiseClass,
    env:      qcResult.metrics.environment,
    speech:   (qcResult.metrics.speechRatio*100).toFixed(1)+"%",
    gaps:     internalGaps,
    problems: qcResult.problems.length,
    qc:       qcResult,
    analysis,
    edges: {
      leadMs:   Math.round(analysis.silence.leadingMs),
      trailMs:  Math.round(analysis.silence.trailingMs),
      silRatio: analysis.silence.silenceRatio,
    },
    pkDb:  analysis.peakDb,
    rDb:   analysis.rmsDb,
    sr:    analysis.sampleRate,
    time:  new Date().toLocaleTimeString(),
  };
}

export default function BatchAnalyzer() {
  const { currentFile, setAudioFile } = useGlobalAudio();
  const [pk, setPk]           = useState("asr");
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({done:0,total:0});
  const [sortBy, setSortBy]   = useState("score");
  const prof = PROFILES[pk];

  async function handleFiles(files) {
    const wavFiles = Array.from(files).filter(f=>f.name.toLowerCase().endsWith(".wav"));
    if(wavFiles.length===0) return;
    // Share first file globally
    if(wavFiles.length>0) setAudioFile(wavFiles[0],pk);
    setRunning(true);
    setResults([]);
    setProgress({done:0,total:wavFiles.length});

    const out = [];
    for(let i=0;i<wavFiles.length;i++){
      try{
        const r = await analyzeFile(wavFiles[i], pk);
        out.push(r);
        setResults([...out]);
        setProgress({done:i+1,total:wavFiles.length});
      }catch(e){
        out.push({name:wavFiles[i].name,score:0,grade:"F",verdict:"REJECT",error:e.message});
        setResults([...out]);
        setProgress({done:i+1,total:wavFiles.length});
      }
    }
    setRunning(false);
  }

  const sorted = [...results].sort((a,b)=>{
    if(sortBy==="score")   return b.score-a.score;
    if(sortBy==="name")    return a.name.localeCompare(b.name);
    if(sortBy==="verdict") return a.verdict.localeCompare(b.verdict);
    if(sortBy==="gaps")    return (b.gaps||0)-(a.gaps||0);
    return 0;
  });

  const stats = {
    total:   results.length,
    ready:   results.filter(r=>r.verdict==="READY").length,
    review:  results.filter(r=>r.verdict==="REVIEW").length,
    reject:  results.filter(r=>r.verdict==="REJECT").length,
    avgScore:results.length>0?Math.round(results.reduce((s,r)=>s+r.score,0)/results.length):0,
    withGaps:results.filter(r=>r.gaps>0).length,
  };

  function exportBatchReport() {
    const rows = sorted.map(r=>`
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:6px 10px;font-size:10px;color:#334155;max-width:200px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.name}</td>
        <td style="padding:6px 10px;font-size:11px;font-weight:700;
          color:${scoreColor(r.score)};text-align:center;">${r.score}</td>
        <td style="padding:6px 10px;font-size:10px;font-weight:700;
          color:${scoreColor(r.score)};text-align:center;">${r.grade}</td>
        <td style="padding:6px 10px;text-align:center;">
          <span style="background:${verdictColor(r.verdict)}22;color:${verdictColor(r.verdict)};
            padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;">${r.verdict}</span>
        </td>
        <td style="padding:6px 10px;font-size:10px;color:#64748b;text-align:center;">${r.lufs??"-"} LUFS</td>
        <td style="padding:6px 10px;font-size:10px;color:#64748b;text-align:center;">${r.snr??"-"} dB</td>
        <td style="padding:6px 10px;font-size:10px;text-align:center;
          color:${r.gaps>0?"#ef4444":"#10b981"};">${r.gaps>0?"⚠ "+r.gaps:"✓"}</td>
        <td style="padding:6px 10px;font-size:10px;color:#64748b;text-align:center;">${r.problems??0}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<title>Aivora Batch QC Report</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;}
@media print{.no-print{display:none;}}</style>
</head><body>
<div style="max-width:1000px;margin:20px auto;background:white;border-radius:12px;
  box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
  <div style="background:linear-gradient(135deg,#0f172a,#0c2340);padding:24px 32px;
    display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:18px;font-weight:800;color:white;">AIVORA BATCH QC REPORT</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px;letter-spacing:2px;">
        ${new Date().toLocaleString()} · Profile: ${pk.toUpperCase()} · ${stats.total} files
      </div>
    </div>
    <div style="display:flex;gap:16px;">
      ${[["READY",stats.ready,"#10b981"],["REVIEW",stats.review,"#f59e0b"],["REJECT",stats.reject,"#ef4444"]].map(([l,v,c])=>`
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:900;color:${c};">${v}</div>
          <div style="font-size:9px;color:#64748b;">${l}</div>
        </div>`).join("")}
      <div style="text-align:center;">
        <div style="font-size:24px;font-weight:900;color:#22d3ee;">${stats.avgScore}</div>
        <div style="font-size:9px;color:#64748b;">AVG SCORE</div>
      </div>
    </div>
  </div>
  <div style="padding:20px 32px;">
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f8fafc;">
        ${["FILE","SCORE","GRADE","VERDICT","LUFS","SNR","GAPS","PROBLEMS"].map(h=>
          `<th style="padding:8px 10px;font-size:10px;color:#64748b;text-align:center;">${h}</th>`).join("")}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="padding:14px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;
    display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:9px;color:#94a3b8;">
      Aivora Platform · DSP Engine V4 · ${stats.withGaps} file(s) with digital gaps
    </div>
    <button class="no-print" onclick="window.print()"
      style="background:#0f172a;color:white;border:none;padding:6px 16px;
      border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;">
      🖨 Print / Save PDF
    </button>
  </div>
</div></body></html>`;

    const blob = new Blob([html],{type:"text/html"});
    window.open(URL.createObjectURL(blob),"_blank");
  }

  return <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>
    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#060e18,#071a18)",borderBottom:"1px solid #0f2a3a",
      padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{width:36,height:36,borderRadius:10,background:prof.color+"22",
        border:"1px solid "+prof.color+"44",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <BarChart3 size={16} color={prof.color}/>
      </div>
      <div>
        <div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>BATCH ANALYZER</div>
        <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>{prof.icon} {prof.label.toUpperCase()} · MULTI-FILE QC</div>
      </div>
    </div>

    <div style={{padding:16,display:"flex",flexDirection:"column",gap:12}}>
      {/* Profile + Upload */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:6}}>
          {Object.entries(PROFILES).map(([id,p])=>(
            <div key={id} onClick={()=>setPk(id)} style={{border:"1px solid "+(pk===id?p.color+"66":"#0f2a3a"),
              borderRadius:8,padding:"6px 10px",cursor:"pointer",background:pk===id?p.color+"11":"#060e16",
              fontSize:10,color:pk===id?p.color:"#4a8a9a",fontWeight:700}}>
              {p.icon} {p.label}
            </div>
          ))}
        </div>
        <label style={{display:"flex",alignItems:"center",gap:6,background:"#060e16",
          border:"2px dashed "+prof.color+"44",borderRadius:8,padding:"8px 16px",
          cursor:"pointer",color:prof.color,fontSize:10,fontWeight:700}}>
          <Upload size={13}/>
          {running?`Analyzing ${progress.done}/${progress.total}...`:"Upload WAV Files"}
          <input type="file" accept=".wav" multiple hidden
            onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}}/>
        </label>
        {results.length>0&&!running&&<button onClick={exportBatchReport}
          style={{display:"flex",alignItems:"center",gap:6,background:"#0f172a",
            border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 16px",
            cursor:"pointer",color:"#94a3b8",fontSize:10,fontWeight:700}}>
          <FileText size={13}/>Batch Report
        </button>}
      </div>

      {/* Progress bar */}
      {running&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:8,padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:10,color:"#4a8a9a"}}>Analyzing files...</span>
          <span style={{fontSize:10,color:"#22d3ee"}}>{progress.done}/{progress.total}</span>
        </div>
        <div style={{height:4,background:"#0f2a3a",borderRadius:2}}>
          <div style={{height:"100%",background:"#22d3ee",borderRadius:2,
            width:(progress.done/progress.total*100)+"%",transition:"width 0.3s"}}/>
        </div>
      </div>}

      {/* Stats */}
      {results.length>0&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[
          ["Total",   stats.total,    "#a0c4cc"],
          ["Ready",   stats.ready,    "#10b981"],
          ["Review",  stats.review,   "#f59e0b"],
          ["Reject",  stats.reject,   "#ef4444"],
          ["Avg Score",stats.avgScore,"#22d3ee"],
          ["With Gaps",stats.withGaps,"#ef4444"],
        ].map(([l,v,c])=>(
          <div key={l} style={{background:"#060e16",border:"1px solid #0f2a3a",
            borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:900,color:c,fontFamily:"monospace"}}>{v}</div>
            <div style={{fontSize:9,color:"#4a8a9a",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>}

      {/* Sort */}
      {results.length>0&&<div style={{display:"flex",gap:6,alignItems:"center"}}>
        <span style={{fontSize:9,color:"#4a8a9a"}}>SORT:</span>
        {["score","name","verdict","gaps"].map(s=>(
          <div key={s} onClick={()=>setSortBy(s)} style={{fontSize:9,padding:"3px 8px",
            borderRadius:4,cursor:"pointer",
            background:sortBy===s?"#22d3ee22":"#060e16",
            border:"1px solid "+(sortBy===s?"#22d3ee44":"#0f2a3a"),
            color:sortBy===s?"#22d3ee":"#4a8a9a",fontWeight:700}}>
            {s.toUpperCase()}
          </div>
        ))}
      </div>}

      {/* Results table */}
      {sorted.length>0&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",
        borderRadius:12,overflow:"hidden"}}>
        {/* Table header */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 60px 50px 80px 90px 70px 60px 60px",
          padding:"8px 12px",borderBottom:"1px solid #0f2a3a",background:"#050d14"}}>
          {["FILE","SCORE","GRADE","VERDICT","LUFS","SNR","GAPS","PROBS"].map(h=>(
            <div key={h} style={{fontSize:8,color:"#4a8a9a",textAlign:h==="FILE"?"left":"center"}}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {sorted.map((r,i)=>{
          const vc=verdictColor(r.verdict);
          const sc=scoreColor(r.score);
          return <div key={i} style={{display:"grid",
            gridTemplateColumns:"1fr 60px 50px 80px 90px 70px 60px 60px",
            padding:"8px 12px",borderBottom:"1px solid #0a1a24",
            background:i%2===0?"#060e16":"#050d14",alignItems:"center"}}>
            {/* Name */}
            <div style={{fontSize:10,color:"#a0c4cc",overflow:"hidden",
              textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}
              title={r.name}>{r.name}</div>
            {/* Score */}
            <div style={{fontSize:12,fontWeight:900,color:sc,
              fontFamily:"monospace",textAlign:"center"}}>{r.score}</div>
            {/* Grade */}
            <div style={{fontSize:11,fontWeight:700,color:sc,
              fontFamily:"monospace",textAlign:"center"}}>{r.grade}</div>
            {/* Verdict */}
            <div style={{textAlign:"center"}}>
              <span style={{fontSize:8,color:vc,background:vc+"22",
                padding:"2px 6px",borderRadius:4,fontWeight:700}}>{r.verdict}</span>
            </div>
            {/* LUFS */}
            <div style={{fontSize:10,color:"#a0c4cc",textAlign:"center"}}>
              {r.lufs?r.lufs+" LUFS":"—"}
            </div>
            {/* SNR */}
            <div style={{fontSize:10,color:"#a0c4cc",textAlign:"center"}}>
              {r.snr?r.snr+" dB":"—"}
            </div>
            {/* Gaps */}
            <div style={{fontSize:10,textAlign:"center",
              color:r.gaps>0?"#ef4444":"#10b981",fontWeight:700}}>
              {r.gaps>0?"⚠ "+r.gaps:"✓"}
            </div>
            {/* Problems */}
            <div style={{fontSize:10,textAlign:"center",
              color:r.problems>0?"#f59e0b":"#10b981"}}>
              {r.problems||"✓"}
            </div>
          </div>;
        })}
      </div>}

      {/* Empty state */}
      {results.length===0&&!running&&<div style={{flex:1,display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",gap:16,opacity:0.4,padding:60}}>
        <BarChart3 size={52} color="#1a4a5a"/>
        <div style={{fontSize:13,color:"#2a5a6a",textAlign:"center"}}>
          Upload multiple WAV files to analyze them all at once
        </div>
      </div>}
    </div>
  </div>;
}
