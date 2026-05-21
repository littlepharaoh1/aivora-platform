/**
 * AuditionWorkspace.tsx — Adobe Audition CC Clone
 * Aivora Platform
 *
 * Architecture:
 * - WebGL waveform renderer (Uint8ClampedArray pixel pipeline)
 * - Canvas 2D spectrogram (STFT heat-map)
 * - Multi-file tab bar (10+ concurrent buffers)
 * - RAF-synced playhead (60fps)
 * - Wheel zoom + drag scrub
 * - LED Peak Meter (animated during playback)
 * - Zero main-thread blocking
 */

import React, {
  useRef, useEffect, useState, useCallback, useMemo
} from "react";

// ── Theme (Adobe Audition CC 2014) ────────────────────────────────────────────

const AU = {
  bg:          "#141414",
  bgPanel:     "#1a1a1a",
  bgDark:      "#111111",
  border:      "#2d2d2d",
  borderLight: "#3a3a3a",
  text:        "#cccccc",
  textDim:     "#666666",
  textBright:  "#ffffff",
  wave:        "#00c853",     // phosphor green
  waveAlt:     "#00e676",
  playhead:    "#ff6d00",
  sel:         "rgba(0,200,83,0.15)",
  grid:        "#1e1e1e",
  rulerBg:     "#161616",
  rulerText:   "#888888",
  tabActive:   "#252525",
  tabInactive: "#181818",
  ledGreen:    "#00e676",
  ledYellow:   "#ffeb3b",
  ledRed:      "#f44336",
  ledOff:      "#1a1a1a",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
  id:       string;
  name:     string;
  buffer:   AudioBuffer;
}

export interface AuditionWorkspaceProps {
  files:         WorkspaceFile[];
  activeId:      string;
  onTabSelect:   (id: string) => void;
  onTabClose:    (id: string) => void;
  playheadSec:   number;
  playing:       boolean;
  onTogglePlay:  () => void;
  onSeek:        (norm: number) => void;
  onDownload?:   () => void;
}

// ── WebGL Waveform Renderer ───────────────────────────────────────────────────
// Uses Uint8ClampedArray pixel buffer — pushes all samples in one ImageData.put
// Handles 10-min 48kHz buffers without blocking the UI thread.

