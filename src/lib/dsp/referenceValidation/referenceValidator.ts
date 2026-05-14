/**
 * referenceValidator.ts — DSP Accuracy Validation Suite
 * Aivora Platform — Phase 2
 */

import { safeDb, safeLufs, safeSnr, safeRt60, safePercent, safePitchHz } from "../metricGuards";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReferenceMetrics {
  lufs?:        number;
  snrDb?:       number;
  truePeak?:    number;
  rt60Ms?:      number;
  c50?:         number;
  speechRatio?: number;
  pitchHz?:     number;
  noiseFloorDb?: number;
  humFreq?:     number | null;
  environment?: string;
}

export interface ReferenceTestCase {
  id:          string;
  name:        string;
  description: string;
  category:    "speech" | "noise" | "hum" | "reverb" | "loudness" | "silence" | "mixed";
  expected:    ReferenceMetrics;
  tolerances:  Partial<Record<keyof ReferenceMetrics, number>>;
}

export interface ValidationResult {
  testId:   string;
  testName: string;
  passed:   boolean;
  checks:   MetricCheck[];
  score:    number;
  duration: number;
}

export interface MetricCheck {
  metric:    string;
  expected:  string;
  actual:    string;
  tolerance: string;
  passed:    boolean;
  delta:     number;
  anomaly?:  string;
}

export interface ValidationReport {
  timestamp:   string;
  totalTests:  number;
  passed:      number;
  failed:      number;
  score:       number;
  results:     ValidationResult[];
  driftAlerts: DriftAlert[];
  summary:     string;
}

export interface DriftAlert {
  metric:   string;
  testId:   string;
  expected: number;
  actual:   number;
  drift:    number;
  severity: "critical" | "warning";
}

// ── Reference Test Cases ──────────────────────────────────────────────────────

export const REFERENCE_TEST_CASES: ReferenceTestCase[] = [
  {
    id: "clean_speech",
    name: "Clean Speech",
    description: "Studio-quality speech — baseline reference",
    category: "speech",
    expected: {
      lufs:        -20,
      snrDb:        45,
      truePeak:     -3,
      rt60Ms:       80,
      speechRatio:  0.70,
      pitchHz:     150,
      noiseFloorDb: -70,
      humFreq:      null,
      environment:  "studio",
    },
    tolerances: {
      lufs:        3,
      snrDb:       10,
      truePeak:    3,
      rt60Ms:      50,
      speechRatio: 0.20,
      pitchHz:     50,
      noiseFloorDb: 15,
    },
  },
  {
    id: "pink_noise",
    name: "Pink Noise",
    description: "1/f noise spectrum — SNR baseline",
    category: "noise",
    expected: {
      lufs:        -20,
      snrDb:         5,
      speechRatio:   0.00,
      noiseFloorDb: -25,
      humFreq:       null,
    },
    tolerances: {
      lufs:        5,
      snrDb:       8,
      speechRatio: 0.15,
      noiseFloorDb: 10,
    },
  },
  {
    id: "white_noise",
    name: "White Noise",
    description: "Flat spectrum noise",
    category: "noise",
    expected: {
      lufs:        -20,
      snrDb:         3,
      speechRatio:   0.00,
      noiseFloorDb: -22,
    },
    tolerances: {
      lufs:        5,
      snrDb:       8,
      speechRatio: 0.15,
      noiseFloorDb: 10,
    },
  },
  {
    id: "hum_50hz",
    name: "50Hz Electrical Hum",
    description: "European mains hum + harmonics",
    category: "hum",
    expected: {
      humFreq:     50,
      snrDb:       15,
      lufs:        -30,
    },
    tolerances: {
      snrDb:   10,
      lufs:     5,
    },
  },
  {
    id: "hum_60hz",
    name: "60Hz Electrical Hum",
    description: "US/Japan mains hum + harmonics",
    category: "hum",
    expected: {
      humFreq:     60,
      snrDb:       15,
      lufs:        -30,
    },
    tolerances: {
      snrDb:   10,
      lufs:     5,
    },
  },
  {
    id: "clipped_audio",
    name: "Clipped Audio",
    description: "Hard clipping above 0 dBFS",
    category: "loudness",
    expected: {
      truePeak:    0,
      lufs:       -6,
      snrDb:      20,
    },
    tolerances: {
      truePeak:  1,
      lufs:      4,
      snrDb:    15,
    },
  },
  {
    id: "silence_abuse",
    name: "Silence Abuse",
    description: "Recording with excessive silence",
    category: "silence",
    expected: {
      speechRatio:  0.10,
      lufs:        -40,
      snrDb:        30,
    },
    tolerances: {
      speechRatio: 0.15,
      lufs:        10,
      snrDb:       15,
    },
  },
  {
    id: "bathroom_reverb",
    name: "Bathroom Reverb",
    description: "High reverb small tiled room",
    category: "reverb",
    expected: {
      rt60Ms:      800,
      c50:         -5,
      environment: "bathroom",
      snrDb:       25,
    },
    tolerances: {
      rt60Ms:  300,
      c50:      10,
      snrDb:    15,
    },
  },
  {
    id: "office_room",
    name: "Office Room",
    description: "Typical office acoustic environment",
    category: "reverb",
    expected: {
      rt60Ms:      250,
      c50:           5,
      environment: "office",
      snrDb:        30,
    },
    tolerances: {
      rt60Ms:  150,
      c50:      10,
      snrDb:    15,
    },
  },
  {
    id: "low_lufs",
    name: "Low LUFS",
    description: "Very quiet recording — below -32 LUFS",
    category: "loudness",
    expected: {
      lufs:    -36,
      snrDb:    35,
    },
    tolerances: {
      lufs:   5,
      snrDb: 15,
    },
  },
  {
    id: "high_lufs",
    name: "High LUFS",
    description: "Loud recording — near -14 LUFS",
    category: "loudness",
    expected: {
      lufs:    -14,
      truePeak: -1,
      snrDb:    40,
    },
    tolerances: {
      lufs:     3,
      truePeak: 2,
      snrDb:   15,
    },
  },
  {
    id: "speech_music_mix",
    name: "Speech + Music Mix",
    description: "Background music during speech",
    category: "mixed",
    expected: {
      speechRatio: 0.40,
      snrDb:       15,
      lufs:       -20,
    },
    tolerances: {
      speechRatio: 0.20,
      snrDb:       10,
      lufs:         5,
    },
  },
];

