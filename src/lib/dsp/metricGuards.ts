/**
 * metricGuards.ts — DSP Metric Safety & Display Guards
 * Aivora Platform — DSP Accuracy Framework
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_MIN        = -120;
const DB_MAX        =    0;
const SNR_MAX       =   80;
const LUFS_MIN      =  -70;
const LUFS_MAX      =    0;
const RT60_MIN      =    0;
const RT60_MAX      = 5000;
const PITCH_MIN     =   50;
const PITCH_MAX     =  800;
const PERCENT_MIN   =    0;
const PERCENT_MAX   =  100;
const DURATION_MIN  =    0;
const DURATION_MAX  = 7200000; // 2 hours in ms

// ── Type Definitions ──────────────────────────────────────────────────────────

export interface GuardedValue<T> {
  value:    T;
  display:  string;
  valid:    boolean;
  clamped:  boolean;
  anomaly?: string;
}

export type DisplayPrecision = 0 | 1 | 2 | 3;

// ── Core Guards ───────────────────────────────────────────────────────────────

function isInvalid(v: unknown): boolean {
  return v === null || v === undefined ||
    (typeof v === "number" && (isNaN(v) || !isFinite(v)));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── safeDb ────────────────────────────────────────────────────────────────────

/**
 * Guards dBFS / dBTP values
 * Below -120 → ≤ -120 dBFS
 * Above 0 → 0 dBFS (clipped)
 * Infinity/NaN → Not measurable
 */
export function safeDb(
  v:         unknown,
  unit       = "dBFS",
  precision: DisplayPrecision = 1
): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: DB_MIN, display: "Not measurable",
    valid: false, clamped: false,
    anomaly: typeof v === "number" && isNaN(v as number) ? "NaN" : "Infinity",
  };

  const n = v as number;

  if (n <= DB_MIN) return {
    value: DB_MIN,
    display: `≤ ${DB_MIN} ${unit}`,
    valid: true, clamped: true,
    anomaly: n < DB_MIN ? "below_floor" : undefined,
  };

  if (n > 0) return {
    value: 0,
    display: `0 ${unit} (clipped)`,
    valid: true, clamped: true,
    anomaly: "above_0db",
  };

  return {
    value: n,
    display: `${n.toFixed(precision)} ${unit}`,
    valid: true, clamped: false,
  };
}

// ── safeLufs ──────────────────────────────────────────────────────────────────

/**
 * Guards LUFS integrated loudness values
 */
export function safeLufs(
  v:         unknown,
  precision: DisplayPrecision = 1
): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: LUFS_MIN, display: "Not measurable",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  if (n < LUFS_MIN) return {
    value: LUFS_MIN,
    display: `≤ ${LUFS_MIN} LUFS`,
    valid: true, clamped: true,
    anomaly: "too_quiet",
  };

  if (n > LUFS_MAX) return {
    value: LUFS_MAX,
    display: `${LUFS_MAX} LUFS`,
    valid: true, clamped: true,
    anomaly: "too_loud",
  };

  return {
    value: n,
    display: `${n.toFixed(precision)} LUFS`,
    valid: true, clamped: false,
  };
}

// ── safeSnr ───────────────────────────────────────────────────────────────────

/**
 * Guards SNR values
 * Above 80 dB → 80+ dB (practically anechoic)
 * Below 0 → 0 dB minimum
 */
export function safeSnr(
  v:         unknown,
  precision: DisplayPrecision = 1
): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: 0, display: "Not measurable",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  if (n >= SNR_MAX) return {
    value: SNR_MAX,
    display: `${SNR_MAX}+ dB`,
    valid: true, clamped: true,
    anomaly: "exceptional",
  };

  if (n < 0) return {
    value: 0,
    display: "0 dB",
    valid: true, clamped: true,
    anomaly: "noise_dominant",
  };

  return {
    value: n,
    display: `${n.toFixed(precision)} dB`,
    valid: true, clamped: false,
  };
}

// ── safePercent ───────────────────────────────────────────────────────────────

/**
 * Guards percentage values (0-100%)
 */
