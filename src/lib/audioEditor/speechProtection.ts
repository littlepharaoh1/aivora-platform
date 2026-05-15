/**
 * speechProtection.ts — Speech Protection Lock
 * Blocks edits that overlap or are near speech regions
 * Aivora Platform — Audition Workstation
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export interface ProtectedRegion {
  startSample:    number;
  endSample:      number;
  startMs:        number;
  endMs:          number;
  type:           "speech" | "transient" | "voiced";
  confidence:     number;
}

export interface SpeechProtectionResult {
  allowed:                 boolean;
  blockedReason?:          string;
  nearestSpeechDistanceMs: number;
  protectedRegions:        ProtectedRegion[];
  riskLevel:               RiskLevel;
  warnings:                string[];
  safetyMarginMs:          number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SAFETY_MARGIN_MS   = 80;   // Default 80ms buffer around speech
const MIN_SPEECH_MS      = 50;   // Min speech duration to protect
const TRANSIENT_THRESH   = 4.0;  // Energy ratio for transient detection

// ── Mono Helper ───────────────────────────────────────────────────────────────

function toMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for(let ch=0; ch<buffer.numberOfChannels; ch++){
    const d = buffer.getChannelData(ch);
    for(let i=0; i<buffer.length; i++) mono[i] += d[i];
  }
  if(buffer.numberOfChannels > 1)
    for(let i=0; i<mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

// ── Speech Region Detector ────────────────────────────────────────────────────

function detectSpeechRegions(
  mono:       Float32Array,
  sampleRate: number,
  marginMs:   number
): ProtectedRegion[] {
  const frameSize   = Math.round(0.02*sampleRate);
  const hopSize     = Math.round(0.01*sampleRate);
  const marginSamples = Math.round(marginMs/1000*sampleRate);
  const regions: ProtectedRegion[] = [];

  // Estimate noise floor
  const energies: number[] = [];
  for(let i=0; i+frameSize<=mono.length; i+=hopSize){
    let e=0;
    for(let j=0; j<frameSize; j++) e += mono[i+j]**2;
    energies.push(e/frameSize);
  }
  energies.sort((a,b) => a-b);
  const cut = Math.max(1, Math.floor(energies.length*0.10));
  const noiseFloor = energies.slice(0,cut).reduce((s,v)=>s+v,0)/cut;
  const thresh = noiseFloor * 8;

  // Find speech frames
  const speechFlags: boolean[] = [];
  for(let i=0; i+frameSize<=mono.length; i+=hopSize){
    let e=0;
    for(let j=0; j<frameSize; j++) e += mono[i+j]**2;
    speechFlags.push(e/frameSize > thresh);
  }

  // Hangover (extend 200ms)
  const hangover = Math.round(0.2*sampleRate/hopSize);
  let countdown = 0;
  for(let i=0; i<speechFlags.length; i++){
    if(speechFlags[i]) countdown = hangover;
    else if(countdown > 0){ speechFlags[i] = true; countdown--; }
  }

  // Extract regions
  let inSpeech = false, speechStart = 0;
  for(let i=0; i<=speechFlags.length; i++){
    const isSpeech = i < speechFlags.length && speechFlags[i];
    if(isSpeech && !inSpeech){ inSpeech=true; speechStart=i*hopSize; }
    if(!isSpeech && inSpeech){
      const speechEnd = i*hopSize;
      const durMs = (speechEnd-speechStart)/sampleRate*1000;
      if(durMs >= MIN_SPEECH_MS){
        // Add safety margin
        const s = Math.max(0, speechStart-marginSamples);
        const e = Math.min(mono.length, speechEnd+marginSamples);
        regions.push({
          startSample: s,
          endSample:   e,
          startMs:     (s/sampleRate)*1000,
          endMs:       (e/sampleRate)*1000,
          type:        "speech",
          confidence:  0.85,
        });
      }
      inSpeech = false;
    }
  }

  return regions;
}

// ── Transient Detector ────────────────────────────────────────────────────────

function detectTransientRegions(
  mono:       Float32Array,
  sampleRate: number,
  marginMs:   number
): ProtectedRegion[] {
  const frameSize     = Math.round(0.005*sampleRate);
  const marginSamples = Math.round(marginMs/1000*sampleRate);
  const regions: ProtectedRegion[] = [];
  let prevEnergy = 0;

  for(let i=0; i+frameSize<=mono.length; i+=frameSize){
    let e=0;
    for(let j=0; j<frameSize; j++) e += mono[i+j]**2;
    e /= frameSize;

    if(prevEnergy > 0 && e/prevEnergy > TRANSIENT_THRESH){
      const s = Math.max(0, i-marginSamples);
      const en = Math.min(mono.length, i+frameSize+marginSamples);
      regions.push({
        startSample: s, endSample: en,
        startMs:     (s/sampleRate)*1000,
        endMs:       (en/sampleRate)*1000,
        type:        "transient",
        confidence:  0.90,
      });
    }
    prevEnergy = e;
  }
  return regions;
}

// ── Overlap Check ─────────────────────────────────────────────────────────────

function overlaps(
  editStart: number, editEnd: number,
  regionStart: number, regionEnd: number
): boolean {
  return editStart < regionEnd && editEnd > regionStart;
}

function distanceToRegion(
  editStart: number, editEnd: number,
  regionStart: number, regionEnd: number,
  sampleRate: number
): number {
  if(overlaps(editStart, editEnd, regionStart, regionEnd)) return 0;
  const dist = Math.min(
    Math.abs(editStart-regionEnd),
    Math.abs(editEnd-regionStart)
  );
  return (dist/sampleRate)*1000;
}

// ── Main Check ────────────────────────────────────────────────────────────────

export function checkSpeechProtection(
  buffer:      AudioBuffer,
  startSample: number,
  endSample:   number,
  options: {
    safetyMarginMs?: number;
    adminOverride?:  boolean;
  } = {}
): SpeechProtectionResult {
  const sr         = buffer.sampleRate;
  const marginMs   = options.safetyMarginMs ?? SAFETY_MARGIN_MS;
  const warnings:  string[] = [];

  const mono = toMono(buffer);

  // Detect protected regions
  const speechRegions    = detectSpeechRegions(mono, sr, marginMs);
  const transientRegions = detectTransientRegions(mono, sr, Math.round(marginMs/2));
  const allProtected     = [...speechRegions, ...transientRegions];

  // Check for overlaps
  const overlappingSpeech    = speechRegions.filter(r=>overlaps(startSample,endSample,r.startSample,r.endSample));
  const overlappingTransient = transientRegions.filter(r=>overlaps(startSample,endSample,r.startSample,r.endSample));

  // Nearest speech distance
  let nearestDist = Infinity;
  for(const r of speechRegions){
    const d = distanceToRegion(startSample, endSample, r.startSample, r.endSample, sr);
    if(d < nearestDist) nearestDist = d;
  }
  if(nearestDist === Infinity) nearestDist = 999999;

  // Risk level
  let riskLevel: RiskLevel;
  let allowed: boolean;
  let blockedReason: string | undefined;

  if(overlappingSpeech.length > 0){
    riskLevel     = "BLOCKED";
    allowed       = options.adminOverride === true;
    blockedReason = `Selection overlaps ${overlappingSpeech.length} speech region(s) — edit blocked`;
    warnings.push(blockedReason);
    if(options.adminOverride) warnings.push("⚠ Admin override active — editing speech is dangerous");
  } else if(overlappingTransient.length > 0){
    riskLevel     = "HIGH";
    allowed       = true;
    blockedReason = `Selection overlaps ${overlappingTransient.length} transient(s) — proceed with caution`;
    warnings.push(blockedReason);
  } else if(nearestDist < marginMs){
    riskLevel = "MEDIUM";
    allowed   = true;
    warnings.push(`Selection is ${nearestDist.toFixed(0)}ms from nearest speech — within safety margin (${marginMs}ms)`);
  } else if(nearestDist < marginMs*2){
    riskLevel = "LOW";
    allowed   = true;
    warnings.push(`Selection is ${nearestDist.toFixed(0)}ms from speech`);
  } else {
    riskLevel = "LOW";
    allowed   = true;
  }

  return {
    allowed,
    blockedReason,
    nearestSpeechDistanceMs: nearestDist === 999999 ? -1 : nearestDist,
    protectedRegions:        allProtected,
    riskLevel,
    warnings,
    safetyMarginMs:          marginMs,
  };
}
