import React from "react";
import { PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { useForensicVerdicts } from "../hooks/useAnalyticsData";
import type { TimeWindow } from "../hooks/useAnalyticsData";

const COLORS: Record<string,string> = {
  AUTHENTIC:  "#22c55e",
  SUSPICIOUS: "#f59e0b",
  SYNTHETIC:  "#ef4444",
  PENDING:    "#6b7280",
};

export default function ForensicVerdictChart(
  { window, compact=false }: { window:TimeWindow; compact?:boolean }
) {
  const { data, loading } = useForensicVerdicts(window);

  if(loading) return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937", borderRadius:8,
      padding:14, height:compact?150:220, display:"flex", alignItems:"center",
      justifyContent:"center", color:"#4b5563", fontSize:11 }}>
      Loading verdict data...
    </div>
  );

  // Aggregate by verdict
  const verdictMap = new Map<string, number>();
  for(const row of data) {
    verdictMap.set(row.forensic_verdict,
      (verdictMap.get(row.forensic_verdict) ?? 0) + Number(row.file_count));
  }
  const pieData = Array.from(verdictMap.entries()).map(([name, value]) => ({ name, value }));
  const total   = pieData.reduce((s,d) => s+d.value, 0);

  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>
          Forensic Verdict Distribution
        </span>
        <span style={{ fontSize:9, color:"#4b5563" }}>src: forensic_verdict_distribution</span>
      </div>

      {total === 0 ? (
        <div style={{ color:"#6b7280", fontSize:11, textAlign:"center", padding:20 }}>
          No verdict data in window
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={compact ? 100 : 160}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%"
                innerRadius={compact?25:35} outerRadius={compact?50:65}
                dataKey="value" paddingAngle={2}>
                {pieData.map((entry) => (
                  <Cell key={entry.name}
                    fill={COLORS[entry.name] ?? "#3b82f6"} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background:"#0d1117",
                border:"1px solid #1f2937", fontSize:11, color:"#e5e7eb" }} />
              {!compact && <Legend wrapperStyle={{ fontSize:10 }} />}
            </PieChart>
          </ResponsiveContainer>
          {!compact && (
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
              {pieData.map(d => (
                <div key={d.name} style={{ fontSize:10 }}>
                  <span style={{ color:COLORS[d.name]??"#3b82f6" }}>●</span>
                  {" "}{d.name}: <span style={{ color:"#e5e7eb" }}>
                    {d.value} ({Math.round(d.value/total*100)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