export function safePercent(
  v:         unknown,
  precision: DisplayPrecision = 1,
  suffix     = "%"
): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: 0, display: "N/A",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  // Handle ratio (0-1) vs percentage (0-100)
  const pct = n > 1 ? n : n * 100;
  const clamped = clamp(pct, PERCENT_MIN, PERCENT_MAX);

  return {
    value:   clamped,
    display: `${clamped.toFixed(precision)}${suffix}`,
    valid:   true,
    clamped: clamped !== pct,
    anomaly: pct > 100 ? "overflow" : pct < 0 ? "negative" : undefined,
  };
}

// ── safeDurationMs ────────────────────────────────────────────────────────────

/**
 * Guards duration values in milliseconds
 */
export function safeDurationMs(
  v:         unknown,
  precision: DisplayPrecision = 0
): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: 0, display: "N/A",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  if (n < DURATION_MIN) return {
    value: 0,
    display: "0 ms",
    valid: true, clamped: true,
    anomaly: "negative",
  };

  if (n > DURATION_MAX) return {
    value: DURATION_MAX,
    display: `> 2h`,
    valid: true, clamped: true,
    anomaly: "too_long",
  };

  if (n >= 60000) {
    const min = Math.floor(n / 60000);
    const sec = ((n % 60000) / 1000).toFixed(1);
    return { value: n, display: `${min}m ${sec}s`, valid: true, clamped: false };
  }

  if (n >= 1000) {
    return { value: n, display: `${(n/1000).toFixed(precision || 2)}s`, valid: true, clamped: false };
  }

  return {
    value: n,
    display: `${n.toFixed(precision)} ms`,
    valid: true, clamped: false,
  };
}

// ── safePitchHz ───────────────────────────────────────────────────────────────

/**
 * Guards pitch/fundamental frequency values
 */
export function safePitchHz(
  v:         unknown,
  precision: DisplayPrecision = 0
): GuardedValue<number> {
  if (isInvalid(v) || (v as number) === 0) return {
    value: 0, display: "Not detected",
    valid: false, clamped: false,
    anomaly: v === 0 ? "no_pitch" : "invalid",
  };

  const n = v as number;

  if (n < PITCH_MIN) return {
    value: PITCH_MIN,
    display: `< ${PITCH_MIN} Hz`,
    valid: true, clamped: true,
    anomaly: "sub_pitch",
  };

  if (n > PITCH_MAX) return {
    value: PITCH_MAX,
    display: `> ${PITCH_MAX} Hz`,
    valid: true, clamped: true,
    anomaly: "supra_pitch",
  };

  return {
    value: n,
    display: `${n.toFixed(precision)} Hz`,
    valid: true, clamped: false,
  };
}

// ── safeRt60 ──────────────────────────────────────────────────────────────────

/**
 * Guards RT60 reverb time values
 */
export function safeRt60(
  v:         unknown,
  precision: DisplayPrecision = 0
): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: 0,
    display: "Not measurable",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  if (n <= 0) return {
    value: 0,
    display: "< 10 ms",
    valid: true, clamped: true,
    anomaly: "anechoic",
  };

  if (n > RT60_MAX) return {
    value: RT60_MAX,
    display: `> ${RT60_MAX} ms`,
    valid: true, clamped: true,
    anomaly: "extreme_reverb",
  };

  if (n >= 1000) {
    return {
      value: n,
      display: `${(n/1000).toFixed(2)}s`,
      valid: true, clamped: false,
    };
  }

  return {
    value: n,
    display: `${n.toFixed(precision)} ms`,
    valid: true, clamped: false,
  };
}

// ── safeC50 ───────────────────────────────────────────────────────────────────

/**
 * Guards C50 speech clarity values
 */
export function safeC50(v: unknown): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: -40,
    display: "Not measurable",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  if (n <= -40) return {
    value: -40,
    display: "Extremely poor",
    valid: true, clamped: true,
    anomaly: "reverb_dominant",
  };

  if (n < 0) return {
    value: n,
    display: `${n.toFixed(1)} dB (poor)`,
    valid: true, clamped: false,
    anomaly: "poor_clarity",
  };

  return {
    value: n,
    display: `${n.toFixed(1)} dB`,
    valid: true, clamped: false,
  };
}

