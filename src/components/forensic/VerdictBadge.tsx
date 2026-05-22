/**
 * VerdictBadge.tsx — Animated forensic verdict display
 *
 * Fix: cleanup on timeout to prevent memory leak
 * Fix: fade-in animation tied to verdict.label change
 */
import React, { useEffect, useState } from "react";
import type { Verdict } from "../../lib/forensics/types";

const COLORS: Record<string, string> = {
  AUTHENTIC:  "#10b981",
  SUSPICIOUS: "#f59e0b",
  SYNTHETIC:  "#ef4444",
  PENDING:    "#2a5a6a",
};

const ICONS: Record<string, string> = {
  AUTHENTIC:  "✓",
  SUSPICIOUS: "⚠",
  SYNTHETIC:  "✗",
  PENDING:    "⟳",
};

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const [visible, setVisible] = useState(false);

  // Fade-in on every label change; cleanup prevents memory leak
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, [verdict.label]);

  const color = COLORS[verdict.label] ?? "#2a5a6a";
  const icon  = ICONS[verdict.label]  ?? "?";
  const pct   = Math.round(verdict.confidence * 100);

  return (
    <div style={{
      padding:"10px 20px", borderRadius:8,
      background:`${color}15`,
      border:`1px solid ${color}44`,
      display:"flex", flexDirection:"column",
      alignItems:"center", gap:5,
      opacity:   visible ? 1 : 0,
      transform: visible ? "scale(1)" : "scale(0.96)",
      transition:"opacity 0.25s ease, transform 0.25s ease",
      boxShadow: verdict.label !== "PENDING"
        ? `0 0 16px ${color}22` : "none",
    }}>
      <div style={{
        fontSize:11, fontWeight:900, color,
        letterSpacing:2,
        display:"flex", alignItems:"center", gap:6,
      }}>
        <span style={{ fontSize:13 }}>{icon}</span>
        {verdict.label}
      </div>
      {verdict.label !== "PENDING" && (
        <>
          <div style={{
            width:80, height:3,
            background:"#0a1a24",
            borderRadius:2, overflow:"hidden",
          }}>
            <div style={{
              height:"100%", width:`${pct}%`,
              background:color, borderRadius:2,
              boxShadow:`0 0 4px ${color}`,
            }}/>
          </div>
          <div style={{ fontSize:8, color:"#2a5a6a" }}>
            Confidence:{" "}
            <span style={{ color, fontWeight:700 }}>{pct}%</span>
          </div>
        </>
      )}
    </div>
  );
}
