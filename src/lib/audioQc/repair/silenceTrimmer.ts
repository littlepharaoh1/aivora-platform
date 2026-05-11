/**
 * silenceTrimmer.ts — Safe leading/trailing silence trim + internal gap shortening
 * Aivora Honest Audio Repair Suite — Batch 9
 */

export interface SilenceTrimmerOptions {
  trimLeading:           boolean;
  trimTrailing:          boolean;
  shortenInternalGaps:   boolean;
  maxInternalSilenceSec: number;   // e.g. 0.5 — gaps longer than this get shortened
  keepPaddingMs:         number;   // padding to keep around speech (default 50ms)
}

export interface TrimRegion {
  type:        "leading" | "trailing" | "internal_gap";
  startSample: number;
  endSample:   number;
  durationMs:  number;
}

export interface SilenceTrimmerResult {
  buffer:        AudioBuffer;
  changed:       boolean;
  trimmedRegions: TrimRegion[];
  warnings:      string[];
}

function findZeroCrossing(
  samples: Float32Array,
  startIdx: number,
  direction: "forward" | "backward",
  maxSearch = 512
): number {
  if (direction === "forward") {
    for (let i = startIdx; i < Math.min(startIdx + maxSearch, samples.length - 1); i++) {
      if (samples[i] * samples[i + 1] <= 0) return i;
    }
  } else {
    for (let i = startIdx; i > Math.max(startIdx - maxSearch, 1); i--) {
      if (samples[i] * samples[i - 1] <= 0) return i;
    }
  }
  return startIdx;
}

function computeFrameEnergy(samples: Float32Array, start: number, size: number): number {
  let e = 0;
  for (let i = start; i < Math.min(start + size, samples.length); i++) e += samples[i] * samples[i];
  return e / size;
}

function findSpeechBoundaries(
  samples: Float32Array,
  sampleRate: number,
  paddingSamples: number
): { start: number; end: number } {
  const frameSize    = Math.round(0.01 * sampleRate); // 10ms
  const energies: number[] = [];

  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    energies.push(computeFrameEnergy(samples, i, frameSize));
  }

  const sorted   = [...energies].sort((a, b) => a - b);
  const noiseEst = sorted[Math.floor(sorted.length * 0.10)];
  const threshold = noiseEst * 4;

  let firstSpeech = -1;
  let lastSpeech  = -1;

  for (let i = 0; i < energies.length; i++) {
    if (energies[i] > threshold) {
      if (firstSpeech === -1) firstSpeech = i;
      lastSpeech = i;
    }
  }

  if (firstSpeech === -1) return { start: 0, end: samples.length };

  const startSample = Math.max(0, firstSpeech * frameSize - paddingSamples);
  const endSample   = Math.min(samples.length, (lastSpeech + 1) * frameSize + paddingSamples);

  return {
    start: findZeroCrossing(samples, startSample, "forward"),
    end:   findZeroCrossing(samples, endSample,   "backward"),
  };
}

function copyBufferSlice(
  buffer: AudioBuffer,
  startSample: number,
  endSample:   number
): AudioBuffer {
  const length = endSample - startSample;
  const ctx    = new OfflineAudioContext(buffer.numberOfChannels, length, buffer.sampleRate);
  const out    = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = out.getChannelData(ch);
    dest.set(src.subarray(startSample, endSample));
  }
  return out;
}

