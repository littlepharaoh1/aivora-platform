import React from "react";
import { useRoutingDecisions }
  from "../../analytics-ui/hooks/useAnalyticsData";
import { ROUTE_VERSION } from "../../lib/routing/activeRouter";

const ROUTE_COLOR: Record<string,string> = {
  AUTO_APPROVE:          "#22c55e",
  SINGLE_REVIEW:         "#3b82f6",
  DUAL_REVIEW:           "#8b5cf6",
  SUPERVISOR_ESCALATION: "#f59e0b",
  FORENSIC_REVIEW:       "#f97316",
  REJECT_IMMEDIATELY:    "#ef4444",
};

const ROUTE_DESC: Record<string,string> = {
  AUTO_APPROVE:          "QC≥85 + clean signals",
  SINGLE_REVIEW:         "QC 70-85",
  DUAL_REVIEW:           "QC<70 or synthetic≥0.4",
  SUPERVISOR_ESCALATION: "Disagreement≥50% or fraud≥3",
  FORENSIC_REVIEW:       "Synthetic≥70% or artifact≥60%",
  REJECT_IMMEDIATELY:    "Multi-factor: QC<30 + problems≥5",
};

export default function RoutingPanel() {
  const { data:routing30 } = useRoutingDecisions("30d");
  const { data:routing7  } = useRoutingDecisions("7d");

  const aggregate = (rows: typeof routing30) => {
    const m = new Map<string,{ count:number; conf:number[] }>();
    for(const r of rows) {
      const ex = m.get(r.routing_decision);
      if(!ex) {
        m.set(r.routing_decision, {
          count: Number(r.decision_count),
          conf:  [Number(r.avg_confidence)],
        });
      } else {
        ex.count += Number(r.decision_count);
        ex.conf.push(Number(r.avg_confidence));
      }
    }
    return Array.from(m.entries())
      .map(([decision, { count, conf }]) => ({
        decision,
        count,
        avg_confidence: conf.reduce((a,b) => a+b, 0) / conf.length,
      }))
      .sort((a,b) => b.count - a.count);
  };

  const stats30 = aggregate(routing30);
  const stats7  = aggregate(routing7);
  const total30 = stats30.reduce((s,r) => s + r.count, 0);

  return (
    <div>
      {/* Router governance */}
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:8,
          textTransform:"uppercase", letterSpacing:1 }}>
          Router Governance
        </div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          {[
            { label:"Version",     value:ROUTE_VERSION },
            { label:"Strategy",    value:"DETERMINISTIC" },
            { label:"Escalation",  value:"MAX DEPTH 2" },
            { label:"Multi-factor",value:"REJECT = 3 signals" },
          ].map(({ label, value }) => (
            <div key={label} style={{ fontSize:10 }}>
              <span style={{ color:"#6b7280" }}>{label}: </span>
              <span style={{ color:"#22d3ee" }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop:8, fontSize:10, color:"#374151" }}>
          Same QC signals → same routing decision (deterministic guarantee)
        </div>
      </div>

      {/* Route definitions */}
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:8,
          textTransform:"uppercase", letterSpacing:1 }}>
          Route Definitions (Priority Order)
        </div>
        {Object.entries(ROUTE_COLOR).map(([route, color], i) => (
          <div key={route} style={{ display:"flex", alignItems:"center",
            gap:10, padding:"6px 0", borderBottom:"1px solid #111827" }}>
            <span style={{ fontSize:11, color:"#4b5563", width:16 }}>{i+1}.</span>
            <span style={{ fontSize:11, color, fontWeight:700, width:180 }}>
              {route.replace(/_/g," ")}
            </span>
            <span style={{ fontSize:10, color:"#6b7280", flex:1 }}>
              {ROUTE_DESC[route] ?? ""}
            </span>
            {stats7.find(s => s.decision === route) && (
              <span style={{ fontSize:10, color:"#374151" }}>
                7d: {stats7.find(s => s.decision === route)?.count ?? 0}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 30d distribution */}
      {stats30.length > 0 && (
        <div style={{ background:"#0d1117", border:"1px solid #1f2937",
          borderRadius:8, padding:14 }}>
          <div style={{ fontSize:11, color:"#6b7280", marginBottom:8,
            textTransform:"uppercase", letterSpacing:1 }}>
            30-Day Distribution
          </div>
          {stats30.map(({ decision, count, avg_confidence }) => {
            const pct   = total30 > 0 ? count / total30 * 100 : 0;
            const color = ROUTE_COLOR[decision] ?? "#6b7280";
            return (
              <div key={decision} style={{ marginBottom:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  marginBottom:3 }}>
                  <span style={{ fontSize:11, color }}>
                    {decision.replace(/_/g," ")}
                  </span>
                  <span style={{ fontSize:11, color:"#9ca3af" }}>
                    {count.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div style={{ height:6, background:"#1f2937", borderRadius:3 }}>
                  <div style={{ width:`${pct}%`, height:"100%",
                    background:color, borderRadius:3 }} />
                </div>
                <div style={{ fontSize:9, color:"#374151", marginTop:2 }}>
                  avg confidence: {(avg_confidence * 100).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
