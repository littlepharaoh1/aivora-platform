/**
 * useASRState.ts — ASR Workstation State
 * Aivora Platform — Phase 11
 *
 * Manages ASR inference lifecycle.
 * Inference submitted via Phase 5.1 scheduler (not main thread).
 * Same audio → same transcript (deterministic).
 */

import { useState, useCallback, useRef } from "react";
import { scheduler }    from "../../runtime/runtimeScheduler";
import { emitEvent }    from "../../lib/telemetry/emitter";
import { mixToMono, resampleTo16k } from "../../lib/transcription/audioChunker";
import { buildRTLTranscript } from "../../lib/transcription/multilingualRuntime";
import { generateSpeechQAReport } from "../../lib/transcription/speechQA";
import { alignTranscript } from "../../lib/transcription/tokenAlignment";
import { buildSpeechDatasetRecord } from "../../lib/transcription/speechDatasetIntel";
import type { ASRTranscript, ASRModelId, ASRLanguage } from "../../lib/transcription/asrTypes";
import type { AlignmentResult } from "../../lib/transcription/tokenAlignment";
import type { RTLTranscript } from "../../lib/transcription/multilingualRuntime";
import type { SpeechQAReport } from "../../lib/transcription/speechQA";
import { DECODER_STRATEGY, TEMPERATURE, INFERENCE_PROTOCOL_VERSION, SAMPLE_RATE }
  from "../../lib/transcription/asrTypes";
import { DECODER_GOVERNANCE } from "../../lib/transcription/greedyDecoder";

export type ASRStatus =
  | "idle"
  | "loading"
  | "chunking"
  | "inferring"
  | "aligning"
  | "complete"
  | "error";

export interface ASRWorkstationState {
  status:         ASRStatus;
  progress:       number;       // 0→1
  error:          string | null;
  transcript:     ASRTranscript | null;
  alignment:      AlignmentResult | null;
  rtlTranscript:  RTLTranscript | null;
  qaReport:       SpeechQAReport | null;
  model_id:       ASRModelId;
  language:       ASRLanguage;
  correlation_id: string | null;
}