function shortenGaps(
  buffer: AudioBuffer,
  maxGapSamples: number,
  paddingSamples: number
): { buffer: AudioBuffer; regions: TrimRegion[] } {
  const sr      = buffer.sampleRate;
  const ch0     = buffer.getChannelData(0);
  const frameSize = Math.round(0.01 * sr);
  const regions: TrimRegion[] = [];

  // Detect internal silence segments
  const energies: number[] = [];
  for (let i = 0; i + frameSize <= ch0.length; i += frameSize)
    energies.push(computeFrameEnergy(ch0, i, frameSize));

  const sorted    = [...energies].sort((a, b) => a - b);
  const noiseEst  = sorted[Math.floor(sorted.length * 0.10)];
  const threshold = noiseEst * 4;

  // Find silence spans
  const silenceSpans: { start: number; end: number }[] = [];
  let inSilence = false, silStart = 0;
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] <= threshold && !inSilence) { inSilence = true; silStart = i; }
    else if (energies[i] > threshold && inSilence) {
      inSilence = false;
      silenceSpans.push({ start: silStart * frameSize, end: i * frameSize });
    }
  }

  // Only shorten internal gaps longer than maxGapSamples
  const toRemove: { start: number; end: number }[] = [];
  for (const span of silenceSpans) {
    const dur = span.end - span.start;
    if (dur > maxGapSamples + paddingSamples * 2) {
      // Keep paddingSamples on each side, remove the rest
      toRemove.push({
        start: span.start + paddingSamples,
        end:   span.end   - paddingSamples,
      });
    }
  }

  if (toRemove.length === 0) return { buffer, regions };

  // Build new buffer by concatenating kept segments
  let keepSegments: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const rem of toRemove) {
    if (cursor < rem.start) keepSegments.push({ start: cursor, end: rem.start });
    regions.push({
      type: "internal_gap",
      startSample: rem.start,
      endSample:   rem.end,
      durationMs:  ((rem.end - rem.start) / sr) * 1000,
    });
    cursor = rem.end;
  }
  if (cursor < ch0.length) keepSegments.push({ start: cursor, end: ch0.length });

  const totalLength = keepSegments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, totalLength, sr);
  const out = ctx.createBuffer(buffer.numberOfChannels, totalLength, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = out.getChannelData(ch);
    let offset = 0;
    for (const seg of keepSegments) {
      dest.set(src.subarray(seg.start, seg.end), offset);
      offset += seg.end - seg.start;
    }
  }

  return { buffer: out, regions };
}

export function trimSilence(
  buffer: AudioBuffer,
  options: SilenceTrimmerOptions
): SilenceTrimmerResult {
  const { trimLeading, trimTrailing, shortenInternalGaps, maxInternalSilenceSec, keepPaddingMs } = options;
  const sr             = buffer.sampleRate;
  const paddingSamples = Math.round((keepPaddingMs / 1000) * sr);
  const warnings:      string[] = [];
  const trimmedRegions: TrimRegion[] = [];
  let   current        = buffer;

  // Step 1: Trim leading / trailing
  if (trimLeading || trimTrailing) {
    const mono       = current.getChannelData(0);
    const boundaries = findSpeechBoundaries(mono, sr, paddingSamples);
    const startSample = trimLeading  ? boundaries.start : 0;
    const endSample   = trimTrailing ? boundaries.end   : mono.length;

    if (startSample > 0) {
      trimmedRegions.push({ type: "leading",  startSample: 0,         endSample: startSample, durationMs: (startSample / sr) * 1000 });
    }
    if (endSample < mono.length) {
      trimmedRegions.push({ type: "trailing", startSample: endSample, endSample: mono.length, durationMs: ((mono.length - endSample) / sr) * 1000 });
    }

    if (endSample - startSample < sr * 0.2) {
      warnings.push("Trim would leave less than 0.2s of audio — skipped");
    } else {
      current = copyBufferSlice(current, startSample, endSample);
    }
  }

  // Step 2: Shorten internal gaps
  if (shortenInternalGaps) {
    const maxGapSamples = Math.round(maxInternalSilenceSec * sr);
    const { buffer: gapBuffer, regions } = shortenGaps(current, maxGapSamples, paddingSamples);
    current = gapBuffer;
    trimmedRegions.push(...regions);
  }

  const changed = trimmedRegions.length > 0;
  return { buffer: current, changed, trimmedRegions, warnings };
}