// ── safeTruePeak ──────────────────────────────────────────────────────────────

/**
 * Guards True Peak values (dBTP)
 */
export function safeTruePeak(v: unknown): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: -120, display: "Not measurable",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;

  if (n > 0) return {
    value: n,
    display: `+${n.toFixed(2)} dBTP ⚠️`,
    valid: true, clamped: false,
    anomaly: "clipped",
  };

  return {
    value: n,
    display: `${n.toFixed(2)} dBTP`,
    valid: true, clamped: false,
  };
}

// ── safeScore ─────────────────────────────────────────────────────────────────

/**
 * Guards QC scores (0-100)
 */
export function safeScore(v: unknown): GuardedValue<number> {
  if (isInvalid(v)) return {
    value: 0, display: "N/A",
    valid: false, clamped: false,
    anomaly: "invalid",
  };

  const n = v as number;
  const clamped = clamp(Math.round(n), 0, 100);

  return {
    value:   clamped,
    display: `${clamped}/100`,
    valid:   true,
    clamped: clamped !== n,
  };
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────

export interface AnomalyReport {
  field:    string;
  anomaly:  string;
  value:    string;
  severity: "critical" | "warning" | "info";
}

export function detectMetricAnomalies(metrics: {
  lufs?:        number;
  snrDb?:       number;
  truePeak?:    number;
  rt60Ms?:      number;
  c50?:         number;
  speechRatio?: number;
  pitchHz?:     number;
  noiseFloorDb?: number;
}): AnomalyReport[] {
  const reports: AnomalyReport[] = [];

  if (metrics.lufs !== undefined) {
    const g = safeLufs(metrics.lufs);
    if (g.anomaly === "too_quiet")
      reports.push({ field: "LUFS", anomaly: "Extremely quiet", value: g.display, severity: "critical" });
    if (g.anomaly === "too_loud")
      reports.push({ field: "LUFS", anomaly: "Clipping risk", value: g.display, severity: "critical" });
  }

  if (metrics.snrDb !== undefined) {
    const g = safeSnr(metrics.snrDb);
    if (g.anomaly === "noise_dominant")
      reports.push({ field: "SNR", anomaly: "Noise dominant", value: g.display, severity: "critical" });
    if (!g.valid)
      reports.push({ field: "SNR", anomaly: "SNR unmeasurable", value: g.display, severity: "warning" });
  }

  if (metrics.truePeak !== undefined && metrics.truePeak > -1) {
    reports.push({ field: "True Peak", anomaly: "Clipping detected", value: safeTruePeak(metrics.truePeak).display, severity: "critical" });
  }

  if (metrics.rt60Ms !== undefined && metrics.rt60Ms > 400) {
    reports.push({ field: "RT60", anomaly: "High reverb", value: safeRt60(metrics.rt60Ms).display, severity: "warning" });
  }

  if (metrics.c50 !== undefined && metrics.c50 <= -40) {
    reports.push({ field: "C50", anomaly: "Reverb dominant", value: safeC50(metrics.c50).display, severity: "warning" });
  }

  if (metrics.speechRatio !== undefined && metrics.speechRatio < 0.15) {
    reports.push({ field: "Speech Ratio", anomaly: "Excessive silence", value: safePercent(metrics.speechRatio).display, severity: "warning" });
  }

  return reports;
}

// ── Convenience formatters ────────────────────────────────────────────────────

export const fmt = {
  db:       (v: unknown, unit = "dBFS") => safeDb(v, unit).display,
  lufs:     (v: unknown) => safeLufs(v).display,
  snr:      (v: unknown) => safeSnr(v).display,
  percent:  (v: unknown) => safePercent(v).display,
  ms:       (v: unknown) => safeDurationMs(v).display,
  pitch:    (v: unknown) => safePitchHz(v).display,
  rt60:     (v: unknown) => safeRt60(v).display,
  c50:      (v: unknown) => safeC50(v).display,
  truePeak: (v: unknown) => safeTruePeak(v).display,
  score:    (v: unknown) => safeScore(v).display,
};
