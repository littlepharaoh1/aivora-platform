/**
 * silenceRestorer.ts — Natural Silence Restoration
 * Aivora Audio QC Engine — Batch 6
 */

import { AudioProblem, makeProblem } from "./qcTypes";

// ── FRAME ENERGY ──────────────────────────────────────────────────────────────

function frameEnergies(
  samples: Float32Array,
  sampleRate: number,
  frameSizeMs = 10
): Float64Array {
  const frameSize = Math.round((frameSizeMs / 1000) * sampleRate);
  const count = Math.floor(samples.length / frameSize);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let e = 0;
    for (let j = i * frameSize; j < (i + 1) * frameSize; j++)
      e += samples[j] * samples[j];
    out[i] = e / frameSize;
  }
  return out;
}

function noiseFloorFromEnergies(energies: Float64Array): number {
  const sorted = Float64Array.from(energies).sort();
  const cutoff = Math.max(1, Math.floor(sorted.length * 0.10));
  let sum = 0;
  for (let i = 0; i < cutoff; i++) sum += sorted[i];
  return sum / cutoff;
}

// ── DIGITAL SILENCE DETECTION ─────────────────────────────────────────────────

interface SilenceSegment {
  startSample: number;
  endSample:   number;
  type:        "leading" | "trailing" | "internal";
}

function detectDigitalSilenceSegments(
  samples: Float32Array,
  sampleRate: number,
  noiseFloor: number
): SilenceSegment[] {
  const FRAME_MS  = 10;
  const frameSize = Math.round((FRAME_MS / 1000) * sampleRate);
  const threshold = noiseFloor * 0.5; // well below noise floor = digital silence
  const segments: SilenceSegment[] = [];

  let inSilence = false;
  let silStart  = 0;
  let firstSpeechFrame = -1;
  let lastSpeechFrame  = -1;

  const energies = frameEnergies(samples, sampleRate, FRAME_MS);

  for (let i = 0; i < energies.length; i++) {
    if (energies[i] > noiseFloor * 1.5) {
      if (firstSpeechFrame === -1) firstSpeechFrame = i;
      lastSpeechFrame = i;
    }
  }

  for (let i = 0; i < energies.length; i++) {
    const isDigitalSilence = energies[i] <= threshold;
    if (isDigitalSilence && !inSilence) {
      inSilence = true;
      silStart  = i;
    } else if (!isDigitalSilence && inSilence) {
      inSilence = false;
      const startSample = silStart * frameSize;
      const endSample   = i * frameSize;
      const type =
        firstSpeechFrame === -1 ? "leading" :
        silStart < firstSpeechFrame ? "leading" :
        i > lastSpeechFrame ? "trailing" : "internal";
      segments.push({ startSample, endSample, type });
    }
  }
  if (inSilence) {
    segments.push({
      startSample: silStart * frameSize,
      endSample:   samples.length,
      type: lastSpeechFrame !== -1 && silStart > lastSpeechFrame ? "trailing" : "internal",
    });
  }

  return segments;
}

// ── NOISE SAMPLE EXTRACTION ───────────────────────────────────────────────────

function extractNoiseSamples(
  samples: Float32Array,
  sampleRate: number,
  noiseFloor: number,
  maxSamples = 4096
): Float32Array {
  const frameSize = Math.round(0.02 * sampleRate);
  const candidates: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let e = 0;
    for (let j = i; j < i + frameSize; j++) e += samples[j] * samples[j];
    e /= frameSize;
    // Frames near noise floor = natural ambient noise
    if (e > noiseFloor * 0.3 && e < noiseFloor * 3.0) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    // Fallback: synthesize low-level white noise
    const noise = new Float32Array(maxSamples);
    const amp   = Math.sqrt(noiseFloor) * 0.5;
    for (let i = 0; i < maxSamples; i++)
      noise[i] = (Math.random() * 2 - 1) * amp;
    return noise;
  }

  // Collect up to maxSamples from candidate frames
  const out: number[] = [];
  for (const start of candidates) {
    for (let j = start; j < start + frameSize && out.length < maxSamples; j++)
      out.push(samples[j]);
    if (out.length >= maxSamples) break;
  }
  return new Float32Array(out);
}

