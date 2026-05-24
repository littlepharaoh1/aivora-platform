import React, { useState } from "react";
import { useDatasetVersions } from "../hooks/useDatasetFactory";

const STATUS_COLOR: Record<string,string> = {
  draft:      "#6b7280",
  validating: "#f59e0b",
  validated:  "#22c55e",
  published:  "#3b82f6",
  failed:     "#ef4444",
};

export default function VersionsPanel() {
  const { versions, loading, refresh } = useDatasetVersions();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:12, color:"#9ca3af" }}>
          {versions.length} versions · append-only · immutable snapshots
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
          Loading dataset versions...
        </div>
      ) : versions.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center", padding:32,
          border:"1px dashed #1f2937", borderRadius:8 }}>
          No dataset versions yet.
          Create one via the Dataset Runtime API.
        </div>
      ) : (
        versions.map(v => (
          <div key={v.id} style={{ background:"#0d1117",
            border:`1px solid ${expanded===v.id?"#22d3ee33":"#1f2937"}`,
            borderRadius:8, marginBottom:8, overflow:"hidden" }}>

            {/* Header row */}
            <div style={{ display:"flex", alignItems:"center", gap:12,
              padding:"10px 14px", cursor:"pointer" }}
              onClick={() => setExpanded(expanded===v.id ? null : v.id)}>
              <span style={{ fontSize:11, color:"#6b7280" }}>
                {expanded===v.id ? "▼" : "▶"}
              </span>
              <span style={{ fontSize:13, color:"#e5e7eb", fontWeight:600 }}>
                v{v.version_number}
              </span>
              <span style={{ fontSize:11, color:"#6b7280" }}>{v.project_name}</span>
              <span style={{ flex:1 }} />
              <span style={{ fontSize:10, padding:"2px 6px", borderRadius:3,
                background:(STATUS_COLOR[v.status]??"#6b7280")+"22",
                color:STATUS_COLOR[v.status]??"#6b7280",
                border:`1px solid ${(STATUS_COLOR[v.status]??"#6b7280")}44` }}>
                {v.status}
              </span>
              <span style={{ fontSize:11, color:"#6b7280" }}>
                {v.total_files.toLocaleString()} files
              </span>
              <span style={{ fontSize:10, color:"#374151" }}>
                {v.created_at.slice(0,10)}
              </span>
            </div>

            {/* Expanded details */}
            {expanded === v.id && (
              <div style={{ padding:"0 14px 12px",
                borderTop:"1px solid #1f2937" }}>
                <div style={{ display:"grid",
                  gridTemplateColumns:"repeat(3,1fr)", gap:8, marginTop:10 }}>
                  {[
                    ["Protocol",   v.version_protocol],
                    ["Split Seed", v.split_seed],
                    ["Train",      `${Math.round(v.split_train_ratio*100)}%`],
                    ["Val",        `${Math.round(v.split_val_ratio*100)}%`],
                    ["Test",       `${Math.round(v.split_test_ratio*100)}%`],
                    ["Duration",   `${v.total_duration_sec?.toFixed(0) ?? 0}s`],
                  ].map(([label, value]) => (
                    <div key={label as string} style={{ fontSize:11 }}>
                      <span style={{ color:"#6b7280" }}>{label}: </span>
                      <span style={{ color:"#22d3ee" }}>{value}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:10, padding:8, background:"#111827",
                  borderRadius:4, fontSize:9, color:"#4b5563",
                  wordBreak:"break-all" }}>
                  checksum: {v.snapshot_checksum}
                </div>
                <div style={{ marginTop:6, fontSize:9, color:"#374151" }}>
                  id: {v.id}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
