export interface HardCutProblem {
  type: string;
  severity: "medium" | "high" | "critical";
  confidence: number;
  sampleIndex: number;
  timeMs: number;
  delta: number;
  message: string;
}

function spectralEnergy(
  buf: Float32Array
): number {
  let e = 0;

  for (let i = 0; i < buf.length; i++) {
    e += Math.abs(buf[i]);
  }

  return e / Math.max(1, buf.length);
}

function zeroCrossingRate(
  buf: Float32Array
): number {
  let z = 0;

  for (let i = 1; i < buf.length; i++) {
    if (
      (buf[i - 1] >= 0 && buf[i] < 0) ||
      (buf[i - 1] < 0 && buf[i] >= 0)
    ) {
      z++;
    }
  }

  return z / Math.max(1, buf.length);
}

export function detectHardCuts(
  samples: Float32Array,
  sampleRate: number
): HardCutProblem[] {
  const problems: HardCutProblem[] = [];

  const frame = Math.floor(sampleRate * 0.02);

  const hop = Math.floor(frame / 2);

  for (
    let i = frame;
    i < samples.length - frame;
    i += hop
  ) {
    const prev = samples.subarray(
      i - frame,
      i
    );

    const next = samples.subarray(
      i,
      i + frame
    );

    const prevEnergy =
      spectralEnergy(prev);

    const nextEnergy =
      spectralEnergy(next);

    const prevZcr =
      zeroCrossingRate(prev);

    const nextZcr =
      zeroCrossingRate(next);

    const energyDelta =
      Math.abs(
        nextEnergy - prevEnergy
      );

    const zcrDelta =
      Math.abs(
        nextZcr - prevZcr
      );

    const abruptness =
      energyDelta * 0.7 +
      zcrDelta * 0.3;

    if (abruptness < 0.12) continue;

    const confidence = Math.min(
      1,
      abruptness * 2.5
    );

    problems.push({
      type: "HARD_CUT",
      severity:
        abruptness > 0.3
          ? "critical"
          : abruptness > 0.2
          ? "high"
          : "medium",
      confidence,
      sampleIndex: i,
      timeMs:
        (i / sampleRate) * 1000,
      delta: abruptness,
      message:
        "Abrupt waveform discontinuity detected.",
    });
  }

  return problems;
}