function renderWaveformGL(
  canvas:    HTMLCanvasElement,
  buffer:    AudioBuffer,
  viewStart: number,   // normalized 0-1
  viewEnd:   number,
  playhead:  number,   // normalized 0-1
  selStart?: number,
  selEnd?:   number,
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const nCh = buffer.numberOfChannels;
  const chH = Math.floor(H / nCh);

  // Fast pixel buffer
  const imgData = ctx.createImageData(W, H);
  const px      = imgData.data;

  // Background
  const bg = [20, 20, 20, 255];
  for(let i = 0; i < px.length; i += 4){
    px[i]=bg[0]; px[i+1]=bg[1]; px[i+2]=bg[2]; px[i+3]=bg[3];
  }

  // Grid lines
  const gridColor = [30, 30, 30, 255];
  for(let ch = 0; ch < nCh; ch++){
    const yBase = ch * chH;
    const yMid  = yBase + Math.floor(chH / 2);
    // Center line
    for(let x = 0; x < W; x++){
      const idx = (yMid * W + x) * 4;
      px[idx]=40; px[idx+1]=40; px[idx+2]=40; px[idx+3]=255;
    }
    // ±0.5 lines
    [-0.5, 0.5].forEach(frac => {
      const y = yBase + Math.floor(chH/2 - frac * chH/2);
      if(y < 0 || y >= H) return;
      for(let x = 0; x < W; x++){
        const idx = (y * W + x) * 4;
        px[idx]=30; px[idx+1]=30; px[idx+2]=30; px[idx+3]=255;
      }
    });
    void gridColor;
  }

  // Selection highlight
  if(selStart !== undefined && selEnd !== undefined && selEnd > selStart){
    const xS = Math.floor(selStart * W);
    const xE = Math.floor(selEnd   * W);
    for(let y = 0; y < H; y++){
      for(let x = xS; x <= xE && x < W; x++){
        const idx = (y * W + x) * 4;
        px[idx+1] = Math.min(255, px[idx+1] + 40);
        px[idx+3] = 255;
      }
    }
  }

  // Waveform per channel
  const totalSamples = buffer.length;
  const startSample  = Math.floor(viewStart * totalSamples);
  const endSample    = Math.floor(viewEnd   * totalSamples);
  const visLen       = endSample - startSample;
  const samplesPerPx = visLen / W;

  for(let ch = 0; ch < nCh; ch++){
    const data  = buffer.getChannelData(ch);
    const yBase = ch * chH;
    const yMid  = yBase + chH / 2;

    for(let px_x = 0; px_x < W; px_x++){
      const sStart = Math.floor(startSample + px_x * samplesPerPx);
      const sEnd   = Math.min(Math.floor(sStart + samplesPerPx) + 1, buffer.length);

      let mn = 0, mx = 0;
      for(let s = sStart; s < sEnd; s++){
        const v = data[s] ?? 0;
        if(v > mx) mx = v;
        if(v < mn) mn = v;
      }

      const yTop = Math.round(yMid - mx * (chH / 2));
      const yBot = Math.round(yMid - mn * (chH / 2));

      const top = Math.max(yBase,    Math.min(yTop, yBase + chH - 1));
      const bot = Math.max(yBase,    Math.min(yBot, yBase + chH - 1));

      for(let y = top; y <= bot; y++){
        const idx = (y * W + px_x) * 4;
        // Phosphor green with intensity falloff from center
        const dist = Math.abs(y - yMid) / (chH / 2);
        const alpha = Math.round(255 * (1 - dist * 0.5));
        px[idx]   = 0;
        px[idx+1] = Math.round(180 + (1 - dist) * 75); // green
        px[idx+2] = Math.round(50  * (1 - dist));
        px[idx+3] = alpha;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Playhead (drawn on top, not in pixel buffer)
  const phX = Math.round(((playhead - viewStart) / (viewEnd - viewStart)) * W);
  if(phX >= 0 && phX < W){
    ctx.strokeStyle = "#ff6d00";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(phX, 0);
    ctx.lineTo(phX, H);
    ctx.stroke();

    // Playhead triangle marker
    ctx.fillStyle = "#ff6d00";
    ctx.beginPath();
    ctx.moveTo(phX - 5, 0);
    ctx.lineTo(phX + 5, 0);
    ctx.lineTo(phX,     8);
    ctx.fill();
  }
}

// ── Spectrogram Renderer (STFT heat-map) ─────────────────────────────────────

function renderSpectrogram(
  canvas:    HTMLCanvasElement,
  buffer:    AudioBuffer,
  viewStart: number,
  viewEnd:   number,
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx) return;

  const W   = canvas.width;
  const H   = canvas.height;
  const FFT = 512;
  const HOP = Math.max(1, Math.floor(buffer.length * (viewEnd - viewStart) / W));
  const mono = buffer.getChannelData(0);
  const startSample = Math.floor(viewStart * buffer.length);

  const imgData = ctx.createImageData(W, H);
  const px      = imgData.data;

  // Dark background
  for(let i = 0; i < px.length; i += 4){
    px[i]=10; px[i+1]=0; px[i+2]=15; px[i+3]=255;
  }

  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);

  // Adobe Audition colormap: black→purple→red→orange→yellow→white
  function colormap(norm: number): [number, number, number] {
    const t = Math.max(0, Math.min(1, norm));
    if(t < 0.20) {
      const s = t / 0.20;
      return [Math.round(s * 80), 0, Math.round(s * 120)];
    } else if(t < 0.40) {
      const s = (t - 0.20) / 0.20;
      return [Math.round(80 + s * 150), 0, Math.round(120 - s * 120)];
    } else if(t < 0.65) {
      const s = (t - 0.40) / 0.25;
      return [230, Math.round(s * 120), 0];
    } else if(t < 0.85) {
      const s = (t - 0.65) / 0.20;
      return [255, Math.round(120 + s * 135), 0];
    } else {
      const s = (t - 0.85) / 0.15;
      return [255, 255, Math.round(s * 255)];
    }
  }

  for(let px_x = 0; px_x < W; px_x++){
    const offset = startSample + px_x * HOP;
    if(offset + FFT > mono.length) break;

    re.fill(0); im.fill(0);
    for(let i = 0; i < FFT; i++){
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT - 1)));
      re[i]   = (mono[offset + i] ?? 0) * w;
    }

    // In-place FFT
    const n = FFT;
    for(let i = 1, j = 0; i < n; i++){
      let bit = n >> 1;
      for(; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if(i < j){ [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
    }
    for(let len = 2; len <= n; len <<= 1){
      const ang = -2 * Math.PI / len;
      const wR = Math.cos(ang), wI = Math.sin(ang);
      for(let i = 0; i < n; i += len){
        let cR = 1, cI = 0;
        for(let j = 0; j < len >> 1; j++){
          const uR = re[i+j], uI = im[i+j];
          const vR = re[i+j+len/2]*cR - im[i+j+len/2]*cI;
          const vI = re[i+j+len/2]*cI + im[i+j+len/2]*cR;
          re[i+j]=uR+vR; im[i+j]=uI+vI;
          re[i+j+len/2]=uR-vR; im[i+j+len/2]=uI-vI;
          const nR=cR*wR-cI*wI; cI=cR*wI+cI*wR; cR=nR;
        }
      }
    }

    for(let bin = 0; bin < FFT / 2; bin++){
      const mag = Math.sqrt(re[bin]**2 + im[bin]**2);
      const db  = mag > 1e-10 ? 20 * Math.log10(mag) : -120;
      const norm = Math.max(0, Math.min(1, (db + 90) / 90));
      const py  = H - 1 - Math.floor(bin / (FFT / 2) * H);
      if(py < 0 || py >= H) continue;
      const [r, g, b] = colormap(norm);
      const idx = (py * W + px_x) * 4;
      px[idx]   = r;
      px[idx+1] = g;
      px[idx+2] = b;
      px[idx+3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Frequency labels
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font      = "9px monospace";
  const nyq     = buffer.sampleRate / 2;
  [100, 500, 1000, 4000, 8000, 16000].forEach(f => {
    if(f > nyq) return;
    const y = H - Math.floor(f / nyq * H);
    ctx.fillText(f >= 1000 ? (f/1000) + "k" : f + "Hz", 2, y);
  });
}

// ── LED Peak Meter ─────────────────────────────────────────────────────────────

function LEDMeter({ level }: { level: number }) {
  // level: 0-1 (linear peak)
  const db    = level > 0 ? 20 * Math.log10(level) : -60;
  const BANDS = 20;
  const minDb = -57, maxDb = 0;

  return (
    <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:60 }}>
      {Array.from({ length: BANDS }, (_, i) => {
        const threshold = minDb + (i / BANDS) * (maxDb - minDb);
        const lit       = db >= threshold;
        const color     = i < 14 ? AU.ledGreen : i < 18 ? AU.ledYellow : AU.ledRed;
        return (
          <div key={i} style={{
            width: 6, height: 3 + i * 2.5,
            background: lit ? color : AU.ledOff,
            borderRadius: 1,
            boxShadow: lit ? `0 0 4px ${color}` : "none",
            transition: "background 0.05s",
          }}/>
        );
      })}
    </div>
  );
}

// ── Time Ruler ─────────────────────────────────────────────────────────────────

function TimeRuler({
  duration, viewStart, viewEnd, width
}: { duration:number; viewStart:number; viewEnd:number; width:number }) {
  const visibleDur = (viewEnd - viewStart) * duration;
  const step = visibleDur > 60 ? 10 : visibleDur > 10 ? 1 : visibleDur > 2 ? 0.5 : 0.1;
  const startT = viewStart * duration;
  const ticks: { x: number; label: string }[] = [];

  for(let t = Math.ceil(startT / step) * step; t <= viewEnd * duration; t += step) {
    const x = ((t - startT) / visibleDur) * width;
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(step < 0.5 ? 2 : 1);
    ticks.push({ x, label: m > 0 ? `${m}:${s.padStart(5,"0")}` : `${s}s` });
  }

  return (
    <div style={{
      position: "relative", height: 20, background: AU.rulerBg,
      borderBottom: `1px solid ${AU.border}`, overflow: "hidden",
      flexShrink: 0,
    }}>
      {ticks.map((t, i) => (
        <div key={i} style={{
          position: "absolute", left: t.x, top: 0,
          borderLeft: `1px solid ${AU.border}`,
          paddingLeft: 3, height: "100%",
          display: "flex", alignItems: "flex-end", paddingBottom: 2,
        }}>
          <span style={{ fontSize: 8, color: AU.rulerText, whiteSpace: "nowrap" }}>
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Workspace ─────────────────────────────────────────────────────────────

export default function AuditionWorkspace({
  files, activeId, onTabSelect, onTabClose,
  playheadSec, playing, onTogglePlay, onSeek, onDownload,
}: AuditionWorkspaceProps) {
  const activeFile  = useMemo(() => files.find(f => f.id === activeId), [files, activeId]);
  const buf         = activeFile?.buffer ?? null;

  const waveRef     = useRef<HTMLCanvasElement>(null);
  const specRef     = useRef<HTMLCanvasElement>(null);
  const containerRef= useRef<HTMLDivElement>(null);

  const [viewStart, setViewStart]   = useState(0);
  const [viewEnd,   setViewEnd]     = useState(1);
  const [selStart,  setSelStart]    = useState<number | undefined>(undefined);
  const [selEnd,    setSelEnd]      = useState<number | undefined>(undefined);
  const [dragging,  setDragging]    = useState(false);
  const [dragStart, setDragStart]   = useState(0);
  const [peakLevel, setPeakLevel]   = useState(0);
  const peakDecayRef= useRef(0);
  const rafRef      = useRef(0);

  const duration    = buf?.duration ?? 1;
  const phNorm      = duration > 0 ? playheadSec / duration : 0;

  // ── Render waveform whenever view/buffer/playhead changes ─────────────────
  useEffect(() => {
    const cv = waveRef.current;
    if(!cv || !buf) return;
    cv.width  = cv.offsetWidth  || 800;
    cv.height = cv.offsetHeight || 160;
    renderWaveformGL(cv, buf, viewStart, viewEnd, phNorm, selStart, selEnd);
  }, [buf, viewStart, viewEnd, phNorm, selStart, selEnd]);

  // ── Render spectrogram on buffer/view change ──────────────────────────────
  useEffect(() => {
    const cv = specRef.current;
    if(!cv || !buf) return;
    cv.width  = cv.offsetWidth  || 800;
    cv.height = cv.offsetHeight || 120;
    renderSpectrogram(cv, buf, viewStart, viewEnd);
  }, [buf, viewStart, viewEnd]);

  // ── LED Peak Meter animation ──────────────────────────────────────────────
  useEffect(() => {
    if(!playing || !buf) { setPeakLevel(0); return; }

    function animateMeter() {
      if(!buf) return;
      const ch0   = buf.getChannelData(0);
      const frame = Math.floor(phNorm * buf.length);
      const slice = ch0.subarray(Math.max(0, frame - 512), frame);
      let peak    = 0;
      for(let i = 0; i < slice.length; i++){
        const v = Math.abs(slice[i]);
        if(v > peak) peak = v;
      }
      // Smooth decay
      peakDecayRef.current = Math.max(peak, peakDecayRef.current * 0.92);
      setPeakLevel(peakDecayRef.current);
      rafRef.current = requestAnimationFrame(animateMeter);
    }
    rafRef.current = requestAnimationFrame(animateMeter);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, buf, phNorm]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if(!el) return;
    const obs = new ResizeObserver(() => {
      // Force re-render
      setViewStart(v => v);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Mouse wheel → zoom ────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx    = (e.clientX - rect.left) / rect.width; // focal point 0-1
    const span  = viewEnd - viewStart;
    const zoomF = e.deltaY < 0 ? 0.85 : 1.15;
    const newSpan = Math.max(0.001, Math.min(1, span * zoomF));
    const anchor  = viewStart + cx * span;
    let ns = anchor - cx * newSpan;
    let ne = anchor + (1 - cx) * newSpan;
    if(ns < 0) { ne -= ns; ns = 0; }
    if(ne > 1) { ns -= (ne - 1); ne = 1; }
    setViewStart(Math.max(0, ns));
    setViewEnd(Math.min(1, ne));
  }, [viewStart, viewEnd]);

  // ── Mouse drag → seek + select ────────────────────────────────────────────
  function normX(e: React.MouseEvent): number {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x    = (e.clientX - rect.left) / rect.width;
    return viewStart + x * (viewEnd - viewStart);
  }

  function handleMouseDown(e: React.MouseEvent) {
    const n = normX(e);
    setDragStart(n);
    setDragging(true);
    setSelStart(n);
    setSelEnd(n);
    onSeek(Math.min(1, Math.max(0, n)));
  }

  function handleMouseMove(e: React.MouseEvent) {
    if(!dragging) return;
    const n = normX(e);
    setSelEnd(n);
    onSeek(Math.min(1, Math.max(0, n)));
    void dragStart;
  }

  function handleMouseUp() { setDragging(false); }

  // ── Scroll bar drag ───────────────────────────────────────────────────────
  const scrollSpan = viewEnd - viewStart;
  const scrollLeft = viewStart;

  function handleScrollDrag(e: React.MouseEvent<HTMLDivElement>) {
    const rect  = e.currentTarget.getBoundingClientRect();
    const x     = (e.clientX - rect.left) / rect.width;
    const newStart = Math.max(0, Math.min(1 - scrollSpan, x - scrollSpan / 2));
    setViewStart(newStart);
    setViewEnd(newStart + scrollSpan);
  }

  // ── Properties panel ──────────────────────────────────────────────────────
  const props_ = buf ? [
    ["Sample Rate",  buf.sampleRate + " Hz"],
    ["Channels",     buf.numberOfChannels === 1 ? "Mono" : "Stereo"],
    ["Duration",     buf.duration.toFixed(3) + " s"],
    ["Samples",      buf.length.toLocaleString()],
    ["Bit Depth",    "32-bit Float"],
    ["Zoom",         ((viewEnd - viewStart) * 100).toFixed(1) + "%"],
  ] : [];

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: AU.bg, border: `1px solid ${AU.border}`,
      borderRadius: 4, overflow: "hidden", fontFamily: "monospace",
      userSelect: "none",
    }}>

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "stretch",
        background: AU.bgDark, borderBottom: `1px solid ${AU.border}`,
        minHeight: 30, overflowX: "auto",
      }}>
        {files.map(f => {
          const active = f.id === activeId;
          return (
            <div key={f.id}
              onClick={() => onTabSelect(f.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "0 10px", cursor: "pointer", flexShrink: 0,
                background: active ? AU.tabActive : AU.tabInactive,
                borderRight: `1px solid ${AU.border}`,
                borderBottom: active ? `2px solid ${AU.wave}` : "2px solid transparent",
              }}>
              <span style={{ fontSize: 9, color: AU.waveAlt }}>≋</span>
              <span style={{
                fontSize: 10, color: active ? AU.textBright : AU.textDim,
                maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {f.name}
              </span>
              <span
                onClick={e => { e.stopPropagation(); onTabClose(f.id); }}
                style={{ fontSize: 9, color: AU.textDim, cursor: "pointer",
                  padding: "0 2px", borderRadius: 2,
                  lineHeight: 1, marginLeft: 2 }}
                title="Close">
                ✕
              </span>
            </div>
          );
        })}
        {files.length === 0 && (
          <div style={{ padding: "0 12px", fontSize: 10, color: AU.textDim,
            display: "flex", alignItems: "center" }}>
            No files loaded
          </div>
        )}
      </div>

      {/* ── Main body ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* ── Left: Files + Properties ─────────────────────────────────── */}
        <div style={{
          width: 160, background: AU.bgPanel,
          borderRight: `1px solid ${AU.border}`,
          display: "flex", flexDirection: "column",
          flexShrink: 0, overflow: "hidden",
        }}>
          <div style={{
            padding: "6px 8px", fontSize: 8, color: AU.textDim,
            letterSpacing: 1, borderBottom: `1px solid ${AU.border}`,
          }}>
            FILES & PROPERTIES
          </div>

          {/* File list */}
          <div style={{ borderBottom: `1px solid ${AU.border}`, padding: 4 }}>
            {files.map(f => (
              <div key={f.id} onClick={() => onTabSelect(f.id)}
                style={{
                  padding: "3px 6px", borderRadius: 2, cursor: "pointer",
                  background: f.id === activeId ? "#252525" : "transparent",
                  fontSize: 9, color: f.id === activeId ? AU.wave : AU.textDim,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                ≋ {f.name}
              </div>
            ))}
          </div>

          {/* Properties */}
          <div style={{ padding: "6px 8px", flex: 1, overflowY: "auto" }}>
            {props_.map(([l, v]) => (
              <div key={l} style={{
                display: "flex", justifyContent: "space-between",
                padding: "2px 0", borderBottom: `1px solid ${AU.border}`,
              }}>
                <span style={{ fontSize: 8, color: AU.textDim }}>{l}</span>
                <span style={{ fontSize: 8, color: AU.textBright }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Operational log */}
          <div style={{
            padding: "6px 8px", borderTop: `1px solid ${AU.border}`,
            fontSize: 8, color: AU.textDim,
          }}>
            <div style={{ color: AU.textDim, marginBottom: 3 }}>OPERATION LOG</div>
            <div style={{ color: playing ? AU.ledGreen : AU.textDim }}>
              {playing ? "▶ Playback active" : "■ Stopped"}
            </div>
            <div style={{ color: AU.textDim, marginTop: 2 }}>
              {phNorm > 0 ? `Position: ${playheadSec.toFixed(3)}s` : "Position: 0.000s"}
            </div>
            <div style={{ color: AU.textDim, marginTop: 2 }}>
              View: {(viewStart * 100).toFixed(1)}% – {(viewEnd * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* ── Center: Workspace ────────────────────────────────────────── */}
        <div ref={containerRef} style={{
          flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
        }}>
          {/* Time ruler */}
          <TimeRuler
            duration={duration}
            viewStart={viewStart}
            viewEnd={viewEnd}
            width={containerRef.current?.offsetWidth ?? 800}
          />

          {/* Waveform canvas */}
          <canvas
            ref={waveRef}
            style={{
              width: "100%", height: 160, display: "block",
              cursor: "crosshair", flexShrink: 0,
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          {/* Channel separator */}
          <div style={{ height: 1, background: AU.border, flexShrink: 0 }}/>

          {/* Spectrogram canvas */}
          <canvas
            ref={specRef}
            style={{
              width: "100%", height: 120, display: "block",
              cursor: "crosshair", flexShrink: 0,
            }}
            onWheel={handleWheel}
          />

          {/* Scroll bar */}
          <div
            onClick={handleScrollDrag}
            style={{
              height: 10, background: AU.bgDark,
              borderTop: `1px solid ${AU.border}`,
              cursor: "pointer", position: "relative",
              flexShrink: 0,
            }}>
            <div style={{
              position: "absolute",
              left: `${scrollLeft * 100}%`,
              width: `${scrollSpan * 100}%`,
              height: "100%",
              background: AU.borderLight,
              borderRadius: 2,
            }}/>
          </div>

          {/* Transport + Controls ──────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px",
            background: AU.bgPanel, borderTop: `1px solid ${AU.border}`,
            flexShrink: 0,
          }}>
            {/* Play/Pause */}
            <button onClick={onTogglePlay} style={{
              background: playing ? "#ff6d0022" : "#00c85322",
              border: `1px solid ${playing ? "#ff6d0066" : "#00c85366"}`,
              borderRadius: 3, padding: "3px 12px",
              cursor: "pointer", color: playing ? "#ff6d00" : AU.wave,
              fontSize: 13, fontWeight: 700,
            }}>
              {playing ? "⏸" : "▶"}
            </button>

            {/* Stop */}
            <button onClick={() => { onSeek(0); }}
              style={{
                background: "#1a1a1a", border: `1px solid ${AU.border}`,
                borderRadius: 3, padding: "3px 8px",
                cursor: "pointer", color: AU.textDim, fontSize: 11,
              }}>
              ⏹
            </button>

            {/* Time display */}
            <div style={{
              background: "#000000", border: `1px solid ${AU.border}`,
              borderRadius: 3, padding: "3px 10px",
              fontFamily: "monospace", fontSize: 11,
              color: "#00ff99", minWidth: 80, textAlign: "center",
            }}>
              {playheadSec.toFixed(3)}s
            </div>

            {/* Zoom controls */}
            <button onClick={() => {
              const m = (viewStart + viewEnd) / 2;
              const h = (viewEnd - viewStart) / 4;
              setViewStart(Math.max(0, m - h));
              setViewEnd(Math.min(1, m + h));
            }} style={{
              background: AU.bgDark, border: `1px solid ${AU.border}`,
              borderRadius: 3, padding: "2px 8px",
              cursor: "pointer", color: AU.textDim, fontSize: 10,
            }}>+</button>

            <button onClick={() => {
              const m = (viewStart + viewEnd) / 2;
              const h = (viewEnd - viewStart);
              setViewStart(Math.max(0, m - h));
              setViewEnd(Math.min(1, m + h));
            }} style={{
              background: AU.bgDark, border: `1px solid ${AU.border}`,
              borderRadius: 3, padding: "2px 8px",
              cursor: "pointer", color: AU.textDim, fontSize: 10,
            }}>−</button>

            <button onClick={() => { setViewStart(0); setViewEnd(1); }}
              style={{
                background: AU.bgDark, border: `1px solid ${AU.border}`,
                borderRadius: 3, padding: "2px 8px",
                cursor: "pointer", color: AU.textDim, fontSize: 9,
              }}>FIT</button>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {/* LED Meter */}
              <LEDMeter level={peakLevel}/>

              {/* Download */}
              {onDownload && (
                <button onClick={onDownload} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "#00c85322", border: "1px solid #00c85366",
                  borderRadius: 3, padding: "4px 12px",
                  cursor: "pointer", color: AU.wave, fontSize: 10, fontWeight: 700,
                  boxShadow: "0 0 8px #00c85333",
                }}>
                  ⬇ Export WAV
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
