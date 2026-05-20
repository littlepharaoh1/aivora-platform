/**
 * provenanceEngine.ts — Audio Provenance Analysis Engine
 * Aivora Audio Infrastructure Platform
 *
 * Analyzes:
 * - Synthetic speech likelihood (from syntheticSpeechDetector)
 * - Voice consistency across segments
 * - Room continuity (same room throughout)
 * - Microphone continuity (same device)
 * - AI artifact correlation (accumulated evidence)
 * - Timeline tamper analysis via high-freq phase discontinuity
 */

import { detectSyntheticSpeech }  from "../audioForensics/syntheticSpeechDetector";
import { extractMicFingerprint, compareMicFingerprints } from "../audioForensics/microphoneFingerprint";
import { extractRoomFingerprint, compareRoomFingerprints } from "../audioForensics/roomFingerprint";
import { detectAIArtifacts }       from "../ai/aiArtifactDetector";

export interface ProvenanceScore {
  overall:        number;   // 0-100
  syntheticRisk:  number;   // 0-1
  voiceConsistency:number;  // 0-1
  roomConsistency: number;  // 0-1
  micConsistency:  number;  // 0-1
  aiArtifactRisk:  number;  // 0-1
  tamperRisk:      number;  // 0-1
  verdict:         "authentic"|"suspicious"|"likely_tampered"|"synthetic";
  evidence:        string[];
}

export interface SegmentAnalysis {
  startSec:  number;
  endSec:    number;
  synthetic: ReturnType<typeof detectSyntheticSpeech>;
  micPrint:  ReturnType<typeof extractMicFingerprint>;
  roomPrint: ReturnType<typeof extractRoomFingerprint>;
}

// ── Phase discontinuity tamper detection ──────────────────────────────────────

function detectTimelineTamper(data: Float32Array, sr: number): number {
  const frameLen = Math.floor(0.01*sr);
  let   jumps    = 0, frames = 0;
  let   prevEnergy = 0;

  for(let s=frameLen;s+frameLen<=data.length;s+=frameLen){
    let e=0;
    for(let i=s;i<s+frameLen;i++) e+=data[i]**2;
    e/=frameLen;

    if(frames>0&&prevEnergy>1e-8){
      const ratio=Math.abs(Math.log10((e+1e-15)/(prevEnergy+1e-15)));
      if(ratio>1.8) jumps++;
    }
    prevEnergy=e; frames++;
  }

  return frames>0?Math.min(1,jumps/frames*10):0;
}

// ── Voice consistency (F0 variance check) ────────────────────────────────────

function analyzeVoiceConsistency(segments: SegmentAnalysis[]): number {
  if(segments.length<2) return 1;
  const f0Scores=segments.map(s=>s.synthetic.features.f0RegularityScore);
  const mean=f0Scores.reduce((a,b)=>a+b)/f0Scores.length;
  const std=Math.sqrt(f0Scores.reduce((s,v)=>s+(v-mean)**2,0)/f0Scores.length);
  return Math.max(0,1-std*3);
}

// ── Main Provenance Engine ────────────────────────────────────────────────────

export class ProvenanceEngine {
  async analyze(
    data: Float32Array,
    sr:   number,
    segmentSec = 10
  ): Promise<ProvenanceScore> {
    const evidence: string[] = [];
    const segLen = Math.floor(segmentSec*sr);
    const segments: SegmentAnalysis[] = [];

    // Analyze segments
    for(let s=0;s+segLen<=data.length;s+=segLen){
      const seg=data.slice(s,s+segLen);
      segments.push({
        startSec: s/sr, endSec:(s+segLen)/sr,
        synthetic: detectSyntheticSpeech(seg as Float32Array,sr),
        micPrint:  extractMicFingerprint(seg as Float32Array,sr),
        roomPrint: extractRoomFingerprint(seg as Float32Array,sr),
      });
    }

    if(!segments.length){
      const seg=data;
      segments.push({
        startSec:0, endSec:data.length/sr,
        synthetic:detectSyntheticSpeech(seg,sr),
        micPrint: extractMicFingerprint(seg,sr),
        roomPrint:extractRoomFingerprint(seg,sr),
      });
    }

    // Synthetic risk
    const synthScores=segments.map(s=>s.synthetic.isSynthetic?s.synthetic.confidence:0);
    const syntheticRisk=synthScores.reduce((a,b)=>a+b)/synthScores.length;
    if(syntheticRisk>0.5) evidence.push(`Synthetic speech detected (${(syntheticRisk*100).toFixed(0)}%)`);

    // AI artifact risk
    const aiArt=detectAIArtifacts(data,sr);
    const aiArtifactRisk=1-aiArt.overallScore/100;
    if(aiArtifactRisk>0.3) evidence.push(`AI artifacts: ${aiArt.dominantType??"unknown"}`);

    // Voice consistency
    const voiceConsistency=analyzeVoiceConsistency(segments);
    if(voiceConsistency<0.7) evidence.push(`Voice inconsistency across segments`);

    // Room consistency
    let roomConsistency=1;
    if(segments.length>1){
      const comparisons=[];
      for(let i=1;i<segments.length;i++){
        const cmp=compareRoomFingerprints(segments[0].roomPrint,segments[i].roomPrint);
        comparisons.push(cmp.similarity);
      }
      roomConsistency=comparisons.reduce((a,b)=>a+b)/comparisons.length;
      if(roomConsistency<0.7) evidence.push(`Room acoustic inconsistency (score=${roomConsistency.toFixed(2)})`);
    }

    // Mic consistency
    let micConsistency=1;
    if(segments.length>1){
      const comparisons=[];
      for(let i=1;i<segments.length;i++){
        const cmp=compareMicFingerprints(segments[0].micPrint,segments[i].micPrint);
        comparisons.push(cmp.similarity);
      }
      micConsistency=comparisons.reduce((a,b)=>a+b)/comparisons.length;
      if(micConsistency<0.7) evidence.push(`Microphone inconsistency (score=${micConsistency.toFixed(2)})`);
    }

    // Timeline tamper
    const tamperRisk=detectTimelineTamper(data,sr);
    if(tamperRisk>0.3) evidence.push(`Timeline tamper risk: ${(tamperRisk*100).toFixed(0)}%`);

    // Overall score
    const riskScore = syntheticRisk*0.30 + aiArtifactRisk*0.20 +
                     (1-voiceConsistency)*0.15 + (1-roomConsistency)*0.15 +
                     (1-micConsistency)*0.10  + tamperRisk*0.10;
    const overall   = Math.round((1-riskScore)*100);

    let verdict: ProvenanceScore["verdict"]="authentic";
    if(riskScore>0.7)      verdict="synthetic";
    else if(riskScore>0.5) verdict="likely_tampered";
    else if(riskScore>0.3) verdict="suspicious";

    return {
      overall, syntheticRisk, voiceConsistency, roomConsistency,
      micConsistency, aiArtifactRisk, tamperRisk,
      verdict, evidence,
    };
  }
}

export const provenanceEngine = new ProvenanceEngine();
