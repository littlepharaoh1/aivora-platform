import type { AudioProblem } from "./qcTypes";

function isFlat(
  values: Float32Array,
  tolerance = 0.00001
): boolean {
  const first = values[0];

  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - first) > tolerance) {
      return false;
    }
  }

  return true;
}

export function detectClipping(
  samples: Float32Array,
  sampleRate: number
): AudioProblem[] {
  const problems: AudioProblem[] = [];

  const threshold = 0.985;

  let start = -1;

  for (let i = 0; i < samples.length; i++) {
    const amp = Math.abs(samples[i]);

    if (amp >= threshold) {
      if (start === -1) {
        start = i;
      }
    } else {
      if (start !== -1) {
        const end = i;

        const slice = samples.subarray(start, end);

        const durationMs =
          ((end - start) / sampleRate) * 1000;

        const peak = Math.max(
          ...Array.from(slice).map((v) => Math.abs(v))
        );

        const flat = slice.length >= 5 && isFlat(slice);

        const confidence = Math.min(
          1,
          peak * 0.6 + (flat ? 0.4 : 0.15)
        );

        const clippingSubtype = flat
          ? "Hard clipping"
          : "Soft clipping";

        problems.push({
          type: "CLIPPING",
          severity:
            durationMs > 20
              ? "critical"
              : durationMs > 8
              ? "high"
              : "medium",
          confidence,
          startSample: start,
          endSample: end,
          timeMs: (start / sampleRate) * 1000,
          durationMs,
          peak,
          message: flat
            ? "Hard clipping detected."
            : "Possible clipping distortion detected.",
          recommendation: `${clippingSubtype} detected. Reduce gain or apply true-peak limiter.`,
        });

        start = -1;
      }
    }
  }

  return problems;
}
