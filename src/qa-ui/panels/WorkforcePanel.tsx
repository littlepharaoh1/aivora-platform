import React from "react";
import { useReviewers } from "../hooks/useQAIntelligence";
import { useFraudHeatmap, useReviewerThroughput }
  from "../../analytics-ui/hooks/useAnalyticsData";

const STATUS_COLOR: Record<string,string> = {
  active:    "#22c55e",
  inactive:  "#6b7280",
  suspended: "#ef4444",
};

const RISK_COLOR: Record<string,string> = {
  HIGH:"#ef4444", MEDIUM:"#f59e0b", LOW:"#22c55e",
};

export default function WorkforcePanel() {
  const { data:reviewers, loading, refresh } = useReviewers();
  const { data:fraud  }  = useFraudHeatmap();
  const { data:throughput} = useReviewerThroughput("30d");

  const fraudMap = new Map(fraud.map(f => [f.reviewer_email, f]));

  const throughputMap = new Map<string,number>();
  for(const t of throughput) {
    throughputMap.set(t.reviewer_name,
      (throughputMap.get(t.reviewer_name) ?? 0) + Number(t.reviews_completed));
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:12, color:"#9ca3af" }}>
          {reviewers.length} reviewers · advisory scoring · no automatic actions
        </span>
        <button onClick={refresh}
          style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
            border:"1px solid #1f2937", background:"transparent",
            color:"#6b7280", cursor:"pointer" }}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center",
          padding:24 }}>Loading workforce data...</div>
      ) : reviewers.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center",
          padding:32, border:"1px dashed #1f2937", borderRadius:8 }}>
          No reviewers in system
        </div>
      ) : (
        <div>
          <div style={{ display:"grid",
            gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",
            gap:4, padding:"6px 12px", marginBottom:4 }}>
            {["Reviewer","Status","Tier","Reviews (30d)","Accuracy","Risk"].map(h => (
              <span key={h} style={{ fontSize:9, color:"#6b7280",
                textTransform:"uppercase", letterSpacing:0.5 }}>{h}</span>
            ))}
          </div>

          {reviewers.map(r => {
            const f   = fraudMap.get(r.email);
            const thr = throughputMap.get(r.name) ?? 0;
            const risk = f?.fraud_risk_level ?? "LOW";
            return (
              <div key={r.id} style={{ display:"grid",
                gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",
                gap:4, padding:"8px 12px", marginBottom:4, borderRadius:6,
                background: risk==="HIGH" ? "#1a050522"
                          : risk==="MEDIUM" ? "#1a0f0022" : "#0d1117",
                border:`1px solid ${risk==="HIGH" ? "#2a0a0a"
                                   : risk==="MEDIUM" ? "#2a1800" : "#1f2937"}` }}>
                <div>
                  <div style={{ fontSize:12, color:"#e5e7eb" }}>
                    {r.name || "—"}
                  </div>
                  <div style={{ fontSize:9, color:"#4b5563" }}>{r.email}</div>
                </div>
                <span style={{ fontSize:11, alignSelf:"center",
                  color:STATUS_COLOR[r.status] ?? "#6b7280" }}>
                  {r.status}
                </span>
                <span style={{ fontSize:11, color:"#6b7280", alignSelf:"center" }}>
                  {r.tier ?? "—"}
                </span>
                <span style={{ fontSize:12, color:"#22d3ee",
                  fontWeight:700, alignSelf:"center" }}>
                  {thr.toLocaleString()}
                </span>
                <span style={{ fontSize:11, alignSelf:"center",
                  color: Number(f?.accuracy_score) >= 0.8 ? "#22c55e"
                       : Number(f?.accuracy_score) >= 0.6 ? "#f59e0b" : "#6b7280" }}>
                  {f?.accuracy_score ?? "—"}
                </span>
                <span style={{ fontSize:11, fontWeight:700, alignSelf:"center",
                  color:RISK_COLOR[risk] ?? "#6b7280" }}>
                  {risk}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize:9, color:"#374151", marginTop:8 }}>
            Risk scores advisory only · No automatic actions taken
          </div>
        </div>
      )}
    </div>
  );
}
