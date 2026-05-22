/**
 * ForensicIntelPanel.tsx — Real-Time Multi-Agent Forensic Intelligence
 * Aivora Platform
 *
 * Architecture:
 * - 4 parallel Web Workers (zero-copy ArrayBuffer transfer)
 * - Stereo → mono mix (not just channel 0)
 * - isMounted guard on every worker callback
 * - Streaming results (UI updates as each agent completes)
 * - Verdict via useMemo (synthRisk + artRisk ensemble)
 * - AudioContext closed immediately after decode
 */

import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from "react";

import type { AgentResult, Verdict } from "../lib/forensics/types";
import {
  SYNTHETIC_WORKER_SRC,
  MIC_WORKER_SRC,
  ROOM_WORKER_SRC,
  ARTIFACT_WORKER_SRC,
  makeWorker,
} from "../lib/forensics/workers";

import RadarChart    from "./forensic/RadarChart";
import ScoreBar      from "./forensic/ScoreBar";
import VerdictBadge  from "./forensic/VerdictBadge";
import EvidenceLedger from "./forensic/EvidenceLedger";

// ── Theme ─────────────────────────────────────────────────────────────────────
const T = {
  bg:      "#040c14",
  panel:   "#060e18",
  border:  "#0f2a3a",
  accent:  "#22d3ee",
  green:   "#10b981",
  red:     "#ef4444",
  yellow:  "#f59e0b",
  orange:  "#f97316",
  purple:  "#8b5cf6",
  text:    "#a0c4cc",
  textDim: "#2a5a6a",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function monoMix(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for(let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for(let i = 0; i < buf.length; i++)
      out[i] += data[i] / buf.numberOfChannels;
  }
  return out;
}

function workerCopy(mono: Float32Array): ArrayBuffer {
  // Create independent ArrayBuffer copy — safe to transfer to worker
  const copy = new ArrayBuffer(mono.byteLength);
  new Float32Array(copy).set(mono);
  return copy;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ForensicIntelPanel() {
  const [analyzing,  setAnalyzing]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [results,    setResults]    = useState<AgentResult>({});
  const [fileBuffer, setFileBuffer] = useState<AudioBuffer|null>(null);
  const [fileName,   setFileName]   = useState("");
  const [error,      setError]      = useState("");

  const mountedRef  = useRef(true);
  const workersRef  = useRef<Worker[]>([]);
  const fileRef     = useRef<HTMLInputElement>(null);

  // isMounted lifecycle
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workersRef.current.forEach(w => w.terminate());
    };
  }, []);

  // ── Run Analysis ────────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async (
    buf: AudioBuffer, name: string
  ) => {
    if(!mountedRef.current) return;

    setAnalyzing(true);
    setProgress(0);
    setResults({});
    setError("");
    setFileName(name);

    // Terminate previous workers
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];

    const sr    = buf.sampleRate;
    const mono  = monoMix(buf);
    const id    = Date.now();
    let   done  = 0;
    const total = 4;
    const partial: AgentResult = {};

    const srcs = [
      SYNTHETIC_WORKER_SRC,
      MIC_WORKER_SRC,
      ROOM_WORKER_SRC,
      ARTIFACT_WORKER_SRC,
    ];

    srcs.forEach(src => {
      const w = makeWorker(src);
      workersRef.current.push(w);

      w.onmessage = (e: MessageEvent) => {
        if(!mountedRef.current) return; // guard
        const { type, result } = e.data;
        (partial as Record<string, unknown>)[type] = result;
        done++;
        setProgress(Math.round(done / total * 100));
        setResults({ ...partial });
        if(done === total) setAnalyzing(false);
      };

      w.onerror = () => {
        if(!mountedRef.current) return;
        done++;
        setProgress(Math.round(done / total * 100));
        if(done === total) setAnalyzing(false);
      };

      // Worker timeout: 15 seconds per agent
      const timeout = setTimeout(() => {
        if(!mountedRef.current) return;
        if(done < total) {
          w.terminate();
          done++;
          setProgress(Math.round(done / total * 100));
          if(done === total) setAnalyzing(false);
        }
      }, 15000);

      // Clear timeout when worker responds
      const origOnMessage = w.onmessage;
      w.onmessage = (e: MessageEvent) => {
        clearTimeout(timeout);
        origOnMessage?.call(w, e);
      };

      // Each worker gets its own copy — transfer is destructive
      const copy = workerCopy(mono);
      w.postMessage({ samples: copy, sr, id }, [copy]);
    });
  }, []);

  // ── File Load ───────────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    if(!file.name.toLowerCase().endsWith(".wav")) {
      setError("Please upload a WAV file"); return;
    }

    // File size limit: 200MB
    const MAX_BYTES = 200 * 1024 * 1024;
    if(file.size > MAX_BYTES) {
      setError(`File too large (${(file.size/1024/1024).toFixed(0)}MB). Max: 200MB`);
      return;
    }

    setError("");
    try {
      const ab  = await file.arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(ab);
      ctx.close();

      // Duration limit: 30 minutes
      const MAX_DURATION = 30 * 60;
      if(buf.duration > MAX_DURATION) {
        setError(`File too long (${(buf.duration/60).toFixed(1)} min). Max: 30 min`);
        return;
      }

      setFileBuffer(buf);
      runAnalysis(buf, file.name);
    } catch(err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if(msg.includes("Unable to decode")) {
        setError("Corrupted or unsupported audio format");
      } else if(msg.includes("out of memory") || msg.includes("memory")) {
        setError("Not enough memory — try a shorter file");
      } else {
        setError("Failed to decode audio — ensure it is a valid WAV file");
      }
    }
  }

  // ── Derived State ────────────────────────────────────────────────────────────
  const verdict = useMemo((): Verdict => {
    if(!results.synthetic) return { label:"PENDING", confidence:0 };
    // synthRisk is non-zero only if isSynthetic=true
    const synthRisk = results.synthetic.isSynthetic
      ? results.synthetic.confidence : 0;
    const artRisk   = results.artifact?.artifactScore ?? 0;
    const risk      = synthRisk * 0.65 + artRisk * 0.35;

    if(risk > 0.65) return { label:"SYNTHETIC",  confidence: risk };
    if(risk > 0.45) return { label:"SUSPICIOUS",  confidence: risk };
    return               { label:"AUTHENTIC",  confidence: 1 - risk };
  }, [results]);

  const radarScores = useMemo(() => {
    const s = results.synthetic?.scores;
    return [
      (s?.jitter     ?? 0) / 100,
      (s?.shimmer    ?? 0) / 100,
      (s?.bispectrum ?? 0) / 100,
      (s?.cpp        ?? 0) / 100,
      results.artifact ? 1 - results.artifact.artifactScore : 0,
      (s?.modulation ?? 0) / 100,
    ];
  }, [results]);

  const radarLabels = ["Jitter", "Shimmer", "Bispec", "CPP", "Clean", "Mod"];
  const radarColors = [
    T.accent, T.green, T.purple, T.yellow, T.green, T.orange,
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: T.bg, minHeight:"100%",
      fontFamily:"monospace", color: T.text,
    }}>

      {/* Header */}
      <div style={{
        background:"linear-gradient(135deg,#060e18,#071a18)",
        borderBottom:`1px solid ${T.border}`,
        padding:"14px 18px",
        display:"flex", alignItems:"center", gap:12,
      }}>
        <div style={{
          width:36, height:36, borderRadius:10,
          background:"#22d3ee22", border:"1px solid #22d3ee44",
          display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:18,
        }}>🔬</div>

        <div>
          <div style={{
            fontSize:13, fontWeight:700,
            color:"#e0f2f8", letterSpacing:1,
          }}>
            FORENSIC INTELLIGENCE ENGINE
          </div>
          <div style={{
            fontSize:9, color: T.textDim, letterSpacing:2,
          }}>
            BISPECTRUM · CPP (ITU-T P.563) · RAP JITTER · RT60 · 4-AGENT PARALLEL
          </div>
        </div>

        <div style={{
          marginLeft:"auto", display:"flex",
          gap:8, alignItems:"center",
        }}>
          {analyzing && (
            <div style={{ fontSize:9, color: T.accent }}>
              ⟳ {progress}%
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              background:"#22d3ee22",
              border:"1px solid #22d3ee44",
              borderRadius:6, padding:"6px 14px",
              cursor:"pointer", color:"#22d3ee",
              fontSize:10, fontWeight:700,
            }}>
            📂 Load WAV
          </button>
          <input
            ref={fileRef} type="file" accept=".wav" hidden
            onChange={e => {
              if(e.target.files?.[0]) handleFile(e.target.files[0]);
            }}
          />
        </div>
      </div>

      {/* Progress bar */}
      {analyzing && (
        <div style={{ height:2, background: T.border }}>
          <div style={{
            height:"100%", width:`${progress}%`,
            background: T.accent, transition:"width 0.15s",
          }}/>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding:"8px 18px",
          background:"#ef444422",
          borderBottom:`1px solid #ef444444`,
          fontSize:10, color: T.red,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Empty state */}
      {!fileBuffer && !analyzing && (
        <div style={{
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center",
          gap:16, padding:60, opacity:0.4,
        }}>
          <div style={{ fontSize:48 }}>🔬</div>
          <div style={{
            fontSize:13, color: T.textDim, textAlign:"center",
          }}>
            Load a WAV file to run<br/>
            4-agent parallel forensic analysis
          </div>
        </div>
      )}

      {/* Results */}
      {(fileBuffer || analyzing) && (
        <div style={{
          padding:16, display:"flex",
          flexDirection:"column", gap:12,
        }}>

          {/* File info + Verdict */}
          <div style={{
            background: T.panel, border:`1px solid ${T.border}`,
            borderRadius:12, padding:16,
            display:"flex", gap:16,
            alignItems:"center", flexWrap:"wrap",
          }}>
            <div style={{ flex:1 }}>
              <div style={{
                fontSize:12, color:"#e0f2f8",
                fontWeight:700, marginBottom:4,
              }}>
                {fileName || "Analyzing..."}
              </div>
              {fileBuffer && (
                <>
                  <div style={{ fontSize:9, color: T.textDim }}>
                    {fileBuffer.sampleRate}Hz ·{" "}
                    {fileBuffer.numberOfChannels === 1 ? "Mono" : "Stereo"} ·{" "}
                    {fileBuffer.duration.toFixed(2)}s · 32-bit Float
                  </div>
                  <div style={{
                    fontSize:8, color: T.textDim, marginTop:3,
                  }}>
                    4 Web Workers · Bispectrum + CPP (ITU-T) + Modulation FFT · Ensemble scoring
                  </div>
                </>
              )}
            </div>
            {results.synthetic && (
              <VerdictBadge verdict={verdict}/>
            )}
          </div>

          {/* 2×2 grid */}
          <div style={{
            display:"grid",
            gridTemplateColumns:"1fr 1fr",
            gap:12,
          }}>

            {/* Radar Chart */}
            <div style={{
              background: T.panel, border:`1px solid ${T.border}`,
              borderRadius:12, padding:14,
              display:"flex", flexDirection:"column",
              alignItems:"center", gap:8,
            }}>
              <div style={{
                fontSize:9, color: T.textDim,
                letterSpacing:1, alignSelf:"flex-start",
              }}>
                NATURALNESS RADAR
              </div>
              <RadarChart
                scores={radarScores}
                labels={radarLabels}
                colors={radarColors}
                size={220}
              />
            </div>

            {/* Synthetic Detection */}
            <div style={{
              background: T.panel, border:`1px solid ${T.border}`,
              borderRadius:12, padding:14,
            }}>
              <div style={{
                fontSize:9, color: T.textDim,
                letterSpacing:1, marginBottom:12,
              }}>
                SYNTHETIC SPEECH DETECTION
              </div>
              {results.synthetic ? (
                <>
                  <ScoreBar
                    label="Jitter RAP"
                    value={results.synthetic.scores.jitter / 100}
                    color={results.synthetic.scores.jitter > 50 ? T.green : T.red}
                    detail="Vocal fold cycle-to-cycle irregularity (YIN)"
                  />
                  <ScoreBar
                    label="Shimmer APQ-3"
                    value={results.synthetic.scores.shimmer / 100}
                    color={results.synthetic.scores.shimmer > 50 ? T.green : T.red}
                    detail="Amplitude perturbation quotient (3-point)"
                  />
                  <ScoreBar
                    label="Bispectrum phase"
                    value={results.synthetic.scores.bispectrum / 100}
                    color={results.synthetic.scores.bispectrum > 50 ? T.green : T.yellow}
                    detail="B(k,k) diagonal entropy — phase coupling"
                  />
                  <ScoreBar
                    label="CPP (ITU-T P.563)"
                    value={results.synthetic.scores.cpp / 100}
                    color={results.synthetic.scores.cpp > 50 ? T.green : T.red}
                    detail="Cepstral peak prominence with liftering + regression"
                  />
                  <ScoreBar
                    label="Modulation 3-9Hz"
                    value={results.synthetic.scores.modulation / 100}
                    color={results.synthetic.scores.modulation > 50 ? T.green : T.yellow}
                    detail="Syllabic rate via modulation FFT spectrum"
                  />
                  <div style={{
                    marginTop:8, padding:"6px 10px", borderRadius:6,
                    background: results.synthetic.isSynthetic
                      ? "#ef444422" : "#10b98122",
                    border:`1px solid ${results.synthetic.isSynthetic
                      ? "#ef444444" : "#10b98144"}`,
                    fontSize:9,
                    color: results.synthetic.isSynthetic ? T.red : T.green,
                  }}>
                    {results.synthetic.isSynthetic
                      ? `⚠ SYNTHETIC — ${Math.round(results.synthetic.confidence * 100)}% confidence`
                      : `✓ NATURAL — ${Math.round(results.synthetic.naturalness * 100)}% naturalness`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize:9, color: T.textDim }}>
                  {analyzing ? "Computing..." : "—"}
                </div>
              )}
            </div>

            {/* Artifact Detection */}
            <div style={{
              background: T.panel, border:`1px solid ${T.border}`,
              borderRadius:12, padding:14,
            }}>
              <div style={{
                fontSize:9, color: T.textDim,
                letterSpacing:1, marginBottom:12,
              }}>
                AI ARTIFACT DETECTION
              </div>
              {results.artifact ? (
                <>
                  <ScoreBar
                    label="Spectral holes"
                    value={Math.max(0, 1 - results.artifact.scores.holeRatio * 8)}
                    color={results.artifact.scores.holeRatio < 0.05 ? T.green : T.red}
                    detail="Over-suppression (3-bin context window)"
                  />
                  <ScoreBar
                    label="Comb filter"
                    value={Math.max(0, 1 - results.artifact.scores.combScore)}
                    color={results.artifact.scores.combScore < 0.25 ? T.green : T.orange}
                    detail="Metallic resonance (spacing scan 4-40 bins)"
                  />
                  <ScoreBar
                    label="Spectral entropy"
                    value={results.artifact.scores.entropy}
                    color={results.artifact.scores.entropy > 0.7 ? T.green : T.yellow}
                    detail="Shannon entropy — natural vs artificial"
                  />
                  <ScoreBar
                    label="Bandwidth"
                    value={results.artifact.scores.bandwidth}
                    color={results.artifact.scores.bandwidth > 0.75 ? T.green : T.yellow}
                    detail="High-frequency coverage (TTS cuts at 8-16kHz)"
                  />
                  <ScoreBar
                    label="Phase continuity"
                    value={Math.max(0, 1 - results.artifact.scores.phaseJumps * 10)}
                    color={results.artifact.scores.phaseJumps < 0.05 ? T.green : T.orange}
                    detail="Energy jump detection (edit stitching)"
                  />
                  <div style={{
                    marginTop:8, padding:"6px 10px", borderRadius:6,
                    background: results.artifact.clean
                      ? "#10b98122" : "#ef444422",
                    border:`1px solid ${results.artifact.clean
                      ? "#10b98144" : "#ef444444"}`,
                    fontSize:9,
                    color: results.artifact.clean ? T.green : T.red,
                  }}>
                    {results.artifact.clean
                      ? "✓ CLEAN — No AI artifacts detected"
                      : `⚠ ${results.artifact.dominantType.replace(/_/g," ").toUpperCase()}`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize:9, color: T.textDim }}>
                  {analyzing ? "Computing..." : "—"}
                </div>
              )}
            </div>

            {/* Room + Mic */}
            <div style={{
              background: T.panel, border:`1px solid ${T.border}`,
              borderRadius:12, padding:14,
            }}>
              <div style={{
                fontSize:9, color: T.textDim,
                letterSpacing:1, marginBottom:12,
              }}>
                ACOUSTIC ENVIRONMENT
              </div>
              {results.room ? (
                <>
                  <div style={{
                    padding:"6px 10px", borderRadius:6,
                    marginBottom:10,
                    background:"#22d3ee11",
                    border:"1px solid #22d3ee22",
                    display:"flex",
                    justifyContent:"space-between",
                    alignItems:"center",
                  }}>
                    <span style={{
                      fontSize:10, color: T.accent, fontWeight:700,
                    }}>
                      {results.room.roomCategory.replace(/_/g," ").toUpperCase()}
                    </span>
                    <span style={{ fontSize:9, color: T.text }}>
                      RT60₁ₖ: {results.room.rt60Overall.toFixed(3)}s
                    </span>
                  </div>

                  {/* RT60 per band */}
                  <div style={{
                    display:"grid",
                    gridTemplateColumns:"1fr 1fr 1fr",
                    gap:4, marginBottom:8,
                  }}>
                    {Object.entries(results.room.rt60s).map(([f, v]) => {
                      const val = v as number;
                      const c = val < 0.3 ? T.green
                              : val < 0.6 ? T.yellow : T.red;
                      return (
                        <div key={f} style={{
                          background:"#050d14",
                          border:`1px solid ${T.border}`,
                          borderRadius:4, padding:"3px 6px",
                          display:"flex",
                          justifyContent:"space-between",
                          alignItems:"center",
                        }}>
                          <span style={{
                            fontSize:7, color: T.textDim,
                          }}>{f}Hz</span>
                          <span style={{
                            fontSize:8, color: c, fontWeight:700,
                          }}>{val.toFixed(2)}s</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Absorption */}
                  <div style={{
                    padding:"4px 8px", borderRadius:4,
                    background:"#050d14",
                    border:`1px solid ${T.border}`,
                    display:"flex",
                    justifyContent:"space-between",
                    marginBottom:8,
                  }}>
                    <span style={{ fontSize:8, color: T.textDim }}>
                      Absorption α
                    </span>
                    <span style={{
                      fontSize:8, color: T.accent,
                    }}>
                      {results.room.absorptionCoeff.toFixed(3)}
                    </span>
                  </div>

                  {/* Mic fingerprint */}
                  {results.mic && (
                    <div style={{
                      padding:"6px 10px", borderRadius:6,
                      background:"#8b5cf611",
                      border:"1px solid #8b5cf622",
                    }}>
                      <div style={{
                        fontSize:8, color: T.textDim, marginBottom:4,
                      }}>
                        MIC FINGERPRINT
                      </div>
                      <div style={{
                        display:"flex",
                        justifyContent:"space-between",
                      }}>
                        <div>
                          <div style={{
                            fontSize:10, color:"#8b5cf6", fontWeight:700,
                          }}>
                            {results.mic.noiseFloorDb.toFixed(1)} dBFS
                          </div>
                          <div style={{
                            fontSize:7, color: T.textDim,
                          }}>noise floor</div>
                          <div style={{
                            fontSize:7, color: T.textDim, marginTop:2,
                          }}>
                            {results.mic.noiseFloorDb < -60 ? "Studio grade"
                            : results.mic.noiseFloorDb < -45 ? "Professional"
                            : results.mic.noiseFloorDb < -30 ? "Consumer"
                            : "High noise"}
                          </div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{
                            fontSize:10, color:"#8b5cf6", fontWeight:700,
                          }}>
                            {results.mic.rolloffHz >= 1000
                              ? (results.mic.rolloffHz / 1000).toFixed(1) + "kHz"
                              : results.mic.rolloffHz + "Hz"}
                          </div>
                          <div style={{
                            fontSize:7, color: T.textDim,
                          }}>rolloff 95%</div>
                          <div style={{
                            fontSize:7, color: T.textDim, marginTop:2,
                          }}>32-band mel</div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize:9, color: T.textDim }}>
                  {analyzing ? "Computing..." : "—"}
                </div>
              )}
            </div>
          </div>

          {/* Evidence Ledger */}
          {Object.keys(results).length > 0 && (
            <EvidenceLedger results={results}/>
          )}

        </div>
      )}
    </div>
  );
}
