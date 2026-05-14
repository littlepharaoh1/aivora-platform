/**
 * adobeQaSimulator.ts — Adobe QA Simulation Engine
 * Simulates professional reviewer inspection
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

import type { AdobeQAResult, QARecommendation } from "./types";
import { analyzeSilenceForensics } from "./silenceForensics";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QAInput {
  original:      AudioBuffer;
  repaired:      AudioBuffer;
  repairedRegionCount: number;
  totalRepairedMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rmsDb(samples: Float32Array): number {
  let sum=0;
  for(let i=0;i<samples.length;i++) sum+=samples[i]**2;
  const rms=Math.sqrt(sum/samples.length);
  return rms>0?20*Math.log10(rms):-120;
}

function toMono(buffer: AudioBuffer): Float32Array {
  const mono=new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;
  return mono;
}

// ── Seam Visibility Check ─────────────────────────────────────────────────────

function checkSeamVisibility(
  mono:       Float32Array,
  sampleRate: number
): number {
  // Check for sudden amplitude jumps
  const frameSize=Math.round(0.005*sampleRate); // 5ms
  let maxJump=0;
  let prevRms=-120;

  for(let i=0;i+frameSize<=mono.length;i+=frameSize){
    const frame=mono.subarray(i,i+frameSize);
    let e=0;
    for(let j=0;j<frame.length;j++) e+=frame[j]**2;
    const db=e>0?10*Math.log10(e/frame.length):-120;
    const jump=Math.abs(db-prevRms);
    if(jump>maxJump&&prevRms>-100) maxJump=jump;
    prevRms=db;
  }

  // Normalize to 0-1 risk
  return Math.min(1,maxJump/30);
}

// ── Spectral Continuity Check ─────────────────────────────────────────────────

function checkSpectralContinuity(
  monoOrig:   Float32Array,
  monoRep:    Float32Array,
  sampleRate: number
): number {
  // Compare RMS profiles
  const frameSize=Math.round(0.02*sampleRate);
  let totalDiff=0, count=0;

  for(let i=0;i+frameSize<=Math.min(monoOrig.length,monoRep.length);i+=frameSize){
    const rmsO=rmsDb(monoOrig.subarray(i,i+frameSize));
    const rmsR=rmsDb(monoRep.subarray(i,i+frameSize));
    if(rmsO>-90&&rmsR>-90){
      totalDiff+=Math.abs(rmsO-rmsR);
      count++;
    }
  }

  const avgDiff=count>0?totalDiff/count:0;
  return Math.max(0,1-avgDiff/20);
}

// ── Silence Realism Score ─────────────────────────────────────────────────────

function computeSilenceRealism(
  repairedForensics: ReturnType<typeof analyzeSilenceForensics>
): number {
  let score=1.0;

  // Penalize remaining contamination
  if(repairedForensics.contaminatedRegions.length>0){
    const avgPurity=repairedForensics.contaminatedRegions
      .reduce((s,r)=>s+r.purityScore,0)/repairedForensics.contaminatedRegions.length;
    score-=(1-avgPurity)*0.4;
  }

  // Penalize digital silence
  if(repairedForensics.hasDigitalSilence) score-=0.3;

  // Penalize repeated patterns
  if(repairedForensics.hasRepeatedPattern) score-=0.25;

  // Penalize seams
  if(repairedForensics.hasSeams) score-=0.20;

  // Penalize hum
  if(repairedForensics.hasHum) score-=0.15;

  return Math.max(0,Math.min(1,score));
}

// ── Speech Preservation Check ─────────────────────────────────────────────────

function checkSpeechPreservation(
  monoOrig: Float32Array,
  monoRep:  Float32Array,
  sampleRate: number
): number {
  // Compare high-energy (speech) regions
  const frameSize=Math.round(0.02*sampleRate);
  const speechThresh=-40;
  let totalSim=0, count=0;

  for(let i=0;i+frameSize<=Math.min(monoOrig.length,monoRep.length);i+=frameSize){
    const orig=monoOrig.subarray(i,i+frameSize);
    const rep =monoRep.subarray(i,i+frameSize);
    const rmsO=rmsDb(orig);

    if(rmsO>speechThresh){
      // Cosine similarity of speech frames
      let dot=0,magO=0,magR=0;
      for(let j=0;j<frameSize;j++){
        dot+=orig[j]*rep[j];
        magO+=orig[j]**2;
        magR+=rep[j]**2;
      }
      const sim=dot/(Math.sqrt(magO)*Math.sqrt(magR)+1e-10);
      totalSim+=Math.max(0,sim);
      count++;
    }
  }

  return count>0?Math.min(1,totalSim/count):1.0;
}

// ── Transient Preservation ────────────────────────────────────────────────────

function checkTransientPreservation(
  monoOrig: Float32Array,
  monoRep:  Float32Array,
  sampleRate: number
): number {
  const frameSize=Math.round(0.005*sampleRate);
  let preserved=0, total=0;

  let prevEnergyO=0, prevEnergyR=0;
  for(let i=0;i+frameSize<=Math.min(monoOrig.length,monoRep.length);i+=frameSize){
    let eO=0,eR=0;
    for(let j=0;j<frameSize;j++){
      eO+=monoOrig[i+j]**2;
      eR+=monoRep[i+j]**2;
    }
    eO/=frameSize; eR/=frameSize;

    // Detect transient in original
    if(prevEnergyO>0&&eO/prevEnergyO>4){
      total++;
      // Check if transient also present in repaired
      if(prevEnergyR>0&&eR/prevEnergyR>2) preserved++;
    }
    prevEnergyO=eO; prevEnergyR=eR;
  }

  return total>0?preserved/total:1.0;
}

// ── Hum Visibility Check ──────────────────────────────────────────────────────

function checkHumVisibility(
  repairedForensics: ReturnType<typeof analyzeSilenceForensics>
): number {
  if(!repairedForensics.hasHum) return 1.0;
  // Some hum remaining — score based on contaminated regions
  const humRegions=repairedForensics.contaminatedRegions.filter(
    r=>r.contaminationType==="hum_50hz"||r.contaminationType==="hum_60hz"
  );
  if(humRegions.length===0) return 1.0;
  return Math.max(0,1-humRegions.length*0.2);
}

// ── Room Tone Consistency ─────────────────────────────────────────────────────

function checkRoomToneConsistency(
  cleanRegions: ReturnType<typeof analyzeSilenceForensics>["cleanRegions"]
): number {
  if(cleanRegions.length<2) return 1.0;

  const rmsList=cleanRegions.map(r=>r.rmsDb);
  const mean=rmsList.reduce((s,v)=>s+v,0)/rmsList.length;
  const std=Math.sqrt(rmsList.reduce((s,v)=>s+(v-mean)**2,0)/rmsList.length);

  // Low std = consistent room tone
  return Math.max(0,1-std/15);
}

// ── Main QA Simulator ─────────────────────────────────────────────────────────

export function simulateAdobeQA(input: QAInput): AdobeQAResult {
  const monoOrig=toMono(input.original);
  const monoRep =toMono(input.repaired);
  const sr=input.repaired.sampleRate;

  // Run forensics on repaired
  const repairedForensics=analyzeSilenceForensics(input.repaired);

  // Compute scores
  const seamRisk          = checkSeamVisibility(monoRep, sr);
  const spectralMatchScore = checkSpectralContinuity(monoOrig, monoRep, sr);
  const silenceRealism    = computeSilenceRealism(repairedForensics);
  const speechPreservation = checkSpeechPreservation(monoOrig, monoRep, sr);
  const transientPreservation = checkTransientPreservation(monoOrig, monoRep, sr);
  const humVisibility     = checkHumVisibility(repairedForensics);
  const roomToneConsistency = checkRoomToneConsistency(repairedForensics.cleanRegions);

  // Weighted reviewer risk
  const reviewerRisk=
    (1-silenceRealism)    * 0.30 +
    seamRisk              * 0.25 +
    (1-speechPreservation)* 0.20 +
    (1-humVisibility)     * 0.15 +
    (1-roomToneConsistency)*0.10;

  const detectedProblems: string[]=[];

  if(silenceRealism<0.70)
    detectedProblems.push("Silence realism insufficient — may be detected as artificial");
  if(seamRisk>0.50)
    detectedProblems.push(`Visible seams detected (risk: ${(seamRisk*100).toFixed(0)}%)`);
  if(speechPreservation<0.90)
    detectedProblems.push("Speech may be altered — verify pronunciation");
  if(repairedForensics.hasDigitalSilence)
    detectedProblems.push("Digital silence still present — visible in spectrogram");
  if(repairedForensics.hasRepeatedPattern)
    detectedProblems.push("Repeated silence texture — may be visible in spectrogram");
  if(repairedForensics.hasHum)
    detectedProblems.push(`Hum still present at ${repairedForensics.humFrequencyHz}Hz`);
  if(repairedForensics.hasSeams)
    detectedProblems.push("Waveform seams visible in waveform view");
  if(roomToneConsistency<0.70)
    detectedProblems.push("Inconsistent room tone across silence regions");
  if(transientPreservation<0.80)
    detectedProblems.push("Transients may be affected — check consonants");

  // Recommendation
  const recommendation: QARecommendation =
    reviewerRisk<0.15&&detectedProblems.length===0 ? "PASS_VISUAL_QA" :
    reviewerRisk<0.35&&detectedProblems.length<=2  ? "NEEDS_REVIEW"   :
    reviewerRisk<0.60                               ? "REPAIR_AGAIN"   :
    "RE_RECORD_REQUIRED";

  const adobePassLikely=reviewerRisk<0.25&&speechPreservation>0.92;
  const confidence=Math.min(1,Math.abs(reviewerRisk-0.35)*4);

  return {
    adobePassLikely,
    reviewerRiskScore:        Math.min(1,reviewerRisk),
    silenceRealismScore:      silenceRealism,
    seamRiskScore:            seamRisk,
    spectralMatchScore,
    speechPreservationScore:  speechPreservation,
    transientPreservationScore: transientPreservation,
    detectedProblems,
    recommendation,
    confidence,
  };
}
