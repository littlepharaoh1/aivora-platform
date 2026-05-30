/**
 * videoAnnotation.test.ts
 * Aivora Platform — Enterprise Video Annotation Tests
 */

import { describe, it, expect } from "vitest";
import {
  createVideoState,
  createTrack, deleteTrack, toggleTrackActive, selectTrack,
  addKeyframe, deleteKeyframe, updateKeyframe, setQAFlagVideo,
  interpolateTrack, addShot, deleteShot,
  goToFrame, setTool, setFramesMeta,
  getFrameKeyframes, getTrackAtFrame,
  undoVideoState, redoVideoState,
  normalizeBBoxV, computeVideoStats,
} from "../src/annotation/videoAnnotationState";
import type { VBBox } from "../src/annotation/videoAnnotationTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeState() {
  return createVideoState({
    video_id:"vid-001", filename:"test.mp4",
    duration_s:60, fps:2, width:1920, height:1080, total_frames:120,
  });
}

const BBOX: VBBox = { x:0.1, y:0.1, width:0.3, height:0.2 };

function withTrack() {
  const s = createTrack(makeState(), "person", 1);
  return { state: s, trackId: s.tracks[0].id };
}

// ── Factory ───────────────────────────────────────────────────────────────────

describe("createVideoState", () => {
  it("creates valid initial state", () => {
    const s = makeState();
    expect(s.tracks).toHaveLength(0);
    expect(s.keyframes).toHaveLength(0);
    expect(s.total_frames).toBe(120);
    expect(s.current_frame).toBe(0);
    expect(s.active_tool).toBe("bbox");
  });

  it("is deterministic", () => {
    const a = makeState(), b = makeState();
    expect(a.fps).toBe(b.fps);
    expect(a.total_frames).toBe(b.total_frames);
    expect(a.version).toBe(b.version);
  });
});

// ── Tracks ────────────────────────────────────────────────────────────────────

describe("createTrack", () => {
  it("adds a track", () => {
    const { state } = withTrack();
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].label).toBe("person");
  });

  it("selects new track", () => {
    const { state, trackId } = withTrack();
    expect(state.selected_track_id).toBe(trackId);
  });

  it("assigns deterministic color by index", () => {
    let s = createTrack(makeState(), "a", 1);
    s = createTrack(s, "b", 2);
    expect(s.tracks[0].color).not.toBe(s.tracks[1].color);
  });

  it("pushes history", () => {
    const { state } = withTrack();
    expect(state.history.length).toBeGreaterThan(0);
  });
});

describe("deleteTrack", () => {
  it("removes track and its keyframes", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0, BBOX);
    state = deleteTrack(state, trackId);
    expect(state.tracks).toHaveLength(0);
    expect(state.keyframes.filter(k=>k.track_id===trackId)).toHaveLength(0);
  });
});

describe("toggleTrackActive", () => {
  it("toggles active state", () => {
    let { state, trackId } = withTrack();
    expect(state.tracks[0].is_active).toBe(true);
    state = toggleTrackActive(state, trackId);
    expect(state.tracks[0].is_active).toBe(false);
  });
});

// ── Keyframes ─────────────────────────────────────────────────────────────────

describe("addKeyframe", () => {
  it("adds a keyframe", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 5, BBOX);
    expect(state.keyframes).toHaveLength(1);
    expect(state.keyframes[0].frame_index).toBe(5);
    expect(state.keyframes[0].is_interpolated).toBe(false);
  });

  it("replaces existing keyframe at same track+frame", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 5, BBOX);
    state = addKeyframe(state, trackId, 5, { x:0.5, y:0.5, width:0.2, height:0.2 });
    const atFrame = state.keyframes.filter(k=>k.track_id===trackId && k.frame_index===5);
    expect(atFrame).toHaveLength(1);
    expect(atFrame[0].bbox.x).toBeCloseTo(0.5);
  });

  it("normalizes bbox", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0, { x:0.5, y:0.5, width:-0.2, height:-0.1 });
    expect(state.keyframes[0].bbox.width).toBeGreaterThan(0);
    expect(state.keyframes[0].bbox.height).toBeGreaterThan(0);
  });

  it("keeps keyframes sorted by frame", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 10, BBOX);
    state = addKeyframe(state, trackId, 2, BBOX);
    state = addKeyframe(state, trackId, 6, BBOX);
    const idxs = state.keyframes.map(k=>k.frame_index);
    expect(idxs).toEqual([...idxs].sort((a,b)=>a-b));
  });
});

describe("deleteKeyframe", () => {
  it("removes a keyframe", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0, BBOX);
    const kfId = state.keyframes[0].id;
    state = deleteKeyframe(state, kfId);
    expect(state.keyframes).toHaveLength(0);
  });
});

describe("updateKeyframe", () => {
  it("updates a field", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0, BBOX);
    const kfId = state.keyframes[0].id;
    state = updateKeyframe(state, kfId, { occluded:true });
    expect(state.keyframes[0].occluded).toBe(true);
  });
});

describe("setQAFlagVideo", () => {
  it("sets and clears qa flag", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0, BBOX);
    const kfId = state.keyframes[0].id;
    state = setQAFlagVideo(state, kfId, "occluded");
    expect(state.keyframes[0].qa_flag).toBe("occluded");
    state = setQAFlagVideo(state, kfId, null);
    expect(state.keyframes[0].qa_flag).toBeNull();
  });
});

// ── Interpolation ─────────────────────────────────────────────────────────────

