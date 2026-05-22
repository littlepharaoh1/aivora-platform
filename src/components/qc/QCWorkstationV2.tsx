/**
 * QCWorkstationV2.tsx — Unified QC Workstation
 * 4 tabs: QC Analysis | Audition Pro | Forensic Intel | Repair Suite
 *
 * Architecture:
 * - useQCWorkstation hook: single source of truth
 * - Tab 1,3,4: display:none/block (safe for non-canvas)
 * - Tab 2: visibility+height+isVisible prop (preserves WebGL context)
 * - RAF paused when tab invisible (no CPU waste)
 * - File header: position sticky (always visible)
 */

import React, { useState, useRef, useCallback } from "react";
import { useQCWorkstation } from "../../hooks/useQCWorkstation";
import AuditionWorkspace   from "../audio/AuditionWorkspace";
import { drawSpectrogramPro } from "../../lib/audioQc/spectrogramPro";
import RadarChart           from "../forensic/RadarChart";
import { repairAudioBuffer } from "../../lib/audioQc/repair/repairPipeline";
import { exportToWav, downloadWav } from "../../lib/audioQc/repair/wavExporter";

// ── Theme ─────────────────────────────────────────────────────────────────────
const T = {
  bg:      "#020608",
  panel:   "#060e18",
  border:  "#0a1520",
  accent:  "#22d3ee",
  green:   "#10b981",
  red:     "#ef4444",
  yellow:  "#f59e0b",
  text:    "#a0c4cc",
  textDim: "#2a5a6a",
};

// ── Tab definitions ───────────────────────────────────────────────────────────
const TABS = [
  { id:"qc",       label:"QC ANALYSIS",    icon:"🔬" },
  { id:"audition", label:"AUDITION PRO",   icon:"🎛" },
  { id:"forensic", label:"FORENSIC INTEL", icon:"🧬" },
  { id:"repair",   label:"REPAIR SUITE",   icon:"🔧" },
] as const;

type TabId = typeof TABS[number]["id"];

// ── Score Badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score, verdict }: { score:number; verdict:string }) {
  const color =
    verdict === "READY"        ? T.green  :
    verdict === "FIX_REQUIRED" ? T.yellow : T.red;
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6,
      padding:"3px 10px", borderRadius:8,
      background:`${color}15`, border:`1px solid ${color}44`,
    }}>
      <span style={{ fontSize:16, fontWeight:900, color, fontFamily:"monospace" }}>
        {score}
      </span>
      <span style={{ fontSize:7, color, fontWeight:700, letterSpacing:1 }}>
        /100
      </span>
      <span style={{
        fontSize:8, color, fontWeight:700,
        padding:"1px 6px", borderRadius:4,
        background:`${color}22`, letterSpacing:1,
      }}>
        {verdict.replace("_"," ")}
      </span>
    </div>
  );
}

// ── File Header ───────────────────────────────────────────────────────────────
function FileHeader({
  file, score, verdict, loading, onUpload,
}: {
  file:     any;
  score:    number;
  verdict:  string;
  loading:  boolean;
  onUpload: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{
      position:"sticky", top:0, zIndex:10,
      background:"linear-gradient(135deg,#060e18,#040c14)",
      borderBottom:`1px solid ${T.border}`,
      padding:"10px 16px",
      display:"flex", alignItems:"center", gap:12,
      flexWrap:"wrap",
    }}>
      {/* Upload button */}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        style={{
          background:"#22d3ee22", border:"1px solid #22d3ee44",
          borderRadius:6, padding:"6px 14px",
          cursor:loading?"not-allowed":"pointer",
          color:"#22d3ee", fontSize:10, fontWeight:700,
          opacity:loading?0.6:1,
        }}>
        {loading ? "⟳ Loading..." : "📂 Load WAV"}
      </button>
      <input
        ref={inputRef} type="file" accept=".wav" multiple hidden
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          if(files[0]) onUpload(files[0]);
        }}
      />

      {/* File info */}
      {file ? (
        <>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{
              fontSize:11, color:"#e0f2f8", fontWeight:700,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>
              {file.name}
            </div>
            <div style={{ fontSize:8, color:T.textDim, marginTop:2 }}>
              {file.sampleRate}Hz ·{" "}
              {file.channels === 1 ? "Mono" : "Stereo"} ·{" "}
              {file.duration.toFixed(2)}s · 32-bit Float
            </div>
          </div>
          {score > 0 && (
            <ScoreBadge score={score} verdict={verdict}/>
          )}
        </>
      ) : (
        <div style={{ fontSize:9, color:T.textDim }}>
          No file loaded — upload a WAV to begin analysis
        </div>
      )}
    </div>
  );
}

