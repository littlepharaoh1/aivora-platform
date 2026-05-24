import React from "react";
import { useRecentQCReviews, useTaskAssignments }
  from "../hooks/useQAIntelligence";

const STATUS_COLOR: Record<string,string> = {
  pending:   "#f59e0b",
  completed: "#22c55e",
  skipped:   "#6b7280",
  escalated: "#ef4444",
};

export default function ReviewQueuePanel() {
  const { data:reviews, loading:rLoading, refresh } = useRecentQCReviews(50);
  const { data:tasks }  = useTaskAssignments(50);

  const pending   = tasks.filter(t => t.status === "pending").length;
  const completed = tasks.filter(t => t.status === "completed").length;

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
        gap:12, marginBottom:12 }}>
        {[
          { label:"Pending Tasks", value:pending,        color:"#f59e0b" },
          { label:"Completed",     value:completed,      color:"#22c55e" },
          { label:"Total Reviews", value:reviews.length, color:"#22d3ee" },
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
        <span style={{ fontSize:12, color:"#9ca3af" }}>Recent QC Reviews</span>
        <button onClick={refresh}
          style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
            border:"1px solid #1f2937", background:"transparent",
            color:"#6b7280", cursor:"pointer" }}>↻ Refresh</button>
      </div>

      {rLoading ? (
        <div style={{ color:"#4b5563", fontSize:12, padding:24,
          textAlign:"center" }}>Loading reviews...</div>
      ) : reviews.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, padding:32,
          textAlign:"center", border:"1px dashed #1f2937",
          borderRadius:8 }}>No reviews yet</div>
      ) : (
        reviews.map(r => (
          <div key={r.id} style={{ background:"#0d1117",
            border:"1px solid #1f2937", borderRadius:6,
            padding:"8px 12px", marginBottom:4 }}>
            <div style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center" }}>
              <div style={{ display:"flex", gap:10 }}>
                {r.verdict && (
                  <span style={{ fontSize:11, fontWeight:600,
                    color: r.verdict==="AUTHENTIC" ? "#22c55e"
                         : r.verdict==="SUSPICIOUS" ? "#f59e0b" : "#ef4444" }}>
                    {r.verdict}
                  </span>
                )}
                {r.qc_score !== null && (
                  <span style={{ fontSize:11,
                    color: Number(r.qc_score) >= 70 ? "#22c55e"
                         : Number(r.qc_score) >= 50 ? "#f59e0b" : "#ef4444" }}>
                    QC: {r.qc_score}
                  </span>
                )}
                {r.status && (
                  <span style={{ fontSize:10,
                    color:STATUS_COLOR[r.status] ?? "#6b7280" }}>
                    {r.status}
                  </span>
                )}
              </div>
              <div style={{ display:"flex", gap:10 }}>
                {r.review_time_sec !== null && (
                  <span style={{ fontSize:10, color:"#6b7280" }}>
                    {r.review_time_sec}s
                  </span>
                )}
                <span style={{ fontSize:10, color:"#374151" }}>
                  {r.created_at.slice(0,16).replace("T"," ")}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
