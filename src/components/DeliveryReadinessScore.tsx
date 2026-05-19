// ════════════════════════════════════════════════════════════════════
// AIVORA — DELIVERY READINESS SCORE (V2)
// REPLACES: Old DeliveryReadinessScore.tsx
// Uses: Unified DSP engine + Studio Compliance + Central FileRecord
// ════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { Upload, Download, Award, BarChart3, Filter, RefreshCw } from "lucide-react";
import { analyzeAudioBuffer } from "../lib/audio/AdvancedAudioAnalyzer";
import { validateStudioCompliance, STUDIO_PROFILES } from "../lib/audio/StudioSpecCompliance";
import ComplianceReportPanel, { ComplianceBadge } from "./ComplianceReportPanel";
import { 
  computeBatchStats, 
  type FileRecord,
  type BatchStats 
} from "../lib/types/FileRecord";

// ─── PROPS ─────────────────────────────────────────────────────────

interface Props {
  records?: any[];
  setRecords?: React.Dispatch<React.SetStateAction<any[]>>;
  defaultProfile?: keyof typeof STUDIO_PROFILES;
}

// ─── COLORS ────────────────────────────────────────────────────────

const C = {
  bg: "#040c14",
  card: "#060e16",
  border: "#0f2a3a",
  text: "#e0f2f8",
  dim: "#a0c4cc",
  muted: "#4a8a9a",
  cyan: "#22d3ee",
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
};

// ─── BATCH OVERVIEW STATS ──────────────────────────────────────────

