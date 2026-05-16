/**
 * zoomEngine.ts — Sample-Level Zoom & Pan Engine
 * Aivora Forensic DSP Platform
 */

export interface ZoomState {
  zoom:      number;
  panOffset: number;
  duration:  number;
  width:     number;
}

export function createZoomEngine(
  initial:  ZoomState,
  onChange: (state: ZoomState) => void
) {
  let state = { ...initial };
  const history: ZoomState[] = [];

  function clamp(s: ZoomState): ZoomState {
    const maxPan = Math.max(0, s.duration - s.width / s.zoom);
    return {
      ...s,
      zoom:      Math.max(5, Math.min(500000, s.zoom)),
      panOffset: Math.max(0, Math.min(maxPan, s.panOffset)),
    };
  }

  function emit(next: ZoomState) {
    history.push({ ...state });
    if (history.length > 20) history.shift();
    state = clamp(next);
    onChange(state);
  }

  return {
    zoomIn(factor = 1.5) {
      emit({ ...state, zoom: state.zoom * factor });
    },
    zoomOut(factor = 1.5) {
      emit({ ...state, zoom: state.zoom / factor });
    },
    zoomFit() {
      history.push({ ...state });
      state = clamp({ ...state, zoom: Math.max(5, state.width / Math.max(0.1, state.duration)), panOffset: 0 });
      onChange(state);
    },
    zoomToSel(start: number, end: number) {
      const dur = end - start;
      if (dur <= 0) return;
      emit({ ...state, zoom: state.width / dur, panOffset: start });
    },
    zoomAtCursor(cursorPx: number, factor: number) {
      const cursorSec = state.panOffset + cursorPx / state.zoom;
      const newZoom   = state.zoom * factor;
      const newPan    = cursorSec - cursorPx / newZoom;
      emit({ ...state, zoom: newZoom, panOffset: newPan });
    },
    panBy(deltaPx: number) {
      emit({ ...state, panOffset: state.panOffset - deltaPx / state.zoom });
    },
    panTo(sec: number) {
      emit({ ...state, panOffset: sec });
    },
    undo() {
      const prev = history.pop();
      if (prev) { state = prev; onChange(state); }
    },
    getState() { return { ...state }; },
    isSampleLevel(sampleRate: number) {
      return state.zoom > sampleRate * 0.1;
    },
  };
}

// ── Sample-Level Waveform Renderer ────────────────────────────────────────────

export function drawSampleLevel(
  canvas:     HTMLCanvasElement,
  mono:       Float32Array,
  sampleRate: number,
  zoom:       number,
  panOffset:  number,
  height:     number,
  playheadSec: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width / (window.devicePixelRatio || 1);
  const H = height;
  const centerY = H / 2;
  const RULER_H = 24;
  const WAVE_H  = H - RULER_H;
  const waveCenter = RULER_H + WAVE_H / 2;

  const startSample = Math.floor(panOffset * sampleRate);
  const endSample   = Math.min(mono.length, Math.ceil((panOffset + W / zoom) * sampleRate) + 2);
  const pxPerSample = zoom / sampleRate;

  // Sample grid
  if (pxPerSample > 8) {
    ctx.strokeStyle = "rgba(14,165,233,0.1)";
    ctx.lineWidth = 1;
    for (let i = startSample; i < endSample; i++) {
      const x = (i / sampleRate - panOffset) * zoom;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }

  // Zero crossing markers
  ctx.fillStyle = "rgba(0,255,136,0.3)";
  for (let i = startSample; i < endSample - 1; i++) {
    if ((mono[i] >= 0 && mono[i+1] < 0) || (mono[i] < 0 && mono[i+1] >= 0)) {
      const x = (i / sampleRate - panOffset) * zoom;
      ctx.fillRect(x - 1, waveCenter - 3, 2, 6);
    }
  }

  // Interpolated waveform curve
  ctx.beginPath();
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth   = 1.5;
  let first = true;

  if (pxPerSample > 2) {
    // Draw smooth curve between samples using Catmull-Rom
    for (let i = Math.max(0, startSample - 1); i < Math.min(mono.length - 1, endSample + 1); i++) {
      const x = (i / sampleRate - panOffset) * zoom;
      const y = waveCenter - mono[i] * (WAVE_H / 2 - 4);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
  } else {
    for (let px = 0; px < W; px++) {
      const sec = panOffset + px / zoom;
      const si  = Math.floor(sec * sampleRate);
      if (si < 0 || si >= mono.length) continue;
      const y = waveCenter - mono[si] * (WAVE_H / 2 - 4);
      if (first) { ctx.moveTo(px, y); first = false; } else ctx.lineTo(px, y);
    }
  }
  ctx.stroke();

  // Sample dots
  if (pxPerSample > 4) {
    ctx.fillStyle = "#00ffaa";
    for (let i = startSample; i < endSample; i++) {
      const x = (i / sampleRate - panOffset) * zoom;
      const y = waveCenter - mono[i] * (WAVE_H / 2 - 4);
      ctx.beginPath();
      ctx.arc(x, y, Math.min(4, pxPerSample * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Playhead
  const phx = (playheadSec - panOffset) * zoom;
  if (phx >= 0 && phx <= W) {
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(phx, RULER_H);
    ctx.lineTo(phx, H);
    ctx.stroke();
  }
}
