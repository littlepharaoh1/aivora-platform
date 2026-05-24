import React from "react";
import { useConsensusLog } from "../hooks/useQAIntelligence";

export default function ConsensusPanel() {
  const { data, loading, refresh } = useConsensusLog(100);

  const escalated = data.filter(r => r.escalated).length;
  const agreed    = data.filter(r =>
    !r.escalated && r.consensus_score && Number(r.consensus_score) >= 0.7
  ).length;

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)",
        gap:12, marginBottom:12 }}>
        {[
          { label:"Total",     value:data.length, color:"#22d3ee" },
          { label:"Agreed",    value:agreed,       color:"#22c55e" },
          { label:"Escalated", value:escalated,
            color:escalated > 0 ? "#ef4444" : "#6b7280" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background:"#0d1117",
            border:"1px solid #1f2937", borderRadius:8,
            padding:"12px 16px", textAlign:"center" }}>
            <div style={{ fontSize:28, fontWeight:900, color }}>{value}</div>
            <div style={{ fontSize:11, color:"#9ca3af" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:8 }}>
        <span style={{ fontSize:12, color:"#9ca3af" }}>
          Consensus Log — last {data.length} entries
        </span>
        <button onClick={refresh}
          style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
            border:"1px solid #1f2937", background:"transparent",
            color:"#6b7280", cursor:"pointer" }}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ color:"#4b5563", fontSize:12, padding:24,
          textAlign:"center" }}>Loading consensus log...</div>
      ) : data.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, padding:32,
          textAlign:"center", border:"1px dashed #1f2937",
          borderRadius:8 }}>No consensus records yet</div>
      ) : (
        data.map(row => (
          <div key={row.id} style={{ background:"#0d1117",
            border:`1px solid ${row.escalated ? "#2a0a0a" : "#1f2937"}`,
            borderRadius:6, padding:"8px 12px", marginBottom:6 }}>
            <div style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center" }}>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                {row.escalated && (
                  <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3,
                    background:"#ef444422", color:"#ef4444",
                    border:"1px solid #ef444444" }}>ESCALATED</span>
                )}
                <span style={{ fontSize:12,
                  color: row.verdict==="AUTHENTIC" ? "#22c55e"
                       : row.verdict==="SUSPICIOUS" ? "#f59e0b" : "#9ca3af" }}>
                  {row.verdict ?? "PENDING"}
                </span>
                {row.reviewer_count !== null && (
                  <span style={{ fontSize:10, color:"#6b7280" }}>
                    {row.reviewer_count} reviewer
                    {row.reviewer_count !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                {row.consensus_score !== null && (
                  <span style={{ fontSize:11, fontWeight:700,
                    color:Number(row.consensus_score) >= 0.7
                      ? "#22c55e" : "#f59e0b" }}>
                    {(Number(row.consensus_score) * 100).toFixed(0)}% consensus
                  </span>
                )}
                <span style={{ fontSize:10, color:"#374151" }}>
                  {row.created_at.slice(0,16).replace("T"," ")}
                </span>
              </div>
            </div>
            {row.audio_file_id && (
              <div style={{ fontSize:9, color:"#374151", marginTop:4 }}>
                file: {row.audio_file_id.slice(0,8)}…
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