function BatchOverview({ stats }: { stats: BatchStats }) {
  const cards = [
    { label: "TOTAL FILES", value: stats.total, color: C.cyan },
    { label: "READY", value: stats.byVerdict.READY, color: C.green },
    { label: "REVIEW", value: stats.byVerdict.REVIEW, color: C.yellow },
    { label: "REJECTED", value: stats.byVerdict.REJECT, color: C.red },
    { label: "AVG SCORE", value: stats.averageScore, color: C.cyan, suffix: "/100" },
    { label: "AVG SNR", value: stats.averageSnr, color: C.cyan, suffix: " dB" },
    { label: "AVG NOISE", value: stats.averageNoiseFloor, color: C.cyan, suffix: " dBFS" },
    { label: "AVG LUFS", value: stats.averageLufs, color: C.cyan, suffix: " LUFS" },
  ];
  
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: 10,
      marginBottom: 20,
    }}>
      {cards.map((c, i) => (
        <div key={i} style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderTop: `2px solid ${c.color}`,
          borderRadius: 8,
          padding: "12px 14px",
        }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontFamily: "monospace" }}>
            {c.label}
          </div>
          <div style={{ 
            fontSize: 24, fontWeight: 800, color: c.color, 
            fontFamily: "monospace", marginTop: 4, lineHeight: 1,
          }}>
            {c.value}{c.suffix && <span style={{ fontSize: 12, opacity: 0.7 }}>{c.suffix}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── TOP ISSUES PANEL ──────────────────────────────────────────────

function TopIssuesPanel({ stats }: { stats: BatchStats }) {
  if (stats.topIssues.length === 0) return null;
  
  const max = Math.max(...stats.topIssues.map(i => i.count));
  
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: 14,
      marginBottom: 20,
    }}>
      <div style={{
        fontSize: 11, color: C.dim, letterSpacing: 2,
        fontFamily: "monospace", marginBottom: 12,
        fontWeight: 600,
      }}>
        TOP REJECTION REASONS
      </div>
      
      {stats.topIssues.map((issue, i) => (
        <div key={issue.id} style={{
          display: "grid",
          gridTemplateColumns: "1fr 60px 30px",
          gap: 10,
          alignItems: "center",
          padding: "6px 0",
          fontSize: 12,
          fontFamily: "monospace",
          color: C.text,
        }}>
          <div>{issue.title}</div>
          <div style={{
            height: 6,
            background: C.border,
            borderRadius: 3,
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${(issue.count / max) * 100}%`,
              background: i < 3 ? C.red : i < 6 ? C.yellow : C.cyan,
              transition: "width 0.3s",
            }} />
          </div>
          <div style={{ color: C.muted, textAlign: "right", fontWeight: 600 }}>
            {issue.count}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── FILE LIST ─────────────────────────────────────────────────────

function FileListItem({ 
  record, 
  selected, 
  onClick 
}: { 
  record: FileRecord; 
  selected: boolean; 
  onClick: () => void;
}) {
  const verdict = record.compliance?.verdict || "REVIEW";
  const score = record.compliance?.score || 0;
  
  const verdictColor = 
    verdict === "READY" ? C.green :
    verdict === "REVIEW" ? C.yellow : C.red;
  
  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? C.border : C.card,
        border: `1px solid ${selected ? C.cyan : C.border}`,
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 6,
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ 
          fontSize: 12, color: C.text, fontFamily: "monospace",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {record.fileName}
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2, fontFamily: "monospace" }}>
          {record.duration ? `${record.duration.toFixed(1)}s` : ""} 
          {record.sampleRate ? ` · ${record.sampleRate}Hz` : ""}
          {record.bitDepth ? ` · ${record.bitDepth}-bit` : ""}
        </div>
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700,
        color: verdictColor,
        fontFamily: "monospace",
      }}>
        {score}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 700,
        color: verdictColor,
        background: verdictColor + "22",
        padding: "3px 8px",
        borderRadius: 10,
        letterSpacing: 1,
        fontFamily: "monospace",
      }}>
        {verdict}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────

export default function DeliveryReadinessScore({ 
  records = [], 
  setRecords,
  defaultProfile = "asr_studio"
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<string>(defaultProfile);
  const [filter, setFilter] = useState<"all" | "READY" | "REVIEW" | "REJECT">("all");
  const [analyzing, setAnalyzing] = useState(false);
  
  const stats = useMemo(() => computeBatchStats(records), [records]);
  
  const filtered = useMemo(() => {
    if (filter === "all") return records;
    return records.filter(r => r.compliance?.verdict === filter);
  }, [records, filter]);
  
  const selected = records.find(r => r.id === selectedId);
  
  // Analyze a file (re-analyze with current profile)
  const analyzeFile = async (record: FileRecord) => {
    if (!record.audioBuffer || !setRecords) return;
    
    setAnalyzing(true);
    try {
      const analysis = await analyzeAudioBuffer(record.audioBuffer);
      const compliance = validateStudioCompliance(analysis, profile);
      
      setRecords(prev => prev.map(r => 
        r.id === record.id 
          ? { 
              ...r, 
              analysis, 
              compliance,
              analyzedAt: new Date().toISOString(),
              stage: "compliance",
              lastModifiedAt: new Date().toISOString(),
            }
          : r
      ));
    } catch (e) {
      
    } finally {
      setAnalyzing(false);
    }
  };
  
  // Batch upload + analyze
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !setRecords) return;
    
    setAnalyzing(true);
    
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".wav")) continue;
      
      try {
        const ab = await file.arrayBuffer();
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
        const analysis = await analyzeAudioBuffer(buf);
        const compliance = validateStudioCompliance(analysis, profile);
        
        const record: FileRecord = {
          id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          fileName: file.name,
          originalFileName: file.name,
          file,
          audioBuffer: buf,
          fileSize: file.size,
          duration: buf.duration,
          sampleRate: buf.sampleRate,
          channels: buf.numberOfChannels,
          bitDepth: 32,
          status: "Valid",
          reason: "",
          decision: "Pending",
          analysis,
          compliance,
          analyzedAt: new Date().toISOString(),
          enhancements: [],
          stage: "compliance",
          stageHistory: [
            { stage: "uploaded", enteredAt: new Date().toISOString() },
            { stage: "compliance", enteredAt: new Date().toISOString() },
          ],
          uploadedAt: new Date().toISOString(),
          lastModifiedAt: new Date().toISOString(),
        };
        
        setRecords(prev => [...prev, record]);
      } catch (err) {
        
      }
    }
    
    setAnalyzing(false);
    e.target.value = "";
  };
  
  // Export CSV summary
  const exportCSV = () => {
    const rows = [
      ["File", "Duration", "Sample Rate", "Bit Depth", "Score", "Grade", "Verdict", "Hard Rejects", "Major", "Minor"],
      ...records.map(r => [
        r.fileName,
        r.duration?.toFixed(2) || "",
        r.sampleRate || "",
        r.bitDepth || "",
        r.compliance?.score || "",
        r.compliance?.grade || "",
        r.compliance?.verdict || "",
        r.compliance?.hardRejects.length || 0,
        r.compliance?.issues.filter((i: any) => i.severity === "major").length || 0,
        r.compliance?.issues.filter((i: any) => i.severity === "minor").length || 0,
      ]),
    ];
    
    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aivora_compliance_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <div style={{
      background: C.bg,
      minHeight: "100vh",
      padding: 20,
      fontFamily: "monospace",
      color: C.text,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 20,
        paddingBottom: 14,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Award size={20} color={C.cyan} />
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
              DELIVERY READINESS SCORE
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4, letterSpacing: 1 }}>
            STUDIO-GRADE BATCH COMPLIANCE · {records.length} FILES
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 10 }}>
          <select
            value={profile}
            onChange={e => setProfile(e.target.value)}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            {Object.entries(STUDIO_PROFILES).map(([key, spec]) => (
              <option key={key} value={key}>{spec.description}</option>
            ))}
          </select>
          
          <label style={{
            background: C.cyan + "22",
            border: `1px solid ${C.cyan}`,
            color: C.cyan,
            padding: "8px 14px",
            borderRadius: 6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
          }}>
            <Upload size={12} />
            UPLOAD WAV
            <input
              type="file"
              accept=".wav"
              multiple
              onChange={handleUpload}
              style={{ display: "none" }}
            />
          </label>
          
          {records.length > 0 && (
            <button
              onClick={exportCSV}
              style={{
                background: C.green + "22",
                border: `1px solid ${C.green}`,
                color: C.green,
                padding: "8px 14px",
                borderRadius: 6,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontFamily: "monospace",
              }}
            >
              <Download size={12} />
              EXPORT CSV
            </button>
          )}
        </div>
      </div>
      
      {analyzing && (
        <div style={{
          background: C.cyan + "11",
          border: `1px solid ${C.cyan}`,
          borderRadius: 6,
          padding: "10px 14px",
          marginBottom: 16,
          fontSize: 12,
          color: C.cyan,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <RefreshCw size={14} className="spin" />
          Processing audio...
        </div>
      )}
      
      {records.length === 0 ? (
        <div style={{
          background: C.card,
          border: `1px dashed ${C.border}`,
          borderRadius: 8,
          padding: 60,
          textAlign: "center",
          color: C.muted,
        }}>
          <Upload size={40} color={C.muted} style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 14, marginBottom: 8 }}>No files uploaded yet</div>
          <div style={{ fontSize: 11 }}>
            Upload WAV files to validate against {STUDIO_PROFILES[profile as keyof typeof STUDIO_PROFILES]?.description}
          </div>
        </div>
      ) : (
        <>
          <BatchOverview stats={stats} />
          <TopIssuesPanel stats={stats} />
          
          <div style={{
            display: "grid",
            gridTemplateColumns: "350px 1fr",
            gap: 20,
          }}>
            {/* File List */}
            <div>
              <div style={{
                display: "flex",
                gap: 6,
                marginBottom: 10,
              }}>
                {(["all", "READY", "REVIEW", "REJECT"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      background: filter === f ? C.cyan + "22" : C.card,
                      border: `1px solid ${filter === f ? C.cyan : C.border}`,
                      color: filter === f ? C.cyan : C.dim,
                      padding: "5px 10px",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 10,
                      fontFamily: "monospace",
                      flex: 1,
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
              
              <div style={{ maxHeight: "calc(100vh - 400px)", overflowY: "auto" }}>
                {filtered.map(r => (
                  <FileListItem
                    key={r.id}
                    record={r}
                    selected={r.id === selectedId}
                    onClick={() => setSelectedId(r.id)}
                  />
                ))}
              </div>
            </div>
            
            {/* Detail View */}
            <div>
              {selected && selected.compliance ? (
                <ComplianceReportPanel
                  report={selected.compliance}
                  fileName={selected.fileName}
                  onExportReport={() => {
                    // Export single file report as JSON
                    const data = {
                      file: selected.fileName,
                      analyzedAt: selected.analyzedAt,
                      compliance: selected.compliance,
                      metrics: selected.analysis,
                    };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${selected.fileName.replace(/\.wav$/, "")}_report.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                />
              ) : (
                <div style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: 60,
                  textAlign: "center",
                  color: C.muted,
                  fontSize: 12,
                }}>
                  Select a file to view detailed compliance report
                </div>
              )}
            </div>
          </div>
        </>
      )}
      
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
