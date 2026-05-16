// @ts-nocheck
/**
 * AivoraAudioBench.tsx — Aivora Audio Bench Dashboard
 * Verifier-backed benchmark system for forensic audio QA
 */
import React, { useState, useCallback } from "react";
import { BENCH_TASKS, getTasksByCategory } from "../lib/audioBench/tasks/index";
import { verifyTaskOutput } from "../lib/audioBench/verifierEngine";
import { runOracle } from "../lib/audioBench/oracleRunner";
import { validateTask } from "../lib/audioBench/taskSchema";
import { gradeToColor, scoreToGrade } from "../lib/audioBench/verifierResult";
import type { VerifierResult } from "../lib/audioBench/verifierResult";
import type { BenchmarkTask, TaskOutput, AudioMetadata } from "../lib/audioBench/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskRun {
  task:     BenchmarkTask;
  result:   VerifierResult | null;
  status:   "idle"|"running"|"done"|"error";
  error?:   string;
  duration: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GradeTag({ score }: { score: number }) {
  const grade = scoreToGrade(score);
  const color = gradeToColor(grade);
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      width:28, height:28, borderRadius:6,
      background:`${color}20`, border:`1px solid ${color}40`,
      fontSize:12, fontWeight:700, color,
    }}>{grade}</span>
  );
}

function MetricRow({ name, value, unit, grade }: {
  name:string; value:number; unit:string; grade:string;
}) {
  const color = grade==="pass"?"#10B981":grade==="review"?"#F59E0B":"#EF4444";
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"4px 0",borderBottom:"1px solid #0a1520",fontSize:10}}>
      <span style={{color:"#4a6a7a"}}>{name}</span>
      <span style={{color,fontWeight:600}}>
        {typeof value==="number"?value.toFixed(2):value}{unit}
        <span style={{marginLeft:6,fontSize:8,color,opacity:0.8}}>
          {grade.toUpperCase()}
        </span>
      </span>
    </div>
  );
}

function DifficultyBadge({ level }: { level: string }) {
  const colors: Record<string,string> = {
    easy:"#10B981", medium:"#F59E0B", hard:"#F97316", expert:"#EF4444"
  };
  const c = colors[level] ?? "#4a6a7a";
  return (
    <span style={{fontSize:8,padding:"2px 6px",borderRadius:4,
      background:`${c}20`,color:c,border:`1px solid ${c}40`,
      letterSpacing:1,fontWeight:700,textTransform:"uppercase"}}>
      {level}
    </span>
  );
}

