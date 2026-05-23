/**
 * audioChunker.ts — Deterministic Audio Chunker
 * Aivora Platform — Phase 8.1
 *
 * Rules:
 *   - Chunk size: exactly MAX_CHUNK_DURATION_SEC × SAMPLE_RATE frames
 *   - Overlap: exactly CHUNK_OVERLAP_SEC × SAMPLE_RATE frames
 *   - Chunks ordered sequentially (index 0, 1, 2...)
 *   - Same audio → same chunks forever
 *   - No probabilistic chunking
 *   - Padding: last chunk zero-padded to full size
 */

import {
  MAX_CHUNK_DURATION_SEC,
  CHUNK_OVERLAP_SEC,
  SAMPLE_RATE,
} from "./asrTypes";
import type { AudioChunk } from "./asrTypes";

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_FRAMES   = MAX_CHUNK_DURATION_SEC * SAMPLE_RATE;  // 480000
const OVERLAP_FRAMES = Math.round(CHUNK_OVERLAP_SEC * SAMPLE_RATE); // 8000
const HOP_FRAMES     = CHUNK_FRAMES - OVERLAP_FRAMES;         // 471000

// ── Chunker ───────────────────────────────────────────────────────────────────

export function chunkAudio(audio: Float32Array): AudioChunk[] {
  if(audio.length === 0) return [];

  const chunks: AudioChunk[] = [];
  let   startFrame = 0;
  let   index      = 0;

  while(startFrame < audio.length) {
    const endFrame = Math.min(startFrame + CHUNK_FRAMES, audio.length);
    const isLast   = endFrame >= audio.length;

    // Zero-pad last chunk to full chunk size for deterministic model input
    let data: Float32Array;
    if(endFrame - startFrame < CHUNK_FRAMES) {
      data = new Float32Array(CHUNK_FRAMES);
      data.set(audio.subarray(startFrame, endFrame));
      // Remaining bytes are 0 (Float32Array default)
    } else {
      data = audio.slice(startFrame, endFrame);
    }

    chunks.push({
      index,
      data,
      start_frame: startFrame,
      end_frame:   endFrame,
      start_sec:   startFrame / SAMPLE_RATE,
      end_sec:     endFrame   / SAMPLE_RATE,
      is_last:     isLast,
    });

    if(isLast) break;

    startFrame += HOP_FRAMES;
    index++;
  }

  return chunks;
}

// ── Resample to 16kHz (deterministic linear interpolation) ───────────────────

export function resampleTo16k(
  audio:      Float32Array,
  sourceSR:   number,
): Float32Array {
  if(sourceSR === SAMPLE_RATE) return audio;

  const ratio    = sourceSR / SAMPLE_RATE;
  const outLen   = Math.floor(audio.length / ratio);
  const out      = new Float32Array(outLen);

  for(let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo     = Math.floor(srcIdx);
    const hi     = Math.min(lo + 1, audio.length - 1);
    const frac   = srcIdx - lo;
    // Linear interpolation — deterministic
    out[i] = audio[lo] * (1 - frac) + audio[hi] * frac;
  }

  return out;
}

// ── Mix to mono (deterministic average) ──────────────────────────────────────

export function mixToMono(
  buffer: AudioBuffer,
): Float32Array {
  if(buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const mono  = new Float32Array(buffer.length);
  const nCh   = buffer.numberOfChannels;
  const CHUNK = 65536; // chunked to avoid main thread blocking

  for(let ch = 0; ch < nCh; ch++) {
    const data = buffer.getChannelData(ch);
    for(let i = 0; i < buffer.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, buffer.length);
      for(let j = i; j < end; j++) {
        mono[j] += data[j] / nCh;
      }
    }
  }

  return mono;
}

// ── Chunk metadata ────────────────────────────────────────────────────────────

export function getChunkCount(audioLength: number): number {
  if(audioLength <= CHUNK_FRAMES) return 1;
  return Math.ceil((audioLength - OVERLAP_FRAMES) / HOP_FRAMES);
}

export const CHUNK_CONSTANTS = {
  CHUNK_FRAMES,
  OVERLAP_FRAMES,
  HOP_FRAMES,
  SAMPLE_RATE,
} as const;
