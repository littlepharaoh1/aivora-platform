/**
 * RadarChart.tsx — Canvas Radar Chart
 *
 * Fixes:
 * 1. nRef + currentRef + targetRef initialized from scores on mount
 * 2. currentRef resets when scores.length changes
 * 3. ctx.save()/restore() isolates every shadow operation
 * 4. Labels at ly-7, scores at ly+6 (13px separation, no overlap)
 * 5. Single continuous RAF loop — no stale closure
 * 6. dpr-aware canvas sizing for sharp rendering
 */
import React, { useRef, useEffect } from "react";

interface RadarChartProps {
  scores: number[];
  labels: string[];
  colors: string[];
  size?:  number;
}

export default function RadarChart({
  scores, labels, colors, size = 240,
}: RadarChartProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef(0);

  // Fix: initialize from scores on mount — no blank first frame
  const nRef       = useRef(scores.length);
  const currentRef = useRef<number[]>(new Array(scores.length).fill(0));
  const targetRef  = useRef<number[]>([...scores]);

  // Sync targets; reset current if axis count changes
  useEffect(() => {
    if(scores.length !== nRef.current) {
      currentRef.current = new Array(scores.length).fill(0);
      nRef.current       = scores.length;
    }
    targetRef.current = scores.map(v => Math.max(0, Math.min(1, v)));
  }, [scores]);

  useEffect(() => {
    const cv = canvasRef.current;
    if(!cv) return;

    const dpr       = window.devicePixelRatio || 1;
    cv.width        = size * dpr;
    cv.height       = size * dpr;
    cv.style.width  = size + "px";
    cv.style.height = size + "px";

    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const W  = size, H = size;
    const cx = W / 2, cy = H / 2 + 8;
    const R  = Math.min(W, H) / 2 - 38;

    function frame() {
      const n = nRef.current;
      if(n === 0) { rafRef.current = requestAnimationFrame(frame); return; }

      // Lerp current → target
      for(let i = 0; i < n; i++) {
        const diff = (targetRef.current[i] ?? 0) - (currentRef.current[i] ?? 0);
        currentRef.current[i] = (currentRef.current[i] ?? 0) + diff * 0.07;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#040c14";
      ctx.fillRect(0, 0, W, H);

      // Grid rings
      [0.25, 0.5, 0.75, 1.0].forEach(r => {
        ctx.save();
        ctx.beginPath();
        for(let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * R * r;
          const y = cy + Math.sin(a) * R * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = r === 1 ? "rgba(15,42,58,0.9)" : "rgba(15,42,58,0.45)";
        ctx.lineWidth   = r === 1 ? 1.2 : 0.7;
        ctx.stroke();
        ctx.restore();
      });

      // Axis spokes
      for(let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.strokeStyle = "#0f2a3a";
        ctx.lineWidth   = 0.8;
        ctx.stroke();
        ctx.restore();
      }

      // Data polygon fill + stroke with glow
      ctx.save();
      ctx.beginPath();
      for(let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = (currentRef.current[i] ?? 0) * R;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle   = "rgba(34,211,238,0.07)";
      ctx.fill();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur  = 8;
      ctx.stroke();
      ctx.restore(); // isolates shadow from dots

      // Dots on data polygon vertices
      for(let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = (currentRef.current[i] ?? 0) * R;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle   = colors[i] || "#22d3ee";
        ctx.shadowColor = colors[i] || "#22d3ee";
        ctx.shadowBlur  = 6;
        ctx.fill();
        ctx.restore(); // isolates shadow from labels
      }

      // Labels at ly-7, scores at ly+6 — 13px separation
      for(let i = 0; i < n; i++) {
        const a   = (i / n) * Math.PI * 2 - Math.PI / 2;
        const lx  = cx + Math.cos(a) * (R + 18);
        const ly  = cy + Math.sin(a) * (R + 18);
        const pct = Math.round((currentRef.current[i] ?? 0) * 100);

        ctx.save();
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";

        // Axis label (dimmer, smaller)
        ctx.font      = "7px monospace";
        ctx.fillStyle = "#4a8a9a";
        ctx.fillText(labels[i] ?? "", lx, ly - 7);

        // Score (colored, bold)
        ctx.font      = "bold 8px monospace";
        ctx.fillStyle = colors[i] || "#22d3ee";
        ctx.fillText(pct + "%", lx, ly + 6);
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [labels, colors, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width:size, height:size, display:"block" }}
    />
  );
}
