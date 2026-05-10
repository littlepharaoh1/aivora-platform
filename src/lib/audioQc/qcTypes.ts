export type AudioProblemSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type AudioProblemType =
  | "DIGITAL_SILENCE"
  | "HARD_CUT"
  | "CLIPPING"
  | "SPECTRAL_NOISE"
  | "HUM"
  | "DC_OFFSET"
  | "LOW_SNR"
  | "FORMAT_SPEC";

export interface AudioProblem {
  type: AudioProblemType;
  severity: AudioProblemSeverity;
  confidence: number;

  startSample?: number;
  endSample?: number;
  sampleIndex?: number;

  timeMs?: number;
  durationMs?: number;

  delta?: number;
  peak?: number;

  message: string;
  recommendation?: string;
}

export interface AudioQcProfile {
  maxAllowedSilenceMs?: number;
  digitalSilenceFloor?: number;
}

export interface AudioMetrics {
  peakDb?: number;
  rmsDb?: number;
  noiseDb?: number;
  snrDb?: number;
}
