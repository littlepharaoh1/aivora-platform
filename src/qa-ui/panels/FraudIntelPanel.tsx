import React from "react";
import { useFraudHeatmap } from "../../analytics-ui/hooks/useAnalyticsData";

const RISK_COLOR: Record<string,string> = {
  HIGH:"#ef4444", MEDIUM:"#f59e0b", LOW:"#22c55e",
};

export default function FraudIntelPanel() {
  const { data, loading, refresh } = useFraudHeatmap();

  const high   = data.filter(r => r.fraud_risk_level === "HIGH").length;
  const medium = data.filter(r => r.fraud_risk_level === "MEDIUM").length;
  const low    = data.filter(r => r.fraud_risk_level === "LOW").length;

  return (
    <div>
      <div style={{ background:"#1a0505", border:"1px solid #2a0a0a",
        borderRadius:8, padding:12, marginBottom:12, fontSize:11,
        color:"#f87171" }}>
        ⚠ Fraud intelligence is ADVISORY ONLY.
        No automatic actions are taken based on these signals.
        All evidence must be reviewed by a human supervisor before any action.
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
        gap:12, marginBottom:12 }}>
        {[
          { label:"HIGH Risk",   value:high,   color:"#ef4444" },
          { label:"MEDIUM Risk", value:medium, color:"#f59e0b" },
          { label:"LOW Risk",    value:low,    color:"#22c55e" },
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
          Reviewer Risk Analysis (src: fraud_heatmap)
        </span>
        <button onClick={refresh}
          style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
            border:"1px solid #1f2937", background:"transparent",
            color:"#6b7280", cursor:"pointer" }}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ color:"#4b5563", fontSize:12, padding:24,
          textAlign:"center" }}>Loading fraud intelligence...</div>
      ) : data.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, padding:32,
          textAlign:"center", border:"1px dashed #1f2937",
          borderRadius:8 }}>No reviewer data available</div>
      ) : (
        data.map(row => {
          const risk = row.fraud_risk_level ?? "LOW";
          // Fix: safe toFixed on possibly-null value
          const disagRate = Number(row.disagreement_rate_pct ?? 0).toFixed(1);

          return (
            <div key={row.reviewer_email}
              style={{ background: risk==="HIGH" ? "#1a050566"
                                 : risk==="MEDIUM" ? "#1a0f0044" : "#0d1117",
                border:`1px solid ${risk==="HIGH" ? "#2a0a0a"
                                   : risk==="MEDIUM" ? "#2a1800" : "#1f2937"}`,
                borderRadius:8, padding:"12px 14px", marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"flex-start", marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:13, color:"#e5e7eb", fontWeight:600 }}>
                    {row.reviewer_name || row.reviewer_email?.split("@")[0] || "—"}
                  </div>
                  <div style={{ fontSize:10, color:"#4b5563" }}>
                    {row.reviewer_email}
                  </div>
                </div>
                <span style={{ fontSize:12, fontWeight:900,
                  color:RISK_COLOR[risk] ?? "#6b7280",
                  padding:"2px 10px", borderRadius:4,
                  background:(RISK_COLOR[risk] ?? "#6b7280")+"22",
                  border:`1px solid ${(RISK_COLOR[risk] ?? "#6b7280")}44` }}>
                  {risk} RISK
                </span>
              </div>

              <div style={{ display:"grid",
                gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                {[
                  { label:"Total Reviews", value:row.total_reviews,
                    color:"#9ca3af" },
                  { label:"Fraud Flags",   value:row.fraud_flags_count,
                    color:row.fraud_flags_count > 0 ? "#ef4444" : "#22c55e" },
                  { label:"Accuracy",      value:row.accuracy_score,
                    color:Number(row.accuracy_score)>=0.8?"#22c55e":"#f59e0b" },
                  { label:"Disagree %",    value:`${disagRate}%`,
                    color:Number(disagRate)>30?"#f59e0b":"#9ca3af" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background:"#111827",
                    borderRadius:4, padding:"6px 8px" }}>
                    <div style={{ fontSize:14, fontWeight:700, color }}>
                      {value}
                    </div>
                    <div style={{ fontSize:9, color:"#4b5563" }}>{label}</div>
                  </div>
                ))}
              </div>

              {risk !== "LOW" && (
                <div style={{ marginTop:8, fontSize:10, color:"#6b7280" }}>
                  ⚠ Advisory signal only.
                  Requires supervisor review before any action.
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
