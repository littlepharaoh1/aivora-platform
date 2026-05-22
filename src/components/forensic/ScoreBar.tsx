/**
 * ScoreBar.tsx — Animated forensic score bar
 *
 * Fix: continuous RAF loop (not mount-only)
 * Fix: direct DOM manipulation — zero re-renders in animation loop
 * Fix: targRef + currRef initialized from value on mount (no blank frame)
 * Fix: cleanup on unmount
 */
import React, { useRef, useEffect } from "react";

interface ScoreBarProps {
  label:   string;
  value:   number;   // 0-1
  color:   string;
  detail?: string;
}

export default function ScoreBar({
  label, value, color, detail,
}: ScoreBarProps) {
  const rafRef  = useRef(0);
  const currRef = useRef(Math.max(0, Math.min(1, value)));
  const targRef = useRef(Math.max(0, Math.min(1, value)));
  const barRef  = useRef<HTMLDivElement>(null);
  const pctRef  = useRef<HTMLSpanElement>(null);

  // Sync target when value prop changes
  useEffect(() => {
    targRef.current = Math.max(0, Math.min(1, value));
  }, [value]);

  // Continuous RAF loop — runs until unmount
  useEffect(() => {
    function tick() {
      const diff = targRef.current - currRef.current;
      if(Math.abs(diff) > 0.001) {
        currRef.current += diff * 0.10;
      } else {
        currRef.current = targRef.current;
      }
      const pct = Math.round(currRef.current * 100);
      // Direct DOM — no setState, no re-render
      if(barRef.current)  barRef.current.style.width = pct + "%";
      if(pctRef.current)  pctRef.current.textContent  = pct + "%";
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // mount/unmount only — RAF runs continuously

  const initPct = Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <div style={{ marginBottom:8 }}>
      <div style={{
        display:"flex", justifyContent:"space-between", marginBottom:3,
      }}>
        <span style={{ fontSize:9, color:"#a0c4cc" }}>{label}</span>
        <span ref={pctRef} style={{ fontSize:9, color, fontWeight:700 }}>
          {initPct}%
        </span>
      </div>
      <div style={{
        height:4, background:"#0a1a24",
        borderRadius:2, overflow:"hidden",
      }}>
        <div ref={barRef} style={{
          height:"100%",
          width: initPct + "%",
          background: color,
          borderRadius:2,
          boxShadow:`0 0 6px ${color}66`,
        }}/>
      </div>
      {detail && (
        <div style={{ fontSize:7, color:"#2a5a6a", marginTop:2 }}>
          {detail}
        </div>
      )}
    </div>
  );
}
