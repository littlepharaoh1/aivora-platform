import React from "react";
import type { RuntimeSnapshot } from "./hooks/useRuntimeState";

function Card({ title, children }: { title:string; children:React.ReactNode }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
        letterSpacing:1, textTransform:"uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, color="#e5e7eb" }:
  { label:string; value:React.ReactNode; color?:string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between",
      alignItems:"center", padding:"4px 0", borderBottom:"1px solid #111827" }}>
      <span style={{ fontSize:11, color:"#9ca3af" }}>{label}</span>
      <span style={{ fontSize:12, color, fontWeight:600 }}>{value}</span>
    </div>
  );
}

export default function RuntimeOverviewPanel({ snap }: { snap: RuntimeSnapshot }) {
  const healthColor = snap.session_health > 0.7 ? "#22c55e"
                    : snap.session_health > 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <Card title="Execution Context">
        <Row label="Execution Mode"   value={snap.execution_mode}
          color={snap.execution_mode==="DESKTOP_ULTRA"?"#22c55e":
                 snap.execution_mode==="LOW_MEMORY"?"#ef4444":"#3b82f6"} />
        <Row label="Policy FPS"       value={`${snap.target_fps} fps`} />
        <Row label="Active Workers"   value={`${snap.active_workers} / ${snap.max_workers}`} />
        <Row label="Queue Depth"      value={snap.queue_depth} />
        <Row label="Similarity"       value={snap.similarity_enabled ? "✅ ON" : "❌ OFF"} />
        <Row label="Analytics"        value={snap.analytics_enabled  ? "✅ ON" : "❌ OFF"} />
      </Card>

      <Card title="GPU + Compute">
        <Row label="GPU Tier"         value={snap.gpu_tier}
          color={snap.gpu_tier==="WEBGPU_FULL"?"#22c55e":
                 snap.gpu_tier==="CPU_ONLY"?"#ef4444":"#f59e0b"} />
        <Row label="Active Backend"   value={snap.gpu_backend} />
        <Row label="Context Lost"     value={snap.gpu_context_lost?"⚠️ YES":"✅ NO"}
          color={snap.gpu_context_lost?"#ef4444":"#22c55e"} />
        <Row label="SAB Available"    value={snap.sab_available?"✅ YES":"❌ NO"}
          color={snap.sab_available?"#22c55e":"#ef4444"} />
        <Row label="SAB Slots"        value={`${snap.sab_active_slots} / ${snap.sab_total_slots}`} />
        {snap.gpu_adapter && <Row label="Adapter" value={snap.gpu_adapter.slice(0,24)} />}
      </Card>

      <Card title="Memory">
        <Row label="Heap Used"        value={`${snap.heap_used_mb} MB`} />
        <Row label="Heap Limit"       value={`${snap.heap_limit_mb} MB`} />
        <Row label="Soft Ceiling"     value={`${snap.memory_ceiling_mb} MB`} />
        <Row label="Memory Pressure"
          value={`${Math.round(snap.memory_pressure*100)}%`}
          color={snap.memory_pressure>0.85?"#ef4444":snap.memory_pressure>0.65?"#f59e0b":"#22c55e"} />
      </Card>

      <Card title="Session Health">
        <Row label="Health Score"
          value={`${Math.round(snap.session_health*100)}%`}
          color={healthColor} />
        <Row label="Status"
          value={snap.session_degraded ? "⚠️ DEGRADED" : "✅ HEALTHY"}
          color={snap.session_degraded ? "#ef4444" : "#22c55e"} />
        <Row label="Overall Pressure"
          value={`${Math.round(snap.overall_pressure*100)}%`}
          color={snap.overall_pressure>0.85?"#ef4444":snap.overall_pressure>0.65?"#f59e0b":"#22c55e"} />
      </Card>
    </div>
  );
}
