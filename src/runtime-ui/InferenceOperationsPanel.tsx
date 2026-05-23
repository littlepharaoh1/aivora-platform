import React from "react";
import type { RuntimeSnapshot } from "./hooks/useRuntimeState";
import { INFERENCE_ROUTES } from "../lib/ai/inferenceScheduler";
import { modelRegistry } from "../lib/models/modelRegistry";
import { DECODER_GOVERNANCE } from "../lib/transcription/greedyDecoder";
import { INFERENCE_PROTOCOL_VERSION } from "../lib/transcription/asrTypes";

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

export default function InferenceOperationsPanel({ snap }: { snap: RuntimeSnapshot }) {
  const models = modelRegistry.listAll();

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <Card title="ASR Decoder Governance">
          <Row label="Strategy"    value={DECODER_GOVERNANCE.strategy.toUpperCase()}
            color="#22d3ee" />
          <Row label="Temperature" value={String(DECODER_GOVERNANCE.temperature)}
            color="#22c55e" />
          <Row label="Beam Size"   value="null (greedy only)" color="#22c55e" />
          <Row label="Top-K"       value="null (disabled)"    color="#22c55e" />
          <Row label="Top-P"       value="null (disabled)"    color="#22c55e" />
          <Row label="RNG Seed"    value="null (deterministic)" color="#22c55e" />
          <Row label="Protocol"    value={INFERENCE_PROTOCOL_VERSION} />
        </Card>

        <Card title="Active GPU Backend">
          <Row label="Compute"     value={snap.gpu_backend}
            color={snap.gpu_backend==="WEBGPU"?"#22c55e":"#f59e0b"} />
          <Row label="GPU Tier"    value={snap.gpu_tier} />
          <Row label="Context Lost"value={snap.gpu_context_lost?"⚠️ YES":"✅ NO"}
            color={snap.gpu_context_lost?"#ef4444":"#22c55e"} />
          <Row label="SAB Fast Path"value={snap.sab_available?"✅ Enabled":"❌ Fallback"}
            color={snap.sab_available?"#22c55e":"#f59e0b"} />
        </Card>
      </div>

      <Card title="Model Registry">
        {models.map(m => (
          <div key={m.id} style={{ display:"flex", justifyContent:"space-between",
            alignItems:"center", padding:"6px 0", borderBottom:"1px solid #111827" }}>
            <div>
              <span style={{ fontSize:12, color:"#e5e7eb" }}>{m.name}</span>
              <span style={{ fontSize:10, color:"#6b7280", marginLeft:8 }}>
                v{m.version} · {m.quantization}
              </span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <span style={{ fontSize:10, color:"#3b82f6" }}>{m.task}</span>
              <span style={{ fontSize:10,
                color:m.memory.weightsMB<=2?"#22c55e":m.memory.weightsMB<=10?"#f59e0b":"#ef4444" }}>
                {m.memory.weightsMB}MB
              </span>
            </div>
          </div>
        ))}
      </Card>

      <Card title="Inference Routes (Deterministic)">
        {Object.entries(INFERENCE_ROUTES).map(([task, route]) => (
          <div key={task} style={{ display:"flex", justifyContent:"space-between",
            padding:"4px 0", borderBottom:"1px solid #111827" }}>
            <span style={{ fontSize:11, color:"#9ca3af" }}>{task}</span>
            <span style={{ fontSize:11, color:"#22d3ee" }}>{route.preferred_runtime}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
