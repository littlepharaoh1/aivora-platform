// ════════════════════════════════════════════════════════════════════
// AIVORA — COMPLIANCE REPORT PANEL
// Production-grade UI for displaying compliance results
// Used by: AudioQualityAnalyzer, DeliveryReadinessScore, QC Workstation
// ════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { 
  CheckCircle2, XCircle, AlertTriangle, Info, 
  ChevronDown, ChevronUp, Download, Wrench,
  Shield, Award, AlertOctagon
} from "lucide-react";
import type { ComplianceReport, ComplianceIssue } from "../lib/audio/StudioSpecCompliance";

// ─── COLOR SYSTEM ──────────────────────────────────────────────────

const COLORS = {
  // Severity
  critical: "#ef4444",
  major: "#f97316",
  minor: "#f59e0b",
  info: "#3b82f6",
  // Verdict
  ready: "#10b981",
  review: "#f59e0b",
  reject: "#ef4444",
  // UI
  bg: "#040c14",
  card: "#060e16",
  cardHover: "#0a1620",
  border: "#0f2a3a",
  borderActive: "#22d3ee",
  text: "#e0f2f8",
  textDim: "#a0c4cc",
  textMuted: "#4a8a9a",
};

const VERDICT_CONFIG = {
  READY:  { color: COLORS.ready,  bg: "#10b98122", icon: Award,        label: "READY FOR DELIVERY" },
  REVIEW: { color: COLORS.review, bg: "#f59e0b22", icon: AlertTriangle, label: "NEEDS REVIEW" },
  REJECT: { color: COLORS.reject, bg: "#ef444422", icon: AlertOctagon, label: "REJECTED" },
};

const SEVERITY_CONFIG = {
  critical: { color: COLORS.critical, label: "CRITICAL", icon: XCircle },
  major:    { color: COLORS.major,    label: "MAJOR",    icon: AlertTriangle },
  minor:    { color: COLORS.minor,    label: "MINOR",    icon: AlertTriangle },
  info:     { color: COLORS.info,     label: "INFO",     icon: Info },
};

const CATEGORY_LABELS: Record<string, string> = {
  specs: "File Specifications",
  noise: "Noise & Hum",
  level: "Level & Loudness",
  environment: "Acoustic Environment",
  integrity: "Audio Integrity",
  voice: "Voice Activity",
};

// ─── SUB-COMPONENTS ────────────────────────────────────────────────

