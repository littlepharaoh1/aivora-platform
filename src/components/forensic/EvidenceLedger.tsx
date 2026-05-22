/**
 * EvidenceLedger.tsx — Court-style forensic evidence chain
 *
 * Fix: buildEvidence is pure function outside component (no recreation on render)
 * Fix: useMemo wraps buildEvidence — recomputes only when results changes
 * Fix: EvidenceItem imported from types.ts (single source of truth)
 */
import React, { useMemo } from "react";
import type { AgentResult, EvidenceItem } from "../../lib/forensics/types";

// Pure function — defined outside component, never recreated
function buildEvidence(results: AgentResult): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const { synthetic, artifact, room, mic } = results;

  if(synthetic) {
    items.push({
      source: "synthetic",
      ok:     synthetic.scores.jitter > 50,
      label:  "Vocal fold irregularity (RAP jitter + APQ-3 shimmer)",
      detail: `Jitter ${synthetic.scores.jitter}% · Shimmer ${
        synthetic.scores.shimmer}% · YIN normalized autocorrelation`,
    });
    items.push({
      source: "synthetic",
      ok:     synthetic.scores.bispectrum > 50,
      label:  "Bispectral phase coupling entropy",
      detail: `B(k,k) diagonal entropy ${
        synthetic.scores.bispectrum}% · TTS repetitive coupling < 40%`,
    });
    items.push({
      source: "synthetic",
      ok:     synthetic.scores.cpp > 50,
      label:  "Cepstral Peak Prominence (ITU-T P.563)",
      detail: `CPP ${synthetic.scores.cpp
        }% · liftered cepstrum + linear regression baseline`,
    });
    items.push({
      source: "synthetic",
      ok:     synthetic.scores.modulation > 40,
      label:  "Syllabic modulation spectrum (3-9 Hz)",
      detail: `${synthetic.scores.modulation
        }% band energy · FFT modulation · Hann-windowed`,
    });
  }

  if(artifact) {
    items.push({
      source: "artifact",
      ok:     artifact.clean,
      label:  "AI artifact signature (5-detector ensemble)",
      detail: [
        `Holes ${(artifact.scores.holeRatio   * 100).toFixed(1)}%`,
        `Comb ${(artifact.scores.combScore    * 100).toFixed(1)}%`,
        `Entropy ${(artifact.scores.entropy   * 100).toFixed(1)}%`,
        `BW ${(artifact.scores.bandwidth      * 100).toFixed(1)}%`,
        `Jumps ${(artifact.scores.phaseJumps  * 100).toFixed(1)}%`,
      ].join(" · "),
    });
  }

  if(room) {
    items.push({
      source: "room",
      ok:     true,
      label:  "Room acoustic fingerprint (Schroeder EDT)",
      detail: `${room.roomCategory.replace(/_/g, " ")} · RT60=${
        room.rt60Overall.toFixed(3)}s · α=${
        room.absorptionCoeff.toFixed(3)} · Biquad Q=1.5`,
    });
  }

  if(mic) {
    items.push({
      source: "mic",
      ok:     mic.noiseFloorDb < -40,
      label:  "Microphone noise floor & rolloff (32-band mel)",
      detail: `Floor ${mic.noiseFloorDb.toFixed(1)} dBFS · Rolloff ${
        mic.rolloffHz >= 1000
          ? (mic.rolloffHz / 1000).toFixed(1) + "kHz"
          : mic.rolloffHz + "Hz"
      } · Z-score normalized`,
    });
  }

  return items;
}

export default function EvidenceLedger({
  results,
}: { results: AgentResult }) {
  // Fix: useMemo — recomputes only when results changes
  const items = useMemo(() => buildEvidence(results), [results]);

  if(items.length === 0) return null;

  return (
    <div style={{
      background:"#060e18",
      border:"1px solid #0f2a3a",
      borderRadius:12, padding:14,
    }}>
      <div style={{
        fontSize:9, color:"#2a5a6a",
        letterSpacing:1, marginBottom:10,
        display:"flex", alignItems:"center", gap:8,
      }}>
        EVIDENCE LEDGER
        <span style={{
          fontSize:7, color:"#1a3a4a",
          background:"#0a1a24",
          padding:"1px 6px", borderRadius:3,
        }}>
          FORENSIC CHAIN OF CUSTODY
        </span>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {items.map((ev, i) => {
          const srcColor =
            ev.source === "room" ? "#22d3ee" :
            ev.source === "mic"  ? "#8b5cf6" :
            ev.ok ? "#10b981" : "#ef4444";

          const borderColor =
            ev.source === "room" || ev.source === "mic"
              ? `${srcColor}22`
              : ev.ok ? "#10b98122" : "#ef444422";

          return (
            <div key={i} style={{
              display:"flex", gap:10,
              padding:"6px 10px", borderRadius:6,
              background:"#050d14",
              border:`1px solid ${borderColor}`,
              alignItems:"flex-start",
            }}>
              <span style={{
                fontSize:11, color:srcColor,
                flexShrink:0, marginTop:1, fontWeight:700,
              }}>
                {ev.source === "room" ? "ℹ" :
                 ev.source === "mic"  ? "◈" :
                 ev.ok ? "✓" : "✗"}
              </span>
              <div style={{ flex:1 }}>
                <div style={{
                  fontSize:9, color:"#a0c4cc", marginBottom:2,
                }}>{ev.label}</div>
                <div style={{
                  fontSize:7, color:"#2a5a6a", lineHeight:1.4,
                }}>{ev.detail}</div>
              </div>
              <span style={{
                fontSize:7, color:srcColor,
                background:`${srcColor}11`,
                border:`1px solid ${srcColor}22`,
                padding:"1px 5px", borderRadius:3,
                flexShrink:0, marginTop:1,
                textTransform:"uppercase", letterSpacing:1,
              }}>{ev.source}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
