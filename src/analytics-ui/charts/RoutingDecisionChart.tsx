import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useRoutingDecisions } from "../hooks/useAnalyticsData";
import type { TimeWindow } from "../hooks/useAnalyticsData";

const ROUTE_COLORS: Record<string,string> = {
  AUTO_APPROVE:        "#22c55e",
  SINGLE_REVIEW:       "#3b82f6",
  DUAL_REVIEW:         "#8b5cf6",
  SUPERVISOR_ESCALATION:"#f59e0b",
  FORENSIC_REVIEW:     "#f97316",
  REJECT_IMMEDIATELY:  "#ef4444",
};

export default function RoutingDecisionChart(
  { window, compact=false }: { window:TimeWindow; compact?:boolean }
) {
  const { data, loading } = useRoutingDecisions(window);

  if(loading) return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937", borderRadius:8,
      padding:14, height:compact?150:220, display:"flex", alignItems:"center",
      justifyContent:"center", color:"#4b5563", fontSize:11 }}>
      Loading routing data...
    </div>
  );

  // Aggregate by decision
  const decMap = new Map<string,number>();
  for(const row of data) {
    decMap.set(row.routing_decision,
      (decMap.get(row.routing_decision) ?? 0) + Number(row.decision_count));
  }
  const chartData = Array.from(decMap.entries())
    .map(([name, value]) => ({ name:name.replace("_"," "), full:name, value }))
    .sort((a,b) => b.value - a.value);

  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>
          Routing Decision Distribution
        </span>
        <span style={{ fontSize:9, color:"#4b5563" }}>src: routing_decision_distribution</span>
      </div>

      {chartData.length === 0 ? (
        <div style={{ color:"#6b7280", fontSize:11, textAlign:"center", padding:20 }}>
          No routing data in window
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={compact ? 110 : 180}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis type="number" stroke="#4b5563" tick={{ fontSize:9 }} />
            <YAxis type="category" dataKey="name" stroke="#4b5563"
              tick={{ fontSize:8 }} width={90} />
            <Tooltip contentStyle={{ background:"#0d1117",
              border:"1px solid #1f2937", fontSize:11, color:"#e5e7eb" }} />
            <Bar dataKey="value" name="Decisions" radius={[0,3,3,0]}>
              {chartData.map((entry) => (
                <React.Fragment key={entry.full}>
                  <rect fill={ROUTE_COLORS[entry.full] ?? "#3b82f6"} />
                </React.Fragment>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
