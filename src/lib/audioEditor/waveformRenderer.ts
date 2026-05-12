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
          selection, qcMarkers, width, height, theme } = opts;

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

  // Waveform
  const startSample = Math.floor(panOffset * sampleRate);
  const endSample   = Math.min(
    mono.length,
    Math.ceil((panOffset + width / zoom) * sampleRate)
  );
  const samplesPerPixel = Math.max(1, Math.floor((endSample - startSample) / width));

  ctx.beginPath();
  ctx.strokeStyle = theme.wave;
  ctx.lineWidth   = 1;

  for (let px = 0; px < width; px++) {
    const sStart = startSample + px * samplesPerPixel;
    const sEnd   = Math.min(sStart + samplesPerPixel, mono.length);
    let min = 0, max = 0;
    for (let i = sStart; i < sEnd; i++) {
      if (mono[i] < min) min = mono[i];
      if (mono[i] > max) max = mono[i];
    }
    const yMax = centerY - max * (WAVE_H / 2 - 2);
    const yMin = centerY - min * (WAVE_H / 2 - 2);
    ctx.moveTo(px, yMax);
    ctx.lineTo(px, yMin);
  }
  ctx.stroke();

  // Center line
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

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