// ── Validation Engine ─────────────────────────────────────────────────────────

function checkMetric(
  metric:    keyof ReferenceMetrics,
  expected:  number | string | null | undefined,
  actual:    number | string | null | undefined,
  tolerance: number | undefined
): MetricCheck {
  // String metrics (environment, humFreq null)
  if (typeof expected === "string" || expected === null) {
    const passed = expected === actual || expected === null;
    return {
      metric,
      expected: String(expected ?? "—"),
      actual:   String(actual ?? "—"),
      tolerance: "exact",
      passed,
      delta: 0,
    };
  }

  if (typeof expected === "number" && typeof actual === "number") {
    const delta = Math.abs(actual - expected);
    const tol   = tolerance ?? 0;
    const passed = delta <= tol;

    return {
      metric,
      expected:  `${expected}`,
      actual:    `${actual.toFixed(2)}`,
      tolerance: `±${tol}`,
      passed,
      delta,
      anomaly: !isFinite(actual) ? "infinite" : isNaN(actual) ? "nan" : undefined,
    };
  }

  return {
    metric,
    expected: "—",
    actual:   "—",
    tolerance: "—",
    passed: false,
    delta: 0,
    anomaly: "missing_data",
  };
}

export function validateMetrics(
  testCase: ReferenceTestCase,
  actual:   ReferenceMetrics
): ValidationResult {
  const start  = Date.now();
  const checks: MetricCheck[] = [];

  const metricKeys = Object.keys(testCase.expected) as (keyof ReferenceMetrics)[];

  for (const key of metricKeys) {
    const expectedVal  = testCase.expected[key];
    const actualVal    = actual[key];
    const tolerance    = testCase.tolerances[key] as number | undefined;

    if (expectedVal === undefined) continue;

    checks.push(checkMetric(key, expectedVal as number, actualVal as number, tolerance));
  }

  const passed     = checks.every(c => c.passed);
  const passedCount = checks.filter(c => c.passed).length;
  const score      = checks.length > 0 ? Math.round((passedCount / checks.length) * 100) : 0;

  return {
    testId:   testCase.id,
    testName: testCase.name,
    passed,
    checks,
    score,
    duration: Date.now() - start,
  };
}

export function generateValidationReport(
  results: ValidationResult[]
): ValidationReport {
  const passed      = results.filter(r => r.passed).length;
  const failed      = results.length - passed;
  const totalScore  = results.length > 0
    ? Math.round(results.reduce((s,r) => s + r.score, 0) / results.length)
    : 0;

  // Detect drift alerts
  const driftAlerts: DriftAlert[] = [];
  for (const result of results) {
    for (const check of result.checks) {
      if (!check.passed && check.delta > 0) {
        const expectedNum = parseFloat(check.expected);
        const actualNum   = parseFloat(check.actual);
        if (!isNaN(expectedNum) && !isNaN(actualNum)) {
          driftAlerts.push({
            metric:   check.metric,
            testId:   result.testId,
            expected: expectedNum,
            actual:   actualNum,
            drift:    check.delta,
            severity: check.delta > 20 ? "critical" : "warning",
          });
        }
      }
    }
  }

  const summary = failed === 0
    ? `✅ All ${results.length} tests passed — DSP engine accurate`
    : `⚠️ ${failed}/${results.length} tests failed — DSP drift detected`;

  return {
    timestamp:  new Date().toISOString(),
    totalTests: results.length,
    passed,
    failed,
    score:      totalScore,
    results,
    driftAlerts,
    summary,
  };
}

// ── Synthetic Test Signal Generator ──────────────────────────────────────────

export function generateSyntheticSignal(
  type:       "silence" | "sine" | "noise" | "speech_like",
  sampleRate: number,
  durationSec: number,
  params:     { frequency?: number; amplitude?: number } = {}
): Float32Array {
  const length  = Math.round(sampleRate * durationSec);
  const samples = new Float32Array(length);
  const amp     = params.amplitude ?? 0.5;
  const freq    = params.frequency ?? 440;

  switch (type) {
    case "silence":
      // Digital silence
      break;

    case "sine":
      for (let i = 0; i < length; i++)
        samples[i] = amp * Math.sin(2 * Math.PI * freq * i / sampleRate);
      break;

    case "noise":
      for (let i = 0; i < length; i++)
        samples[i] = amp * (Math.random() * 2 - 1);
      break;

    case "speech_like": {
      // Simulate speech-like signal: voiced + unvoiced alternating
      const frameSize = Math.round(0.02 * sampleRate);
      for (let i = 0; i < length; i++) {
        const frameIdx = Math.floor(i / frameSize);
        const isVoiced = frameIdx % 4 !== 0; // 75% voiced
        if (isVoiced) {
          samples[i] = amp * Math.sin(2 * Math.PI * (freq + Math.random() * 50) * i / sampleRate);
        } else {
          samples[i] = amp * 0.1 * (Math.random() * 2 - 1);
        }
      }
      break;
    }
  }

  return samples;
}
