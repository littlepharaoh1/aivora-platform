/**
 * zoomEngine.ts — Advanced Zoom & Pan Engine
 * Aivora Forensic DSP Platform
 */

export interface ZoomState {
  zoom:      number;   // px/sec
  panOffset: number;   // seconds from left
  duration:  number;
  width:     number;
}

export interface ZoomEngine {
  zoomIn:        (factor?: number) => void;
  zoomOut:       (factor?: number) => void;
  zoomFit:       () => void;
  zoomToSel:     (start: number, end: number) => void;
  panTo:         (sec: number) => void;
  panBy:         (deltaPx: number) => void;
  zoomAtCursor:  (cursorPx: number, factor: number) => void;
  getState:      () => ZoomState;
}

export function createZoomEngine(
  initial: ZoomState,
  onChange: (state: ZoomState) => void
): ZoomEngine {
  let state = { ...initial };

  function clamp(s: ZoomState): ZoomState {
    const maxPan = Math.max(0, s.duration - s.width / s.zoom);
    return {
      ...s,
      zoom:      Math.max(5, Math.min(50000, s.zoom)),
      panOffset: Math.max(0, Math.min(maxPan, s.panOffset)),
    };
  }

  function emit(next: ZoomState) {
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
      const zoom = Math.max(5, state.width / Math.max(0.1, state.duration));
      emit({ ...state, zoom, panOffset: 0 });
    },
    zoomToSel(start, end) {
      const dur = end - start;
      if (dur <= 0) return;
      const zoom = state.width / dur;
      emit({ ...state, zoom, panOffset: start });
    },
    panTo(sec) {
      emit({ ...state, panOffset: sec });
    },
    panBy(deltaPx) {
      emit({ ...state, panOffset: state.panOffset + deltaPx / state.zoom });
    },
    zoomAtCursor(cursorPx, factor) {
      const cursorSec = state.panOffset + cursorPx / state.zoom;
      const newZoom   = state.zoom * factor;
      const newPan    = cursorSec - cursorPx / newZoom;
      emit({ ...state, zoom: newZoom, panOffset: newPan });
    },
    getState() { return { ...state }; },
  };
}
