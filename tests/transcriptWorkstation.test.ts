/**
 * transcriptWorkstation.test.ts
 * Aivora Platform — Transcript Workstation Pro Tests
 */

import { describe, it, expect } from "vitest";
import {
  fromASRTranscript,
  applyOperation,
  rebuildFullText,
  searchSegments,
  replaceInSegments,
} from "../transcriptWorkstationService";
import type { ASRTranscript } from "../asrTypes";
import type { WorkstationSegment } from "../transcriptWorkstationTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockASR: ASRTranscript = {
  id:                 "test-asr-001",
  audio_file_id:      null,
  correlation_id:     "corr-001",
  model_id:           "whisper_base",
  model_checksum:     null,
  tokenizer_version:  "1.0.0",
  quantization:       "fp32",
  backend:            "cpu_worker",
  decoder_strategy:   "greedy",
  inference_protocol: "8.1.0",
  language_detected:  "ar",
  full_text:          "مرحبا بك في منصة ايفورا",
  duration_sec:       8.0,
  chunk_count:        1,
  generated_at:       "2025-01-01T00:00:00Z",
  input_checksum:     null,
  output_checksum:    null,
  segments: [
    {
      id:          1,
      text:        "مرحبا بك",
      tokens:      [],
      start_sec:   0.0,
      end_sec:     2.0,
      language:    "ar",
      is_rtl:      true,
      chunk_index: 0,
    },
    {
      id:          2,
      text:        "في منصة ايفورا",
      tokens:      [],
      start_sec:   2.1,
      end_sec:     5.5,
      language:    "ar",
      is_rtl:      true,
      chunk_index: 0,
    },
  ] as any,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fromASRTranscript", () => {
  it("converts ASRTranscript to WorkstationTranscript", () => {
    const ws = fromASRTranscript(mockASR);
    expect(ws.segments).toHaveLength(2);
    expect(ws.speakers).toHaveLength(1);
    expect(ws.speakers[0].label).toBe("Speaker 1");
    expect(ws.language_detected).toBe("ar");
    expect(ws.word_count).toBeGreaterThan(0);
  });

  it("assigns default speaker to all segments", () => {
    const ws = fromASRTranscript(mockASR);
    const speakerId = ws.speakers[0].id;
    ws.segments.forEach(seg => {
      expect(seg.speaker_id).toBe(speakerId);
    });
  });

  it("preserves RTL flag", () => {
    const ws = fromASRTranscript(mockASR);
    ws.segments.forEach(seg => {
      expect(seg.is_rtl).toBe(true);
    });
  });

  it("assigns sequential indices", () => {
    const ws = fromASRTranscript(mockASR);
    ws.segments.forEach((seg, i) => {
      expect(seg.index).toBe(i);
    });
  });

  it("is deterministic — same input same output structure", () => {
    const ws1 = fromASRTranscript(mockASR);
    const ws2 = fromASRTranscript(mockASR);
    expect(ws1.segments.length).toBe(ws2.segments.length);
    expect(ws1.full_text).toBe(ws2.full_text);
    expect(ws1.language_detected).toBe(ws2.language_detected);
  });
});

describe("applyOperation — EDIT_SEGMENT", () => {
  it("edits segment text", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const newSegs = applyOperation(ws.segments, {
      type:       "EDIT_SEGMENT",
      segment_id: seg.id,
      old_text:   seg.text,
      new_text:   "مرحبا جميعا",
    });
    expect(newSegs[0].text).toBe("مرحبا جميعا");
    expect(newSegs[0].is_edited).toBe(true);
  });

  it("does not mutate other segments", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const original1 = ws.segments[1].text;
    const newSegs = applyOperation(ws.segments, {
      type:"EDIT_SEGMENT", segment_id:seg.id,
      old_text:seg.text, new_text:"edited",
    });
    expect(newSegs[1].text).toBe(original1);
  });

  it("returns same array length", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const newSegs = applyOperation(ws.segments, {
      type:"EDIT_SEGMENT", segment_id:seg.id,
      old_text:seg.text, new_text:"test",
    });
    expect(newSegs).toHaveLength(ws.segments.length);
  });
});

describe("applyOperation — ASSIGN_SPEAKER", () => {
  it("reassigns speaker on segment", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const newSpkId = "new-speaker-uuid";
    const newSegs = applyOperation(ws.segments, {
      type:           "ASSIGN_SPEAKER",
      segment_id:     seg.id,
      old_speaker_id: seg.speaker_id,
      new_speaker_id: newSpkId,
    });
    expect(newSegs[0].speaker_id).toBe(newSpkId);
    expect(newSegs[1].speaker_id).toBe(seg.speaker_id); // unchanged
  });
});

describe("applyOperation — SET_QA_FLAG", () => {
  it("sets qa flag on segment", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const newSegs = applyOperation(ws.segments, {
      type:"SET_QA_FLAG", target:"segment",
      id:seg.id, old_flag:null, new_flag:"low_confidence",
    });
    expect(newSegs[0].qa_flag).toBe("low_confidence");
  });

  it("clears qa flag", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const withFlag = applyOperation(ws.segments, {
      type:"SET_QA_FLAG", target:"segment",
      id:seg.id, old_flag:null, new_flag:"inaudible",
    });
    const cleared = applyOperation(withFlag, {
      type:"SET_QA_FLAG", target:"segment",
      id:seg.id, old_flag:"inaudible", new_flag:null,
    });
    expect(cleared[0].qa_flag).toBeNull();
  });
});

