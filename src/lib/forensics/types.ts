/**
 * types.ts — Forensic Intelligence Types
 */

export interface SyntheticResult {
  isSynthetic:  boolean;
  confidence:   number;
  naturalness:  number;
  scores: {
    jitter:     number;
    shimmer:    number;
    bispectrum: number;
    cpp:        number;
    modulation: number;
  };
}

export interface MicResult {
  signature:    number[];
  noiseFloorDb: number;
  rolloffHz:    number;
}

export interface RoomResult {
  rt60s:           Record<number, number>;
  rt60Overall:     number;
  roomCategory:    string;
  absorptionCoeff: number;
}

export interface ArtifactResult {
  clean:         boolean;
  artifactScore: number;
  dominantType:  string;
  scores: {
    holeRatio:  number;
    combScore:  number;
    entropy:    number;
    bandwidth:  number;
    phaseJumps: number;
  };
}

export interface AgentResult {
  synthetic?: SyntheticResult;
  mic?:       MicResult;
  room?:      RoomResult;
  artifact?:  ArtifactResult;
}

export interface Verdict {
  label:      "AUTHENTIC" | "SUSPICIOUS" | "SYNTHETIC" | "PENDING";
  confidence: number;
}
