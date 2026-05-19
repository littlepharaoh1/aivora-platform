// @ts-nocheck
/**
 * ObservabilityDashboard.tsx — Runtime Observability UI
 * Aivora Audio Infrastructure Platform
 *
 * Displays:
 * - DSP stage timing (profiler metrics)
 * - Worker health (heartbeat + RTT)
 * - Render telemetry (RAF FPS + drop rate)
 * - GC pressure
 * - Benchmark corpus runner
 * - Validation suite runner
 */
import React, { useState, useEffect, useCallback } from "react";
import { dspProfiler } from "../lib/dsp/observability/dspProfiler";
import { renderTelemetry } from "../lib/dsp/observability/renderTelemetry";
import { workerMonitor } from "../lib/dsp/observability/workerMonitor";
import { validationSuite } from "../lib/dsp/referenceValidation/dspValidationSuite";
import { benchmarkRunner } from "../lib/dsp/referenceValidation/benchmarkCorpus";

const COLORS = {
  pass:    "#10B981",
  fail:    "#EF4444",
  warn:    "#F59E0B",
  info:    "#0EA5E9",
  purple:  "#8B5CF6",
  muted:   "#4a6a7a",
  bg:      "#050d18",
  border:  "#0f2030",
};

function MetricCard({ label, value, unit = "", color = COLORS.info, sub = "" }: {
  label: string; value: string|number; unit?: string; color?: string; sub?: string;
}) {
  return (
    <div style={{ background:COLORS.bg, border:`1px solid ${color}30`,
      borderTop:`2px solid ${color}`, borderRadius:8, padding:"10px 14px", minWidth:100 }}>
      <div style={{ fontSize:18, fontWeight:700, color }}>{value}<span style={{fontSize:10,color:COLORS.muted}}> {unit}</span></div>
      <div style={{ fontSize:8, color:COLORS.muted, letterSpacing:1 }}>{label}</div>
      {sub && <div style={{ fontSize:8, color:COLORS.muted, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const c = status==="healthy"?COLORS.pass:status==="degraded"?COLORS.warn:COLORS.fail;
  return <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:c, marginRight:6 }}/>;
}

export default function ObservabilityDashboard() {
  const [tab,          setTab]          = useState<"profiler"|"workers"|"render"|"validation"|"benchmark">("profiler");
  const [profilerSnap, setProfilerSnap] = useState<ReturnType<typeof dspProfiler.exportSnapshot>|null>(null);
  const [renderSnap,   setRenderSnap]   = useState<ReturnType<typeof renderTelemetry.exportSnapshot>|null>(null);
  const [workerSnap,   setWorkerSnap]   = useState<ReturnType<typeof workerMonitor.exportSnapshot>|null>(null);
  const [validResult,  setValidResult]  = useState<any>(null);
  const [benchResult,  setBenchResult]  = useState<any>(null);
  const [running,      setRunning]      = useState(false);
  const [benchProgress, setBenchProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProfilerSnap(dspProfiler.exportSnapshot());
      setRenderSnap(renderTelemetry.exportSnapshot());
      setWorkerSnap(workerMonitor.exportSnapshot());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const runValidation = useCallback(async () => {
    setRunning(true);
    const result = await validationSuite.run();
    setValidResult(result);
    setRunning(false);
  }, []);

  const runBenchmark = useCallback(async () => {
    setRunning(true);
    setBenchProgress(0);
    const result = await benchmarkRunner.runAll((pct) => setBenchProgress(pct));
    setBenchResult(result);
    setRunning(false);
  }, []);

  const tabs = ["profiler","workers","render","validation","benchmark"] as const;

  return (
    <div style={{ height:"100%", overflow:"auto", background:"#020608",
      fontFamily:"'JetBrains Mono',monospace", color:"#a0c4cc", padding:16 }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:9, color:"#2a6a8a", letterSpacing:3, marginBottom:4 }}>DSP OBSERVABILITY</div>
        <div style={{ fontSize:18, fontWeight:700, color:"#E2EEF6" }}>Runtime Dashboard</div>
        <div style={{ fontSize:10, color:COLORS.muted, marginTop:2 }}>
          Live telemetry · Worker health · Render metrics · Validation suite
        </div>
      </div>

      {/* GC Pressure Banner */}
      {profilerSnap?.gc && !profilerSnap.gc.estimated && profilerSnap.gc.heapPressure > 0.7 && (
        <div style={{ background:"#EF444415", border:"1px solid #EF444440",
          borderRadius:6, padding:"6px 12px", marginBottom:12,
          fontSize:9, color:"#EF4444" }}>
          ⚠ High GC pressure: {Math.round(profilerSnap.gc.heapPressure*100)}% heap used
          ({profilerSnap.gc.usedJSHeapMB}MB / {profilerSnap.gc.totalJSHeapMB}MB)
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
        {tabs.map(t => (
          <div key={t} onClick={()=>setTab(t)}
            style={{ padding:"5px 12px", borderRadius:6, cursor:"pointer",
              fontSize:9, fontWeight:700, letterSpacing:1, textTransform:"uppercase",
              background:tab===t?"#0EA5E922":"transparent",
              color:tab===t?"#0EA5E9":COLORS.muted,
              border:`1px solid ${tab===t?"#0EA5E9":"#1a3a5a"}` }}>
            {t}
          </div>
        ))}
      </div>

      {/* ── Profiler Tab ── */}
      {tab==="profiler" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <MetricCard label="Active Stages" value={profilerSnap?.stages?.length??0} color={COLORS.info}/>
            <MetricCard label="Total Dropped" value={profilerSnap?.totalDropped??0} color={COLORS.fail}/>
            <MetricCard label="Heap Used" value={profilerSnap?.gc?.usedJSHeapMB??0} unit="MB" color={COLORS.purple}/>
            <MetricCard label="Pressure" value={profilerSnap?.gc?.estimated?"N/A":Math.round((profilerSnap?.gc?.heapPressure??0)*100)+"%"} color={COLORS.warn}/>
          </div>

          {profilerSnap?.stages && profilerSnap.stages.length > 0 ? (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {profilerSnap.stages.map((s: any) => (
                <div key={s.stage} style={{ background:COLORS.bg, border:`1px solid ${COLORS.border}`,
                  borderLeft:`3px solid ${s.p95>16?"#EF4444":s.p95>8?"#F59E0B":"#10B981"}`,
                  borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:"#E2EEF6" }}>{s.stage}</div>
                    <div style={{ display:"flex", gap:8 }}>
                      {[
                        {l:"mean", v:`${s.mean}ms`},
                        {l:"p95",  v:`${s.p95}ms`},
                        {l:"p99",  v:`${s.p99}ms`},
                        {l:"dropped", v:s.dropped},
                        {l:"count", v:s.count},
                      ].map(({l,v})=>(
                        <span key={l} style={{ fontSize:8, padding:"2px 6px", borderRadius:4,
                          background:"#0a1520", color:COLORS.muted }}>
                          {l}: <span style={{color:"#E2EEF6"}}>{v}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign:"center", padding:40, color:COLORS.muted, fontSize:10 }}>
              No DSP stages profiled yet. Process audio files to see telemetry.
            </div>
          )}
        </div>
      )}

      {/* ── Workers Tab ── */}
      {tab==="workers" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <MetricCard label="All Healthy" value={workerSnap?.allHealthy?"YES":"NO"}
              color={workerSnap?.allHealthy?COLORS.pass:COLORS.fail}/>
            <MetricCard label="Workers" value={workerSnap?.workers?.length??0} color={COLORS.info}/>
            <MetricCard label="Unresponsive" value={workerSnap?.workers?.filter((w:any)=>w.status==="unresponsive").length??0} color={COLORS.fail}/>
            <MetricCard label="Crashed" value={workerSnap?.workers?.filter((w:any)=>w.status==="crashed").length??0} color={COLORS.fail}/>
          </div>

          {workerSnap?.workers && workerSnap.workers.length > 0 ? (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {workerSnap.workers.map((w: any) => (
                <div key={w.type} style={{ background:COLORS.bg,
                  border:`1px solid ${COLORS.border}`, borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <StatusDot status={w.status}/>
                    <span style={{ fontSize:11, fontWeight:700, color:"#E2EEF6" }}>{w.type}</span>
                    <span style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
                      background:`${w.status==="healthy"?COLORS.pass:COLORS.fail}20`,
                      color:w.status==="healthy"?COLORS.pass:COLORS.fail }}>
                      {w.status}
                    </span>
                    {[
                      {l:"RTT", v:`${w.rttMs}ms`},
                      {l:"P95", v:`${w.rttP95Ms}ms`},
                      {l:"msgs", v:w.messageCount},
                      {l:"crashes", v:w.crashCount},
                    ].map(({l,v})=>(
                      <span key={l} style={{ fontSize:8, padding:"2px 6px",
                        borderRadius:4, background:"#0a1520", color:COLORS.muted }}>
                        {l}: <span style={{color:"#E2EEF6"}}>{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign:"center", padding:40, color:COLORS.muted, fontSize:10 }}>
              No workers registered yet. Workers appear here when active.
            </div>
          )}
        </div>
      )}

      {/* ── Render Tab ── */}
      {tab==="render" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <MetricCard label="RAF FPS" value={renderSnap?.rafFps?.toFixed(1)??0} unit="fps"
              color={(renderSnap?.rafFps??0)>55?COLORS.pass:(renderSnap?.rafFps??0)>30?COLORS.warn:COLORS.fail}/>
            <MetricCard label="RAF Drop Rate" value={Math.round((renderSnap?.rafDropRate??0)*100)+"%"}
              color={(renderSnap?.rafDropRate??0)<0.05?COLORS.pass:COLORS.warn}/>
            <MetricCard label="GPU" value={renderSnap?.gpuAvailable?"Available":"N/A"}
              color={renderSnap?.gpuAvailable?COLORS.pass:COLORS.muted}/>
            <MetricCard label="Total Dropped" value={renderSnap?.totalDropped??0} color={COLORS.fail}/>
          </div>

          {renderSnap?.stages && renderSnap.stages.length > 0 ? (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {renderSnap.stages.map((s: any) => (
                <div key={s.stage} style={{ background:COLORS.bg,
                  border:`1px solid ${COLORS.border}`,
                  borderLeft:`3px solid ${s.p95Ms>16?"#EF4444":s.p95Ms>8?"#F59E0B":"#10B981"}`,
                  borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                    <span style={{ fontSize:10, fontWeight:700, color:"#E2EEF6" }}>{s.stage}</span>
                    <div style={{ display:"flex", gap:8 }}>
                      {[
                        {l:"fps",  v:`${s.fps}`},
                        {l:"mean", v:`${s.meanMs}ms`},
                        {l:"p95",  v:`${s.p95Ms}ms`},
                        {l:"dropped", v:s.droppedFrames},
                      ].map(({l,v})=>(
                        <span key={l} style={{ fontSize:8, padding:"2px 6px",
                          borderRadius:4, background:"#0a1520", color:COLORS.muted }}>
                          {l}: <span style={{color:"#E2EEF6"}}>{v}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign:"center", padding:40, color:COLORS.muted, fontSize:10 }}>
              No render stages active. Open Pro Editor or QC Workstation to see metrics.
            </div>
          )}
        </div>
      )}

      {/* ── Validation Tab ── */}
      {tab==="validation" && (
        <div>
          <button onClick={runValidation} disabled={running}
            style={{ marginBottom:16, padding:"10px 20px", borderRadius:8, border:"none",
              background:running?"#1a3a5a":"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
              color:"#fff", fontSize:11, fontWeight:700, cursor:running?"not-allowed":"pointer",
              fontFamily:"inherit" }}>
            {running?"⟳ Running...":"▶ Run DSP Validation Suite"}
          </button>

          {validResult && (
            <div>
              <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
                <MetricCard label="Pass Rate" value={Math.round(validResult.passRate*100)+"%"}
                  color={validResult.passRate>=0.9?COLORS.pass:COLORS.fail}/>
                <MetricCard label="Passed" value={validResult.totalPass} color={COLORS.pass}/>
                <MetricCard label="Failed" value={validResult.totalFail} color={COLORS.fail}/>
                <MetricCard label="Duration" value={validResult.durationMs} unit="ms" color={COLORS.info}/>
              </div>

              {validResult.groups.map((g: any) => (
                <div key={g.group} style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:COLORS.info, letterSpacing:2, marginBottom:6 }}>
                    {g.group} — {g.passed}/{g.passed+g.failed} passed ({g.durationMs}ms)
                  </div>
                  {g.results.map((r: any) => (
                    <div key={r.name} style={{ display:"flex", alignItems:"center", gap:8,
                      padding:"5px 10px", borderRadius:6, marginBottom:3,
                      background:r.status==="pass"?"#10B98110":"#EF444410",
                      border:`1px solid ${r.status==="pass"?"#10B98130":"#EF444430"}` }}>
                      <span style={{ fontSize:10, color:r.status==="pass"?COLORS.pass:COLORS.fail }}>
                        {r.status==="pass"?"✓":r.status==="skip"?"○":"✗"}
                      </span>
                      <span style={{ fontSize:9, color:"#E2EEF6", flex:1 }}>{r.name}</span>
                      <span style={{ fontSize:8, color:COLORS.muted }}>{r.durationMs}ms</span>
                      {r.status!=="pass" && r.message && (
                        <span style={{ fontSize:8, color:COLORS.fail }}>{r.message.slice(0,60)}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Benchmark Tab ── */}
      {tab==="benchmark" && (
        <div>
          <button onClick={runBenchmark} disabled={running}
            style={{ marginBottom:12, padding:"10px 20px", borderRadius:8, border:"none",
              background:running?"#1a3a5a":"linear-gradient(135deg,#F59E0B,#EF4444)",
              color:"#fff", fontSize:11, fontWeight:700, cursor:running?"not-allowed":"pointer",
              fontFamily:"inherit" }}>
            {running?`⟳ Running... ${benchProgress}%`:"⚡ Run Benchmark Corpus"}
          </button>

          {running && (
            <div style={{ height:4, background:"#0a1520", borderRadius:2, marginBottom:12, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${benchProgress}%`,
                background:"linear-gradient(90deg,#F59E0B,#EF4444)", transition:"width 0.3s" }}/>
            </div>
          )}

          {benchResult && (
            <div>
              <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
                <MetricCard label="Total Score" value={benchResult.totalScore+"/100"}
                  color={benchResult.totalScore>=80?COLORS.pass:benchResult.totalScore>=60?COLORS.warn:COLORS.fail}/>
                <MetricCard label="Passed" value={benchResult.passed} color={COLORS.pass}/>
                <MetricCard label="Failed" value={benchResult.failed} color={COLORS.fail}/>
                <MetricCard label="Duration" value={benchResult.durationMs} unit="ms" color={COLORS.info}/>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {benchResult.results.map((r: any) => (
                  <div key={r.id} style={{ background:COLORS.bg,
                    border:`1px solid ${r.passed?"#10B98130":"#EF444430"}`,
                    borderLeft:`3px solid ${r.passed?COLORS.pass:COLORS.fail}`,
                    borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between",
                      alignItems:"center", flexWrap:"wrap", gap:8 }}>
                      <div>
                        <div style={{ fontSize:10, fontWeight:700, color:"#E2EEF6" }}>
                          {r.id} — {r.name}
                        </div>
                        <div style={{ fontSize:8, color:COLORS.muted, marginTop:2 }}>
                          {r.category} · {r.durationMs}ms
                          {r.failReason && ` · ${r.failReason}`}
                        </div>
                      </div>
                      <div style={{ fontSize:16, fontWeight:700,
                        color:r.score>=80?COLORS.pass:r.score>=60?COLORS.warn:COLORS.fail }}>
                        {r.score}/100
                      </div>
                    </div>
                    {r.metrics && (
                      <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap" }}>
                        {Object.entries(r.metrics).map(([k,v]: [string,any]) => (
                          <span key={k} style={{ fontSize:8, padding:"2px 6px",
                            borderRadius:4, background:"#0a1520", color:COLORS.muted }}>
                            {k}: <span style={{color:"#E2EEF6"}}>{typeof v==="number"?v.toLocaleString():v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
