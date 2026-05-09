export interface ClippingProblem {
  type: string;
  severity: "medium" | "high" | "critical";
  confidence: number;
  startSample: number;
  endSample: number;
  durationMs: number;
  peak: number;
  message: string;
}

function isFlat(
  values: Float32Array,
  tolerance = 0.00001
): boolean {
  const first = values[0];

  for (let i = 1; i < values.length; i++) {
    if (
      Math.abs(values[i] - first) >
      tolerance
    ) {
      return false;
    }
  }

  return true;
}

export function detectClipping(
  samples: Float32Array,
  sampleRate: number
): ClippingProblem[] {
  const problems: ClippingProblem[] = [];

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

        const slice =
          samples.subarray(start, end);

        const durationMs =
          ((end - start) /
            sampleRate) *
          1000;

        const peak = Math.max(
          ...Array.from(slice).map((v) =>
            Math.abs(v)
          )
        );

        const flat =
          slice.length >= 5 &&
          isFlat(slice);

        const confidence =
          Math.min(
            1,
            (peak * 0.6) +
              (flat ? 0.4 : 0.15)
          );

        problems.push({
          type: flat
            ? "HARD_CLIPPING"
            : "SOFT_CLIPPING",
          severity:
            durationMs > 20
              ? "critical"
              : durationMs > 8
              ? "high"
              : "medium",
          confidence,
          startSample: start,
          endSample: end,
          durationMs,
          peak,
          message: flat
            ? "Hard clipping detected."
            : "Possible clipping distortion detected.",
        });

        start = -1;
      }
    }
  }

  return problems;
}
