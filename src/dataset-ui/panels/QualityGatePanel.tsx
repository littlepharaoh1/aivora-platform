import React from "react";
import { useQualityGates } from "../hooks/useDatasetFactory";

export default function QualityGatePanel() {
  const { gates, loading, refresh } = useQualityGates();

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:12, color:"#9ca3af" }}>
          {gates.length} quality gates · threshold-based · no ML
        </span>
        <button onClick={refresh}
          style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
            border:"1px solid #1f2937", background:"transparent",
            color:"#6b7280", cursor:"pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center", padding:24 }}>
          Loading quality gates...
        </div>
      ) : gates.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center", padding:32,
          border:"1px dashed #1f2937", borderRadius:8 }}>
          No quality gates configured.
          Create one via the Quality Gate API.
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {gates.map(gate => (
            <div key={gate.id} style={{ background:"#0d1117",
              border:`1px solid ${gate.is_active?"#166534":"#1f2937"}`,
              borderRadius:8, padding:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                marginBottom:8 }}>
                <span style={{ fontSize:13, color:"#e5e7eb", fontWeight:600 }}>
                  {gate.gate_name}
                </span>
                <span style={{ fontSize:10, padding:"2px 6px", borderRadius:3,
                  background: gate.is_active ? "#052e1644":"#1f293744",
                  color:      gate.is_active ? "#22c55e":"#6b7280" }}>
                  {gate.is_active ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
              {gate.project_name && (
                <div style={{ fontSize:10, color:"#6b7280", marginBottom:8 }}>
                  Project: {gate.project_name}
                </div>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                {[
                  ["Min QC Score",    gate.min_qc_score],
                  ["Min Duration",    `${gate.min_duration_sec}s`],
                  ["Max Duration",    `${gate.max_duration_sec}s`],
                  ["Min SNR",         `${gate.min_snr_db}dB`],
                  ["Min Consensus",   `${Math.round(gate.min_reviewer_consensus*100)}%`],
                  ["Reject Synthetic",gate.reject_synthetic?"YES":"NO"],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ fontSize:10,
                    padding:"3px 0", borderBottom:"1px solid #111827" }}>
                    <span style={{ color:"#6b7280" }}>{label}: </span>
                    <span style={{ color:"#22d3ee" }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
