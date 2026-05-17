/**
 * timelineEngine.ts — Non-Destructive Audio Timeline Engine
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Immutable edit graph (DAG) — every operation creates new node
 * - Non-destructive: original audio never modified
 * - Sample-accurate clip positioning
 * - Ripple edit propagation
 * - Raised-cosine crossfades at all boundaries
 * - Undo/redo via DAG traversal
 *
 * Reference:
 * - Pro Tools edit engine architecture
 * - Reaper non-destructive editing model
 */

// ── Core Types ────────────────────────────────────────────────────────────────

export type ClipId    = string;
export type EditId    = string;
export type TrackId   = string;

export interface AudioClip {
  readonly id:          ClipId;
  readonly sourceId:    string;       // reference to source AudioBuffer
  readonly trackId:     TrackId;
  readonly startSample: number;       // position on timeline (samples)
  readonly endSample:   number;       // end position on timeline
  readonly offsetSample: number;      // offset into source buffer
  readonly gain:        number;       // 0-4 linear gain
  readonly fadeInSamples:  number;    // raised-cosine fade in
  readonly fadeOutSamples: number;    // raised-cosine fade out
  readonly muted:       boolean;
  readonly label:       string;
}

export interface TimelineTrack {
  readonly id:     TrackId;
  readonly name:   string;
  readonly muted:  boolean;
  readonly solo:   boolean;
  readonly gain:   number;
  readonly clips:  readonly AudioClip[];
}

export interface TimelineState {
  readonly id:           string;
  readonly tracks:       readonly TimelineTrack[];
  readonly sampleRate:   number;
  readonly totalSamples: number;
  readonly markers:      readonly TimelineMarker[];
  readonly loopStart:    number;
  readonly loopEnd:      number;
  readonly version:      number;
}

export interface TimelineMarker {
  readonly id:          string;
  readonly samplePos:   number;
  readonly label:       string;
  readonly color:       string;
}

// ── Edit Operations ───────────────────────────────────────────────────────────

export type EditOperation =
  | { type: "ADD_CLIP";     clip: AudioClip }
  | { type: "REMOVE_CLIP";  clipId: ClipId; trackId: TrackId }
  | { type: "MOVE_CLIP";    clipId: ClipId; trackId: TrackId; newStart: number }
  | { type: "TRIM_CLIP";    clipId: ClipId; trackId: TrackId; newStart: number; newEnd: number }
  | { type: "SPLIT_CLIP";   clipId: ClipId; trackId: TrackId; splitSample: number }
  | { type: "RIPPLE_DELETE"; trackId: TrackId; startSample: number; endSample: number }
  | { type: "SET_GAIN";     clipId: ClipId; trackId: TrackId; gain: number }
  | { type: "SET_FADE";     clipId: ClipId; trackId: TrackId; fadeIn: number; fadeOut: number }
  | { type: "MUTE_CLIP";    clipId: ClipId; trackId: TrackId; muted: boolean }
  | { type: "ADD_TRACK";    track: TimelineTrack }
  | { type: "REMOVE_TRACK"; trackId: TrackId }
  | { type: "ADD_MARKER";   marker: TimelineMarker }
  | { type: "SET_LOOP";     start: number; end: number };

// ── Edit Node (DAG) ───────────────────────────────────────────────────────────

