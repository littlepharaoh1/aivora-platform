/**
 * transcriptWorkstationService.ts
 * Aivora Platform — Transcript Workstation Pro
 *
 * Service layer — reuses existing:
 *   - supabase (existing client)
 *   - mutationQueue (offline-first)
 *   - sha256 (deterministic checksums)
 *   - emitEvent (telemetry)
 */

import { supabase }   from "../supabase";
import { emitEvent }  from "../telemetry/emitter";
import { enqueueMutation } from "../offline/mutationQueue";
import type {
  WorkstationTranscript, WorkstationSegment,
  TranscriptVersion, Speaker, QAFlag, ExportFormat,
  EditOperation,
} from "./transcriptWorkstationTypes";
import type { ASRTranscript } from "./asrTypes";

// ── SHA-256 (reuse existing pattern) ─────────────────────────────────────────

async function sha256(str: string): Promise<string> {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── Speaker color (deterministic from id) ─────────────────────────────────────

const SPEAKER_COLORS = [
  "#22d3ee","#a855f7","#f59e0b","#10b981",
  "#3b82f6","#ef4444","#ec4899","#84cc16",
];

export function speakerColor(speakerId: string, idx: number): string {
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

// ── Convert ASRTranscript → WorkstationTranscript ─────────────────────────────

export function fromASRTranscript(
  asr: ASRTranscript,
): WorkstationTranscript {
  const defaultSpeaker: Speaker = {
    id:    crypto.randomUUID(),
    label: "Speaker 1",
    color: SPEAKER_COLORS[0],
  };

  const now = new Date().toISOString();

  const segments: WorkstationSegment[] = (asr.segments as any[]).map((s, i) => ({
    id:         crypto.randomUUID(),
    index:      i,
    speaker_id: defaultSpeaker.id,
    words:      (s.tokens ?? []).map((t: any) => ({
      ...t,
      speaker_id:    defaultSpeaker.id,
      is_edited:     false,
      original_text: t.text,
      qa_flag:       null,
    })),
    text:        s.text ?? "",
    start_sec:   s.start_sec ?? s.start ?? 0,
    end_sec:     s.end_sec   ?? s.end   ?? 0,
    language:    s.language  ?? asr.language_detected,
    is_rtl:      s.is_rtl    ?? false,
    is_edited:   false,
    qa_flag:     null,
    confidence:  s.confidence ?? 0.9,
    created_at:  now,
    updated_at:  now,
  }));

  const fullText = segments.map(s => s.text).join(" ").trim();
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const versionId = crypto.randomUUID();

  return {
    id:                 crypto.randomUUID(),
    audio_file_id:      asr.audio_file_id ?? null,
    correlation_id:     asr.correlation_id,
    model_id:           asr.model_id,
    language_detected:  asr.language_detected,
    speakers:           [defaultSpeaker],
    segments,
    full_text:          fullText,
    word_count:         wordCount,
    duration_sec:       asr.duration_sec,
    version_number:     1,
    current_version_id: versionId,
    input_checksum:     asr.input_checksum,
    output_checksum:    asr.output_checksum,
    created_at:         now,
    updated_at:         now,
    auto_saved_at:      null,
  };
}

// ── Rebuild full_text from segments ──────────────────────────────────────────

export function rebuildFullText(segments: WorkstationSegment[]): string {
  return segments.map(s => s.text).join(" ").trim();
}

// ── Apply edit operation (pure — returns new state) ──────────────────────────

export function applyOperation(
  segments: WorkstationSegment[],
  op: EditOperation,
): WorkstationSegment[] {
  const now = new Date().toISOString();

  switch(op.type) {
    case "EDIT_WORD": {
      return segments.map(seg => {
        if(seg.id !== op.segment_id) return seg;
        const words = seg.words.map((w, i) => {
          if(i !== op.word_idx) return w;
          return { ...w, text: op.new_text, is_edited: true };
        });
        const text = words.map(w => w.text).join(" ").trim();
        return { ...seg, words, text, is_edited: true, updated_at: now };
      });
    }
    case "EDIT_SEGMENT": {
      return segments.map(seg => {
        if(seg.id !== op.segment_id) return seg;
        return { ...seg, text: op.new_text, is_edited: true, updated_at: now };
      });
    }
    case "ASSIGN_SPEAKER": {
      return segments.map(seg => {
        if(seg.id !== op.segment_id) return seg;
        return { ...seg, speaker_id: op.new_speaker_id, updated_at: now };
      });
    }
    case "SET_QA_FLAG": {
      if(op.target === "segment") {
        return segments.map(seg => {
          if(seg.id !== op.id) return seg;
          return { ...seg, qa_flag: op.new_flag, updated_at: now };
        });
      }
      return segments.map(seg => {
        if(seg.id !== op.id) return seg;
        const words = seg.words.map((w, i) => {
          if(i !== op.word_idx) return w;
          return { ...w, qa_flag: op.new_flag };
        });
        return { ...seg, words, updated_at: now };
      });
    }
    case "MERGE_SEGMENTS": {
      const idxA = segments.findIndex(s => s.id === op.segment_id_a);
      const idxB = segments.findIndex(s => s.id === op.segment_id_b);
      if(idxA < 0 || idxB < 0) return segments;
      const segA = segments[idxA], segB = segments[idxB];
      const merged: WorkstationSegment = {
        ...segA,
        words:      [...segA.words, ...segB.words],
        text:       [segA.text, segB.text].filter(Boolean).join(" "),
        end_sec:    segB.end_sec,
        is_edited:  true,
        updated_at: now,
      };
      const out = segments.filter(s => s.id !== op.segment_id_b);
      return out.map((s,i) => s.id === op.segment_id_a
        ? { ...merged, index: i } : { ...s, index: i });
    }
    case "SPLIT_SEGMENT": {
      const seg = segments.find(s => s.id === op.segment_id);
      if(!seg || op.split_word_idx <= 0 || op.split_word_idx >= seg.words.length) return segments;
      const wordsA = seg.words.slice(0, op.split_word_idx);
      const wordsB = seg.words.slice(op.split_word_idx);
      const segA: WorkstationSegment = {
        ...seg,
        words:     wordsA,
        text:      wordsA.map(w=>w.text).join(" ").trim(),
        end_sec:   wordsA[wordsA.length-1]?.end_sec ?? seg.end_sec,
        is_edited: true, updated_at: now,
      };
      const segB: WorkstationSegment = {
        ...seg,
        id:        crypto.randomUUID(),
        words:     wordsB,
        text:      wordsB.map(w=>w.text).join(" ").trim(),
        start_sec: wordsB[0]?.start_sec ?? seg.start_sec,
        is_edited: true, updated_at: now,
      };
      const out: WorkstationSegment[] = [];
      segments.forEach(s => {
        if(s.id === op.segment_id) { out.push(segA); out.push(segB); }
        else out.push(s);
      });
      return out.map((s,i) => ({ ...s, index: i }));
    }
    case "DELETE_SEGMENT": {
      return segments
        .filter(s => s.id !== op.segment_id)
        .map((s,i) => ({ ...s, index: i }));
    }
    case "ADD_SEGMENT": {
      return [...segments, op.segment].map((s,i) => ({ ...s, index: i }));
    }
    default: return segments;
  }
}

// ── Save to Supabase (offline-safe) ──────────────────────────────────────────

export async function saveTranscript(
  transcript: WorkstationTranscript,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const checksum = await sha256(JSON.stringify(transcript.segments));
    const updated  = {
      ...transcript,
      output_checksum: checksum,
      updated_at:      new Date().toISOString(),
      auto_saved_at:   new Date().toISOString(),
    };

    const { error } = await supabase
      .from("workstation_transcripts")
      .upsert({ ...updated, user_id: userId }, { onConflict: "id" });

    if(error) throw error;

    emitEvent({
      event_type:     "ADMIN_ACTION",
      event_source:   "qc_workstation",
      correlation_id: transcript.correlation_id,
      severity:       "info",
      payload:        { action: "TRANSCRIPT_SAVED", word_count: transcript.word_count },
    });

    return { ok: true };
  } catch(e: any) {
    // Offline fallback
    await enqueueMutation({
      mutation_type:   "speech_transcript_insert",
      correlation_id:  transcript.correlation_id,
      payload:         transcript as unknown as Record<string,unknown>,
    });
    return { ok: true }; // queued for later sync
  }
}

// ── Save version snapshot ─────────────────────────────────────────────────────

export async function saveVersion(
  transcript: WorkstationTranscript,
  userId: string,
  summary: string,
): Promise<TranscriptVersion | null> {
  try {
    const checksum = await sha256(JSON.stringify(transcript.segments));
    const version: TranscriptVersion = {
      version_id:     crypto.randomUUID(),
      transcript_id:  transcript.id,
      version_number: transcript.version_number,
      snapshot:       transcript.segments,
      created_at:     new Date().toISOString(),
      created_by:     userId,
      change_summary: summary,
      checksum,
    };

    await supabase.from("transcript_versions").insert(version);
    return version;
  } catch { return null; }
}

// ── Load versions ─────────────────────────────────────────────────────────────

export async function loadVersions(
  transcriptId: string,
): Promise<TranscriptVersion[]> {
  const { data } = await supabase
    .from("transcript_versions")
    .select("*")
    .eq("transcript_id", transcriptId)
    .order("version_number", { ascending: false })
    .limit(50);
  return (data ?? []) as TranscriptVersion[];
}

// ── Search within segments ────────────────────────────────────────────────────

export function searchSegments(
  segments: WorkstationSegment[],
  query: string,
): { segment_idx: number; word_idx: number; match_text: string }[] {
  if(!query.trim()) return [];
  const q = query.toLowerCase();
  const results: { segment_idx: number; word_idx: number; match_text: string }[] = [];
  segments.forEach((seg, si) => {
    if(seg.words.length > 0) {
      seg.words.forEach((w, wi) => {
        if(w.text.toLowerCase().includes(q)) {
          results.push({ segment_idx: si, word_idx: wi, match_text: w.text });
        }
      });
    } else if(seg.text.toLowerCase().includes(q)) {
      // Fallback: segment-level match when no word-level data
      results.push({ segment_idx: si, word_idx: -1, match_text: seg.text });
    }
  });
  return results;
}

// ── Replace in segments ───────────────────────────────────────────────────────

export function replaceInSegments(
  segments: WorkstationSegment[],
  find: string,
  replace: string,
): { segments: WorkstationSegment[]; count: number } {
  const now = new Date().toISOString();
  let count = 0;
  const updated = segments.map(seg => {
    if(seg.words.length === 0) {
      // Fallback: replace directly in seg.text when no word-level data
      if(!seg.text.toLowerCase().includes(find.toLowerCase())) return seg;
      count++;
      const newText = seg.text.replace(new RegExp(find, "gi"), replace);
      return { ...seg, text: newText, is_edited: true, updated_at: now };
    }
    const words = seg.words.map(w => {
      if(!w.text.toLowerCase().includes(find.toLowerCase())) return w;
      count++;
      const newText = w.text.replace(new RegExp(find, "gi"), replace);
      return { ...w, text: newText, is_edited: true, original_text: w.original_text || w.text };
    });
    const text = words.map(w => w.text).join(" ").trim();
    return { ...seg, words, text, is_edited: true, updated_at: now };
  });
  return { segments: updated, count };
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportTranscript(
  transcript: WorkstationTranscript,
  format: ExportFormat,
  filename: string,
): void {
  let content = "";
  let mime    = "text/plain";

  switch(format) {
    case "txt": {
      content = transcript.segments.map(s => {
        const spk = transcript.speakers.find(sp => sp.id === s.speaker_id);
        return `[${spk?.label ?? "Speaker"}] ${s.text}`;
      }).join("\n\n");
      break;
    }
    case "json": {
      content = JSON.stringify({
        id:               transcript.id,
        duration_sec:     transcript.duration_sec,
        language:         transcript.language_detected,
        speakers:         transcript.speakers,
        segments:         transcript.segments.map(s => ({
          speaker:    transcript.speakers.find(sp=>sp.id===s.speaker_id)?.label,
          start_sec:  s.start_sec,
          end_sec:    s.end_sec,
          text:       s.text,
          confidence: s.confidence,
          language:   s.language,
        })),
        generated_at: transcript.created_at,
      }, null, 2);
      mime = "application/json";
      break;
    }
    case "jsonl": {
      content = transcript.segments.map(s => JSON.stringify({
        speaker:    transcript.speakers.find(sp=>sp.id===s.speaker_id)?.label,
        start_sec:  s.start_sec,
        end_sec:    s.end_sec,
        text:       s.text,
        language:   s.language,
        is_rtl:     s.is_rtl,
        confidence: s.confidence,
        qa_flag:    s.qa_flag,
      })).join("\n");
      mime = "application/jsonl";
      break;
    }
    case "csv": {
      const header = "speaker,start_sec,end_sec,text,language,is_rtl,confidence,qa_flag";
      const rows = transcript.segments.map(s => {
        const spk = transcript.speakers.find(sp=>sp.id===s.speaker_id)?.label ?? "";
        return `"${spk}",${s.start_sec},${s.end_sec},"${s.text.replace(/"/g,'""')}",${s.language},${s.is_rtl},${s.confidence},${s.qa_flag??''}`;
      });
      content = [header, ...rows].join("\n");
      mime = "text/csv";
      break;
    }
    case "srt": {
      const toSRT = (sec: number) => {
        const h  = Math.floor(sec/3600);
        const m  = Math.floor((sec%3600)/60);
        const s2 = Math.floor(sec%60);
        const ms = Math.floor((sec%1)*1000);
        return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s2).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
      };
      content = transcript.segments.map((s,i) => {
        const spk = transcript.speakers.find(sp=>sp.id===s.speaker_id)?.label ?? "Speaker";
        return `${i+1}\n${toSRT(s.start_sec)} --> ${toSRT(s.end_sec)}\n${spk}: ${s.text}`;
      }).join("\n\n");
      break;
    }
  }

  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.${format}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
