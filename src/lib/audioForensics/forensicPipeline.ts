/**
 * forensicPipeline.ts — Unified Forensic Audio Analysis Pipeline
 * Aivora Audio Infrastructure Platform
 *
 * Orchestrates all forensic modules into a single analysis pass:
 * 1. Audio integrity check (NaN, clipping, DC, drift)
 * 2. Synthetic speech detection (TTS/clone)
 * 3. AI artifact detection (vocoder/enhancement artifacts)
 * 4. Microphone fingerprinting (device signature)
 * 5. Room fingerprinting (environment signature)
 * 6. Provenance scoring (overall authenticity score)
 *
 * Output: ForensicReport — comprehensive evidence document
 * suitable for dataset quality review and audio authentication.
 */

import { runIntegrityCheck }        from "../dsp/observability/audioIntegrity";
import { detectSyntheticSpeech }    from "./syntheticSpeechDetector";
import { extractMicFingerprint }    from "./microphoneFingerprint";
import { extractRoomFingerprint }   from "./roomFingerprint";
import { detectAIArtifacts }        from "../ai/aiArtifactDetector";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ForensicVerdict =
  | "authentic"          // high confidence genuine human recording
  | "likely_authentic"   // probable genuine, minor issues
  | "suspicious"         // multiple red flags
  | "likely_synthetic"   // strong synthetic indicators
  | "synthetic"          // high confidence AI-generated
  | "inconclusive";      // insufficient evidence

export interface ForensicReport {
  readonly timestamp:        number;
  readonly durationSec:      number;
  readonly sampleRate:       number;

  // Module results
  readonly integrity:        ReturnType<typeof runIntegrityCheck>;
  readonly synthetic:        ReturnType<typeof detectSyntheticSpeech>;
  readonly aiArtifacts:      ReturnType<typeof detectAIArtifacts>;
  readonly micFingerprint:   ReturnType<typeof extractMicFingerprint>;
  readonly roomFingerprint:  ReturnType<typeof extractRoomFingerprint>;

  // Scoring
  readonly provenanceScore:  number;   // 0-100 (100=authentic)
  readonly verdict:          ForensicVerdict;
  readonly confidence:       number;   // 0-1
  readonly redFlags:         string[];
  readonly greenFlags:       string[];
  readonly summary:          string;
  readonly processingMs:     number;
}

// ── Provenance Scoring ────────────────────────────────────────────────────────

function computeProvenanceScore(
  integrity: ReturnType<typeof runIntegrityCheck>,
  synthetic: ReturnType<typeof detectSyntheticSpeech>,
  aiArt:     ReturnType<typeof detectAIArtifacts>
): number {
  let score = 100;

  // Integrity penalties
  if(integrity.nanInf.hasNaN || integrity.nanInf.hasInf) score -= 30;
  if(integrity.silence.isDigitalMute)                    score -= 20;
  if(integrity.clipping.clipRatio > 0.01)               score -= 10;
  if(integrity.dcOffset.significant)                     score -= 5;
  if(integrity.timing.significant)                       score -= 5;

  // Synthetic speech penalties
  if(synthetic.isSynthetic) {
    score -= Math.round(synthetic.confidence * 40);
  } else {
    score += Math.round((1-synthetic.confidence) * 5); // bonus for natural
  }

  // AI artifact penalties
  const artPenalty = Math.round((1 - aiArt.overallScore/100) * 20);
  score -= artPenalty;

  return Math.max(0, Math.min(100, score));
}

// ── Verdict Classification ────────────────────────────────────────────────────

function classifyVerdict(
  provenanceScore: number,
  synthetic:       ReturnType<typeof detectSyntheticSpeech>,
  aiArt:           ReturnType<typeof detectAIArtifacts>
): { verdict: ForensicVerdict; confidence: number } {
  const syntConf = synthetic.confidence;
  const isSynt   = synthetic.isSynthetic;
  const aiScore  = aiArt.overallScore;

  if(provenanceScore >= 85 && !isSynt && aiScore >= 80)
    return { verdict:"authentic",        confidence:0.9 };
  if(provenanceScore >= 70 && !isSynt)
    return { verdict:"likely_authentic", confidence:0.75 };
  if(provenanceScore >= 55)
    return { verdict:"suspicious",       confidence:0.6 };
  if(isSynt && syntConf > 0.7)
    return { verdict:"likely_synthetic", confidence:syntConf };
  if(isSynt && syntConf > 0.85 && aiScore < 50)
    return { verdict:"synthetic",        confidence:syntConf };

  return { verdict:"inconclusive", confidence:0.4 };
}

