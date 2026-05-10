import { detectAdaptiveDigitalSilence } from "./adaptiveSilenceDetector";
import { detectHardCuts } from "./hardCutDetector";
import { detectClipping } from "./clippingDetector";
import type { AudioProblem, AudioProblemSeverity } from "./qcTypes";

export interface AudioQcResult {
  score: number;
  deliveryRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  problems: AudioProblem[];
  technicalScore: number;
  integrityScore: number;
}

function severityPenalty(severity: AudioProblemSeverity): number {
  switch (severity) {
    case "critical": return 25;
    case "high": return 15;
    case "medium": return 8;
    case "low": return 3;
    default: return 3;
  }
}

function deliveryRiskFromScore(score: number): AudioQcResult["deliveryRisk"] {
  if (score > 90) return "LOW";
  if (score > 75) return "MEDIUM";
  if (score > 50) return "HIGH";
  return "CRITICAL";
}

function sortProblems(problems: AudioProblem[]): AudioProblem[] {
  const rank: Record<AudioProblemSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...problems].sort((a, b) => {
    const severityDiff = rank[b.severity] - rank[a.severity];
    if (severityDiff !== 0) return severityDiff;

    const timeA = a.timeMs ?? 0;
    const timeB = b.timeMs ?? 0;
    return timeA - timeB;
  });
}

export async function analyzeAudioQuality(
  samples: Float32Array,
  sampleRate: number
): Promise<AudioQcResult> {
  const silenceProblems = detectAdaptiveDigitalSilence(samples, sampleRate);
  const hardCutProblems = detectHardCuts(samples, sampleRate);
  const clippingProblems = detectClipping(samples, sampleRate);

  const problems = sortProblems([
    ...silenceProblems,
    ...hardCutProblems,
    ...clippingProblems,
  ]);

  let score = 100;
  for (const p of problems) {
    score -= severityPenalty(p.severity);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const technicalScore = Math.max(
    0,
    Math.min(100, 100 - clippingProblems.length * 12)
  );

  const integrityScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        silenceProblems.length * 10 -
        hardCutProblems.length * 15
    )
  );

  return {
    score,
    deliveryRisk: deliveryRiskFromScore(score),
    problems,
    technicalScore,
    integrityScore,
  };
}
