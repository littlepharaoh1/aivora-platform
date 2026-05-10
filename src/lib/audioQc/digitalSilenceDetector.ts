import type { AudioMetrics, AudioProblem, AudioQcProfile } from "./qcTypes";

function rms(data: Float32Array): number {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function variance(data: Float32Array): number {
  if (!data.length) return 0;
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;

  let v = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i] - mean;
    v += d * d;
  }
  return v / data.length;
}

function nearZeroRatio(data: Float32Array, threshold = 1e-7): number {
  if (!data.length) return 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) <= threshold) count++;
  }
  return count / data.length;
}

function estimateNoiseFloor(data: Float32Array, sampleRate: number): number {
  const win = Math.max(1, Math.floor(sampleRate * 0.05));
  const values: number[] = [];

  for (let i = 0; i + win <= data.length; i += win) {
    values.push(rms(data.subarray(i, i + win)));
  }

  if (!values.length) return 1e-6;
  values.sort((a, b) => a - b);

  const idx = Math.floor(values.length * 0.2);
  return Math.max(values[idx] || 1e-6, 1e-8);
}

export function detectDigitalSilence(
  channelData: Float32Array,
  sampleRate: number,
  profile: AudioQcProfile = {},
  _metrics: AudioMetrics = {}
): AudioProblem[] {
  const problems: AudioProblem[] = [];

  const maxAllowedSilenceMs = profile.maxAllowedSilenceMs ?? 100;
  const noiseFloor = estimateNoiseFloor(channelData, sampleRate);

  const windows = [
    Math.floor(sampleRate * 0.01),
    Math.floor(sampleRate * 0.03),
    Math.floor(sampleRate * 0.08),
  ].filter(Boolean);

  for (const winSize of windows) {
    const hop = Math.max(1, Math.floor(winSize / 4));

    for (let start = 0; start + winSize <= channelData.length; start += hop) {
      const end = start + winSize;
      const slice = channelData.subarray(start, end);

      const sliceRms = rms(slice);
      const sliceVariance = variance(slice);
      const nzRatio = nearZeroRatio(slice);

      const adaptiveThreshold = Math.max(noiseFloor * 0.25, 1e-8);

      const silenceLike =
        sliceRms < adaptiveThreshold &&
        sliceVariance < adaptiveThreshold &&
        nzRatio > 0.985;

      if (!silenceLike) continue;

      const durationMs = ((end - start) / sampleRate) * 1000;
      if (durationMs < maxAllowedSilenceMs) continue;

      const confidence = Math.min(
        1,
        nzRatio * 0.5 +
          Math.max(0, 1 - sliceRms / adaptiveThreshold) * 0.3 +
          Math.max(0, 1 - sliceVariance / adaptiveThreshold) * 0.2
      );

      problems.push({
        type: "DIGITAL_SILENCE",
        severity: durationMs > 800 ? "critical" : "high",
        confidence,
        startSample: start,
        endSample: end,
        durationMs,
        timeMs: (start / sampleRate) * 1000,
        delta: nzRatio,
        message: "Adaptive digital silence / flat-line silence detected.",
        recommendation:
          "Inspect waveform and spectrogram for hard mute, blank gap, or editing corruption. Re-record is recommended if this is inside the required spoken segment.",
      });
    }
  }

  return problems;
}