function TaskCard({ run, onRun, onOracle }: {
  run: TaskRun;
  onRun:    (task: BenchmarkTask, file: File) => void;
  onOracle: (task: BenchmarkTask, file: File) => void;
}) {
  const { task, result, status } = run;
  const validation = validateTask(task);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const oracleRef = React.useRef<HTMLInputElement>(null);

  return (
    <div style={{
      background:"#050d18", border:"1px solid #0f2030",
      borderRadius:12, padding:16, marginBottom:12,
      borderLeft:`3px solid ${
        status==="done"&&result?.passed?"#10B981":
        status==="done"?"#EF4444":
        status==="running"?"#F59E0B":"#1a3a5a"
      }`,
    }}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",
        justifyContent:"space-between",gap:8,marginBottom:10}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{fontSize:10,color:"#2a6a8a",fontFamily:"monospace"}}>
              {task.id}
            </span>
            <DifficultyBadge level={task.difficulty}/>
            {!validation.valid&&<span style={{fontSize:8,color:"#EF4444"}}>
              ⚠ Invalid task
            </span>}
          </div>
          <div style={{fontSize:13,fontWeight:700,color:"#E2EEF6"}}>
            {task.title}
          </div>
          <div style={{fontSize:10,color:"#4a6a7a",marginTop:2}}>
            {task.metadata.tags.map(t=>`#${t}`).join(" ")}
          </div>
        </div>
        {result&&<GradeTag score={result.score}/>}
      </div>

      {/* Instructions preview */}
      <div style={{fontSize:9,color:"#2a5a6a",marginBottom:10,
        fontFamily:"monospace",lineHeight:1.5,
        background:"#030810",padding:8,borderRadius:6,
        maxHeight:80,overflow:"hidden",position:"relative"}}>
        {task.instructions.split("\n").slice(0,4).join("\n")}
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:20,
          background:"linear-gradient(transparent,#030810)"}}/>
      </div>

      {/* Thresholds */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
        {[
          {k:"LUFS",    v:`${task.thresholds.minLufs}→${task.thresholds.maxLufs}`},
          {k:"TP",      v:`≤${task.thresholds.maxTruePeak}dBTP`},
          {k:"SNR",     v:`≥${task.thresholds.minSnrDb}dB`},
          {k:"Speech",  v:`≥${(task.thresholds.minSpeechPreservation*100).toFixed(1)}%`},
          {k:"Seam",    v:`≤${task.thresholds.maxSeamRisk}`},
        ].map(({k,v})=>(
          <span key={k} style={{fontSize:8,padding:"2px 6px",borderRadius:4,
            background:"#0a1520",color:"#4a8a9a",border:"1px solid #1a3a5a"}}>
            {k}: {v}
          </span>
        ))}
      </div>

      {/* Result */}
      {result&&(
        <div style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:700,
              color:result.passed?"#10B981":"#EF4444"}}>
              {result.passed?"✓ PASSED":"✗ FAILED"}
            </span>
            <span style={{fontSize:10,color:"#64A0B8"}}>
              Score: {result.score}/100
            </span>
            <span style={{fontSize:9,color:"#2a5a6a"}}>
              v{result.verifierVersion}
            </span>
          </div>

          {/* Metric results */}
          <div style={{background:"#030810",borderRadius:6,padding:8}}>
            {result.metricResults.slice(0,6).map(m=>(
              <MetricRow key={m.name} name={m.name}
                value={m.value} unit={m.unit} grade={m.grade}/>
            ))}
          </div>

          {/* Blocking failures */}
          {result.blockingFailures.length>0&&(
            <div style={{marginTop:8}}>
              {result.blockingFailures.map(f=>(
                <div key={f.code} style={{fontSize:9,color:"#EF4444",
                  padding:"3px 6px",background:"#EF444410",borderRadius:4,
                  marginBottom:2,fontFamily:"monospace"}}>
                  ✗ {f.code}: {f.message.slice(0,80)}
                </div>
              ))}
            </div>
          )}

          {/* Reproducibility hash */}
          <div style={{marginTop:6,fontSize:7,color:"#1a3a5a",
            fontFamily:"monospace",wordBreak:"break-all"}}>
            Hash: {result.reproducibilityHash.slice(0,32)}...
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <label style={{
          background:"#0d2030",border:"1px solid #1a4a6a",borderRadius:6,
          padding:"5px 12px",cursor:"pointer",fontSize:9,color:"#0EA5E9",
          fontWeight:600,display:"flex",alignItems:"center",gap:4,
          opacity:status==="running"?0.5:1,
        }}>
          {status==="running"?"⟳ Running...":"▶ Submit WAV"}
          <input ref={fileRef} type="file" accept=".wav" style={{display:"none"}}
            onChange={e=>{
              const f=e.target.files?.[0];
              if(f) onRun(task,f);
              e.target.value="";
            }}/>
        </label>

        <label style={{
          background:"#0d2030",border:"1px solid #8B5CF640",borderRadius:6,
          padding:"5px 12px",cursor:"pointer",fontSize:9,color:"#8B5CF6",
          fontWeight:600,display:"flex",alignItems:"center",gap:4,
        }}>
          ⚗ Run Oracle
          <input ref={oracleRef} type="file" accept=".wav" style={{display:"none"}}
            onChange={e=>{
              const f=e.target.files?.[0];
              if(f) onOracle(task,f);
              e.target.value="";
            }}/>
        </label>

        {run.duration>0&&(
          <span style={{fontSize:8,color:"#2a5a6a",alignSelf:"center"}}>
            {(run.duration/1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function AivoraAudioBench() {
  const [runs, setRuns] = useState<Record<string,TaskRun>>(() => {
    const init: Record<string,TaskRun> = {};
    for (const t of BENCH_TASKS) {
      init[t.id] = { task:t, result:null, status:"idle", duration:0 };
    }
    return init;
  });

  const [filter, setFilter] = useState<string>("all");

  const setRun = useCallback((id:string, patch: Partial<TaskRun>) => {
    setRuns(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  async function handleSubmit(task: BenchmarkTask, file: File) {
    setRun(task.id, { status:"running", result:null });
    const start = Date.now();
    try {
      const ab  = await file.arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(ab);

      const sha = await (async () => {
        try {
          const d = buf.getChannelData(0);
          const c = new Float32Array(d);
          const h = await crypto.subtle.digest("SHA-256", new Uint8Array(c.buffer));
          return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,"0")).join("");
        } catch { return "unavailable"; }
      })();

      const meta: AudioMetadata = {
        sampleRate: buf.sampleRate, channels: buf.numberOfChannels,
        bitDepth: 32, durationSec: buf.duration,
        format: "wav_float32", fileSizeBytes: file.size, sha256: sha,
      };

      const output: TaskOutput = {
        taskId: task.id, outputBuffer: buf, metadata: meta,
        processingLog: [`Submitted: ${file.name}`], submittedAt: Date.now(),
      };

      const result = await verifyTaskOutput(task, output);
      setRun(task.id, { status:"done", result, duration: Date.now()-start });
      await ctx.close();
    } catch(e: any) {
      setRun(task.id, { status:"error", error:String(e), duration:Date.now()-start });
    }
  }

  async function handleOracle(task: BenchmarkTask, file: File) {
    setRun(task.id, { status:"running", result:null });
    const start = Date.now();
    try {
      const ab  = await file.arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(ab);
      const oracle = await runOracle(task, buf);
      setRun(task.id, {
        status:"done", result:oracle.verifierResult,
        duration:Date.now()-start
      });
      await ctx.close();
    } catch(e: any) {
      setRun(task.id, { status:"error", error:String(e), duration:Date.now()-start });
    }
  }

  // Stats
  const allRuns = Object.values(runs);
  const done    = allRuns.filter(r=>r.status==="done"&&r.result);
  const passed  = done.filter(r=>r.result?.passed);
  const avgScore = done.length>0
    ? done.reduce((s,r)=>s+(r.result?.score??0),0)/done.length : 0;

  const filtered = BENCH_TASKS.filter(t =>
    filter==="all" ? true : t.category===filter || t.difficulty===filter
  );

  return (
    <div style={{height:"100%",overflow:"auto",background:"#020608",
      fontFamily:"'JetBrains Mono',monospace",color:"#a0c4cc",padding:16}}>

      {/* Header */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:9,color:"#2a6a8a",letterSpacing:3,marginBottom:4}}>
          AIVORA AUDIO BENCH
        </div>
        <div style={{fontSize:18,fontWeight:700,color:"#E2EEF6",letterSpacing:-0.5}}>
          Forensic Audio Benchmark System
        </div>
        <div style={{fontSize:10,color:"#4a6a7a",marginTop:4}}>
          Verifier-backed • Deterministic • ITU-R BS.1770-4 • SHA-256 reproducibility
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {label:"Total Tasks",  value:BENCH_TASKS.length,        color:"#0EA5E9"},
          {label:"Completed",    value:done.length,               color:"#8B5CF6"},
          {label:"Passed",       value:passed.length,             color:"#10B981"},
          {label:"Pass Rate",    value:done.length>0?`${Math.round(passed.length/done.length*100)}%`:"—", color:"#F59E0B"},
          {label:"Avg Score",    value:done.length>0?avgScore.toFixed(0):"—",  color:"#22d3ee"},
        ].map(({label,value,color})=>(
          <div key={label} style={{
            background:"#050d18",border:`1px solid ${color}30`,
            borderTop:`2px solid ${color}`,borderRadius:8,
            padding:"10px 14px",minWidth:90,
          }}>
            <div style={{fontSize:18,fontWeight:700,color}}>{value}</div>
            <div style={{fontSize:8,color:"#4a6a7a",letterSpacing:1}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {["all","easy","medium","hard","expert",
          "silence_repair","hum_removal","speech_preservation"].map(f=>(
          <div key={f} onClick={()=>setFilter(f)}
            style={{fontSize:8,padding:"3px 8px",borderRadius:4,cursor:"pointer",
              background:filter===f?"#0EA5E922":"transparent",
              color:filter===f?"#0EA5E9":"#2a5a6a",
              border:`1px solid ${filter===f?"#0EA5E9":"#1a3a5a"}`}}>
            {f}
          </div>
        ))}
      </div>

      {/* Tasks */}
      {filtered.map(task=>(
        <TaskCard key={task.id} run={runs[task.id]}
          onRun={handleSubmit} onOracle={handleOracle}/>
      ))}

      {/* Footer */}
      <div style={{marginTop:16,padding:"10px 0",borderTop:"1px solid #0a1520",
        fontSize:8,color:"#1a3a5a",letterSpacing:1}}>
        AIVORA AUDIO BENCH v1.0 · VERIFIER v1.0.0 · ITU-R BS.1770-4 · SHA-256
      </div>
    </div>
  );
}
