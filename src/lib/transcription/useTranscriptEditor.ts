/**
 * useTranscriptEditor.ts
 * Aivora Platform — Transcript Workstation Pro
 *
 * Central hook — manages all editor state.
 * Uses useReducer for deterministic state transitions.
 * Auto-save via useEffect (no external scheduler needed).
 * Reuses existing: supabase, mutationQueue, emitEvent.
 */

import { useReducer, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../../hooks/useAuth";
import {
  fromASRTranscript, applyOperation, rebuildFullText,
  saveTranscript, saveVersion, loadVersions,
  searchSegments, replaceInSegments, exportTranscript,
  speakerColor,
} from "./transcriptWorkstationService";
import type {
  EditorState, EditOperation, WorkstationTranscript,
  WorkstationSegment, Speaker, QAFlag, ExportFormat,
  SearchResult, TranscriptVersion,
} from "./transcriptWorkstationTypes";
import type { ASRTranscript } from "./asrTypes";
import { emitEvent } from "../telemetry/emitter";

// ── Initial State ─────────────────────────────────────────────────────────────

const INITIAL_STATE: EditorState = {
  transcript:        null,
  selectedSegmentId: null,
  selectedWordIdx:   null,
  searchQuery:       "",
  searchResults:     [],
  searchIdx:         0,
  isDirty:           false,
  isSaving:          false,
  lastSavedAt:       null,
  undoStack:         [],
  redoStack:         [],
  versions:          [],
  loadingVersionId:  null,
  playhead_sec:      0,
};

// ── Action Types ──────────────────────────────────────────────────────────────

type Action =
  | { type: "LOAD_TRANSCRIPT";    transcript: WorkstationTranscript }
  | { type: "APPLY_EDIT";         op: EditOperation }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SELECT_SEGMENT";     segmentId: string | null; wordIdx?: number }
  | { type: "SET_SEARCH";         query: string }
  | { type: "SET_SEARCH_RESULTS"; results: SearchResult[] }
  | { type: "SEARCH_NEXT" }
  | { type: "SEARCH_PREV" }
  | { type: "REPLACE_ALL";        find: string; replace: string }
  | { type: "ADD_SPEAKER";        speaker: Speaker }
  | { type: "RENAME_SPEAKER";     speakerId: string; label: string }
  | { type: "SET_SAVING";         isSaving: boolean }
  | { type: "SET_SAVED";          at: string }
  | { type: "LOAD_VERSIONS";      versions: TranscriptVersion[] }
  | { type: "RESTORE_VERSION";    version: TranscriptVersion }
  | { type: "SET_PLAYHEAD";       sec: number };

// ── Reducer (pure — deterministic) ────────────────────────────────────────────

function reducer(state: EditorState, action: Action): EditorState {
  switch(action.type) {

    case "LOAD_TRANSCRIPT":
      return {
        ...INITIAL_STATE,
        transcript: action.transcript,
      };

    case "APPLY_EDIT": {
      if(!state.transcript) return state;
      const newSegments = applyOperation(state.transcript.segments, action.op);
      const fullText    = rebuildFullText(newSegments);
      const wordCount   = fullText.split(/\s+/).filter(Boolean).length;
      return {
        ...state,
        transcript: {
          ...state.transcript,
          segments:   newSegments,
          full_text:  fullText,
          word_count: wordCount,
          updated_at: new Date().toISOString(),
        },
        undoStack: [...state.undoStack, action.op],
        redoStack: [],
        isDirty:   true,
      };
    }

    case "UNDO": {
      if(!state.transcript || state.undoStack.length === 0) return state;
      const stack   = [...state.undoStack];
      const last    = stack.pop()!;
      // Replay all ops except last
      const base    = fromASRTranscript({
        ...state.transcript as any,
        segments: state.transcript.segments, // start from current — rebuild from scratch not needed here
      });
      // Reverse the op
      const reversed = reverseOp(last, state.transcript.segments);
      if(!reversed) return state;
      const newSegments = applyOperation(state.transcript.segments, reversed);
      const fullText    = rebuildFullText(newSegments);
      return {
        ...state,
        transcript: {
          ...state.transcript,
          segments:  newSegments,
          full_text: fullText,
          word_count: fullText.split(/\s+/).filter(Boolean).length,
          updated_at: new Date().toISOString(),
        },
        undoStack: stack,
        redoStack: [last, ...state.redoStack],
        isDirty:   true,
      };
    }

    case "REDO": {
      if(!state.transcript || state.redoStack.length === 0) return state;
      const stack   = [...state.redoStack];
      const next    = stack.shift()!;
      const newSegs = applyOperation(state.transcript.segments, next);
      const fullText = rebuildFullText(newSegs);
      return {
        ...state,
        transcript: {
          ...state.transcript,
          segments:  newSegs,
          full_text: fullText,
          word_count: fullText.split(/\s+/).filter(Boolean).length,
          updated_at: new Date().toISOString(),
        },
        undoStack: [...state.undoStack, next],
        redoStack: stack,
        isDirty:   true,
      };
    }

    case "SELECT_SEGMENT":
      return {
        ...state,
        selectedSegmentId: action.segmentId,
        selectedWordIdx:   action.wordIdx ?? null,
      };

    case "SET_SEARCH":
      return { ...state, searchQuery: action.query, searchIdx: 0 };

    case "SET_SEARCH_RESULTS":
      return { ...state, searchResults: action.results, searchIdx: 0 };

    case "SEARCH_NEXT":
      if(state.searchResults.length === 0) return state;
      return { ...state, searchIdx: (state.searchIdx + 1) % state.searchResults.length };

    case "SEARCH_PREV":
      if(state.searchResults.length === 0) return state;
      return {
        ...state,
        searchIdx: (state.searchIdx - 1 + state.searchResults.length) % state.searchResults.length,
      };

    case "REPLACE_ALL": {
      if(!state.transcript) return state;
      const { segments, count } = replaceInSegments(
        state.transcript.segments, action.find, action.replace
      );
      if(count === 0) return state;
      const fullText = rebuildFullText(segments);
      return {
        ...state,
        transcript: {
          ...state.transcript,
          segments,
          full_text:  fullText,
          word_count: fullText.split(/\s+/).filter(Boolean).length,
          updated_at: new Date().toISOString(),
        },
        isDirty: true,
      };
    }

    case "ADD_SPEAKER": {
      if(!state.transcript) return state;
      return {
        ...state,
        transcript: {
          ...state.transcript,
          speakers: [...state.transcript.speakers, action.speaker],
        },
      };
    }

    case "RENAME_SPEAKER": {
      if(!state.transcript) return state;
      return {
        ...state,
        transcript: {
          ...state.transcript,
          speakers: state.transcript.speakers.map(sp =>
            sp.id === action.speakerId ? { ...sp, label: action.label } : sp
          ),
        },
        isDirty: true,
      };
    }

    case "SET_SAVING":
      return { ...state, isSaving: action.isSaving };

    case "SET_SAVED":
      return { ...state, isSaving: false, isDirty: false, lastSavedAt: action.at };

    case "LOAD_VERSIONS":
      return { ...state, versions: action.versions };

    case "RESTORE_VERSION": {
      if(!state.transcript) return state;
      return {
        ...state,
        transcript: {
          ...state.transcript,
          segments:           action.version.snapshot,
          full_text:          rebuildFullText(action.version.snapshot),
          version_number:     action.version.version_number,
          current_version_id: action.version.version_id,
          updated_at:         new Date().toISOString(),
        },
        undoStack: [],
        redoStack: [],
        isDirty:   true,
      };
    }

    case "SET_PLAYHEAD":
      return { ...state, playhead_sec: action.sec };

    default: return state;
  }
}

// ── Reverse operation (for undo) ──────────────────────────────────────────────

function reverseOp(
  op: EditOperation,
  currentSegments: WorkstationSegment[],
): EditOperation | null {
  switch(op.type) {
    case "EDIT_WORD":
      return { ...op, old_text: op.new_text, new_text: op.old_text };
    case "EDIT_SEGMENT":
      return { ...op, old_text: op.new_text, new_text: op.old_text };
    case "ASSIGN_SPEAKER":
      return { ...op, old_speaker_id: op.new_speaker_id, new_speaker_id: op.old_speaker_id };
    case "SET_QA_FLAG":
      return { ...op, old_flag: op.new_flag, new_flag: op.old_flag };
    case "DELETE_SEGMENT":
      return { type: "ADD_SEGMENT", segment: op.snapshot };
    case "ADD_SEGMENT":
      return { type: "DELETE_SEGMENT", segment_id: op.segment.id, snapshot: op.segment };
    case "MERGE_SEGMENTS":
    case "SPLIT_SEGMENT":
      // Complex ops: rebuild from scratch not supported in simple undo
      // Return null to block undo for these ops
      return null;
    default: return null;
  }
}

// ── AUTO-SAVE interval ────────────────────────────────────────────────────────

const AUTO_SAVE_MS = 30_000; // 30 seconds

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTranscriptEditor() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { user } = useAuth();
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load from ASR result ──────────────────────────────────────────────────
  const loadFromASR = useCallback((asr: ASRTranscript) => {
    const ws = fromASRTranscript(asr);
    dispatch({ type: "LOAD_TRANSCRIPT", transcript: ws });
    emitEvent({
      event_type:   "ADMIN_ACTION",
      event_source: "transcript_workstation",
      correlation_id: asr.correlation_id,
      severity:     "info",
      payload:      { action: "WORKSTATION_OPENED", segments: asr.segments.length },
    });
  }, []);

  // ── Edit operations ───────────────────────────────────────────────────────
  const applyEdit = useCallback((op: EditOperation) => {
    dispatch({ type: "APPLY_EDIT", op });
  }, []);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  // ── Selection ─────────────────────────────────────────────────────────────
  const selectSegment = useCallback((id: string | null, wordIdx?: number) => {
    dispatch({ type: "SELECT_SEGMENT", segmentId: id, wordIdx });
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  const search = useCallback((query: string) => {
    dispatch({ type: "SET_SEARCH", query });
    if(!state.transcript || !query.trim()) {
      dispatch({ type: "SET_SEARCH_RESULTS", results: [] });
      return;
    }
    const results = searchSegments(state.transcript.segments, query);
    dispatch({ type: "SET_SEARCH_RESULTS", results });
  }, [state.transcript]);

  const searchNext = useCallback(() => dispatch({ type: "SEARCH_NEXT" }), []);
  const searchPrev = useCallback(() => dispatch({ type: "SEARCH_PREV" }), []);

  const replaceAll = useCallback((find: string, replace: string) => {
    dispatch({ type: "REPLACE_ALL", find, replace });
  }, []);

  // ── Speakers ──────────────────────────────────────────────────────────────
  const addSpeaker = useCallback((label: string) => {
    if(!state.transcript) return;
    const idx = state.transcript.speakers.length;
    const speaker: Speaker = {
      id:    crypto.randomUUID(),
      label,
      color: speakerColor("", idx),
    };
    dispatch({ type: "ADD_SPEAKER", speaker });
  }, [state.transcript]);

  const renameSpeaker = useCallback((speakerId: string, label: string) => {
    dispatch({ type: "RENAME_SPEAKER", speakerId, label });
  }, []);

  const assignSpeaker = useCallback((segmentId: string, newSpeakerId: string) => {
    const seg = state.transcript?.segments.find(s => s.id === segmentId);
    if(!seg) return;
    applyEdit({
      type:           "ASSIGN_SPEAKER",
      segment_id:     segmentId,
      old_speaker_id: seg.speaker_id,
      new_speaker_id: newSpeakerId,
    });
  }, [state.transcript, applyEdit]);

  // ── QA Flags ──────────────────────────────────────────────────────────────
  const setQAFlag = useCallback((
    target: "segment" | "word",
    id: string,
    flag: QAFlag | null,
    wordIdx?: number,
  ) => {
    const seg = state.transcript?.segments.find(s => s.id === id);
    const oldFlag = target === "segment"
      ? seg?.qa_flag ?? null
      : (seg?.words[wordIdx ?? 0]?.qa_flag ?? null);
    applyEdit({ type: "SET_QA_FLAG", target, id, old_flag: oldFlag, new_flag: flag, word_idx: wordIdx });
  }, [state.transcript, applyEdit]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(async (createVersion = false) => {
    if(!state.transcript || !user) return;
    dispatch({ type: "SET_SAVING", isSaving: true });
    const { ok } = await saveTranscript(state.transcript, user.id);
    if(ok) {
      if(createVersion) {
        await saveVersion(state.transcript, user.id, `Manual save v${state.transcript.version_number}`);
      }
      dispatch({ type: "SET_SAVED", at: new Date().toISOString() });
    } else {
      dispatch({ type: "SET_SAVING", isSaving: false });
    }
  }, [state.transcript, user]);

  // ── Load versions ─────────────────────────────────────────────────────────
  const fetchVersions = useCallback(async () => {
    if(!state.transcript) return;
    const versions = await loadVersions(state.transcript.id);
    dispatch({ type: "LOAD_VERSIONS", versions });
  }, [state.transcript]);

  const restoreVersion = useCallback((version: TranscriptVersion) => {
    dispatch({ type: "RESTORE_VERSION", version });
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportAs = useCallback((format: ExportFormat) => {
    if(!state.transcript) return;
    const filename = `transcript_${state.transcript.id.slice(0,8)}`;
    exportTranscript(state.transcript, format, filename);
  }, [state.transcript]);

  // ── Playhead ──────────────────────────────────────────────────────────────
  const setPlayhead = useCallback((sec: number) => {
    dispatch({ type: "SET_PLAYHEAD", sec });
  }, []);

  // ── Auto-save ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if(autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    if(state.isDirty && state.transcript && user) {
      autoSaveTimer.current = setInterval(() => {
        save(false);
      }, AUTO_SAVE_MS);
    }
    return () => {
      if(autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    };
  }, [state.isDirty, state.transcript, user, save]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if(ctrl && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if(ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if(ctrl && e.key === "s") { e.preventDefault(); save(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, save]);

  return {
    state,
    loadFromASR,
    applyEdit,
    undo, redo,
    selectSegment,
    search, searchNext, searchPrev, replaceAll,
    addSpeaker, renameSpeaker, assignSpeaker,
    setQAFlag,
    save,
    fetchVersions, restoreVersion,
    exportAs,
    setPlayhead,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