interface EditNode {
  readonly id:        EditId;
  readonly operation: EditOperation;
  readonly state:     TimelineState;
  readonly timestamp: number;
  readonly parentId:  EditId | null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeEmptyState(sr: number): TimelineState {
  return {
    id:           generateId(),
    tracks:       [],
    sampleRate:   sr,
    totalSamples: 0,
    markers:      [],
    loopStart:    0,
    loopEnd:      0,
    version:      0,
  };
}

function computeTotalSamples(state: TimelineState): number {
  let max = 0;
  for(const track of state.tracks)
    for(const clip of track.clips)
      if(clip.endSample > max) max = clip.endSample;
  return max;
}

function updateTrack(
  state: TimelineState,
  trackId: TrackId,
  fn: (track: TimelineTrack) => TimelineTrack
): TimelineState {
  const tracks = state.tracks.map(t => t.id === trackId ? fn(t) : t);
  const next = { ...state, tracks, version: state.version + 1 };
  return { ...next, totalSamples: computeTotalSamples(next) };
}

function updateClip(
  track: TimelineTrack,
  clipId: ClipId,
  fn: (clip: AudioClip) => AudioClip
): TimelineTrack {
  return { ...track, clips: track.clips.map(c => c.id === clipId ? fn(c) : c) };
}

// ── Edit Application ──────────────────────────────────────────────────────────

function applyOperation(state: TimelineState, op: EditOperation): TimelineState {
  switch(op.type) {

    case "ADD_CLIP": {
      return updateTrack(state, op.clip.trackId, track => ({
        ...track,
        clips: [...track.clips, op.clip].sort((a,b) => a.startSample - b.startSample),
      }));
    }

    case "REMOVE_CLIP": {
      return updateTrack(state, op.trackId, track => ({
        ...track, clips: track.clips.filter(c => c.id !== op.clipId),
      }));
    }

    case "MOVE_CLIP": {
      return updateTrack(state, op.trackId, track =>
        updateClip(track, op.clipId, clip => {
          const dur = clip.endSample - clip.startSample;
          return { ...clip, startSample: op.newStart, endSample: op.newStart + dur };
        })
      );
    }

    case "TRIM_CLIP": {
      return updateTrack(state, op.trackId, track =>
        updateClip(track, op.clipId, clip => ({
          ...clip, startSample: op.newStart, endSample: op.newEnd,
        }))
      );
    }

    case "SPLIT_CLIP": {
      return updateTrack(state, op.trackId, track => {
        const clip = track.clips.find(c => c.id === op.clipId);
        if(!clip || op.splitSample <= clip.startSample || op.splitSample >= clip.endSample)
          return track;

        const left: AudioClip = {
          ...clip, id: generateId(),
          endSample:      op.splitSample,
          fadeOutSamples: 0,
        };
        const right: AudioClip = {
          ...clip, id: generateId(),
          startSample:   op.splitSample,
          offsetSample:  clip.offsetSample + (op.splitSample - clip.startSample),
          fadeInSamples: 0,
        };
        return {
          ...track,
          clips: track.clips
            .filter(c => c.id !== op.clipId)
            .concat([left, right])
            .sort((a,b) => a.startSample - b.startSample),
        };
      });
    }

    case "RIPPLE_DELETE": {
      // Remove region and shift everything after it left
      const regionLen = op.endSample - op.startSample;
      return updateTrack(state, op.trackId, track => {
        const clips = track.clips
          .filter(c => !(c.startSample >= op.startSample && c.endSample <= op.endSample))
          .map(c => {
            // Clip entirely after region — shift left
            if(c.startSample >= op.endSample) {
              const dur = c.endSample - c.startSample;
              const ns  = c.startSample - regionLen;
              return { ...c, startSample: ns, endSample: ns + dur };
            }
            // Clip overlaps region end — trim start
            if(c.startSample < op.endSample && c.endSample > op.endSample) {
              const overlapLen = op.endSample - c.startSample;
              return {
                ...c,
                startSample:  op.startSample,
                endSample:    c.endSample - regionLen,
                offsetSample: c.offsetSample + overlapLen,
              };
            }
            // Clip overlaps region start — trim end
            if(c.endSample > op.startSample && c.startSample < op.startSample) {
              return { ...c, endSample: op.startSample };
            }
            return c;
          })
          .filter(c => c.endSample > c.startSample)
          .sort((a,b) => a.startSample - b.startSample);
        return { ...track, clips };
      });
    }

    case "SET_GAIN": {
      return updateTrack(state, op.trackId, track =>
        updateClip(track, op.clipId, clip => ({ ...clip, gain: op.gain }))
      );
    }

    case "SET_FADE": {
      return updateTrack(state, op.trackId, track =>
        updateClip(track, op.clipId, clip => ({
          ...clip, fadeInSamples: op.fadeIn, fadeOutSamples: op.fadeOut,
        }))
      );
    }

    case "MUTE_CLIP": {
      return updateTrack(state, op.trackId, track =>
        updateClip(track, op.clipId, clip => ({ ...clip, muted: op.muted }))
      );
    }

    case "ADD_TRACK": {
      const tracks = [...state.tracks, op.track];
      return { ...state, tracks, version: state.version + 1 };
    }

    case "REMOVE_TRACK": {
      const tracks = state.tracks.filter(t => t.id !== op.trackId);
      return { ...state, tracks, version: state.version + 1 };
    }

    case "ADD_MARKER": {
      const markers = [...state.markers, op.marker]
        .sort((a,b) => a.samplePos - b.samplePos);
      return { ...state, markers, version: state.version + 1 };
    }

    case "SET_LOOP": {
      return { ...state, loopStart: op.start, loopEnd: op.end,
        version: state.version + 1 };
    }
  }
}

// ── Timeline Engine ───────────────────────────────────────────────────────────

export class TimelineEngine {
  private nodes    = new Map<EditId, EditNode>();
  private headId:  EditId | null = null;
  private redoStack: EditId[] = [];
  private sources  = new Map<string, AudioBuffer>();