// ── RESTORATION ───────────────────────────────────────────────────────────────

function restoreSegment(
  output: Float32Array,
  startSample: number,
  endSample:   number,
  noiseSamples: Float32Array,
  fadeSamples  = 256
): void {
  const len = endSample - startSample;
  for (let i = 0; i < len; i++) {
    const noiseIdx  = i % noiseSamples.length;
    let   sample    = noiseSamples[noiseIdx];

    // Fade in/out to avoid clicks
    if (i < fadeSamples)
      sample *= i / fadeSamples;
    else if (i > len - fadeSamples)
      sample *= (len - i) / fadeSamples;

    output[startSample + i] = sample;
  }
}

// ── PUBLIC INTERFACE ──────────────────────────────────────────────────────────

export interface RestorationResult {
  restoredBuffer:   AudioBuffer | null;
  segmentsRestored: number;
  totalRestoredMs:  number;
  changed:          boolean;
  problems:         AudioProblem[];
}

export function restoreNaturalSilence(
  buffer: AudioBuffer
): RestorationResult {
  const sampleRate = buffer.sampleRate;
  const problems: AudioProblem[] = [];

  // Work on channel 0 for analysis, restore all channels
  const ch0      = buffer.getChannelData(0);
  const noiseFloor = noiseFloorFromEnergies(frameEnergies(ch0, sampleRate));
  const segments   = detectDigitalSilenceSegments(ch0, sampleRate, noiseFloor);

  if (segments.length === 0) {
    return {
      restoredBuffer:   null,
      segmentsRestored: 0,
      totalRestoredMs:  0,
      changed:          false,
      problems,
    };
  }

  // Create offline copy
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    sampleRate
  );
  const outBuffer = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    sampleRate
  );

  // Copy all channels
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = outBuffer.getChannelData(ch);
    dest.set(src);
  }

  // Extract noise profile from channel 0
  const noiseSamples = extractNoiseSamples(ch0, sampleRate, noiseFloor);

  let totalRestoredSamples = 0;

  for (const seg of segments) {
    const durationSec = (seg.endSample - seg.startSample) / sampleRate;

    // Only restore segments > 50ms
    if (durationSec < 0.05) continue;

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const dest = outBuffer.getChannelData(ch);
      restoreSegment(dest, seg.startSample, seg.endSample, noiseSamples);
    }
    totalRestoredSamples += seg.endSample - seg.startSample;
  }

  const totalRestoredMs = (totalRestoredSamples / sampleRate) * 1000;

  if (segments.length > 0) {
    problems.push(makeProblem("DIGITAL_SILENCE", "medium",
      `${segments.length} digital silence segment(s) detected and restored with natural noise`,
      { confidence: 0.85, suggestedAction: "Verify restored segments before delivery" }));
  }

  const leadingCount  = segments.filter(s => s.type === "leading").length;
  const trailingCount = segments.filter(s => s.type === "trailing").length;
  const internalCount = segments.filter(s => s.type === "internal").length;

  if (internalCount > 3) {
    problems.push(makeProblem("SILENCE_GAP", "warning",
      `${internalCount} internal digital silence gaps found — possible edited or spliced recording`,
      { confidence: 0.78 }));
  }

  if (leadingCount > 0 || trailingCount > 0) {
    problems.push(makeProblem("LEADING_SILENCE", "low",
      `Leading/trailing digital silence replaced with natural room tone`,
      { confidence: 0.90 }));
  }

  return {
    restoredBuffer:   outBuffer,
    segmentsRestored: segments.length,
    totalRestoredMs,
    changed:          totalRestoredMs > 0,
    problems,
  };
}
