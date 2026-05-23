/**
 * RuntimeControlCenter.tsx — Enterprise Runtime Control Center
 * Aivora Platform — Phase 9
 *
 * READ-ONLY runtime observability surface.
 * All metrics from authoritative Tier 5 + 6A + 6B infrastructure.
 * No fake values. No simulated data.
 */

import React, { useState, lazy, Suspense } from "react";
import { useRuntimeState } from "./hooks/useRuntimeState";

const RuntimeOverviewPanel      = lazy(() => import("./RuntimeOverviewPanel"));
const GPUOperationsPanel        = lazy(() => import("./GPUOperationsPanel"));
const WorkerPoolInspector       = lazy(() => import("./WorkerPoolInspector"));
const MemoryGovernancePanel     = lazy(() => import("./MemoryGovernancePanel"));
const InferenceOperationsPanel  = lazy(() => import("./InferenceOperationsPanel"));
const SessionSurvivabilityPanel = lazy(() => import("./SessionSurvivabilityPanel"));

const TABS = [
  { id:"overview",     label:"Overview",     icon:"⚡" },
  { id:"gpu",          label:"GPU",          icon:"🎮" },
  { id:"workers",      label:"Workers",      icon:"⚙️" },
  { id:"memory",       label:"Memory",       icon:"💾" },
  { id:"inference",    label:"AI/Inference", icon:"🧠" },
  { id:"session",      label:"Session",      icon:"💓" },
] as const;

type TabId = typeof TABS[number]["id"];

function PressureBar({ value, label }: { value:number; label:string }) {
  const color = value > 0.85 ? "#ef4444" : value > 0.65 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
        <span style={{ fontSize:10, color:"#9ca3af" }}>{label}</span>
        <span style={{ fontSize:10, color }}>
          {Math.round(value * 100)}%
        </span>
      </div>
      <div style={{ height:4, background:"#1f2937", borderRadius:2 }}>
        <div style={{ width:`${value*100}%`, height:"100%",
          background:color, borderRadius:2, transition:"width 0.5s" }} />
      </div>
    </div>
  );
}

function StatusBadge({ value, good="✅", bad="❌" }:
  { value:boolean; good?:string; bad?:string }) {
  return <span>{value ? good : bad}</span>;
}

function LoadingPanel() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"#4b5563", fontSize:13 }}>
      Loading panel...
    </div>
  );
}

export default function RuntimeControlCenter() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const snap = useRuntimeState(1000);

  const modeColor = snap.execution_mode === "DESKTOP_ULTRA"    ? "#22c55e"
                  : snap.execution_mode === "DESKTOP_BALANCED" ? "#3b82f6"
                  : snap.execution_mode === "MOBILE_SAFE"      ? "#f59e0b"
                  : "#ef4444";

  return (
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>

      {/* Header */}
      <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:16, fontWeight:700, color:"#22d3ee",
            letterSpacing:1 }}>AIVORA RUNTIME CONTROL CENTER</span>
          <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4,
            background:modeColor+"22", color:modeColor, border:`1px solid ${modeColor}44` }}>
            {snap.execution_mode}
          </span>
          {snap.session_degraded && (
            <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4,
              background:"#ef444422", color:"#ef4444", border:"1px solid #ef444444" }}>
              ⚠ DEGRADED
            </span>
          )}
        </div>
        <div style={{ fontSize:10, color:"#6b7280", marginTop:4 }}>
          Last updated: {new Date(snap.sampled_at).toLocaleTimeString()}
          {" · "}Workers: {snap.active_workers}/{snap.max_workers}
          {" · "}Queue: {snap.queue_depth}
          {" · "}GPU: {snap.gpu_backend}
          {" · "}SAB: {snap.sab_available ? "✅" : "❌"}
        </div>
      </div>

      {/* Quick Status Bar */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
        gap:1, background:"#1f2937", borderBottom:"1px solid #1f2937" }}>
        {[
          { label:"Overall Pressure", value:snap.overall_pressure },
          { label:"Memory Pressure",  value:snap.memory_pressure  },
          { label:"Worker Pressure",  value:snap.worker_pressure  },
          { label:"GPU Pressure",     value:snap.gpu_pressure     },
        ].map(({ label, value }) => (
          <div key={label} style={{ background:"#0a0f1a", padding:"8px 12px" }}>
            <PressureBar value={value} label={label} />
          </div>
        ))}
      </div>

      {/* Tab Bar */}
      <div style={{ display:"flex", borderBottom:"1px solid #1f2937",
        background:"#0d1117", overflowX:"auto" }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding:"10px 16px", border:"none", cursor:"pointer",
              background:"transparent", whiteSpace:"nowrap",
              color: activeTab === tab.id ? "#22d3ee" : "#6b7280",
              borderBottom: activeTab === tab.id
                ? "2px solid #22d3ee" : "2px solid transparent",
              fontSize:12, display:"flex", alignItems:"center", gap:6,
            }}>
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Panel Content */}
      <div style={{ padding:16 }}>
        <Suspense fallback={<LoadingPanel />}>
          {activeTab === "overview"  && <RuntimeOverviewPanel snap={snap} />}
          {activeTab === "gpu"       && <GPUOperationsPanel snap={snap} />}
          {activeTab === "workers"   && <WorkerPoolInspector snap={snap} />}
          {activeTab === "memory"    && <MemoryGovernancePanel snap={snap} />}
          {activeTab === "inference" && <InferenceOperationsPanel snap={snap} />}
          {activeTab === "session"   && <SessionSurvivabilityPanel snap={snap} />}
        </Suspense>
      </div>
    </div>
  );
}
