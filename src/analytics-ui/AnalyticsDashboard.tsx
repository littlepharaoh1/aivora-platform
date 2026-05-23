/**
 * AnalyticsDashboard.tsx — Enterprise Analytics Dashboard
 * Aivora Platform — Phase 10
 *
 * ALL data from materialized views — zero fake KPIs.
 * Lazy-loaded sections. Bounded queries. Deterministic rendering.
 */

import React, { useState, lazy, Suspense } from "react";
import type { TimeWindow } from "./hooks/useAnalyticsData";

const DSPTimingChart         = lazy(() => import("./charts/DSPTimingChart"));
const ForensicVerdictChart   = lazy(() => import("./charts/ForensicVerdictChart"));
const RoutingDecisionChart   = lazy(() => import("./charts/RoutingDecisionChart"));
const ReviewerThroughputChart= lazy(() => import("./charts/ReviewerThroughputChart"));
const FraudHeatmapChart      = lazy(() => import("./charts/FraudHeatmapChart"));
const QueueRetryChart        = lazy(() => import("./charts/QueueRetryChart"));

const TABS = [
  { id:"overview",  label:"Overview",         icon:"📊" },
  { id:"dsp",       label:"DSP Timing",        icon:"⚙️" },
  { id:"forensic",  label:"Forensic Verdicts", icon:"🔬" },
  { id:"routing",   label:"Routing",           icon:"🔀" },
  { id:"reviewers", label:"Reviewers",         icon:"👥" },
  { id:"fraud",     label:"Fraud Heatmap",     icon:"🛡️" },
  { id:"queue",     label:"Queue Health",      icon:"📦" },
] as const;

type TabId = typeof TABS[number]["id"];

const WINDOWS: { value: TimeWindow; label: string }[] = [
  { value:"7d",  label:"7 days"  },
  { value:"30d", label:"30 days" },
  { value:"90d", label:"90 days" },
];

function LoadingChart() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"#4b5563", fontSize:12 }}>
      Loading data from materialized view...
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [window,    setWindow]    = useState<TimeWindow>("30d");

  return (
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>

      {/* Header */}
      <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a", display:"flex", justifyContent:"space-between",
        alignItems:"center" }}>
        <div>
          <span style={{ fontSize:16, fontWeight:700, color:"#22d3ee",
            letterSpacing:1 }}>ANALYTICS DASHBOARD</span>
          <span style={{ fontSize:10, color:"#4b5563", marginLeft:12 }}>
            Source: materialized views · No fake data
          </span>
        </div>

        {/* Time window selector */}
        <div style={{ display:"flex", gap:4 }}>
          {WINDOWS.map(w => (
            <button key={w.value} onClick={() => setWindow(w.value)}
              style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
                cursor:"pointer", border:"1px solid",
                borderColor: window === w.value ? "#22d3ee" : "#1f2937",
                background:  window === w.value ? "#22d3ee22" : "transparent",
                color:       window === w.value ? "#22d3ee" : "#6b7280",
              }}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display:"flex", borderBottom:"1px solid #1f2937",
        background:"#0d1117", overflowX:"auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding:"10px 16px", border:"none", cursor:"pointer",
              background:"transparent", whiteSpace:"nowrap", fontSize:12,
              color: activeTab===tab.id ? "#22d3ee" : "#6b7280",
              borderBottom: activeTab===tab.id
                ? "2px solid #22d3ee" : "2px solid transparent",
              display:"flex", alignItems:"center", gap:6,
            }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:16 }}>
        <Suspense fallback={<LoadingChart />}>
          {activeTab === "overview" && (
            <div>
              <div style={{ fontSize:11, color:"#6b7280", marginBottom:16 }}>
                Overview: all 6 materialized views · window: {window}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <DSPTimingChart         window={window} compact />
                <ForensicVerdictChart   window={window} compact />
                <RoutingDecisionChart   window={window} compact />
                <QueueRetryChart        window={window} compact />
              </div>
            </div>
          )}
          {activeTab === "dsp"       && <DSPTimingChart          window={window} />}
          {activeTab === "forensic"  && <ForensicVerdictChart    window={window} />}
          {activeTab === "routing"   && <RoutingDecisionChart    window={window} />}
          {activeTab === "reviewers" && <ReviewerThroughputChart window={window} />}
          {activeTab === "fraud"     && <FraudHeatmapChart />}
          {activeTab === "queue"     && <QueueRetryChart         window={window} />}
        </Suspense>
      </div>
    </div>
  );
}
