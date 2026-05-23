import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useReviewerThroughput } from "../hooks/useAnalyticsData";
import type { TimeWindow } from "../hooks/useAnalyticsData";

export default function ReviewerThroughputChart({ window }: { window:TimeWindow }) {
  const { data, loading } = useReviewerThroughput(window);

  if(loading) return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, height:220, display:"flex",
      alignItems:"center", justifyContent:"center", color:"#4b5563", fontSize:11 }}>
      Loading reviewer data...
    </div>
  );

  // Aggregate daily total reviews
  const byDate = new Map<string,number>();
  for(const row of data) {
    byDate.set(row.review_date,
      (byDate.get(row.review_date) ?? 0) + Number(row.reviews_completed));
  }
  const chartData = Array.from(byDate.entries())
    .map(([date, reviews]) => ({ date:date.slice(5), reviews }))
    .sort((a,b) => a.date.localeCompare(b.date));

  // Top reviewers by total
  const reviewerTotals = new Map<string,number>();
  for(const row of data) {
    reviewerTotals.set(row.reviewer_name,
      (reviewerTotals.get(row.reviewer_name) ?? 0) + Number(row.reviews_completed));
  }
  const topReviewers = Array.from(reviewerTotals.entries())
    .sort((a,b) => b[1]-a[1]).slice(0, 5);

  return (
    <div>
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14, marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>
            Daily Review Volume
          </span>
          <span style={{ fontSize:9, color:"#4b5563" }}>src: reviewer_throughput_daily</span>
        </div>
        {chartData.length === 0 ? (
          <div style={{ color:"#6b7280", fontSize:11, textAlign:"center", padding:20 }}>
            No reviewer data in window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" stroke="#4b5563" tick={{ fontSize:9 }} />
              <YAxis stroke="#4b5563" tick={{ fontSize:9 }} />
              <Tooltip contentStyle={{ background:"#0d1117",
                border:"1px solid #1f2937", fontSize:11, color:"#e5e7eb" }} />
              <Line type="monotone" dataKey="reviews" stroke="#22d3ee"
                dot={false} strokeWidth={2} name="Reviews" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {topReviewers.length > 0 && (
        <div style={{ background:"#0d1117", border:"1px solid #1f2937",
          borderRadius:8, padding:14 }}>
          <div style={{ fontSize:11, color:"#6b7280", marginBottom:8,
            textTransform:"uppercase", letterSpacing:1 }}>Top Reviewers</div>
          {topReviewers.map(([name, count], i) => (
            <div key={name} style={{ display:"flex", justifyContent:"space-between",
              padding:"5px 0", borderBottom:"1px solid #111827" }}>
              <span style={{ fontSize:11, color:"#9ca3af" }}>
                {i+1}. {name}
              </span>
              <span style={{ fontSize:12, color:"#22d3ee", fontWeight:700 }}>
                {count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
