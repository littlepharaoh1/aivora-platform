/**
 * regionEditor.ts — Region selection state management
 * Aivora Waveform Workstation
 */

export interface Region {
  startSec: number;
  endSec:   number;
}

export interface RegionEditorState {
  region:    Region | null;
  dragging:  boolean;
  dragMode:  "create" | "move" | "resize-left" | "resize-right" | null;
  dragStart: number;
}

export function createRegionEditor(): RegionEditorState {
  return { region: null, dragging: false, dragMode: null, dragStart: 0 };
}

export function xToTime(
  x:         number,
  panOffset: number,
  zoom:      number
): number {
  return panOffset + x / zoom;
}

export function timeToX(
  time:      number,
  panOffset: number,
  zoom:      number
): number {
  return (time - panOffset) * zoom;
}

export function getRegionDuration(region: Region): number {
  return region.endSec - region.startSec;
}

export function snapToZeroCrossing(
  mono:       Float32Array,
  timeSec:    number,
  sampleRate: number,
  searchMs    = 5
): number {
  const searchSamples = Math.round((searchMs / 1000) * sampleRate);
  const centerSample  = Math.round(timeSec * sampleRate);
  const start = Math.max(0, centerSample - searchSamples);
  const end   = Math.min(mono.length - 1, centerSample + searchSamples);

  let bestSample = centerSample;
  let bestDist   = Infinity;

  for (let i = start; i < end - 1; i++) {
    if (mono[i] * mono[i + 1] <= 0) {
      const dist = Math.abs(i - centerSample);
      if (dist < bestDist) { bestDist = dist; bestSample = i; }
    }
  }
  return bestSample / sampleRate;
}
