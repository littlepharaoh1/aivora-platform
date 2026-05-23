import React from "react";
import type { RuntimeSnapshot } from "./hooks/useRuntimeState";
import { getGPUCapabilitiesSync } from "../gpu/gpuCapabilities";
import { getFallbackChain } from "../gpu/gpuFallbacks";

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

export default function GPUOperationsPanel({ snap }: { snap: RuntimeSnapshot }) {
  const caps  = getGPUCapabilitiesSync();
  const chain = getFallbackChain(snap.gpu_tier as any);

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <Card title="GPU Capabilities">
        <Row label="GPU Tier"        value={snap.gpu_tier}
          color={snap.gpu_tier==="WEBGPU_FULL"?"#22c55e":"#f59e0b"} />
        <Row label="Active Backend"  value={snap.gpu_backend} />
        <Row label="WebGPU"          value={caps?.has_webgpu ?"✅":"❌"}
          color={caps?.has_webgpu?"#22c55e":"#ef4444"} />
        <Row label="WebGL2"          value={caps?.has_webgl2 ?"✅":"❌"}
          color={caps?.has_webgl2?"#22c55e":"#ef4444"} />
        <Row label="F16 Support"     value={caps?.supports_f16?"✅":"❌"} />
        <Row label="Context Lost"    value={snap.gpu_context_lost?"⚠️ YES":"✅ NO"}
          color={snap.gpu_context_lost?"#ef4444":"#22c55e"} />
        <Row label="Software Raster" value={caps?.is_software_rasterizer?"⚠️ YES":"✅ NO"}
          color={caps?.is_software_rasterizer?"#f59e0b":"#22c55e"} />
        {snap.gpu_adapter && <Row label="Adapter"  value={snap.gpu_adapter.slice(0,28)} />}
        {caps?.adapter_vendor && <Row label="Vendor" value={caps.adapter_vendor.slice(0,28)} />}
      </Card>

      <Card title="Fallback Chain">
        <div style={{ marginBottom:8 }}>
          {chain.map((backend, i) => (
            <div key={backend} style={{ display:"flex", alignItems:"center",
              gap:8, padding:"6px 0", borderBottom:"1px solid #111827" }}>
              <span style={{ fontSize:11,
                color: snap.gpu_backend === backend ? "#22d3ee" :
                       i === 0 ? "#22c55e" : "#6b7280",
                fontWeight: snap.gpu_backend === backend ? 700 : 400 }}>
                {snap.gpu_backend === backend ? "▶ " : `${i+1}. `}
                {backend}
              </span>
              {snap.gpu_backend === backend && (
                <span style={{ fontSize:9, color:"#22d3ee",
                  background:"#22d3ee11", padding:"1px 4px", borderRadius:3 }}>
                  ACTIVE
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize:10, color:"#4b5563", marginTop:8 }}>
          VRAM: Not measurable in browser
          (proxy via texture pressure)
        </div>
        <Row label="GPU Pressure"
          value={`${Math.round(snap.gpu_pressure*100)}%`}
          color={snap.gpu_pressure>0.85?"#ef4444":snap.gpu_pressure>0.65?"#f59e0b":"#22c55e"} />
      </Card>
    </div>
  );
}
