import React from "react";
import { useFraudHeatmap } from "../hooks/useAnalyticsData";

const RISK_COLOR: Record<string,string> = {
  HIGH:   "#ef4444",
  MEDIUM: "#f59e0b",
  LOW:    "#22c55e",
};

export default function FraudHeatmapChart() {
  const { data, loading } = useFraudHeatmap();

  if(loading) return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, height:220, display:"flex",
      alignItems:"center", justifyContent:"center", color:"#4b5563", fontSize:11 }}>
      Loading fraud data...
    </div>
  );

  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>
          Reviewer Fraud Heatmap
        </span>
        <span style={{ fontSize:9, color:"#4b5563" }}>src: fraud_heatmap · advisory only</span>
      </div>

      {data.length === 0 ? (
        <div style={{ color:"#6b7280", fontSize:11, textAlign:"center", padding:20 }}>
          No reviewer data available
        </div>
      ) : (
        <div>
          <div style={{ display:"grid",
            gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",
            gap:4, marginBottom:6, padding:"4px 8px" }}>
            {["Reviewer","Reviews","Accuracy","Consensus","Fraud Flags","Risk"].map(h => (
              <span key={h} style={{ fontSize:9, color:"#6b7280",
                textTransform:"uppercase", letterSpacing:0.5 }}>{h}</span>
            ))}
          </div>
          {data.map(row => {
            const risk = row.fraud_risk_level ?? "LOW";
            return (
              <div key={row.reviewer_email}
                style={{ display:"grid",
                  gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",
                  gap:4, padding:"6px 8px", borderRadius:4, marginBottom:2,
                  background:risk==="HIGH"?"#1a0505":risk==="MEDIUM"?"#1a0f00":"transparent",
                  border:`1px solid ${risk==="HIGH"?"#2a0a0a":risk==="MEDIUM"?"#2a1800":"#111827"}`,
                }}>
                <span style={{ fontSize:11, color:"#e5e7eb" }}>
                  {row.reviewer_name || row.reviewer_email?.split("@")[0] || "—"}
                </span>
                <span style={{ fontSize:11, color:"#9ca3af" }}>{row.total_reviews}</span>
                <span style={{ fontSize:11,
                  color:Number(row.accuracy_score)>=0.8?"#22c55e":
                        Number(row.accuracy_score)>=0.6?"#f59e0b":"#ef4444" }}>
                  {row.accuracy_score}
                </span>
                <span style={{ fontSize:11, color:"#9ca3af" }}>{row.consensus_score}</span>
                <span style={{ fontSize:11,
                  color:row.fraud_flags_count>0?"#ef4444":"#22c55e" }}>
                  {row.fraud_flags_count}
                </span>
                <span style={{ fontSize:11, fontWeight:700,
                  color:RISK_COLOR[risk]??"#6b7280" }}>
                  {risk}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize:9, color:"#4b5563", marginTop:8 }}>
            Advisory only — no automatic actions
          </div>
        </div>
      )}
    </div>
  );
}