export function useASRState() {
  const [state, setState] = useState<ASRWorkstationState>({
    status:        "idle",
    progress:      0,
    error:         null,
    transcript:    null,
    alignment:     null,
    rtlTranscript: null,
    qaReport:      null,
    model_id:      "whisper_base",
    language:      "auto",
    correlation_id:null,
  });

  const abortRef = useRef(false);

  const setModel    = useCallback((m: ASRModelId)    =>
    setState(s => ({ ...s, model_id:m })), []);
  const setLanguage = useCallback((l: ASRLanguage)   =>
    setState(s => ({ ...s, language:l })), []);

  const transcribe = useCallback(async (audioBuffer: AudioBuffer) => {
    abortRef.current = false;
    const corrId = crypto.randomUUID();

    setState(s => ({ ...s, status:"loading", progress:0.05,
      error:null, transcript:null, alignment:null,
      rtlTranscript:null, qaReport:null, correlation_id:corrId }));

    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:corrId, severity:"info",
      payload:{ action:"ASR_WORKSTATION_STARTED", model_id:state.model_id,
        language:state.language, duration_sec:audioBuffer.duration },
    });

    try {
      // Submit to scheduler — not main thread
      let transcript: ASRTranscript | null = null;

      setState(s => ({ ...s, status:"chunking", progress:0.15 }));

      // Mix to mono + resample (CPU — off render loop)
      const mono    = mixToMono(audioBuffer);
      const audio16k= resampleTo16k(mono, audioBuffer.sampleRate);

      setState(s => ({ ...s, status:"inferring", progress:0.3 }));

      // Run ASR via scheduler
      const transcriptRef: { current: ASRTranscript | null } = { current: null };
      await new Promise<void>((resolve, reject) => {
        const taskId = scheduler.submit({
          task_type:      "BATCH",
          priority:       "HIGH",
          correlation_id: corrId,
          execute: async () => {
            try {
              // ── Groq Whisper large-v3 via whisperBrowser ──────────────────
              const { runWhisperBrowser } = await import(
                "../../lib/transcription/whisperBrowser"
              );
              const { WHISPER_TOKENIZER_CONFIG } = await import(
                "../../lib/transcription/tokenizerGovernance"
              );

              const result = await runWhisperBrowser(
                audioBuffer,
                state.model_id,
                state.language,
                (pct) => setState(s => ({ ...s, progress: 0.2 + pct * 0.7 })),
              );

              const now = new Date().toISOString();
              const isRTL = state.language === "ar" ||
                result.language === "ar" ||
                result.language === "arabic";

              transcriptRef.current = {
                id:                 corrId,
                audio_file_id:      null,
                correlation_id:     corrId,
                model_id:           state.model_id,
                model_checksum:     null,
                tokenizer_version:  WHISPER_TOKENIZER_CONFIG.version,
                quantization:       "fp32",
                backend:            "cpu_worker",
                decoder_strategy:   DECODER_STRATEGY,
                inference_protocol: INFERENCE_PROTOCOL_VERSION,
                language_detected:  result.language as any,
                segments:           result.segments.map((s, i) => ({
                  id:          crypto.randomUUID(),
                  segment_idx: i,
                  text:        s.text,
                  tokens:      [],
                  start_sec:   s.start,
                  end_sec:     s.end,
                  duration_sec:s.end - s.start,
                  language:    result.language as any,
                  is_rtl:      isRTL,
                  confidence:  s.confidence,
                  checksum:    "",
                } as any)),
                full_text:          result.full_text,
                duration_sec:       audioBuffer.duration,
                chunk_count:        result.segments.length || 1,
                generated_at:       now,
                input_checksum:     null,
                output_checksum:    null,
              } as ASRTranscript;

              resolve();
            } catch(e) { reject(e); }
          },
          onTimeout: () => reject(new Error("ASR inference timeout")),
        });
        if(!taskId) reject(new Error("Scheduler rejected: queue full or pressure too high"));
      });

      transcript = transcriptRef.current;
      if(!transcript || abortRef.current) return;
      setState(s => ({ ...s, progress:0.8, status:"aligning" }));

      // Alignment
      const alignment = alignTranscript(
        transcript.segments,
        audio16k.length,
        SAMPLE_RATE,
      );

      // RTL + multilingual
      const rtlTranscript = buildRTLTranscript(transcript.segments);

      // QA
      const qaReport = generateSpeechQAReport(transcript, alignment);

      setState(s => ({
        ...s,
        status:        "complete",
        progress:      1.0,
        transcript,
        alignment,
        rtlTranscript,
        qaReport,
      }));

      emitEvent({
        event_type:"ADMIN_ACTION", event_source:"qc_workstation",
        correlation_id:corrId, severity:"info",
        payload:{ action:"ASR_WORKSTATION_COMPLETE",
          chunk_count:transcript.chunk_count,
          duration_sec:audioBuffer.duration,
          qa_passed:qaReport.passed,
          rtl_ratio:rtlTranscript.rtl_ratio,
        },
      });

    } catch(e) {
      const msg = e instanceof Error ? e.message : "ASR failed";
      setState(s => ({ ...s, status:"error", error:msg, progress:0 }));
    }
  }, [state.model_id, state.language]);

  const reset = useCallback(() => {
    abortRef.current = true;
    setState(s => ({ ...s, status:"idle", progress:0, error:null,
      transcript:null, alignment:null, rtlTranscript:null, qaReport:null,
      correlation_id:null }));
  }, []);

  return { state, transcribe, reset, setModel, setLanguage,
    GOVERNANCE: {
      decoder:     DECODER_STRATEGY,
      temperature: TEMPERATURE,
      protocol:    INFERENCE_PROTOCOL_VERSION,
    }
  };
}
