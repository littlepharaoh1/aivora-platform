/**
 * transcriptWorkstationTypes.ts
 * Aivora Platform — Transcript Workstation Pro
 *
 * Extends existing ASRTranscript types.
 * No external state managers. Deterministic. Offline-first.
 */

import type { ASRToken, ASRLanguage } from "./asrTypes";

// ── Speaker ───────────────────────────────────────────────────────────────────

export interface Speaker {
  id:         string;   // UUID
  label:      string;   // "Speaker 1", "Ahmed", etc.
  color:      string;   // hex — deterministic from id hash
}

// ── Word (extends ASRToken with editing) ──────────────────────────────────────

export interface WorkstationWord extends ASRToken {
  speaker_id:   string;
  is_edited:    boolean;
  original_text:string;
  qa_flag:      QAFlag | null;
}

// ── QA Flags ─────────────────────────────────────────────────────────────────

export type QAFlag =
  | "low_confidence"
  | "inaudible"
  | "cross_talk"
  | "noise"
  | "uncertain"
  | "reviewed_ok";

// ── Segment (extended) ────────────────────────────────────────────────────────

export interface WorkstationSegment {
  id:           string;   // UUID
  index:        number;   // 0-based, deterministic order
  speaker_id:   string;
  words:        WorkstationWord[];
  text:         string;   // derived from words
  start_sec:    number;
  end_sec:      number;
  language:     string;
  is_rtl:       boolean;
  is_edited:    boolean;
  qa_flag:      QAFlag | null;
  confidence:   number;   // mean word confidence
  created_at:   string;
  updated_at:   string;
}

// ── Version (history entry) ───────────────────────────────────────────────────

export interface TranscriptVersion {
  version_id:       string;
  transcript_id:    string;
  version_number:   number;
  snapshot:         WorkstationSegment[];
  created_at:       string;
  created_by:       string;
  change_summary:   string;
  checksum:         string;   // SHA-256 of snapshot JSON
}

// ── Full Workstation Transcript ───────────────────────────────────────────────

export interface WorkstationTranscript {
  id:                 string;
  audio_file_id:      string | null;
  correlation_id:     string;
  model_id:           string;
  language_detected:  string;
  speakers:           Speaker[];
  segments:           WorkstationSegment[];
  full_text:          string;
  word_count:         number;
  duration_sec:       number;
  version_number:     number;
  current_version_id: string;
  input_checksum:     string | null;
  output_checksum:    string | null;
  created_at:         string;
  updated_at:         string;
  auto_saved_at:      string | null;
}

// ── Edit Operations (for undo/redo) ───────────────────────────────────────────

export type EditOperation =
  | { type: "EDIT_WORD";     segment_id: string; word_idx: number; old_text: string; new_text: string }
  | { type: "EDIT_SEGMENT";  segment_id: string; old_text: string; new_text: string }
  | { type: "ASSIGN_SPEAKER";segment_id: string; old_speaker_id: string; new_speaker_id: string }
  | { type: "SET_QA_FLAG";   target: "segment"|"word"; id: string; word_idx?: number; old_flag: QAFlag|null; new_flag: QAFlag|null }
  | { type: "MERGE_SEGMENTS";segment_id_a: string; segment_id_b: string }
  | { type: "SPLIT_SEGMENT"; segment_id: string; split_word_idx: number }
  | { type: "DELETE_SEGMENT";segment_id: string; snapshot: WorkstationSegment }
  | { type: "ADD_SEGMENT";   segment: WorkstationSegment };

// ── Editor State ──────────────────────────────────────────────────────────────

export interface EditorState {
  transcript:       WorkstationTranscript | null;
  selectedSegmentId:string | null;
  selectedWordIdx:  number | null;
  searchQuery:      string;
  searchResults:    SearchResult[];
  searchIdx:        number;
  isDirty:          boolean;
  isSaving:         boolean;
  lastSavedAt:      string | null;
  undoStack:        EditOperation[];
  redoStack:        EditOperation[];
  versions:         TranscriptVersion[];
  loadingVersionId: string | null;
  playhead_sec:     number;
}

export interface SearchResult {
  segment_idx: number;
  word_idx:    number;
  match_text:  string;
}

// ── Export Formats ────────────────────────────────────────────────────────────

export type ExportFormat = "txt" | "json" | "jsonl" | "csv" | "srt";

// ── Keyboard Shortcut Map ─────────────────────────────────────────────────────

export const KEYBOARD_SHORTCUTS: Record<string, string> = {
  "Ctrl+Z":       "Undo",
  "Ctrl+Shift+Z": "Redo",
  "Ctrl+Y":       "Redo",
  "Ctrl+F":       "Search",
  "Ctrl+H":       "Search & Replace",
  "Ctrl+S":       "Save",
  "Ctrl+Enter":   "Confirm edit",
  "Escape":       "Cancel edit / Close search",
  "Tab":          "Next segment",
  "Shift+Tab":    "Previous segment",
  "Alt+S":        "Assign speaker",
  "Alt+F":        "Toggle QA flag",
  "Alt+M":        "Merge with next segment",
  "Alt+P":        "Split segment at cursor",
};
