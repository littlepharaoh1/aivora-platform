import React from "react";
import type { RuntimeSnapshot } from "./hooks/useRuntimeState";
import { sharedMemoryPool } from "../gpu/sharedMemoryPool";
import { TENSOR_LIMITS, getActiveTensorCount } from "../lib/ai/tensorMemory";

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
      padding:"4px 0", borderBottom:"1px solid #111827" }}>
      <span style={{ fontSize:11, color:"#9ca3af" }}>{label}</span>
      <span style={{ fontSize:12, color, fontWeight:600 }}>{value}</span>
    </div>
  );
}

export default function MemoryGovernancePanel({ snap }: { snap: RuntimeSnapshot }) {
  const sabConf      = sharedMemoryPool.getConfig();
  const activeTensors= getActiveTensorCount();
  const sabMB        = (sabConf.slot_count * sabConf.slot_floats * 4) / (1024*1024);

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <Card title="JS Heap">
        <Row label="Used"          value={`${snap.heap_used_mb} MB`} />
        <Row label="Limit"         value={`${snap.heap_limit_mb} MB`} />
        <Row label="Soft Ceiling"  value={`${snap.memory_ceiling_mb} MB`} />
        <Row label="Pressure"
          value={`${Math.round(snap.memory_pressure*100)}%`}
          color={snap.memory_pressure>0.85?"#ef4444":snap.memory_pressure>0.65?"#f59e0b":"#22c55e"} />
      </Card>

      <Card title="Shared Memory (SAB)">
        <Row label="Available"     value={snap.sab_available?"✅ YES":"❌ NO"}
          color={snap.sab_available?"#22c55e":"#ef4444"} />
        <Row label="Total Size"    value={`${sabMB.toFixed(1)} MB`} />
        <Row label="Active Slots"  value={`${snap.sab_active_slots} / ${snap.sab_total_slots}`} />
        <Row label="Slot Size"     value={`${(sabConf.slot_floats*4/1024/1024).toFixed(1)} MB each`} />
      </Card>

      <Card title="Tensor Memory">
        <Row label="Active Tensors"   value={`${activeTensors} / ${TENSOR_LIMITS.MAX_TENSOR_COUNT}`} />
        <Row label="Max Tensor Size"  value={`${TENSOR_LIMITS.MAX_TENSOR_BYTES/1024/1024} MB`} />
        <Row label="Max Frame"        value={`${(TENSOR_LIMITS.MAX_FRAME_SAMPLES/16000).toFixed(0)}s at 16kHz`} />
      </Card>

      <Card title="Governance Thresholds">
        <Row label="Soft Pressure"    value="65%" />
        <Row label="Hard Pressure"    value="85%" />
        <Row label="Eviction Trigger" value="Hard limit reached" />
        <Row label="Recovery"         value="LOD + Spectrogram eviction" />
      </Card>
    </div>
  );
}