// ── Evidence Collection ───────────────────────────────────────────────────────

function collectEvidence(
  integrity: ReturnType<typeof runIntegrityCheck>,
  synthetic: ReturnType<typeof detectSyntheticSpeech>,
  aiArt:     ReturnType<typeof detectAIArtifacts>,
  mic:       ReturnType<typeof extractMicFingerprint>,
  room:      ReturnType<typeof extractRoomFingerprint>
): { red: string[]; green: string[] } {
  const red:   string[] = [];
  const green: string[] = [];

  // Integrity
  if(integrity.nanInf.hasNaN)
    red.push(`DSP corruption: ${integrity.nanInf.nanCount} NaN samples`);
  if(integrity.clipping.clipRatio > 0.005)
    red.push(`Clipping: ${(integrity.clipping.clipRatio*100).toFixed(2)}% samples`);
  if(integrity.dcOffset.significant)
    red.push(`DC offset: ${integrity.dcOffset.offsetDb.toFixed(1)} dBFS`);
  if(integrity.overallClean)
    green.push("Audio integrity: clean (no corruption detected)");

  // Synthetic
  if(synthetic.isSynthetic) {
    red.push(`Synthetic speech: ${synthetic.method} (${(synthetic.confidence*100).toFixed(0)}% confidence)`);
    red.push(...synthetic.evidence);
  } else {
    green.push(`Natural speech characteristics (score: ${synthetic.overallScore}/100)`);
  }

  // AI Artifacts
  if(aiArt.overallScore < 70)
    red.push(`AI artifacts detected: ${aiArt.dominantType} (score: ${aiArt.overallScore}/100)`);
  else
    green.push(`Minimal AI artifacts (score: ${aiArt.overallScore}/100)`);

  // Room
  if(room.overallRT60Ms > 50)
    green.push(`Room environment detected (RT60: ${room.overallRT60Ms}ms)`);
  else
    red.push("No room acoustics — possible close-mic synthesis or anechoic");

  // Mic
  if(mic.rolloffHz > 8000)
    green.push(`Full bandwidth microphone (rolloff: ${mic.rolloffHz}Hz)`);
  else
    red.push(`Narrow bandwidth (rolloff: ${mic.rolloffHz}Hz) — possible bandwidth extension`);

  return { red, green };
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

export async function runForensicPipeline(
  data: Float32Array,
  sr:   number
): Promise<ForensicReport> {
  const startMs = performance.now();

  // Mock AudioBuffer for integrity check
  const mockBuffer = {
    getChannelData: () => data,
    numberOfChannels: 1,
    length:           data.length,
    sampleRate:       sr,
    duration:         data.length / sr,
  } as unknown as AudioBuffer;

  // Run all modules in parallel where safe
  const [integrity, synthetic, aiArtifacts] = await Promise.all([
    Promise.resolve(runIntegrityCheck(mockBuffer)),
    Promise.resolve(detectSyntheticSpeech(data, sr)),
    Promise.resolve(detectAIArtifacts(data, sr)),
  ]);

  // Sequential (CPU-intensive, avoid contention)
  const micFingerprint  = extractMicFingerprint(data, sr);
  const roomFingerprint = extractRoomFingerprint(data, sr);

  // Scoring
  const provenanceScore = computeProvenanceScore(integrity, synthetic, aiArtifacts);
  const { verdict, confidence } = classifyVerdict(provenanceScore, synthetic, aiArtifacts);
  const { red, green } = collectEvidence(integrity, synthetic, aiArtifacts, micFingerprint, roomFingerprint);

  const summary = [
    `Verdict: ${verdict.toUpperCase().replace("_"," ")} (${Math.round(confidence*100)}% confidence)`,
    `Provenance Score: ${provenanceScore}/100`,
    `Duration: ${(data.length/sr).toFixed(2)}s at ${sr}Hz`,
    red.length>0   ? `Red flags: ${red.length}`   : "No red flags",
    green.length>0 ? `Green flags: ${green.length}` : "",
  ].filter(Boolean).join(" | ");

  return {
    timestamp:      Date.now(),
    durationSec:    Math.round(data.length/sr*100)/100,
    sampleRate:     sr,
    integrity,
    synthetic,
    aiArtifacts,
    micFingerprint,
    roomFingerprint,
    provenanceScore,
    verdict,
    confidence:     Math.round(confidence*1000)/1000,
    redFlags:       red,
    greenFlags:     green,
    summary,
    processingMs:   Math.round(performance.now()-startMs),
  };
}