  constructor(sampleRate = 48000) {
    const initial = makeEmptyState(sampleRate);
    const rootNode: EditNode = {
      id:        generateId(),
      operation: { type: "ADD_TRACK", track: {
        id: generateId(), name: "Track 1",
        muted: false, solo: false, gain: 1, clips: [],
      }},
      state:     initial,
      timestamp: Date.now(),
      parentId:  null,
    };
    this.nodes.set(rootNode.id, rootNode);
    this.headId = rootNode.id;
  }

  // ── Source Management ───────────────────────────────────────────────────────

  registerSource(id: string, buffer: AudioBuffer): void {
    this.sources.set(id, buffer);
  }

  getSource(id: string): AudioBuffer | undefined {
    return this.sources.get(id);
  }

  // ── State Access ────────────────────────────────────────────────────────────

  get state(): TimelineState {
    return this.nodes.get(this.headId!)!.state;
  }

  get canUndo(): boolean {
    return this.nodes.get(this.headId!)?.parentId != null;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ── Edit ────────────────────────────────────────────────────────────────────

  dispatch(op: EditOperation): TimelineState {
    const current  = this.nodes.get(this.headId!)!;
    const newState = applyOperation(current.state, op);
    const newNode: EditNode = {
      id:        generateId(),
      operation: op,
      state:     newState,
      timestamp: Date.now(),
      parentId:  this.headId,
    };
    this.nodes.set(newNode.id, newNode);
    this.headId    = newNode.id;
    this.redoStack = []; // clear redo on new edit
    return newState;
  }

  undo(): TimelineState | null {
    const current = this.nodes.get(this.headId!);
    if(!current?.parentId) return null;
    this.redoStack.push(this.headId!);
    this.headId = current.parentId;
    return this.state;
  }

  redo(): TimelineState | null {
    const redoId = this.redoStack.pop();
    if(!redoId) return null;
    this.headId = redoId;
    return this.state;
  }

  // ── Convenience Operations ──────────────────────────────────────────────────

  addClip(
    sourceId: string, trackId: TrackId,
    startSample: number, durationSamples: number,
    options: Partial<Omit<AudioClip,"id"|"sourceId"|"trackId"|"startSample"|"endSample">> = {}
  ): AudioClip {
    const clip: AudioClip = {
      id:            generateId(),
      sourceId, trackId,
      startSample,
      endSample:     startSample + durationSamples,
      offsetSample:  options.offsetSample ?? 0,
      gain:          options.gain         ?? 1,
      fadeInSamples: options.fadeInSamples ?? Math.floor(0.01 * this.state.sampleRate),
      fadeOutSamples:options.fadeOutSamples?? Math.floor(0.01 * this.state.sampleRate),
      muted:         options.muted        ?? false,
      label:         options.label        ?? "Clip",
    };
    this.dispatch({ type:"ADD_CLIP", clip });
    return clip;
  }

  splitAtPlayhead(trackId: TrackId, samplePos: number): void {
    const track = this.state.tracks.find(t => t.id === trackId);
    if(!track) return;
    const clip = track.clips.find(
      c => c.startSample < samplePos && c.endSample > samplePos
    );
    if(clip) this.dispatch({ type:"SPLIT_CLIP", clipId:clip.id, trackId, splitSample:samplePos });
  }

  rippleDelete(trackId: TrackId, startSample: number, endSample: number): void {
    this.dispatch({ type:"RIPPLE_DELETE", trackId, startSample, endSample });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  // Mix all tracks to stereo Float32Array output

  render(startSample = 0, endSample?: number): Float32Array {
    const state  = this.state;
    const sr     = state.sampleRate;
    const end    = endSample ?? state.totalSamples;
    const length = end - startSample;
    if(length <= 0) return new Float32Array(0);

    const outL = new Float64Array(length);
    const outR = new Float64Array(length);

    for(const track of state.tracks) {
      if(track.muted) continue;

      for(const clip of track.clips) {
        if(clip.muted) continue;
        if(clip.endSample <= startSample || clip.startSample >= end) continue;

        const src = this.sources.get(clip.sourceId);
        if(!src) continue;

        const srcL = src.getChannelData(0);
        const srcR = src.numberOfChannels > 1 ? src.getChannelData(1) : srcL;

        const clipStart = Math.max(clip.startSample, startSample);
        const clipEnd   = Math.min(clip.endSample, end);
        const clipGain  = clip.gain * track.gain;
        const clipLen   = clip.endSample - clip.startSample;

        for(let t = clipStart; t < clipEnd; t++) {
          const srcIdx  = clip.offsetSample + (t - clip.startSample);
          if(srcIdx < 0 || srcIdx >= srcL.length) continue;

          // Raised-cosine fades
          const posInClip = t - clip.startSample;
          let fade = 1;
          if(posInClip < clip.fadeInSamples && clip.fadeInSamples > 0)
            fade = 0.5*(1-Math.cos(Math.PI*posInClip/clip.fadeInSamples));
          else if(posInClip > clipLen - clip.fadeOutSamples && clip.fadeOutSamples > 0)
            fade = 0.5*(1+Math.cos(Math.PI*(posInClip-(clipLen-clip.fadeOutSamples))/clip.fadeOutSamples));

          const g = clipGain * fade;
          const outIdx = t - startSample;
          outL[outIdx] += srcL[srcIdx] * g;
          outR[outIdx] += srcR[srcIdx] * g;
        }
      }
    }

    // Interleave + soft clip
    const result = new Float32Array(length * 2);
    for(let i=0;i<length;i++){
      result[i*2]   = Math.max(-1,Math.min(1,outL[i]));
      result[i*2+1] = Math.max(-1,Math.min(1,outR[i]));
    }
    return result;
  }

  // ── History ─────────────────────────────────────────────────────────────────

  getHistory(): { id: EditId; type: string; timestamp: number }[] {
    const history: { id: EditId; type: string; timestamp: number }[] = [];
    let current = this.nodes.get(this.headId!);
    while(current) {
      history.unshift({
        id:        current.id,
        type:      current.operation.type,
        timestamp: current.timestamp,
      });
      current = current.parentId ? this.nodes.get(current.parentId) : undefined;
    }
    return history;
  }

  get editCount(): number { return this.nodes.size; }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const timeline = new TimelineEngine(48000);
