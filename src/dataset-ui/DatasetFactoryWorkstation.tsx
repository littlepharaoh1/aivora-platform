/**
 * DatasetFactoryWorkstation.tsx — Enterprise Dataset Factory UI
 * Aivora Platform — Phase 12
 *
 * ALL data from authoritative DB tables.
 * Immutable snapshots. Deterministic splits. Checksum lineage.
 */

import React, { useState, lazy, Suspense } from "react";

const VersionsPanel   = lazy(() => import("./panels/VersionsPanel"));
const QualityGatePanel= lazy(() => import("./panels/QualityGatePanel"));
const PipelinePanel   = lazy(() => import("./panels/PipelinePanel"));
const ExportCenter    = lazy(() => import("./panels/ExportCenter"));
const SplitVisualizer = lazy(() => import("./panels/SplitVisualizer"));

const TABS = [
  { id:"versions",  label:"Dataset Versions", icon:"📦" },
  { id:"gates",     label:"Quality Gates",    icon:"🛡️" },
  { id:"pipeline",  label:"Pipeline Runs",    icon:"⚙️" },
  { id:"splits",    label:"Split Visualizer", icon:"📊" },
  { id:"export",    label:"Export Center",    icon:"📤" },
] as const;

type TabId = typeof TABS[number]["id"];

function Loading() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"#4b5563", fontSize:12 }}>
      Loading from authoritative DB...
    </div>
  );
}

export default function DatasetFactoryWorkstation() {
  const [activeTab, setActiveTab] = useState<TabId>("versions");

  return (
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>

      {/* Header */}
      <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
          <span style={{ fontSize:16, fontWeight:700, color:"#22d3ee",
            letterSpacing:1 }}>DATASET FACTORY</span>
          <span style={{ fontSize:9, color:"#374151" }}>
            Tier 7 · Deterministic · Append-only
          </span>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {[
            { label:"PROTOCOL",  value:"7.0.0" },
            { label:"SNAPSHOTS", value:"IMMUTABLE" },
            { label:"SPLITS",    value:"LCG DETERMINISTIC" },
            { label:"LINEAGE",   value:"SHA256" },
            { label:"REPLAY",    value:"SAFE" },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding:"2px 8px", borderRadius:3,
              background:"#052e16", border:"1px solid #166534",
              fontSize:9 }}>
              <span style={{ color:"#6b7280" }}>{label}: </span>
              <span style={{ color:"#22c55e", fontWeight:700 }}>{value}</span>
            </div>
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
              display:"flex", alignItems:"center", gap:6 }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:16 }}>
        <Suspense fallback={<Loading />}>
          {activeTab === "versions"  && <VersionsPanel />}
          {activeTab === "gates"     && <QualityGatePanel />}
          {activeTab === "pipeline"  && <PipelinePanel />}
          {activeTab === "splits"    && <SplitVisualizer />}
          {activeTab === "export"    && <ExportCenter />}
        </Suspense>
      </div>
    </div>
  );
}
