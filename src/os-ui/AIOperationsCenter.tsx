/**
 * AIOperationsCenter.tsx — Unified AI Operations Center
 * Aivora Platform — Phase 15.5
 *
 * Fixes applied:
 * ✅ useQASummary hoisted to parent — single fetch
 * ✅ useRuntimeState single instance at parent level
 * ✅ Lazy panels with Suspense boundaries
 * ✅ READ-ONLY — no runtime control
 * ✅ No duplicate polling loops
 */

import React, { useState, lazy, Suspense } from "react";
import { useRuntimeState } from "../runtime-ui/hooks/useRuntimeState";
import { useQASummary }    from "../qa-ui/hooks/useQAIntelligence";
import type { RuntimeSnapshot } from "../runtime-ui/hooks/useRuntimeState";
import type { QASummary }       from "../qa-ui/hooks/useQAIntelligence";

// ── Lazy panels ───────────────────────────────────────────────────────────────
const RuntimeControlCenter          = lazy(() => import("../runtime-ui/RuntimeControlCenter"));
const AnalyticsDashboard            = lazy(() => import("../analytics-ui/AnalyticsDashboard"));
const SpeechIntelligenceWorkstation = lazy(() => import("../speech-ui/SpeechIntelligenceWorkstation"));
const DatasetFactoryWorkstation     = lazy(() => import("../dataset-ui/DatasetFactoryWorkstation"));
const QAIntelligenceWorkstation     = lazy(() => import("../qa-ui/QAIntelligenceWorkstation"));
const MultimodalWorkstation         = lazy(() => import("../multimodal-ui/MultimodalWorkstation"));

const SECTIONS = [
  { id:"overview",   label:"OS Overview",     icon:"🌐" },
  { id:"runtime",    label:"Runtime Center",  icon:"⚡" },
  { id:"analytics",  label:"Analytics",       icon:"📊" },
  { id:"speech",     label:"Speech Intel",    icon:"🎤" },
  { id:"dataset",    label:"Dataset Factory", icon:"🏭" },
  { id:"qa",         label:"QA Intel",        icon:"👥" },
  { id:"multimodal", label:"Multimodal",      icon:"🖼️" },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

function Loading() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:300, color:"#4b5563", fontSize:12 }}>
      Loading module...
    </div>
  );
}

// ── OS Status Bar — receives props, no internal polling ───────────────────────