describe("applyOperation — MERGE_SEGMENTS", () => {
  it("merges two segments into one", () => {
    const ws = fromASRTranscript(mockASR);
    const segA = ws.segments[0];
    const segB = ws.segments[1];
    const newSegs = applyOperation(ws.segments, {
      type:"MERGE_SEGMENTS",
      segment_id_a: segA.id,
      segment_id_b: segB.id,
    });
    expect(newSegs).toHaveLength(1);
    expect(newSegs[0].text).toContain(segA.text);
    expect(newSegs[0].text).toContain(segB.text);
    expect(newSegs[0].end_sec).toBe(segB.end_sec);
  });

  it("reindexes after merge", () => {
    const ws = fromASRTranscript(mockASR);
    const segA = ws.segments[0];
    const segB = ws.segments[1];
    const newSegs = applyOperation(ws.segments, {
      type:"MERGE_SEGMENTS",
      segment_id_a:segA.id, segment_id_b:segB.id,
    });
    newSegs.forEach((s,i) => expect(s.index).toBe(i));
  });
});

describe("applyOperation — DELETE_SEGMENT", () => {
  it("removes segment", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const newSegs = applyOperation(ws.segments, {
      type:"DELETE_SEGMENT", segment_id:seg.id, snapshot:seg,
    });
    expect(newSegs).toHaveLength(ws.segments.length - 1);
    expect(newSegs.find(s => s.id === seg.id)).toBeUndefined();
  });

  it("reindexes after delete", () => {
    const ws = fromASRTranscript(mockASR);
    const seg = ws.segments[0];
    const newSegs = applyOperation(ws.segments, {
      type:"DELETE_SEGMENT", segment_id:seg.id, snapshot:seg,
    });
    newSegs.forEach((s,i) => expect(s.index).toBe(i));
  });
});

describe("applyOperation — ADD_SEGMENT", () => {
  it("adds a segment", () => {
    const ws = fromASRTranscript(mockASR);
    const newSeg: WorkstationSegment = {
      id:"new-seg", index:0, speaker_id:ws.speakers[0].id,
      words:[], text:"جملة جديدة",
      start_sec:6.0, end_sec:7.0, language:"ar", is_rtl:true,
      is_edited:false, qa_flag:null, confidence:0.9,
      created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
    };
    const newSegs = applyOperation(ws.segments, { type:"ADD_SEGMENT", segment:newSeg });
    expect(newSegs).toHaveLength(ws.segments.length + 1);
    expect(newSegs.find(s=>s.id==="new-seg")).toBeDefined();
  });
});

describe("rebuildFullText", () => {
  it("joins segment texts", () => {
    const ws = fromASRTranscript(mockASR);
    const text = rebuildFullText(ws.segments);
    expect(text).toContain("مرحبا بك");
    expect(text).toContain("في منصة ايفورا");
  });

  it("trims whitespace", () => {
    const ws = fromASRTranscript(mockASR);
    const text = rebuildFullText(ws.segments);
    expect(text).toBe(text.trim());
  });

  it("handles empty segments", () => {
    expect(rebuildFullText([])).toBe("");
  });
});

describe("searchSegments", () => {
  it("finds matches", () => {
    const ws = fromASRTranscript(mockASR);
    const results = searchSegments(ws.segments, "مرحبا");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for no match", () => {
    const ws = fromASRTranscript(mockASR);
    const results = searchSegments(ws.segments, "xyz_not_found_xyz");
    expect(results).toHaveLength(0);
  });

  it("returns empty for empty query", () => {
    const ws = fromASRTranscript(mockASR);
    expect(searchSegments(ws.segments, "")).toHaveLength(0);
    expect(searchSegments(ws.segments, "  ")).toHaveLength(0);
  });

  it("is case-insensitive for latin", () => {
    const wsEn: ASRTranscript = {
      ...mockASR,
      segments: [{
        ...mockASR.segments[0],
        text:"Hello World", language:"en", is_rtl:false,
      }] as any,
    };
    const ws = fromASRTranscript(wsEn);
    const r1 = searchSegments(ws.segments, "hello");
    const r2 = searchSegments(ws.segments, "HELLO");
    expect(r1.length).toBe(r2.length);
  });
});

describe("replaceInSegments", () => {
  it("replaces text in segments", () => {
    const ws = fromASRTranscript(mockASR);
    const { segments, count } = replaceInSegments(ws.segments, "مرحبا", "أهلا");
    expect(count).toBeGreaterThan(0);
    const hasReplaced = segments.some(s => s.words.some(w => w.text.includes("أهلا")));
    expect(hasReplaced).toBe(true);
  });

  it("returns count=0 for no match", () => {
    const ws = fromASRTranscript(mockASR);
    const { count } = replaceInSegments(ws.segments, "xyz_not_found", "replaced");
    expect(count).toBe(0);
  });

  it("marks replaced words as edited", () => {
    const ws = fromASRTranscript(mockASR);
    // Add words to first segment
    ws.segments[0].words = [
      { text:"مرحبا", id:1, start_frame:0, end_frame:100,
        start_sec:0, end_sec:1, confidence:0.9, is_rtl:true,
        speaker_id:"sp1", is_edited:false, original_text:"مرحبا", qa_flag:null },
    ] as any;
    const { segments } = replaceInSegments(ws.segments, "مرحبا", "أهلا");
    const editedWord = segments[0].words.find(w => w.text === "أهلا");
    expect(editedWord?.is_edited).toBe(true);
    expect(editedWord?.original_text).toBe("مرحبا");
  });
});
