import { detectAdaptiveDigitalSilence } from "./adaptiveSilenceDetector";
import { detectHardCuts } from "./hardCutDetector";
import { detectClipping } from "./clippingDetector";

export interface AudioQcProblem {
  type: string;
  severity: string;
  confidence: number;
  message: string;
  [key: string]: any;
}

export interface AudioQcResult {
  score: number;
  deliveryRisk: string;
  problems: AudioQcProblem[];
  technicalScore: number;
  integrityScore: number;
}

export async function analyzeAudioQuality(
  samples: Float32Array,
  sampleRate: number
): Promise<AudioQcResult> {

  const problems: AudioQcProblem[] = [];

  const silenceProblems =
    detectAdaptiveDigitalSilence(
      samples,
      sampleRate
    );

  const hardCutProblems =
    detectHardCuts(
      samples,
      sampleRate
    );

  const clippingProblems =
    detectClipping(
      samples,
      sampleRate
    );

  problems.push(
    ...silenceProblems,
    ...hardCutProblems,
    ...clippingProblems
  );

  let score = 100;

  for (const p of problems) {

    if (p.severity === "critical") {
      score -= 25;
    }

    else if (p.severity === "high") {
      score -= 15;
    }

    else if (p.severity === "medium") {
      score -= 8;
    }

    else {
      score -= 3;
    }
  }

  score = Math.max(0, score);

  const technicalScore =
    Math.max(
      0,
      100 - clippingProblems.length * 12
    );

  const integrityScore =
    Math.max(
      0,
      100 -
      silenceProblems.length * 10 -
      hardCutProblems.length * 15
    );

  const deliveryRisk =
    score > 90
      ? "LOW"
      : score > 75
      ? "MEDIUM"
      : score > 50
      ? "HIGH"
      : "CRITICAL";

  return {
    score,
    deliveryRisk,
    problems,
    technicalScore,
    integrityScore
  };
}
