/**
 * QAIntelligenceWorkstation.tsx — Enterprise Human QA Intelligence
 * Aivora Platform — Phase 13
 * Advisory only. No automatic punishments. All scoring explainable.
 */

import React, { useState, lazy, Suspense } from "react";
import { useQASummary, useReviewers, useRecentQCReviews }
  from "./hooks/useQAIntelligence";

const WorkforcePanel   = lazy(() => import("./panels/WorkforcePanel"));
const ConsensusPanel   = lazy(() => import("./panels/ConsensusPanel"));
const RoutingPanel     = lazy(() => import("./panels/RoutingPanel"));
const ReviewQueuePanel = lazy(() => import("./panels/ReviewQueuePanel"));
const FraudIntelPanel  = lazy(() => import("./panels/FraudIntelPanel"));

const TABS = [
  { id:"overview",  label:"Overview",     icon:"📊" },
  { id:"workforce", label:"Workforce",     icon:"👥" },
  { id:"consensus", label:"Consensus",     icon:"🤝" },
  { id:"routing",   label:"Routing Intel", icon:"🔀" },
  { id:"queue",     label:"Review Queue",  icon:"📋" },
  { id:"fraud",     label:"Fraud Intel",   icon:"🛡️" },
] as const;

type TabId = typeof TABS[number]["id"];

function Loading() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"#4b5563", fontSize:12 }}>
      Loading QA intelligence...
    </div>
  );
}

function KPICard({ label, value, color="#22d3ee" }:
  { label:string; value:React.ReactNode; color?:string }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:"14px 16px" }}>
      <div style={{ fontSize:28, fontWeight:900, color, marginBottom:2 }}>
        {value}
      </div>
      <div style={{ fontSize:11, color:"#e5e7eb" }}>{label}</div>
    </div>
  );
}

// ── Overview Panel ────────────────────────────────────────────────────────────
function OverviewPanel() {
  const { data: reviewers } = useReviewers();
  const { data: reviews   } = useRecentQCReviews(20);

  const verdictCounts: Record<string,number> = {};
  for(const r of reviews) {
    if(r.verdict) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
  }

  const VERDICT_COLOR: Record<string,string> = {
    AUTHENTIC:"#22c55e", SUSPICIOUS:"#f59e0b",
    SYNTHETIC:"#ef4444", PENDING:"#6b7280",
  };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
          textTransform:"uppercase", letterSpacing:1 }}>
          Recent Verdict Distribution
        </div>
        {Object.keys(verdictCounts).length === 0 ? (
          <div style={{ color:"#4b5563", fontSize:11, textAlign:"center",
            padding:20 }}>No recent reviews</div>
        ) : (
          Object.entries(verdictCounts).map(([verdict, count]) => (
            <div key={verdict} style={{ display:"flex",
              justifyContent:"space-between", alignItems:"center",
              padding:"6px 0", borderBottom:"1px solid #111827" }}>
              <span style={{ fontSize:12,
                color:VERDICT_COLOR[verdict] ?? "#9ca3af" }}>{verdict}</span>
              <span style={{ fontSize:13, fontWeight:700,
                color:VERDICT_COLOR[verdict] ?? "#9ca3af" }}>{count}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
          textTransform:"uppercase", letterSpacing:1 }}>
          Reviewer Status
        </div>
        {(reviewers ?? []).length === 0 ? (
          <div style={{ color:"#4b5563", fontSize:11, textAlign:"center",
            padding:20 }}>No reviewers yet</div>
        ) : (
          (reviewers ?? []).slice(0, 8).map(r => (
            <div key={r.id} style={{ display:"flex",
              justifyContent:"space-between", padding:"5px 0",
              borderBottom:"1px solid #111827", fontSize:11 }}>
              <span style={{ color:"#e5e7eb" }}>
                {r.name || r.email?.split("@")[0] || "—"}
              </span>
              <div style={{ display:"flex", gap:8 }}>
                {r.tier && (
                  <span style={{ fontSize:9, color:"#6b7280" }}>{r.tier}</span>
                )}
                <span style={{ color:"#22d3ee" }}>
                  {(r.total_reviews ?? 0).toLocaleString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function QAIntelligenceWorkstation() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { summary, loading } = useQASummary();

  return (
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>

      {/* Header */}
      <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
          <span style={{ fontSize:16, fontWeight:700, color:"#22d3ee",
            letterSpacing:1 }}>HUMAN QA INTELLIGENCE</span>
          <span style={{ fontSize:9, color:"#374151" }}>
            Tier 1 · Advisory only · Deterministic scoring
          </span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[
            { label:"SCORING",    value:"EXPLAINABLE"  },
            { label:"FRAUD",      value:"ADVISORY ONLY"},
            { label:"ROUTING",    value:"DETERMINISTIC"},
            { label:"LINEAGE",    value:"TRACEABLE"    },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding:"2px 8px", borderRadius:3,
              background:"#052e16", border:"1px solid #166534", fontSize:9 }}>
              <span style={{ color:"#6b7280" }}>{label}: </span>
              <span style={{ color:"#22c55e", fontWeight:700 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      {!loading && summary && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)",
          gap:1, background:"#1f2937", borderBottom:"1px solid #1f2937" }}>
          <KPICard label="Total Reviews"
            value={summary.total_reviews.toLocaleString()} />
          <KPICard label="Active Reviewers"
            value={summary.total_reviewers} color="#3b82f6" />
          <KPICard label="Mean QC Score"
            value={summary.mean_qc_score}   color="#22c55e" />
          <KPICard label="Consensus Rate"
            value={`${summary.consensus_rate}%`} color="#22c55e" />
          <KPICard label="Escalation Rate"
            value={`${summary.escalation_rate}%`}
            color={summary.escalation_rate > 20 ? "#ef4444" : "#f59e0b"} />
          <KPICard label="Pending Tasks"
            value={summary.pending_tasks}
            color={summary.pending_tasks > 100 ? "#f59e0b" : "#6b7280"} />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #1f2937",
        background:"#0d1117", overflowX:"auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding:"10px 16px", border:"none", cursor:"pointer",
              background:"transparent", whiteSpace:"nowrap", fontSize:12,
              color: activeTab===tab.id ? "#22d3ee" : "#6b7280",
              borderBottom: activeTab===tab.id
                ? "2px solid #22d3ee" : "2px solid transparent",
              display:"flex", alignItems:"center", gap:6 }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding:16 }}>
        <Suspense fallback={<Loading />}>
          {activeTab === "overview"  && <OverviewPanel />}
          {activeTab === "workforce" && <WorkforcePanel />}
          {activeTab === "consensus" && <ConsensusPanel />}
          {activeTab === "routing"   && <RoutingPanel />}
          {activeTab === "queue"     && <ReviewQueuePanel />}
          {activeTab === "fraud"     && <FraudIntelPanel />}
        </Suspense>
      </div>
    </div>
  );
}