describe("interpolateTrack", () => {
  it("creates interpolated keyframes between two manual ones", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0,  { x:0.0, y:0.0, width:0.2, height:0.2 });
    state = addKeyframe(state, trackId, 10, { x:0.5, y:0.5, width:0.2, height:0.2 });
    state = interpolateTrack(state, trackId);
    const interp = state.keyframes.filter(k=>k.is_interpolated);
    expect(interp.length).toBe(9); // frames 1-9
  });

  it("interpolates bbox linearly at midpoint", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0,  { x:0.0, y:0.0, width:0.2, height:0.2 });
    state = addKeyframe(state, trackId, 10, { x:1.0, y:0.0, width:0.2, height:0.2 });
    state = interpolateTrack(state, trackId);
    const mid = state.keyframes.find(k=>k.frame_index===5 && k.is_interpolated);
    expect(mid).toBeDefined();
    // x at frame 5 should be ~0.5 (but clamped by normalizeBBoxV constraints — linear value)
    expect(mid!.bbox.x).toBeGreaterThan(0.3);
    expect(mid!.bbox.x).toBeLessThan(0.7);
  });

  it("does nothing with fewer than 2 keyframes", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0, BBOX);
    state = interpolateTrack(state, trackId);
    expect(state.keyframes.filter(k=>k.is_interpolated)).toHaveLength(0);
  });

  it("is deterministic — same keyframes same interpolation", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0,  { x:0.0, y:0.0, width:0.2, height:0.2 });
    state = addKeyframe(state, trackId, 8,  { x:0.4, y:0.4, width:0.2, height:0.2 });
    const r1 = interpolateTrack(state, trackId);
    const r2 = interpolateTrack(state, trackId);
    const x1 = r1.keyframes.filter(k=>k.is_interpolated).map(k=>k.bbox.x);
    const x2 = r2.keyframes.filter(k=>k.is_interpolated).map(k=>k.bbox.x);
    expect(x1).toEqual(x2);
  });

  it("does not overwrite manual keyframes", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0,  { x:0.0, y:0.0, width:0.2, height:0.2 });
    state = addKeyframe(state, trackId, 5,  { x:0.9, y:0.0, width:0.2, height:0.2 });
    state = addKeyframe(state, trackId, 10, { x:0.5, y:0.5, width:0.2, height:0.2 });
    state = interpolateTrack(state, trackId);
    const manual5 = state.keyframes.find(k=>k.frame_index===5 && !k.is_interpolated);
    expect(manual5).toBeDefined();
    expect(manual5!.bbox.x).toBeCloseTo(0.9);
  });
});

// ── Shots ─────────────────────────────────────────────────────────────────────

describe("Shot segments", () => {
  it("adds and deletes a shot", () => {
    let s = addShot(makeState(), 0, 30, "Intro");
    expect(s.shots).toHaveLength(1);
    const id = s.shots[0].id;
    s = deleteShot(s, id);
    expect(s.shots).toHaveLength(0);
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe("goToFrame", () => {
  it("clamps to valid range", () => {
    let s = makeState();
    expect(goToFrame(s, -5).current_frame).toBe(0);
    expect(goToFrame(s, 9999).current_frame).toBe(s.total_frames-1);
    expect(goToFrame(s, 50).current_frame).toBe(50);
  });
});

describe("setTool", () => {
  it("changes active tool", () => {
    expect(setTool(makeState(), "select").active_tool).toBe("select");
  });
});

// ── Undo / Redo ───────────────────────────────────────────────────────────────

describe("undoVideoState / redoVideoState", () => {
  it("undo reverts track creation", () => {
    let { state } = withTrack();
    state = undoVideoState(state);
    expect(state.tracks).toHaveLength(0);
  });

  it("redo re-applies", () => {
    let { state } = withTrack();
    state = undoVideoState(state);
    state = redoVideoState(state);
    expect(state.tracks).toHaveLength(1);
  });

  it("undo on empty history is safe", () => {
    const s = undoVideoState(makeState());
    expect(s.tracks).toHaveLength(0);
  });
});

// ── Geometry ──────────────────────────────────────────────────────────────────

describe("normalizeBBoxV", () => {
  it("handles negative dimensions", () => {
    const b = normalizeBBoxV({ x:0.5, y:0.5, width:-0.2, height:-0.1 });
    expect(b.width).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(0.5);
  });

  it("clamps to bounds", () => {
    const b = normalizeBBoxV({ x:0.95, y:0.95, width:0.5, height:0.5 });
    expect(b.x + b.width).toBeLessThanOrEqual(1);
    expect(b.y + b.height).toBeLessThanOrEqual(1);
  });
});

// ── Queries ───────────────────────────────────────────────────────────────────

describe("getFrameKeyframes", () => {
  it("returns keyframes for a frame", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 5, BBOX);
    state = addKeyframe(state, trackId, 6, BBOX);
    expect(getFrameKeyframes(state, 5)).toHaveLength(1);
    expect(getFrameKeyframes(state, 99)).toHaveLength(0);
  });
});

describe("getTrackAtFrame", () => {
  it("finds keyframe by track+frame", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 5, BBOX);
    expect(getTrackAtFrame(state, trackId, 5)).not.toBeNull();
    expect(getTrackAtFrame(state, trackId, 9)).toBeNull();
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

describe("computeVideoStats", () => {
  it("counts manual vs interpolated", () => {
    let { state, trackId } = withTrack();
    state = addKeyframe(state, trackId, 0,  { x:0.0, y:0.0, width:0.2, height:0.2 });
    state = addKeyframe(state, trackId, 10, { x:0.5, y:0.5, width:0.2, height:0.2 });
    state = interpolateTrack(state, trackId);
    const stats = computeVideoStats(state);
    expect(stats.manual).toBe(2);
    expect(stats.interpolated).toBe(9);
    expect(stats.total_tracks).toBe(1);
  });

  it("handles empty state", () => {
    const stats = computeVideoStats(makeState());
    expect(stats.total_keyframes).toBe(0);
    expect(stats.mean_confidence).toBe(0);
  });
});
