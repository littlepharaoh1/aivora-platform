export interface NoiseProblem {
  type: string;
  severity: string;
  confidence: number;
  message: string;
  noiseFloorDb: number;
}

function rms(samples: Float32Array) {
  let sum = 0;

  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }

  return Math.sqrt(sum / samples.length);
}

function rmsToDb(rmsValue: number) {
  return 20 * Math.log10(rmsValue + 1e-12);
}

export function detectSpectralNoise(
  samples: Float32Array,
  sampleRate: number
): NoiseProblem[] {

  const problems: NoiseProblem[] = [];

  const frame =
    Math.floor(sampleRate * 0.05);

  const dbValues: number[] = [];

  for (
    let i = 0;
    i < samples.length - frame;
    i += frame
  ) {

    const slice =
      samples.subarray(i, i + frame);

    const value =
      rmsToDb(rms(slice));

    dbValues.push(value);
  }

  if (!dbValues.length) {
    return problems;
  }

  dbValues.sort((a, b) => a - b);

  const floor =
    dbValues[
      Math.floor(dbValues.length * 0.1)
    ];

  if (floor > -38) {

    problems.push({
      type: "HIGH_NOISE_FLOOR",
      severity:
        floor > -30
          ? "critical"
          : floor > -34
          ? "high"
          : "medium",
      confidence:
        Math.min(
          1,
          Math.abs(floor + 40) / 15
        ),
      noiseFloorDb: floor,
      message:
        "High background noise floor detected."
    });
  }

  return problems;
}