function OSStatusBar({ snap, summary }:
  { snap:RuntimeSnapshot; summary:QASummary | null }) {
  const healthColor = snap.session_health > 0.7 ? "#22c55e"
                    : snap.session_health > 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)",
      gap:1, background:"#1f2937" }}>
      {[
        { label:"OS Health",
          value:`${Math.round(snap.session_health*100)}%`,
          color:healthColor },
        { label:"GPU Backend",
          value:snap.gpu_backend,
          color:snap.gpu_context_lost?"#ef4444":"#22c55e" },
        { label:"Workers",
          value:`${snap.active_workers}/${snap.max_workers}`,
          color:snap.worker_pressure>0.8?"#ef4444":"#22d3ee" },
        { label:"Memory",
          value:`${snap.heap_used_mb}MB`,
          color:snap.memory_pressure>0.8?"#ef4444":"#22d3ee" },
        { label:"SAB",
          value:snap.sab_available?"ON":"OFF",
          color:snap.sab_available?"#22c55e":"#6b7280" },
        { label:"Policy",
          value:snap.execution_mode.replace("DESKTOP_","").replace("_"," "),
          color:"#22d3ee" },
        { label:"Reviews",
          value:summary?.total_reviews.toLocaleString() ?? "—",
          color:"#9ca3af" },
        { label:"Pending",
          value:String(summary?.pending_tasks ?? "—"),
          color:(summary?.pending_tasks ?? 0) > 50 ? "#f59e0b":"#9ca3af" },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ background:"#0a0f1a", padding:"8px 10px" }}>
          <div style={{ fontSize:13, fontWeight:700, color }}>{value}</div>
          <div style={{ fontSize:9, color:"#4b5563" }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── OS Overview Panel — receives snap as prop ─────────────────────────────────

function OSOverviewPanel({ snap }: { snap:RuntimeSnapshot }) {
  const tiers = [
    { tier:"Tier 0-1", label:"Core + QA",        status:"✅" },
    { tier:"Tier 2",   label:"DSP Runtime",       status:"✅" },
    { tier:"Tier 3",   label:"Routing + Offline", status:"✅" },
    { tier:"Tier 4",   label:"Observability",     status:"✅" },
    { tier:"Tier 5",   label:"Runtime Scheduler",
      status:snap.execution_mode!=="LOW_MEMORY"?"✅":"⚠️" },
    { tier:"Tier 6A",  label:"GPU Runtime",
      status:snap.gpu_context_lost?"⚠️":"✅" },
    { tier:"Tier 6B",  label:"AI Inference",      status:"✅" },
    { tier:"Tier 7",   label:"Dataset Factory",   status:"✅" },
    { tier:"Tier 8",   label:"Speech Intel",      status:"✅" },
    { tier:"Tier 14",  label:"Multimodal AI",     status:"✅" },
    { tier:"Tier 15",  label:"AI OS Layer",       status:"✅" },
  ];

  return (
    <div>
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:16, marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:12,
          textTransform:"uppercase", letterSpacing:1 }}>
          Platform Tier Status
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
          {tiers.map(t => (
            <div key={t.tier} style={{ background:"#111827", borderRadius:6,
              padding:"10px 12px", display:"flex",
              justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:11, color:"#e5e7eb", fontWeight:600 }}>
                  {t.tier}
                </div>
                <div style={{ fontSize:9, color:"#6b7280" }}>{t.label}</div>
              </div>
              <span style={{ fontSize:16 }}>{t.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:16 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:12,
          textTransform:"uppercase", letterSpacing:1 }}>
          Runtime Snapshot
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
          {[
            { label:"Execution Mode",
              value:snap.execution_mode,
              color:snap.execution_mode==="DESKTOP_ULTRA"?"#22c55e":"#f59e0b" },
            { label:"GPU Pressure",
              value:`${Math.round(snap.gpu_pressure*100)}%`,
              color:snap.gpu_pressure>0.8?"#ef4444":"#22c55e" },
            { label:"Memory Pressure",
              value:`${Math.round(snap.memory_pressure*100)}%`,
              color:snap.memory_pressure>0.8?"#ef4444":"#22c55e" },
            { label:"Session Health",
              value:`${Math.round(snap.session_health*100)}%`,
              color:snap.session_health>0.7?"#22c55e":
                    snap.session_health>0.4?"#f59e0b":"#ef4444" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:"#111827", borderRadius:6,
              padding:"12px 14px", textAlign:"center" }}>
              <div style={{ fontSize:20, fontWeight:900, color }}>{value}</div>
              <div style={{ fontSize:9, color:"#6b7280", marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component — single polling source ────────────────────────────────────

export default function AIOperationsCenter() {
  const [active, setActive] = useState<SectionId>("overview");

  // ✅ Fix: single polling source at top level — passed as props
  const snap            = useRuntimeState(2000);
  const { summary }     = useQASummary();

  return (
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>

      {/* OS Header */}
      <div style={{ padding:"14px 20px 10px", borderBottom:"1px solid #1f2937",
        background:"#050810" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:18, fontWeight:900, color:"#22d3ee",
            letterSpacing:2 }}>AIVORA AI OS</span>
          <span style={{ fontSize:10, color:"#374151" }}>
            Enterprise AI Infrastructure Operating System
          </span>
          <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            {["DETERMINISTIC","BOUNDED","OBSERVABLE","REPLAY-SAFE"].map(label => (
              <div key={label} style={{ fontSize:8, padding:"2px 6px",
                borderRadius:3, border:"1px solid #22c55e44",
                color:"#22c55e", background:"#22c55e11" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ✅ Fix: snap + summary passed as props — no internal polling */}
      <OSStatusBar snap={snap} summary={summary} />

      {/* Navigation */}
      <div style={{ display:"flex", borderBottom:"1px solid #1f2937",
        background:"#0d1117", overflowX:"auto" }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActive(s.id)}
            style={{ padding:"10px 16px", border:"none", cursor:"pointer",
              background:"transparent", whiteSpace:"nowrap", fontSize:11,
              color:active===s.id?"#22d3ee":"#6b7280",
              borderBottom:active===s.id
                ?"2px solid #22d3ee":"2px solid transparent",
              display:"flex", alignItems:"center", gap:5 }}>
            <span>{s.icon}</span><span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* ✅ Fix: snap passed as prop to OSOverviewPanel */}
      <div style={{ padding:16 }}>
        <Suspense fallback={<Loading />}>
          {active === "overview"   && <OSOverviewPanel snap={snap} />}
          {active === "runtime"    && <RuntimeControlCenter />}
          {active === "analytics"  && <AnalyticsDashboard />}
          {active === "speech"     && <SpeechIntelligenceWorkstation />}
          {active === "dataset"    && <DatasetFactoryWorkstation />}
          {active === "qa"         && <QAIntelligenceWorkstation />}
          {active === "multimodal" && <MultimodalWorkstation />}
        </Suspense>
      </div>
    </div>
  );
}
