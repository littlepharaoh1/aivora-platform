/**
 * whisperBrowser.ts — Groq Whisper API Implementation
 * Aivora Platform — Production ASR
 *
 * Uses Groq's Whisper large-v3 — fastest + most accurate
 * Free tier: 28,800 audio seconds/day
 * Arabic RTL: full support
 */

import type { ASRModelId, ASRLanguage } from "./asrTypes";

export interface WhisperWord {
  word:       string;
  start:      number;
  end:        number;
  confidence: number;
}

export interface WhisperSegment {
  text:       string;
  start:      number;
  end:        number;
  confidence: number;
  words:      WhisperWord[];
}

export interface WhisperResult {
  full_text:   string;
  segments:    WhisperSegment[];
  language:    string;
  duration_ms: number;
}

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY ?? "";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

const LANG_MAP: Record<ASRLanguage, string | null> = {
  auto: null,
  ar:   "ar",
  en:   "en",
};

export async function runWhisperBrowser(
  audioBuffer: AudioBuffer,
  _modelId: ASRModelId,
  language: ASRLanguage,
  onProgress?: (pct: number) => void,
): Promise<WhisperResult> {
  const startMs = Date.now();

  if (!GROQ_API_KEY) {
    console.error("[Groq] VITE_GROQ_API_KEY not set");
    return {
      full_text:   "[Groq API key not configured]",
      segments:    [],
      language,
      duration_ms: Date.now() - startMs,
    };
  }

  onProgress?.(0.1);

  // Convert AudioBuffer → WAV blob
  const wavBlob = audioBufferToWav(audioBuffer);
  onProgress?.(0.2);

  // Build multipart form
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("timestamp_granularities[]", "word");
  form.append("temperature", "0");

  const lang = LANG_MAP[language];
  if (lang) form.append("language", lang);

  // Prompt improves accuracy for Arabic and other RTL languages
  if (language === "ar" || language === "auto") {
    form.append("prompt", "هذا تسجيل صوتي باللغة العربية. يرجى النسخ الحرفي الدقيق.");
  }

  onProgress?.(0.3);

  // Call Groq API
  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  });

  onProgress?.(0.9);

  if (!res.ok) {
    const err = await res.text();
    console.error("[Groq] API error:", err);
    return {
      full_text:   `[Groq API error: ${res.status}]`,
      segments:    [],
      language,
      duration_ms: Date.now() - startMs,
    };
  }

  const data = await res.json();
  console.log("[Groq] response:", JSON.stringify(data).slice(0, 300));

  onProgress?.(1.0);

  const segments: WhisperSegment[] = (data.segments ?? []).map((s: any) => ({
    text:       s.text?.trim() ?? "",
    start:      s.start ?? 0,
    end:        s.end ?? 0,
    confidence: s.avg_logprob ? Math.exp(s.avg_logprob) : 0.9,
  }));

  return {
    full_text:   (data.text ?? "").trim(),
    segments,
    language:    data.language ?? language,
    duration_ms: Date.now() - startMs,
  };
}

// ── AudioBuffer → WAV ─────────────────────────────────────────────────────────
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh   = buffer.numberOfChannels;
  const sr      = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const len     = samples.length;
  const wavBuf  = new ArrayBuffer(44 + len * 2);
  const view    = new DataView(wavBuf);

  function writeStr(offset: number, str: string) {
    for (let i = 0; i < str.length; i++)
      view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0,  "RIFF");
  view.setUint32(4,  36 + len * 2, true);
  writeStr(8,  "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,     true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr,    true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16,    true);
  writeStr(36, "data");
  view.setUint32(40, len * 2, true);

  let offset = 44;
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([wavBuf], { type: "audio/wav" });
}
