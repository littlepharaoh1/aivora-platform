/**
 * speechPreservation.ts — Speech Preservation Verification
 * Verifies repair did not damage speech regions
 * Aivora Platform — Adobe-Grade Silence Repair System
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpeechPreservationResult {
  speechPreserved:    boolean;
  score:              number;      // 0.0 – 1.0
  grade:              "PASS"|"REVIEW"|"FAIL";
  rmsDeltaDb:         number;
  peakDeltaDb:        number;
  correlationScore:   number;
  transientRisk:      number;
  timingShiftMs:      number;
  modifiedSpeechRisk: number;     // 0.0 – 1.0
  warnings:           string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function rmsDb(samples: Float32Array): number {
  let sum=0;
  for(let i=0;i<samples.length;i++) sum+=samples[i]**2;
  const rms=Math.sqrt(sum/Math.max(1,samples.length));
  return rms>0?20*Math.log10(rms):-120;
}

function peakDb(samples: Float32Array): number {
  let peak=0;
  for(let i=0;i<samples.length;i++){
    const a=Math.abs(samples[i]);
    if(a>peak) peak=a;
  }
  return peak>0?20*Math.log10(peak):-120;
}

// ── Speech Region Extractor ───────────────────────────────────────────────────

function extractSpeechRegions(
  mono:       Float32Array,
  sampleRate: number
): {start:number;end:number}[] {
  const frameSize=Math.round(0.02*sampleRate);
  const hopSize  =Math.round(0.01*sampleRate);
  const regions: {start:number;end:number}[]=[];

  // Estimate noise floor
  const energies: number[]=[];
  for(let i=0;i+frameSize<=mono.length;i+=hopSize){
    let e=0;
    for(let j=0;j<frameSize;j++) e+=mono[i+j]**2;
    energies.push(e/frameSize);
  }
  const sorted=[...energies].sort((a,b)=>a-b);
  const cut=Math.max(1,Math.floor(sorted.length*0.1));
  const noiseFloor=sorted.slice(0,cut).reduce((s,v)=>s+v,0)/cut;
  const thresh=noiseFloor*8;   // Speech = 8x noise floor

  let inSpeech=false, speechStart=0;
  for(let i=0;i+frameSize<=mono.length;i+=hopSize){
    let e=0;
    for(let j=0;j<frameSize;j++) e+=mono[i+j]**2;
    e/=frameSize;

    if(e>thresh){
      if(!inSpeech){inSpeech=true;speechStart=i;}
    } else {
      if(inSpeech){
        const durMs=(i-speechStart)/sampleRate*1000;
        if(durMs>50) regions.push({start:speechStart,end:i});
        inSpeech=false;
      }
    }
  }
  if(inSpeech&&mono.length-speechStart>frameSize)
    regions.push({start:speechStart,end:mono.length});

  return regions;
}

// ── Correlation ───────────────────────────────────────────────────────────────

function correlate(a: Float32Array, b: Float32Array): number {
  const len=Math.min(a.length,b.length,8192);
  let dot=0,magA=0,magB=0;
  for(let i=0;i<len;i++){
    dot+=a[i]*b[i];
    magA+=a[i]**2;
    magB+=b[i]**2;
  }
  const denom=Math.sqrt(magA)*Math.sqrt(magB);
  return denom>0?Math.max(-1,Math.min(1,dot/denom)):0;
}

// ── Transient Risk ────────────────────────────────────────────────────────────

function computeTransientRisk(
  origMono: Float32Array,
  repMono:  Float32Array,
  sampleRate: number,
  speechRegions: {start:number;end:number}[]
): number {
  if(speechRegions.length===0) return 0;
  const frameSize=Math.round(0.005*sampleRate);
  let risk=0, count=0;

  for(const reg of speechRegions){
    let prevEO=0,prevER=0;
    for(let i=reg.start;i+frameSize<=reg.end;i+=frameSize){
      let eO=0,eR=0;
      for(let j=0;j<frameSize;j++){
        if(i+j<origMono.length) eO+=origMono[i+j]**2;
        if(i+j<repMono.length)  eR+=repMono[i+j]**2;
      }
      eO/=frameSize; eR/=frameSize;
      // Transient in original
      if(prevEO>0&&eO/prevEO>4){
        count++;
        // Check preserved in repaired
        if(prevER>0&&eR/prevER<2) risk++;
      }
      prevEO=eO; prevER=eR;
    }
  }
  return count>0?risk/count:0;
}

// ── Timing Shift ──────────────────────────────────────────────────────────────

function estimateTimingShift(
  origMono: Float32Array,
  repMono:  Float32Array,
  sampleRate: number
): number {
  // Cross-correlate first 1 second
  const len=Math.min(sampleRate,origMono.length,repMono.length);
  const maxLag=Math.round(0.010*sampleRate); // 10ms max

  let bestLag=0, bestCorr=-Infinity;
  for(let lag=-maxLag;lag<=maxLag;lag++){
    let corr=0;
    for(let i=0;i<len;i++){
      const j=i+lag;
      if(j>=0&&j<repMono.length) corr+=origMono[i]*repMono[j];
    }
    if(corr>bestCorr){bestCorr=corr;bestLag=lag;}
  }
  return (bestLag/sampleRate)*1000; // ms
}

// ── Modified Speech Risk ──────────────────────────────────────────────────────

function computeModifiedSpeechRisk(
  origMono:     Float32Array,
  repMono:      Float32Array,
  speechRegions:{start:number;end:number}[]
): number {
  if(speechRegions.length===0) return 0;
  let totalRisk=0;

  for(const reg of speechRegions){
    const len=Math.min(reg.end-reg.start, origMono.length-reg.start, repMono.length-reg.start);
    if(len<=0) continue;
    const origSeg=origMono.subarray(reg.start,reg.start+len);
    const repSeg =repMono.subarray(reg.start,reg.start+len);

    // Sample-level difference
    let maxDiff=0;
    for(let i=0;i<len;i++){
      const diff=Math.abs(origSeg[i]-repSeg[i]);
      if(diff>maxDiff) maxDiff=diff;
    }
    // Risk based on max sample difference (>0.001 = modified)
    totalRisk+=Math.min(1,maxDiff*100);
  }

  return speechRegions.length>0?totalRisk/speechRegions.length:0;
}

// ── Main Verification ─────────────────────────────────────────────────────────

export function verifySpeechPreservation(
  original: AudioBuffer,
  repaired: AudioBuffer
): SpeechPreservationResult {
  const warnings:string[]=[];
  const sr=original.sampleRate;

  if(original.length!==repaired.length){
    warnings.push(`Duration mismatch: ${original.length} vs ${repaired.length} samples`);
  }

  const origMono=toMono(original);
  const repMono =toMono(repaired);

  // Extract speech regions from original
  const speechRegions=extractSpeechRegions(origMono,sr);

  if(speechRegions.length===0){
    return {
      speechPreserved:true,score:1.0,grade:"PASS",
      rmsDeltaDb:0,peakDeltaDb:0,correlationScore:1.0,
      transientRisk:0,timingShiftMs:0,modifiedSpeechRisk:0,
      warnings:["No speech regions detected — silence only file"],
    };
  }

  // Compare speech regions only
  const origSpeechSamples: number[]=[];
  const repSpeechSamples:  number[]=[];

  for(const reg of speechRegions){
    const len=Math.min(reg.end-reg.start,origMono.length-reg.start,repMono.length-reg.start);
    if(len<=0) continue;
    for(let i=0;i<len;i++){
      origSpeechSamples.push(origMono[reg.start+i]);
      repSpeechSamples.push(repMono[reg.start+i]);
    }
  }

  const origSpeech=new Float32Array(origSpeechSamples);
  const repSpeech =new Float32Array(repSpeechSamples);

  const rmsOrig=rmsDb(origSpeech);
  const rmsRep =rmsDb(repSpeech);
  const rmsDelta=Math.abs(rmsOrig-rmsRep);

  const peakOrig=peakDb(origSpeech);
  const peakRep =peakDb(repSpeech);
  const peakDelta=Math.abs(peakOrig-peakRep);

  const correlation=correlate(origSpeech,repSpeech);
  const transientRisk=computeTransientRisk(origMono,repMono,sr,speechRegions);
  const timingShift=estimateTimingShift(origMono,repMono,sr);
  const modifiedRisk=computeModifiedSpeechRisk(origMono,repMono,speechRegions);

  // Scoring
  let score=1.0;
  score-=Math.min(0.15,rmsDelta/20*0.15);
  score-=Math.min(0.10,peakDelta/20*0.10);
  score-=Math.min(0.30,(1-Math.max(0,correlation))*0.30);
  score-=Math.min(0.20,transientRisk*0.20);
  score-=Math.min(0.15,Math.abs(timingShift)/10*0.15);
  score-=Math.min(0.20,modifiedRisk*0.20);
  score=Math.max(0,Math.min(1,score));

  // Warnings
  if(rmsDelta>3)   warnings.push(`Speech RMS changed by ${rmsDelta.toFixed(1)} dB`);
  if(peakDelta>3)  warnings.push(`Speech peak changed by ${peakDelta.toFixed(1)} dB`);
  if(correlation<0.97) warnings.push(`Low speech correlation: ${(correlation*100).toFixed(1)}%`);
  if(transientRisk>0.1) warnings.push(`Transient preservation risk: ${(transientRisk*100).toFixed(0)}%`);
  if(Math.abs(timingShift)>5) warnings.push(`Timing shift detected: ${timingShift.toFixed(1)}ms`);
  if(modifiedRisk>0.1) warnings.push(`Speech samples may have been modified`);

  const grade: SpeechPreservationResult["grade"] =
    score>=0.97 ? "PASS" :
    score>=0.93 ? "REVIEW" : "FAIL";

  const speechPreserved=grade==="PASS"&&modifiedRisk<0.05;

  return {
    speechPreserved,score,grade,
    rmsDeltaDb:    rmsDelta,
    peakDeltaDb:   peakDelta,
    correlationScore: Math.max(0,correlation),
    transientRisk,
    timingShiftMs: timingShift,
    modifiedSpeechRisk: modifiedRisk,
    warnings,
  };
}