// ── Tab Bar ───────────────────────────────────────────────────────────────────
function TabBar({
  active, onChange, forensicProgress, forensicAnalyzing,
}: {
  active:            TabId;
  onChange:          (t: TabId) => void;
  forensicProgress:  number;
  forensicAnalyzing: boolean;
}) {
  return (
    <div style={{
      display:"flex", background:T.panel,
      borderBottom:`1px solid ${T.border}`,
      overflowX:"auto",
    }}>
      {TABS.map(tab => {
        const isActive = tab.id === active;
        const showBadge = tab.id === "forensic" && forensicAnalyzing;
        return (
          <button key={tab.id} onClick={() => onChange(tab.id)} style={{
            display:"flex", alignItems:"center", gap:6,
            padding:"10px 16px", cursor:"pointer",
            background:isActive?"#0a1a2a":"transparent",
            border:"none",
            borderBottom:isActive?`2px solid ${T.accent}`:"2px solid transparent",
            color:isActive?T.accent:T.textDim,
            fontSize:9, fontWeight:isActive?700:400,
            letterSpacing:1, whiteSpace:"nowrap",
            transition:"all 0.15s",
          }}>
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {showBadge && (
              <span style={{
                fontSize:7, color:T.accent,
                background:"#22d3ee22",
                padding:"1px 5px", borderRadius:3,
              }}>
                {forensicProgress}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function QCWorkstationV2() {
  const [activeTab, setActiveTab] = useState<TabId>("qc");
  const isVisibleRef = useRef<Record<TabId, boolean>>({
    qc: true, audition: false, forensic: false, repair: false,
  });

  const qc = useQCWorkstation();

  const handleTabChange = useCallback((tab: TabId) => {
    isVisibleRef.current[tab] = true;
    setActiveTab(tab);
  }, []);

  const score   = qc.analysis?.appenResult?.score   ?? 0;
  const verdict = qc.analysis?.appenResult?.verdict  ?? "—";

  // Workspace files for AuditionWorkspace
  const wsFiles = qc.file ? [{
    id:     "main",
    name:   qc.file.name,
    buffer: qc.activeBuffer ?? qc.file.buffer,
  }] : [];

  return (
    <div style={{
      display:"flex", flexDirection:"column",
      height:"100%", background:T.bg,
      fontFamily:"monospace", color:T.text,
      overflow:"hidden",
    }}>

      {/* Sticky File Header */}
      <FileHeader
        file={qc.file}
        score={score}
        verdict={verdict}
        loading={qc.loading}
        onUpload={qc.loadFile}
      />

      {/* Error */}
      {qc.error && (
        <div style={{
          padding:"6px 16px",
          background:"#ef444422",
          borderBottom:`1px solid #ef444444`,
          fontSize:9, color:T.red,
        }}>
          ⚠ {qc.error}
        </div>
      )}

      {/* Tab Bar */}
      <TabBar
        active={activeTab}
        onChange={handleTabChange}
        forensicProgress={qc.forensicProgress}
        forensicAnalyzing={qc.forensicAnalyzing}
      />

      {/* Tab Contents */}
      <div style={{ flex:1, overflow:"auto", position:"relative" }}>

        {/* Tab 1: QC Analysis */}
        <div style={{ display: activeTab==="qc" ? "block" : "none" }}>
          <QCAnalysisTabContent qc={qc}/>
        </div>

        {/* Tab 2: Audition Pro — visibility strategy (preserves WebGL) */}
        <div style={{
          visibility:  activeTab==="audition" ? "visible" : "hidden",
          height:      activeTab==="audition" ? "auto" : 0,
          overflow:    activeTab==="audition" ? "visible" : "hidden",
          position:    activeTab==="audition" ? "relative" : "absolute",
          width:       "100%",
        }}>
          {wsFiles.length > 0 && (
            <AuditionWorkspace
              files={wsFiles}
              activeId="main"
              onTabSelect={() => {}}
              onTabClose={() => {}}
              playheadSec={qc.playheadSec}
              playing={qc.isPlaying}
              onTogglePlay={qc.togglePlayback}
              onSeek={qc.seekTo}
            />
          )}
          {!qc.file && (
            <div style={{
              padding:40, textAlign:"center",
              color:T.textDim, fontSize:11,
            }}>
              Load a WAV file to open Audition Pro
            </div>
          )}
        </div>

        {/* Tab 3: Forensic Intel */}
        <div style={{ display: activeTab==="forensic" ? "block" : "none" }}>
          <ForensicTabContent qc={qc}/>
        </div>

        {/* Tab 4: Repair Suite */}
        <div style={{ display: activeTab==="repair" ? "block" : "none" }}>
          <RepairTabContent qc={qc}/>
        </div>

      </div>
    </div>
  );
}

// ── Spectrogram Canvas ───────────────────────────────────────────────────────
function SpectrogramCanvas({ data, colorMap="aivora" }: { data:any; colorMap?:string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const cv = canvasRef.current;
    if(!cv || !data) return;
    cv.width  = cv.offsetWidth  || 600;
    cv.height = cv.offsetHeight || 120;
    drawSpectrogramPro(cv, data, {
      colorMap: colorMap as any,
      logFreq:  true,
      gain:     1.3,
      showGrid: true,
      showLabels: true,
    });
  }, [data, colorMap]);

  return (
    <canvas ref={canvasRef} style={{
      width:"100%", height:120, display:"block",
      borderRadius:6, background:"#080808",
    }}/>
  );
}

// ── Tab 1: QC Analysis ────────────────────────────────────────────────────────
function QCAnalysisTabContent({ qc }: { qc: ReturnType<typeof useQCWorkstation> }) {
  if(!qc.file) return (
    <div style={{ padding:40, textAlign:"center", color:T.textDim, fontSize:11 }}>
      Load a WAV file to begin QC analysis
    </div>
  );

  if(qc.analysisLoading) return (
    <div style={{ padding:40, textAlign:"center", color:T.accent, fontSize:11 }}>
      ⟳ Analyzing...
    </div>
  );

  const r = qc.analysis?.rep;
  const a = qc.analysis?.appenResult;

  return (
    <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>

      {/* Appen Score */}
      {a && (
        <div style={{
          background:T.panel,
          border:`1px solid ${a.verdict==="READY"?"#10b98144":a.verdict==="FIX_REQUIRED"?"#f59e0b44":"#ef444444"}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ fontSize:9, color:T.textDim, letterSpacing:1, fontWeight:700 }}>
              QC DELIVERY REPORT
            </span>
            <ScoreBadge score={a.score} verdict={a.verdict}/>
          </div>
          <div style={{
            fontSize:10, color:T.text, marginBottom:10,
            padding:"6px 10px", background:"#050d14", borderRadius:6,
          }}>
            {a.summary}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {a.checks?.map((c: any, i: number) => (
              <div key={i} style={{
                display:"flex", alignItems:"center", gap:8,
                padding:"5px 8px", background:"#050d14", borderRadius:6,
                border:`1px solid ${c.passed?"#10b98122":c.critical?"#ef444433":"#f59e0b33"}`,
              }}>
                <span style={{ fontSize:11, color:c.passed?T.green:c.critical?T.red:T.yellow }}>
                  {c.passed?"✓":"✗"}
                </span>
                <span style={{ fontSize:10, color:T.text, flex:1 }}>{c.label}</span>
                <span style={{ fontSize:10, color:T.textDim, fontFamily:"monospace" }}>
                  {c.value}
                </span>
                {!c.passed && c.fix && (
                  <span style={{ fontSize:9, color:T.textDim, maxWidth:200, textAlign:"right" }}>
                    → {c.fix}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QC Metrics */}
      {r && (
        <div style={{
          background:T.panel, border:`1px solid ${T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:10 }}>
            TECHNICAL METRICS
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            {[
              ["Score",     `${r.score ?? 0}/100`],
              ["LUFS",      `${r.metrics?.lufs?.toFixed(1) ?? "—"}`],
              ["True Peak", `${r.metrics?.truePeak?.toFixed(2) ?? "—"} dBTP`],
              ["SNR",       `${r.metrics?.snrDb?.toFixed(1) ?? "—"} dB`],
              ["Noise",     r.metrics?.noiseClass ?? "—"],
              ["Env",       r.metrics?.environment ?? "—"],
            ].map(([label, value]) => (
              <div key={label} style={{
                background:"#050d14", border:`1px solid ${T.border}`,
                borderRadius:6, padding:"6px 8px",
              }}>
                <div style={{ fontSize:7, color:T.textDim }}>{label}</div>
                <div style={{ fontSize:10, color:T.accent, fontWeight:700, marginTop:2 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spectrogram */}
      {qc.analysis?.spectrogramData && (
        <div style={{
          background:T.panel, border:`1px solid ${T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{
            fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:8,
            display:"flex", justifyContent:"space-between", alignItems:"center",
          }}>
            <span>SPECTROGRAM</span>
            <span style={{ fontSize:7, color:"#1a3a4a" }}>
              Log frequency · Aivora colormap
            </span>
          </div>
          <SpectrogramCanvas data={qc.analysis.spectrogramData}/>
        </div>
      )}

      {/* Problems */}
      {r?.problems?.length > 0 && (
        <div style={{
          background:T.panel, border:`1px solid ${T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:10 }}>
            DETECTED PROBLEMS ({r.problems.length})
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {r.problems.map((p: any, i: number) => (
              <div key={i} style={{
                display:"flex", gap:8, padding:"5px 8px",
                background:"#050d14", borderRadius:6,
                border:`1px solid ${p.severity==="critical"?"#ef444433":"#f59e0b33"}`,
              }}>
                <span style={{
                  fontSize:9,
                  color:p.severity==="critical"?T.red:T.yellow,
                  flexShrink:0,
                }}>
                  {p.severity==="critical"?"🔴":"🟡"}
                </span>
                <div>
                  <div style={{ fontSize:9, color:T.text }}>{p.type}</div>
                  <div style={{ fontSize:7, color:T.textDim }}>{p.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Forensic Intel ─────────────────────────────────────────────────────
function ForensicTabContent({ qc }: { qc: ReturnType<typeof useQCWorkstation> }) {
  const { agentResult, forensicProgress, forensicAnalyzing, verdict } = qc;

  if(!qc.file) return (
    <div style={{ padding:40, textAlign:"center", color:T.textDim, fontSize:11 }}>
      Load a WAV file to run forensic analysis
    </div>
  );

  const s = agentResult.synthetic?.scores;

  return (
    <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>

      {/* Progress */}
      {forensicAnalyzing && (
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:12, padding:14 }}>
          <div style={{ fontSize:9, color:T.accent, marginBottom:8 }}>
            ⟳ Running 4-agent forensic analysis... {forensicProgress}%
          </div>
          <div style={{ height:3, background:T.border, borderRadius:2 }}>
            <div style={{
              height:"100%", width:`${forensicProgress}%`,
              background:T.accent, borderRadius:2,
              transition:"width 0.2s",
            }}/>
          </div>
        </div>
      )}

      {/* Radar + Verdict row */}
      {agentResult.synthetic && (() => {
        const s = agentResult.synthetic!.scores;
        const radarScores = [
          Math.max(0, Math.min(1, s.jitter     / 100)),
          Math.max(0, Math.min(1, s.shimmer    / 100)),
          Math.max(0, Math.min(1, s.bispectrum / 100)),
          Math.max(0, Math.min(1, s.cpp        / 100)),
          agentResult.artifact ? Math.max(0,1-agentResult.artifact.artifactScore) : 0,
          Math.max(0, Math.min(1, s.modulation / 100)),
        ];
        return (
          <div style={{
            display:"flex", gap:12, flexWrap:"wrap",
            background:T.panel, border:`1px solid ${T.border}`,
            borderRadius:12, padding:14,
          }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{ fontSize:9, color:T.textDim, letterSpacing:1 }}>NATURALNESS RADAR</div>
              <RadarChart
                scores={radarScores}
                labels={["Jitter","Shimmer","Bispec","CPP","Clean","Mod"]}
                colors={["#22d3ee","#10b981","#8b5cf6","#f59e0b","#10b981","#f97316"]}
                size={200}
              />
            </div>
            <div style={{ flex:1, minWidth:180 }}>
              <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:8 }}>
                PROVENANCE VERDICT
              </div>
              <div style={{
                padding:"10px 16px", borderRadius:8, marginBottom:8,
                background:`${verdict.label==="AUTHENTIC"?T.green:verdict.label==="SYNTHETIC"?T.red:T.yellow}15`,
                border:`1px solid ${verdict.label==="AUTHENTIC"?T.green:verdict.label==="SYNTHETIC"?T.red:T.yellow}44`,
                display:"flex", flexDirection:"column", alignItems:"center", gap:4,
              }}>
                <div style={{
                  fontSize:13, fontWeight:900, letterSpacing:2,
                  color:verdict.label==="AUTHENTIC"?T.green:verdict.label==="SYNTHETIC"?T.red:T.yellow,
                }}>
                  {verdict.label==="AUTHENTIC"?"✓":verdict.label==="SYNTHETIC"?"✗":"⚠"} {verdict.label}
                </div>
                <div style={{ fontSize:8, color:T.textDim }}>
                  Confidence:{" "}
                  <span style={{
                    color:verdict.label==="AUTHENTIC"?T.green:verdict.label==="SYNTHETIC"?T.red:T.yellow,
                    fontWeight:700,
                  }}>
                    {Math.round(verdict.confidence*100)}%
                  </span>
                </div>
              </div>
              <div style={{ fontSize:8, color:T.textDim }}>
                4 Web Workers · Bispectrum + CPP (ITU-T) + RT60 · Ensemble scoring
              </div>
            </div>
          </div>
        );
      })()}

      {/* Verdict — now inside radar block above */}

      {/* Synthetic scores */}
      {s && (
        <div style={{
          background:T.panel, border:`1px solid ${T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:12 }}>
            SYNTHETIC SPEECH DETECTION
          </div>
          {[
            ["Jitter RAP",       s.jitter,     "Vocal fold irregularity (YIN)"],
            ["Shimmer APQ-3",    s.shimmer,    "Amplitude perturbation"],
            ["Bispectrum",       s.bispectrum, "Phase coupling entropy B(k,k)"],
            ["CPP (ITU-T P.563)",s.cpp,        "Cepstral peak prominence"],
            ["Modulation 3-9Hz", s.modulation, "Syllabic rate FFT"],
          ].map(([label, val, detail]) => {
            // Clamp to 0-100 — bispectrum can return negative on some files
            const v = Math.max(0, Math.min(100, val as number));
            const color = v > 50 ? T.green : T.red;
            return (
              <div key={label as string} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ fontSize:9, color:T.text }}>{label as string}</span>
                  <span style={{ fontSize:9, color, fontWeight:700 }}>{v}%</span>
                </div>
                <div style={{ height:4, background:"#0a1a24", borderRadius:2, overflow:"hidden" }}>
                  <div style={{
                    height:"100%", width:`${v}%`,
                    background:color, borderRadius:2,
                    boxShadow:`0 0 6px ${color}66`,
                    transition:"width 0.5s",
                  }}/>
                </div>
                <div style={{ fontSize:7, color:T.textDim, marginTop:2 }}>{detail as string}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Room + Mic */}
      {agentResult.room && (
        <div style={{
          background:T.panel, border:`1px solid ${T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:10 }}>
            ACOUSTIC ENVIRONMENT
          </div>
          <div style={{
            padding:"6px 10px", borderRadius:6, marginBottom:8,
            background:"#22d3ee11", border:"1px solid #22d3ee22",
            display:"flex", justifyContent:"space-between",
          }}>
            <span style={{ fontSize:10, color:T.accent, fontWeight:700 }}>
              {agentResult.room.roomCategory.replace(/_/g," ").toUpperCase()}
            </span>
            <span style={{ fontSize:9, color:T.text }}>
              RT60: {agentResult.room.rt60Overall.toFixed(3)}s
            </span>
          </div>
          {agentResult.mic && (
            <div style={{
              padding:"6px 10px", borderRadius:6,
              background:"#8b5cf611", border:"1px solid #8b5cf622",
              display:"flex", justifyContent:"space-between",
            }}>
              <div>
                <div style={{ fontSize:7, color:T.textDim }}>Noise Floor</div>
                <div style={{ fontSize:10, color:"#8b5cf6", fontWeight:700 }}>
                  {agentResult.mic.noiseFloorDb.toFixed(1)} dBFS
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:7, color:T.textDim }}>Rolloff 95%</div>
                <div style={{ fontSize:10, color:"#8b5cf6", fontWeight:700 }}>
                  {agentResult.mic.rolloffHz >= 1000
                    ? (agentResult.mic.rolloffHz/1000).toFixed(1)+"kHz"
                    : agentResult.mic.rolloffHz+"Hz"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Artifact */}
      {agentResult.artifact && (
        <div style={{
          background:T.panel, border:`1px solid ${T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:8 }}>
            AI ARTIFACT DETECTION
          </div>
          <div style={{
            padding:"6px 10px", borderRadius:6,
            background:agentResult.artifact.clean?"#10b98122":"#ef444422",
            border:`1px solid ${agentResult.artifact.clean?"#10b98144":"#ef444444"}`,
            fontSize:10,
            color:agentResult.artifact.clean?T.green:T.red,
          }}>
            {agentResult.artifact.clean
              ? "✓ CLEAN — No AI artifacts detected"
              : `⚠ ${agentResult.artifact.dominantType.replace(/_/g," ").toUpperCase()}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Repair Suite ───────────────────────────────────────────────────────
function RepairTabContent({ qc }: { qc: ReturnType<typeof useQCWorkstation> }) {
  const [opts, setOpts] = React.useState({
    humRemoval:             false,
    humFrequency:           50 as 50|60,
    loudnessNormalize:      false,
    targetLufs:             -23,
    trimSilence:            false,
    shortenInternalSilence: false,
    noiseReduction:         false,
    noiseStrength:          0.7,
    dynamicCompression:     false,
    speechEQ:               false,
    profile:                "wakeword" as "wakeword"|"asr"|"tts"|"conversation",
  });
  const [repairing, setRepairing] = React.useState(false);
  const [result,    setResult]    = React.useState<any>(null);
  const [error,     setError]     = React.useState("");

  if(!qc.file) return (
    <div style={{ padding:40, textAlign:"center", color:T.textDim, fontSize:11 }}>
      Load a WAV file to access repair tools
    </div>
  );

  async function runRepair() {
    const buf = qc.file!.buffer;
    setRepairing(true); setError(""); setResult(null);
    try {
      const r = repairAudioBuffer(buf, opts, qc.file!.name);
      setResult(r);
      if(r.changed) qc.setRepairedBuffer(r.repairedBuffer);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Repair failed");
    }
    setRepairing(false);
  }

  const toggleOpt = (key: string) =>
    setOpts(p => ({ ...p, [key]: !(p as any)[key] }));

  const TOOLS = [
    { key:"noiseReduction",       label:"Noise Reduction",    icon:"🌊" },
    { key:"humRemoval",           label:"Hum Removal",        icon:"⚡" },
    { key:"trimSilence",          label:"Trim Silence",       icon:"✂️" },
    { key:"shortenInternalSilence",label:"Shorten Gaps",      icon:"⏩" },
    { key:"loudnessNormalize",    label:"Loudness Normalize", icon:"📊" },
    { key:"dynamicCompression",   label:"Compression",        icon:"🎚" },
    { key:"speechEQ",             label:"Speech EQ",          icon:"🎛" },
  ];

  return (
    <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>

      {/* Tools */}
      <div style={{
        background:T.panel, border:`1px solid ${T.border}`,
        borderRadius:12, padding:14,
      }}>
        <div style={{ fontSize:9, color:T.textDim, letterSpacing:1, marginBottom:10 }}>
          REPAIR TOOLS
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
          {TOOLS.map(({ key, label, icon }) => {
            const active = (opts as any)[key];
            return (
              <button key={key}
                onClick={() => toggleOpt(key)}
                style={{
                  padding:"6px 12px", borderRadius:6,
                  cursor:"pointer", fontSize:10, fontWeight:700,
                  background:active?"#10b98122":"#050d14",
                  border:`1px solid ${active?"#10b98166":T.border}`,
                  color:active?T.green:T.textDim,
                  display:"flex", alignItems:"center", gap:5,
                }}>
                <span>{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Sub-options */}
        {opts.noiseReduction && (
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            padding:"6px 10px", background:"#050d14",
            borderRadius:6, marginBottom:8,
          }}>
            <span style={{ fontSize:9, color:T.textDim }}>Strength:</span>
            <input type="range" min="0.1" max="1.0" step="0.1"
              value={opts.noiseStrength}
              onChange={e => setOpts(p => ({...p, noiseStrength:parseFloat(e.target.value)}))}
              style={{ width:80, accentColor:T.accent }}/>
            <span style={{ fontSize:9, color:T.accent }}>
              {Math.round(opts.noiseStrength*100)}%
            </span>
          </div>
        )}

        {opts.humRemoval && (
          <div style={{
            display:"flex", gap:6, marginBottom:8,
          }}>
            {([50,60] as const).map(f => (
              <button key={f}
                onClick={() => setOpts(p => ({...p, humFrequency:f}))}
                style={{
                  padding:"4px 12px", borderRadius:5, cursor:"pointer",
                  fontSize:10, fontWeight:700,
                  background:opts.humFrequency===f?"#f59e0b22":"#050d14",
                  border:`1px solid ${opts.humFrequency===f?"#f59e0b66":T.border}`,
                  color:opts.humFrequency===f?T.yellow:T.textDim,
                }}>
                {f}Hz
              </button>
            ))}
          </div>
        )}

        {opts.loudnessNormalize && (
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            padding:"6px 10px", background:"#050d14",
            borderRadius:6, marginBottom:8,
          }}>
            <span style={{ fontSize:9, color:T.textDim }}>Target LUFS:</span>
            <input type="range" min="-32" max="-14" step="0.5"
              value={opts.targetLufs}
              onChange={e => setOpts(p => ({...p, targetLufs:parseFloat(e.target.value)}))}
              style={{ width:80, accentColor:T.accent }}/>
            <span style={{ fontSize:9, color:T.accent }}>
              {opts.targetLufs} LUFS
            </span>
          </div>
        )}

        {/* Warning */}
        <div style={{
          padding:"6px 10px", background:"#050d14",
          borderRadius:6, fontSize:8, color:T.textDim,
          border:`1px solid ${T.border}`,
        }}>
          ⚠ Repairs are manual and should be reviewed before delivery
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={runRepair}
        disabled={repairing}
        style={{
          padding:"10px 20px", borderRadius:8, cursor:"pointer",
          fontWeight:700, fontSize:11, letterSpacing:1,
          background:repairing?"#1a2a3a":"#10b98122",
          border:`1px solid ${repairing?"#2a4a5a":"#10b98166"}`,
          color:repairing?T.textDim:T.green,
          transition:"all 0.2s",
        }}>
        {repairing ? "⟳ Repairing..." : "▶ Run Repair Suite"}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          padding:"8px 12px", borderRadius:6,
          background:"#ef444422", border:"1px solid #ef444444",
          fontSize:9, color:T.red,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          background:T.panel, border:`1px solid ${result.changed?T.green:T.border}`,
          borderRadius:12, padding:14,
        }}>
          <div style={{
            fontSize:9, color:result.changed?T.green:T.textDim,
            letterSpacing:1, marginBottom:10, fontWeight:700,
          }}>
            {result.changed ? "✓ REPAIR COMPLETE" : "ℹ NO CHANGES NEEDED"}
          </div>

          {result.operations.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
              {result.operations.map((op: string, i: number) => (
                <div key={i} style={{
                  fontSize:8, color:T.text,
                  padding:"3px 8px", background:"#050d14",
                  borderRadius:4, border:`1px solid ${T.border}`,
                }}>
                  ✓ {op}
                </div>
              ))}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
              {result.warnings.map((w: string, i: number) => (
                <div key={i} style={{
                  fontSize:8, color:T.yellow,
                  padding:"3px 8px", background:"#050d14",
                  borderRadius:4, border:"1px solid #f59e0b33",
                }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          {result.changed && (
            <button
              onClick={() => {
                const exported = exportToWav(result.repairedBuffer, result.exportNameSuggestion);
                downloadWav(exported);
              }}
              style={{
                width:"100%", padding:"8px 16px",
                borderRadius:6, cursor:"pointer",
                fontWeight:700, fontSize:10,
                background:"#10b98122",
                border:"1px solid #10b98166",
                color:T.green,
                display:"flex", alignItems:"center",
                justifyContent:"center", gap:6,
              }}>
              ⬇ Download Repaired WAV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
