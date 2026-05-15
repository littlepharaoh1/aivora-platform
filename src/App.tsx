// @ts-nocheck
/**
 * App.tsx — Aivora Platform
 * New Design System — Sidebar Layout
 */
import React, { useState } from "react";
import AppSidebar from "./components/layout/AppSidebar";
import AppTopBar from "./components/layout/AppTopBar";
import { colors } from "./lib/design/tokens";
import AuthGate from "./components/AuthGate";
import { useAuth } from "./lib/auth/AuthContext";

// Lazy imports
import AudioQualityAnalyzer from "./components/AudioQualityAnalyzer";
import BatchAnalyzer from "./components/BatchAnalyzer";
import SmartNamingSequencer from "./components/SmartNamingSequencer";
import ActivityMonitor from "./components/ActivityMonitor";
import DspValidationDashboard from "./components/DspValidationDashboard";
import ForensicSilenceRepair from "./components/ForensicSilenceRepair";
import AivoraAuditionWorkstation from "./components/AivoraAuditionWorkstation";

type Tab =
  | "dashboard"
  | "qc"
  | "batch"
  | "naming"
  | "forensic_repair"
  | "audition"
  | "contributors"
  | "monitor"
  | "dsp_validation"
  | "store";

// ── Tab Meta ──────────────────────────────────────────────────────────────────

const TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  dashboard:      { title: "Dashboard",              subtitle: "AIVORA PLATFORM OVERVIEW" },
  qc:             { title: "QC Workstation",         subtitle: "AUDIO QUALITY CONTROL" },
  batch:          { title: "Batch Analyzer",         subtitle: "MULTI-FILE QC PROCESSING" },
  naming:         { title: "Smart Naming",           subtitle: "GERMAN APPEN SEQUENCER" },
  forensic_repair:{ title: "Forensic Silence Repair",subtitle: "ADOBE-STYLE QA SIMULATION" },
  audition:       { title: "Audition Workstation",   subtitle: "PROFESSIONAL AUDIO EDITOR" },
  contributors:   { title: "Contributors",           subtitle: "TEAM MANAGEMENT" },
  monitor:        { title: "Activity Monitor",       subtitle: "REAL-TIME TRACKING" },
  dsp_validation: { title: "DSP Validation",         subtitle: "ACCURACY TESTING SUITE" },
  store:          { title: "Aivora Store",           subtitle: "RESOURCES & TOOLS" },
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { user } = useAuth();

  const cards = [
    { icon:"🎙", label:"QC Workstation",    sub:"Analyze audio quality",   tab:"qc" as Tab,             color:colors.accent.sky },
    { icon:"📊", label:"Batch Analyzer",    sub:"Process 200+ files",      tab:"batch" as Tab,           color:colors.accent.purple },
    { icon:"🏷", label:"Smart Naming",      sub:"German Appen sequencer",  tab:"naming" as Tab,          color:colors.accent.cyan },
    { icon:"🔬", label:"Forensic Repair",   sub:"Silence reconstruction",  tab:"forensic_repair" as Tab, color:colors.accent.amber },
    { icon:"🎛", label:"Audition Editor",   sub:"Professional workstation",tab:"audition" as Tab,        color:colors.accent.green },
    { icon:"📈", label:"Activity Monitor",  sub:"Real-time tracking",      tab:"monitor" as Tab,         color:colors.accent.sky },
  ];

  return (
    <div style={{ padding: 24, animation: "fadeIn 0.3s ease" }}>
      {/* Welcome */}
      <div style={{
        background: `linear-gradient(135deg, ${colors.bg.elevated}, ${colors.bg.surface})`,
        border: `1px solid ${colors.bg.border}`,
        borderRadius: 16, padding: "20px 24px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: `linear-gradient(135deg, ${colors.accent.sky}, ${colors.accent.purple})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24,
        }}>⬡</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: colors.text.primary }}>
            Welcome to Aivora
          </div>
          <div style={{ fontSize: 11, color: colors.text.secondary, marginTop: 2 }}>
            {user?.email} · AI Audio Data Production Platform
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 9, color: colors.text.muted, letterSpacing: 1 }}>VERSION</div>
          <div style={{ fontSize: 13, color: colors.accent.sky, fontWeight: 700 }}>2.0</div>
        </div>
      </div>

      {/* Quick access grid */}
      <div style={{ fontSize: 10, color: colors.text.muted, letterSpacing: 2, marginBottom: 12 }}>
        QUICK ACCESS
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
      }}>
        {cards.map(card => (
          <div key={card.tab} onClick={() => onNavigate(card.tab)}
            style={{
              background: colors.bg.surface,
              border: `1px solid ${colors.bg.border}`,
              borderTop: `2px solid ${card.color}`,
              borderRadius: 12, padding: 16,
              cursor: "pointer", transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = colors.bg.elevated;
              (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = colors.bg.surface;
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text.primary, marginBottom: 4 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 10, color: colors.text.secondary }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ fontSize: 10, color: colors.text.muted, letterSpacing: 2, margin: "24px 0 12px" }}>
        PLATFORM CAPABILITIES
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          ["13", "DSP Phases",       colors.accent.sky],
          ["85%+", "VAD Accuracy",   colors.accent.green],
          ["88%", "RT60 Accuracy",   colors.accent.purple],
          ["200", "Batch Files",     colors.accent.amber],
          ["32-bit", "Float Export", colors.accent.cyan],
          ["6", "Repair Tools",      colors.accent.green],
        ].map(([value, label, color]) => (
          <div key={label} style={{
            background: colors.bg.surface,
            border: `1px solid ${colors.bg.border}`,
            borderRadius: 10, padding: "10px 16px",
            flex: 1, minWidth: 100, textAlign: "center",
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: color as string }}>{value}</div>
            <div style={{ fontSize: 9, color: colors.text.muted, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Placeholder ───────────────────────────────────────────────────────────────

function ComingSoon({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", flexDirection: "column", gap: 12, opacity: 0.5 }}>
      <div style={{ fontSize: 40 }}>🚧</div>
      <div style={{ fontSize: 14, color: colors.text.secondary }}>{title}</div>
      <div style={{ fontSize: 11, color: colors.text.muted }}>Coming soon</div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

function AppContent() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const meta = TAB_META[tab];

  // Audition workstation gets full screen (no topbar/sidebar wrapper)
  if (tab === "audition") {
    return <AivoraAuditionWorkstation />;
  }

  return (
    <div style={{
      display: "flex", height: "100vh", width: "100vw",
      background: colors.bg.base, overflow: "hidden",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Sidebar */}
      <AppSidebar activeTab={tab} onTabChange={setTab} />

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <AppTopBar title={meta.title} subtitle={meta.subtitle} />

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", background: colors.bg.base }}>
          {tab === "dashboard"       && <Dashboard onNavigate={setTab} />}
          {tab === "qc"              && <AudioQualityAnalyzer />}
          {tab === "batch"           && <BatchAnalyzer />}
          {tab === "naming"          && <SmartNamingSequencer />}
          {tab === "forensic_repair" && <ForensicSilenceRepair />}
          {tab === "monitor"         && <ActivityMonitor />}
          {tab === "dsp_validation"  && <DspValidationDashboard />}
          {tab === "contributors"    && <ComingSoon title="Contributors" />}
          {tab === "store"           && <ComingSoon title="Aivora Store" />}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <AppContent />
    </AuthGate>
  );
}
