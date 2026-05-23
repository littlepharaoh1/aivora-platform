import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useQueueRetry } from "../hooks/useAnalyticsData";
import type { TimeWindow } from "../hooks/useAnalyticsData";

export default function QueueRetryChart(
  { window, compact=false }: { window:TimeWindow; compact?:boolean }
) {
  const { data, loading } = useQueueRetry(window);

  if(loading) return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, height:compact?150:220,
      display:"flex", alignItems:"center", justifyContent:"center",
      color:"#4b5563", fontSize:11 }}>
      Loading queue data...
    </div>
  );

  const byDate = new Map<string,{
    date:string; completed:number; failed:number; dlq:number
  }>();
  for(const row of data) {
    const ex = byDate.get(row.job_date);
    if(!ex) {
      byDate.set(row.job_date, {
        date:      row.job_date.slice(5),
        completed: Number(row.completed_jobs),
        failed:    Number(row.failed_jobs),
        dlq:       Number(row.dlq_jobs),
      });
    } else {
      ex.completed += Number(row.completed_jobs);
      ex.failed    += Number(row.failed_jobs);
      ex.dlq       += Number(row.dlq_jobs);
    }
  }
  const chartData = Array.from(byDate.values())
    .sort((a,b) => a.date.localeCompare(b.date));

  const totals = {
    completed: data.reduce((s,r)=>s+Number(r.completed_jobs),0),
    failed:    data.reduce((s,r)=>s+Number(r.failed_jobs),0),
    dlq:       data.reduce((s,r)=>s+Number(r.dlq_jobs),0),
  };

  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>
          Queue Health
        </span>
        <span style={{ fontSize:9, color:"#4b5563" }}>src: queue_retry_analytics</span>
      </div>

      {chartData.length === 0 ? (
        <div style={{ color:"#6b7280", fontSize:11, textAlign:"center", padding:20 }}>
          No queue data in window
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={compact?100:160}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" stroke="#4b5563" tick={{ fontSize:9 }} />
              <YAxis stroke="#4b5563" tick={{ fontSize:9 }} />
              <Tooltip contentStyle={{ background:"#0d1117",
                border:"1px solid #1f2937", fontSize:11, color:"#e5e7eb" }} />
              {!compact && <Legend wrapperStyle={{ fontSize:10 }} />}
              <Bar dataKey="completed" fill="#22c55e" name="Completed" stackId="a" />
              <Bar dataKey="failed"    fill="#f59e0b" name="Failed"    stackId="a" />
              <Bar dataKey="dlq"       fill="#ef4444" name="DLQ"       stackId="a" />
            </BarChart>
          </ResponsiveContainer>
          {!compact && (
            <div style={{ display:"flex", gap:16, marginTop:8 }}>
              {[
                { label:"✅ Completed", value:totals.completed, color:"#22c55e" },
                { label:"⚠️ Failed",   value:totals.failed,    color:"#f59e0b" },
                { label:"❌ DLQ",      value:totals.dlq,       color:"#ef4444" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ fontSize:10 }}>
                  {label}: <span style={{ color, fontWeight:700 }}>
                    {value.toLocaleString()}
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
