export type AudioProblemSeverity = "low" | "medium" | "high" | "critical";

export interface AudioProblem {
  type: string;
  severity: AudioProblemSeverity;
  confidence: number;
  startSample: number;
  endSample: number;
  durationMs: number;
  message: string;
  recommendation: string;
}

export interface AudioQcProfile {
  maxAllowedSilenceMs: number;
}

export interface AudioMetrics {
  noiseFloorDb?: number;
}

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

function variance(buf: Float32Array): number {
  let mean = 0;
  for (let i = 0; i < buf.length; i++) mean += buf[i];
  mean /= Math.max(1, buf.length);

  let v = 0;
  for (let i = 0; i < buf.length; i++) {
    const d = buf[i] - mean;
    v += d * d;
  }
  return v / Math.max(1, buf.length);
}

function nearZeroRatio(buf: Float32Array, threshold = 1e-7): number {
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    if (Math.abs(buf[i]) < threshold) count++;
  }
  return count / Math.max(1, buf.length);
}

function estimateNoiseFloor(samples: Float32Array, sampleRate: number): number {
  const frame = Math.max(1, Math.floor(sampleRate * 0.05));
  const values: number[] = [];

  for (let i = 0; i < samples.length - frame; i += frame) {
    values.push(rms(samples.subarray(i, i + frame)));
  }

  if (!values.length) return 1e-7;

  values.sort((a, b) => a - b);
  const bottom = values.slice(0, Math.max(1, Math.floor(values.length * 0.2)));
  return bottom.reduce((a, b) => a + b, 0) / bottom.length;
}

export function detectAdaptiveDigitalSilence(
  channelData: Float32Array,
  sampleRate: number,
  profile: AudioQcProfile = { maxAllowedSilenceMs: 100 },
  _metrics: AudioMetrics = {}
): AudioProblem[] {
  const problems: AudioProblem[] = [];
  const noiseFloor = estimateNoiseFloor(channelData, sampleRate);

  const windows = [
    Math.floor(sampleRate * 0.01),
    Math.floor(sampleRate * 0.03),
    Math.floor(sampleRate * 0.08),
  ].filter(Boolean);

  for (const winSize of windows) {
    const hop = Math.max(1, Math.floor(winSize / 4));

    for (let start = 0; start < channelData.length - winSize; start += hop) {
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

      if (durationMs < profile.maxAllowedSilenceMs) continue;

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
        message: "Adaptive digital silence detected.",
        recommendation:
          "Inspect waveform for hard mute, blank gap, or rendering/editing corruption.",
      });
    }
  }

  return problems;
}
