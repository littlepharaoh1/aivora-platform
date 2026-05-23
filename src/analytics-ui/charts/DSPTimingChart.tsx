import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import { useDSPTiming } from "../hooks/useAnalyticsData";
import type { TimeWindow } from "../hooks/useAnalyticsData";

function ChartCard({ title, children, source }:
  { title:string; children:React.ReactNode; source?:string }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>{title}</span>
        {source && <span style={{ fontSize:9, color:"#4b5563" }}>src: {source}</span>}
      </div>
      {children}
    </div>
  );
}

export default function DSPTimingChart(
  { window, compact=false }: { window:TimeWindow; compact?:boolean }
) {
  const { data, loading, error } = useDSPTiming(window);

  if(loading) return (
    <div style={{ height:compact?120:200, display:"flex", alignItems:"center",
      justifyContent:"center", color:"#4b5563", fontSize:11 }}>
      Loading DSP timing...
    </div>
  );

  if(error || data.length === 0) return (
    <ChartCard title="DSP Execution Timing" source="dsp_execution_timing">
      <div style={{ color:"#6b7280", fontSize:11, textAlign:"center", padding:20 }}>
        {error ?? "No data in selected window"}
      </div>
    </ChartCard>
  );

  // Aggregate by date for chart
  const byDate = new Map<string, { date:string; avg:number; p95:number; timeouts:number }>();
  for(const row of data) {
    const existing = byDate.get(row.execution_date);
    if(!existing) {
      byDate.set(row.execution_date, {
        date:     row.execution_date.slice(5),
        avg:      Math.round(Number(row.avg_duration_ms)),
        p95:      Number(row.p95_duration_ms),
        timeouts: Number(row.timeout_count),
      });
    }
  }
  const chartData = Array.from(byDate.values());

  return (
    <ChartCard title="DSP Execution Timing" source="dsp_execution_timing">
      <ResponsiveContainer width="100%" height={compact ? 120 : 200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" stroke="#4b5563" tick={{ fontSize:9 }} />
          <YAxis stroke="#4b5563" tick={{ fontSize:9 }} />
          <Tooltip contentStyle={{ background:"#0d1117", border:"1px solid #1f2937",
            fontSize:11, color:"#e5e7eb" }} />
          {!compact && <Legend wrapperStyle={{ fontSize:10 }} />}
          <Line type="monotone" dataKey="avg" stroke="#22d3ee" dot={false}
            name="Avg ms" strokeWidth={2} />
          <Line type="monotone" dataKey="p95" stroke="#f59e0b" dot={false}
            name="P95 ms" strokeWidth={1} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
      {!compact && (
        <div style={{ display:"flex", gap:16, marginTop:8 }}>
          {[
            { label:"Total Spans",    value:data.reduce((s,r)=>s+Number(r.total_spans),0).toLocaleString() },
            { label:"Avg Duration",   value:`${Math.round(data.reduce((s,r)=>s+Number(r.avg_duration_ms),0)/Math.max(1,data.length))}ms` },
            { label:"Total Timeouts", value:data.reduce((s,r)=>s+Number(r.timeout_count),0) },
          ].map(({ label, value }) => (
            <div key={label} style={{ fontSize:10, color:"#9ca3af" }}>
              {label}: <span style={{ color:"#22d3ee" }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
