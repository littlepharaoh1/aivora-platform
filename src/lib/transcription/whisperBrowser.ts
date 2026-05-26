/**
 * whisperBrowser.ts — Transformers.js Whisper Wrapper
 * Aivora Platform — Browser-native ASR
 *
 * Loads Whisper from HuggingFace CDN on first use.
 * Cached in browser after first load.
 * Zero server dependency.
 */

import type { ASRModelId, ASRLanguage } from "./asrTypes";

// Model ID mapping
const MODEL_MAP: Record<ASRModelId, string> = {
  whisper_tiny:   "Xenova/whisper-tiny",
  whisper_base:   "Xenova/whisper-base",
  whisper_small:  "Xenova/whisper-small",
  whisper_medium: "Xenova/whisper-medium",
};

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

let pipelineCache: Record<string, any> = {};

export async function runWhisperBrowser(
  audioBuffer: AudioBuffer,
  modelId: ASRModelId,
  language: ASRLanguage,
  onProgress?: (pct: number) => void,
): Promise<WhisperResult> {
  const startMs = Date.now();

  // Direct package import
  const { pipeline, env } = await import("@huggingface/transformers");

  // Use CDN — no local model files needed
  env.allowLocalModels  = false;
  env.useBrowserCache   = true;

  const modelKey = MODEL_MAP[modelId] ?? MODEL_MAP.whisper_base;
  const cacheKey = `${modelKey}_${language}`;

  onProgress?.(0.05);

  // Load or reuse cached pipeline
  console.log("[Whisper] Loading model:", modelKey, "lang:", language);
  if (!pipelineCache[cacheKey]) {
    pipelineCache[cacheKey] = await pipeline(
      "automatic-speech-recognition",
      modelKey,
      {
        progress_callback: (p: any) => {
          if (p.status === "progress") {
            onProgress?.(0.05 + (p.progress / 100) * 0.5);
          }
        },
      }
    );
  }

  const asr = pipelineCache[cacheKey];
  onProgress?.(0.6);

  // Convert AudioBuffer → Float32Array (mono, 16kHz)
  const targetSR  = 16000;
  const srcSR     = audioBuffer.sampleRate;
  const srcData   = audioBuffer.getChannelData(0);

  // Resample if needed
  let samples: Float32Array;
  if (srcSR === targetSR) {
    samples = srcData;
  } else {
    const ratio    = targetSR / srcSR;
    const outLen   = Math.floor(srcData.length * ratio);
    samples        = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      samples[i] = srcData[Math.floor(i / ratio)] ?? 0;
    }
  }

  onProgress?.(0.65);

  // Language config
  const generateKwargs: any = {
    return_timestamps: true,
    language: language === "auto" ? null : language,
  };

  // Run inference
  const output = await asr(samples, { generate_kwargs: generateKwargs });

  onProgress?.(0.95);

  // Debug
  console.log("[Whisper] raw output:", JSON.stringify(output).slice(0, 500));

  // Parse output
  const chunks: any[] = output.chunks ?? [];
  const full_text: string = output.text ?? chunks.map((c: any) => c.text).join(" ");
  console.log("[Whisper] full_text:", full_text);
  console.log("[Whisper] chunks:", chunks.length);

  const segments: WhisperSegment[] = chunks.map((chunk: any) => ({
    text:       chunk.text?.trim() ?? "",
    start:      chunk.timestamp?.[0] ?? 0,
    end:        chunk.timestamp?.[1] ?? 0,
    confidence: 0.9, // Transformers.js doesn't expose per-token confidence
  }));

  onProgress?.(1.0);

  return {
    full_text:   full_text.trim(),
    segments,
    language:    language === "auto" ? "detected" : language,
    duration_ms: Date.now() - startMs,
  };
}
