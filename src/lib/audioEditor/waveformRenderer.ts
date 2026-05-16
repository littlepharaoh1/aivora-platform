/**
 * waveformRenderer.ts — High-resolution waveform canvas renderer
 * Aivora Waveform Workstation
 */

export interface WaveformRenderOptions {
  mono:          Float32Array;
  sampleRate:    number;
  duration:      number;
  zoom:          number;       // pixels per second
  panOffset:     number;       // seconds offset from left
  playheadSec:   number;
  selection:     { start: number; end: number } | null;
  qcMarkers:     QCMarker[];
  width:         number;
  height:        number;
  theme: {
    bg:         string;
    wave:       string;
    waveAlt:    string;
    ruler:      string;
    rulerText:  string;
    playhead:   string;
    selection:  string;
    grid:       string;
  };
}

export interface QCMarker {
  timeSec:  number;
  type:     string;
  severity: string;
  message:  string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  warning:  "#f59e0b",
  medium:   "#f59e0b",
  low:      "#22d3ee",
};

export function renderWaveform(
  canvas: HTMLCanvasElement,
  opts:   WaveformRenderOptions
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { mono, sampleRate, zoom, panOffset, playheadSec,
          selection, qcMarkers, width, height, theme: rawTheme } = opts;
  const theme = rawTheme ?? {
    bg:"#040a10",
    grid:"#0a1520",
    wave:"#00cc66",
    playhead:"#f59e0b",
    selection:"rgba(34,211,238,0.15)",
    ruler:"#030810",
    rulerText:"#2a5a6a",
  };

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = width  * dpr;
  canvas.height = height * dpr;
  canvas.style.width  = width  + "px";
  canvas.style.height = height + "px";
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  const RULER_H  = 24;
  const WAVE_H   = height - RULER_H;
  const centerY  = RULER_H + WAVE_H / 2;

  // Grid lines
  const secInterval = zoom < 50 ? 5 : zoom < 100 ? 2 : zoom < 200 ? 1 : 0.5;
  const firstSec    = Math.floor(panOffset / secInterval) * secInterval;
  for (let s = firstSec; s < panOffset + width / zoom; s += secInterval) {
    const x = (s - panOffset) * zoom;
    if (x < 0 || x > width) continue;
    ctx.fillStyle = theme.grid;
    ctx.fillRect(x, RULER_H, 1, WAVE_H);
  }

  // Selection overlay
  if (selection) {
    const sx = (selection.start - panOffset) * zoom;
    const ex = (selection.end   - panOffset) * zoom;
    ctx.fillStyle = theme.selection;
    ctx.fillRect(sx, RULER_H, ex - sx, WAVE_H);
    // Handles
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(sx - 2, RULER_H, 4, WAVE_H);
    ctx.fillRect(ex - 2, RULER_H, 4, WAVE_H);
  }

  // ── dB Scale (right side) ─────────────────────────────────────────────
  const DB_W = 36;
  const dbLevels = [0, -6, -12, -18, -24, -36, -48, -60];
  ctx.fillStyle = "#050d14";
  ctx.fillRect(width - DB_W, RULER_H, DB_W, WAVE_H);
  ctx.strokeStyle = "#0f2a3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width - DB_W, RULER_H);
  ctx.lineTo(width - DB_W, height);
  ctx.stroke();

  for (const db of dbLevels) {
    const normalized = Math.pow(10, db / 20);
    const yPos = centerY - normalized * (WAVE_H / 2 - 4);
    const yNeg = centerY + normalized * (WAVE_H / 2 - 4);
    // dB grid lines
    ctx.strokeStyle = "rgba(15,42,58,0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, yPos);
    ctx.lineTo(width - DB_W, yPos);
    ctx.stroke();
    if (db !== 0) {
      ctx.beginPath();
      ctx.moveTo(0, yNeg);
      ctx.lineTo(width - DB_W, yNeg);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // dB labels
    ctx.fillStyle = db === 0 ? "#ef4444" : db >= -12 ? "#f59e0b" : "#2a5a6a";
    ctx.font = "8px monospace";
    ctx.textAlign = "right";
    ctx.fillText(db + "dB", width - 2, yPos + 3);
  }

  // ── Waveform — Peak + RMS ───────────────────────────────────────────────
  const startSample = Math.floor(panOffset * sampleRate);
  const endSample   = Math.min(
    mono.length,
    Math.ceil((panOffset + width / zoom) * sampleRate)
  );
  const drawWidth = width - DB_W;
  const samplesPerPixel = Math.max(1, (endSample - startSample) / drawWidth);

  // Peak envelope (dark green fill)
  const peakMin: number[] = new Array(drawWidth).fill(centerY);
  const peakMax: number[] = new Array(drawWidth).fill(centerY);

  for (let px = 0; px < drawWidth; px++) {
    const sStart = Math.floor(startSample + px * samplesPerPixel);
    const sEnd   = Math.min(Math.floor(sStart + samplesPerPixel) + 1, mono.length);
    let min = 0, max = 0;
    for (let i = sStart; i < sEnd; i++) {
      if (mono[i] < min) min = mono[i];
      if (mono[i] > max) max = mono[i];
    }
    const amp = Math.min(1/Math.max(0.01, Math.max(Math.abs(max),Math.abs(min))), 4);
    peakMax[px] = centerY - max * amp * (WAVE_H / 2 - 4);
    peakMin[px] = centerY - min * amp * (WAVE_H / 2 - 4);
  }

  // Draw peak fill
  ctx.beginPath();
  for (let px = 0; px < drawWidth; px++) {
    if (px === 0) ctx.moveTo(px, peakMax[px]); else ctx.lineTo(px, peakMax[px]);
  }
  for (let px = drawWidth - 1; px >= 0; px--) {
    ctx.lineTo(px, peakMin[px]);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(0,180,80,0.18)";
  ctx.fill();

  // Peak outline
  ctx.beginPath();
  ctx.strokeStyle = "rgba(0,220,100,0.5)";
  ctx.lineWidth = 1;
  for (let px = 0; px < drawWidth; px++) {
    ctx.moveTo(px, peakMax[px]);
    ctx.lineTo(px, peakMin[px]);
  }
  ctx.stroke();

  // RMS envelope (bright green)
  ctx.beginPath();
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 1.5;
  let firstRms = true;
  for (let px = 0; px < drawWidth; px++) {
    const sStart = Math.floor(startSample + px * samplesPerPixel);
    const sEnd   = Math.min(Math.floor(sStart + samplesPerPixel) + 1, mono.length);
    let sum = 0;
    for (let i = sStart; i < sEnd; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / Math.max(1, sEnd - sStart));
    const rmsAmp = Math.min(1/Math.max(0.01,rms),4);
    const y = centerY - rms * rmsAmp * (WAVE_H / 2 - 4);
    if (firstRms) { ctx.moveTo(px, y); firstRms = false; } else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // Mirror RMS bottom
  ctx.beginPath();
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 1.5;
  firstRms = true;
  for (let px = 0; px < drawWidth; px++) {
    const sStart = Math.floor(startSample + px * samplesPerPixel);
    const sEnd   = Math.min(Math.floor(sStart + samplesPerPixel) + 1, mono.length);
    let sum = 0;
    for (let i = sStart; i < sEnd; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / Math.max(1, sEnd - sStart));
    const rmsAmp2 = Math.min(1/Math.max(0.01,rms),4);
    const y = centerY + rms * rmsAmp2 * (WAVE_H / 2 - 4);
    if (firstRms) { ctx.moveTo(px, y); firstRms = false; } else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // Center line
  ctx.strokeStyle = "rgba(0,255,136,0.2)";
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(drawWidth, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // QC Markers
  for (const marker of qcMarkers) {
    const x = (marker.timeSec - panOffset) * zoom;
    if (x < 0 || x > width) continue;
    const color = SEVERITY_COLORS[marker.severity] || "#4a8a9a";
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, RULER_H);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
    // Dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, RULER_H + 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Playhead
  const px = (playheadSec - panOffset) * zoom;
  if (px >= 0 && px <= width) {
    ctx.strokeStyle = theme.playhead;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(px, RULER_H);
    ctx.lineTo(px, height);
    ctx.stroke();
    // Triangle
    ctx.fillStyle = theme.playhead;
    ctx.beginPath();
    ctx.moveTo(px - 6, RULER_H);
    ctx.lineTo(px + 6, RULER_H);
    ctx.lineTo(px, RULER_H + 10);
    ctx.fill();
  }

  // Ruler
  ctx.fillStyle = "#050d14";
  ctx.fillRect(0, 0, width, RULER_H);
  ctx.strokeStyle = "#0f2a3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H);
  ctx.lineTo(width, RULER_H);
  ctx.stroke();

  ctx.fillStyle  = theme.rulerText;
  ctx.font       = "9px monospace";
  ctx.textAlign  = "center";

  for (let s = firstSec; s < panOffset + width / zoom + secInterval; s += secInterval) {
    const x = (s - panOffset) * zoom;
    if (x < 0 || x > width) continue;
    const m   = Math.floor(s / 60);
    const sec = (s % 60).toFixed(secInterval < 1 ? 1 : 0);
    ctx.fillText(`${m}:${String(sec).padStart(secInterval < 1 ? 4 : 2, "0")}`, x, 14);
    ctx.fillStyle = "#0f2a3a";
    ctx.fillRect(x, 16, 1, 8);
    ctx.fillStyle = theme.rulerText;
  }
}