function VerdictBanner({ report }: { report: ComplianceReport }) {
  const cfg = VERDICT_CONFIG[report.verdict];
  const Icon = cfg.icon;
  
  return (
    <div style={{
      background: `linear-gradient(135deg, ${cfg.bg}, transparent)`,
      border: `2px solid ${cfg.color}`,
      borderRadius: 12,
      padding: 20,
      display: "flex",
      alignItems: "center",
      gap: 16,
      marginBottom: 20,
    }}>
      <div style={{
        width: 60, height: 60, borderRadius: "50%",
        background: cfg.color + "22",
        border: `2px solid ${cfg.color}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <Icon size={32} color={cfg.color} />
      </div>
      
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 11, color: COLORS.textMuted,
          letterSpacing: 2, marginBottom: 4,
          fontFamily: "monospace",
        }}>
          AIVORA QC VERDICT
        </div>
        <div style={{
          fontSize: 20, fontWeight: 800, color: cfg.color,
          letterSpacing: 1, fontFamily: "monospace",
        }}>
          {cfg.label}
        </div>
        <div style={{
          fontSize: 12, color: COLORS.textDim, marginTop: 6,
          lineHeight: 1.5,
        }}>
          {report.summary}
        </div>
      </div>
      
      <div style={{
        textAlign: "center",
        padding: "0 20px",
        borderLeft: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ fontSize: 36, fontWeight: 900, color: cfg.color, lineHeight: 1, fontFamily: "monospace" }}>
          {report.score}
        </div>
        <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: 1, marginTop: 4 }}>
          / 100 · GRADE {report.grade}
        </div>
      </div>
    </div>
  );
}

function IssueCard({ issue, defaultExpanded = false }: { issue: ComplianceIssue; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cfg = SEVERITY_CONFIG[issue.severity];
  const Icon = cfg.icon;
  
  return (
    <div style={{
      background: COLORS.card,
      border: `1px solid ${cfg.color}44`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: 8,
      marginBottom: 8,
      overflow: "hidden",
    }}>
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
        }}
      >
        <Icon size={18} color={cfg.color} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: COLORS.text,
            fontFamily: "monospace",
          }}>
            {issue.title}
          </div>
          <div style={{
            fontSize: 11, color: COLORS.textMuted,
            marginTop: 2, fontFamily: "monospace",
            display: "flex", gap: 12,
          }}>
            <span>{cfg.label}</span>
            <span>·</span>
            <span>{CATEGORY_LABELS[issue.category] || issue.category}</span>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color={COLORS.textMuted} /> : <ChevronDown size={16} color={COLORS.textMuted} />}
      </div>
      
      {expanded && (
        <div style={{
          padding: "0 14px 14px 42px",
          fontSize: 12,
          color: COLORS.textDim,
          fontFamily: "monospace",
          lineHeight: 1.6,
        }}>
          <div style={{ marginBottom: 8 }}>{issue.detail}</div>
          
          <div style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 12px",
            padding: 10,
            background: COLORS.bg,
            borderRadius: 6,
            fontSize: 11,
          }}>
            <span style={{ color: COLORS.textMuted }}>MEASURED:</span>
            <span style={{ color: cfg.color, fontWeight: 600 }}>{issue.measured}</span>
            <span style={{ color: COLORS.textMuted }}>REQUIRED:</span>
            <span style={{ color: COLORS.ready, fontWeight: 600 }}>{issue.required}</span>
          </div>
          
          {issue.fix && (
            <div style={{
              marginTop: 10,
              padding: 10,
              background: "#22d3ee11",
              border: "1px solid #22d3ee44",
              borderRadius: 6,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}>
              <Wrench size={14} color="#22d3ee" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 10, color: "#22d3ee", letterSpacing: 1, marginBottom: 4 }}>
                  RECOMMENDED FIX
                </div>
                <div style={{ color: COLORS.text }}>{issue.fix}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PassedItem({ text }: { text: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      background: "#10b98111",
      borderLeft: `2px solid ${COLORS.ready}`,
      borderRadius: 4,
      marginBottom: 4,
      fontSize: 11,
      color: COLORS.textDim,
      fontFamily: "monospace",
    }}>
      <CheckCircle2 size={12} color={COLORS.ready} />
      {text}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count, color }: { icon: any; title: string; count: number; color: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 10,
      paddingBottom: 8,
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      <Icon size={16} color={color} />
      <span style={{
        fontSize: 11, color: COLORS.textDim,
        letterSpacing: 2, fontFamily: "monospace",
        fontWeight: 600,
      }}>
        {title}
      </span>
      <div style={{
        marginLeft: "auto",
        background: color + "22",
        color,
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "monospace",
      }}>
        {count}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────

export interface ComplianceReportPanelProps {
  report: ComplianceReport;
  fileName?: string;
  onExportReport?: () => void;
  compact?: boolean;
}

export default function ComplianceReportPanel({ 
  report, 
  fileName,
  onExportReport,
  compact = false 
}: ComplianceReportPanelProps) {
  
  // Group issues by severity
  const critical = report.hardRejects.filter(i => i.severity === "critical");
  const majorIssues = report.issues.filter(i => i.severity === "major");
  const minorIssues = report.issues.filter(i => i.severity === "minor");
  
  return (
    <div style={{
      background: COLORS.bg,
      padding: compact ? 12 : 0,
      fontFamily: "monospace",
      color: COLORS.text,
    }}>
      {/* Verdict Banner */}
      <VerdictBanner report={report} />
      
      {/* Profile Info */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 14px",
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 11,
      }}>
        <div>
          <div style={{ color: COLORS.textMuted, letterSpacing: 1, marginBottom: 2 }}>
            COMPLIANCE PROFILE
          </div>
          <div style={{ color: COLORS.text, fontWeight: 600 }}>
            {report.profileName}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: COLORS.textMuted, letterSpacing: 1, marginBottom: 2 }}>
            ANALYZED AT
          </div>
          <div style={{ color: COLORS.text }}>
            {new Date(report.analyzedAt).toLocaleString()}
          </div>
        </div>
        {onExportReport && (
          <button
            onClick={onExportReport}
            style={{
              background: COLORS.borderActive + "22",
              border: `1px solid ${COLORS.borderActive}`,
              color: COLORS.borderActive,
              padding: "6px 12px",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontFamily: "monospace",
              marginLeft: 12,
            }}
          >
            <Download size={12} />
            EXPORT
          </button>
        )}
      </div>
      
      {/* Critical Hard Rejects */}
      {critical.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader 
            icon={AlertOctagon}
            title="HARD REJECTIONS — ZERO TOLERANCE" 
            count={critical.length}
            color={COLORS.critical}
          />
          {critical.map((issue, i) => (
            <IssueCard key={issue.id + i} issue={issue} defaultExpanded={true} />
          ))}
        </div>
      )}
      
      {/* Major Issues */}
      {majorIssues.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader 
            icon={AlertTriangle}
            title="MAJOR ISSUES" 
            count={majorIssues.length}
            color={COLORS.major}
          />
          {majorIssues.map((issue, i) => (
            <IssueCard key={issue.id + i} issue={issue} />
          ))}
        </div>
      )}
      
      {/* Minor Issues */}
      {minorIssues.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader 
            icon={Info}
            title="MINOR NOTES" 
            count={minorIssues.length}
            color={COLORS.minor}
          />
          {minorIssues.map((issue, i) => (
            <IssueCard key={issue.id + i} issue={issue} />
          ))}
        </div>
      )}
      
      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionHeader 
            icon={Wrench}
            title="ACTIONABLE RECOMMENDATIONS" 
            count={report.recommendations.length}
            color={COLORS.borderActive}
          />
          <div style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: 14,
          }}>
            {report.recommendations.map((rec, i) => (
              <div key={i} style={{
                display: "flex",
                gap: 10,
                padding: "8px 0",
                borderBottom: i < report.recommendations.length - 1 
                  ? `1px solid ${COLORS.border}` : "none",
                fontSize: 12,
                color: COLORS.textDim,
                lineHeight: 1.5,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: COLORS.borderActive + "22",
                  color: COLORS.borderActive,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>{rec}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Passed Checks (collapsible) */}
      {report.passed.length > 0 && (
        <details style={{ marginBottom: 20 }}>
          <summary style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            paddingBottom: 8,
            borderBottom: `1px solid ${COLORS.border}`,
            listStyle: "none",
          }}>
            <Shield size={16} color={COLORS.ready} />
            <span style={{
              fontSize: 11, color: COLORS.textDim,
              letterSpacing: 2, fontWeight: 600,
            }}>
              PASSED CHECKS
            </span>
            <div style={{
              marginLeft: "auto",
              background: COLORS.ready + "22",
              color: COLORS.ready,
              padding: "2px 10px",
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 700,
            }}>
              {report.passed.length}
            </div>
          </summary>
          {report.passed.map((p, i) => (
            <PassedItem key={i} text={p} />
          ))}
        </details>
      )}
    </div>
  );
}

// ─── COMPACT VARIANT ───────────────────────────────────────────────

export function ComplianceBadge({ report }: { report: ComplianceReport }) {
  const cfg = VERDICT_CONFIG[report.verdict];
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 12px",
      background: cfg.bg,
      border: `1px solid ${cfg.color}`,
      borderRadius: 16,
      fontSize: 11,
      fontFamily: "monospace",
      color: cfg.color,
      fontWeight: 700,
      letterSpacing: 1,
    }}>
      <cfg.icon size={12} />
      {report.verdict} · {report.score}
    </div>
  );
}
