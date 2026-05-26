/**
 * whisperBrowser.ts — Web Speech API Implementation
 * Browser-native speech recognition — zero dependencies
 * Chrome/Edge: full support | Firefox: limited
 */

import type { ASRModelId, ASRLanguage } from "./asrTypes";

export interface WhisperSegment {
  text:       string;
  start:      number;
  end:        number;
  confidence: number;
}

export interface WhisperResult {
  full_text:   string;
  segments:    WhisperSegment[];
  language:    string;
  duration_ms: number;
}

const LANG_MAP: Record<ASRLanguage, string> = {
  auto: "ar-SA",
  ar:   "ar-SA",
  en:   "en-US",
};

export async function runWhisperBrowser(
  audioBuffer: AudioBuffer,
  _modelId: ASRModelId,
  language: ASRLanguage,
  onProgress?: (pct: number) => void,
): Promise<WhisperResult> {
  const startMs = Date.now();
  onProgress?.(0.1);

  // Check Web Speech API support
  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    // Fallback: return placeholder indicating browser limitation
    return {
      full_text:   "[Speech recognition not supported in this browser. Please use Chrome or Edge.]",
      segments:    [],
      language:    language,
      duration_ms: Date.now() - startMs,
    };
  }

  // Convert AudioBuffer to WAV blob for playback
  const wavBlob = audioBufferToWav(audioBuffer);
  const audioUrl = URL.createObjectURL(wavBlob);
  const audio = new Audio(audioUrl);

  onProgress?.(0.2);

  return new Promise((resolve) => {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = LANG_MAP[language] ?? "ar-SA";
    recognition.maxAlternatives = 1;

    const segments: WhisperSegment[] = [];
    let fullText = "";
    let startTime = 0;

    recognition.onstart = () => {
      startTime = Date.now();
      onProgress?.(0.3);
    };

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          const conf = result[0].confidence ?? 0.85;
          const elapsed = (Date.now() - startTime) / 1000;
          segments.push({ text, start: elapsed, end: elapsed + 1, confidence: conf });
          fullText += (fullText ? " " : "") + text;
        }
      }
      onProgress?.(0.6 + segments.length * 0.05);
    };

    recognition.onerror = (event: any) => {
      console.error("[SpeechAPI] error:", event.error);
      resolve({
        full_text:   fullText || `[Recognition error: ${event.error}]`,
        segments,
        language,
        duration_ms: Date.now() - startMs,
      });
    };

    recognition.onend = () => {
      onProgress?.(1.0);
      URL.revokeObjectURL(audioUrl);
      resolve({
        full_text:   fullText || "[No speech detected]",
        segments,
        language,
        duration_ms: Date.now() - startMs,
      });
    };

    // Play audio and recognize simultaneously
    audio.play().catch(() => {
      // If autoplay blocked, try recognition directly on mic
      recognition.start();
    });
    recognition.start();

    // Stop after audio duration + buffer
    const durationMs = (audioBuffer.duration * 1000) + 2000;
    setTimeout(() => {
      try { recognition.stop(); } catch(_) {}
    }, durationMs);
  });
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
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
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
