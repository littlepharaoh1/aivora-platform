/**
 * regionQa.ts — Region QA After Each Edit
 * Immediate quality check on edited region
 * Aivora Platform — Audition Workstation
 */

import { detectBoundaryClick, detectWaveformDiscontinuity } from "./sampleEditEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RegionQAStatus = "PASS" | "REVIEW" | "FAIL";

export interface RegionQAResult {
  status:                  RegionQAStatus;
  score:                   number;         // 0.0 – 1.0
  leftBoundaryRisk:        number;
  rightBoundaryRisk:       number;
  seamRisk:                number;
  spectralContinuityScore: number;
  silenceRealismScore:     number;
  speechPreservationScore: number;
  blockingReasons:         string[];
  warnings:                string[];
  suggestedFixes:          string[];
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function getMagnitude(samples: Float32Array, fftSize: number): Float32Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const len = Math.min(fftSize, samples.length);
  for(let i=0; i<len; i++)
    re[i] = samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(len-1)));

  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len2=2;len2<=n;len2<<=1){
    const ang=(-2*Math.PI)/len2,wRe=Math.cos(ang),wIm=Math.sin(ang);
    for(let i=0;i<n;i+=len2){
      let cRe=1,cIm=0;
      for(let j=0;j<len2>>1;j++){
        const uRe=re[i+j],uIm=im[i+j];
        const vRe=re[i+j+len2/2]*cRe-im[i+j+len2/2]*cIm;
        const vIm=re[i+j+len2/2]*cIm+im[i+j+len2/2]*cRe;
        re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;
        re[i+j+len2/2]=uRe-vRe;im[i+j+len2/2]=uIm-vIm;
        const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;
      }
    }
  }
  const mag=new Float32Array(fftSize/2);
  for(let i=0;i<fftSize/2;i++) mag[i]=Math.sqrt(re[i]**2+im[i]**2);
  return mag;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMono(buffer: AudioBuffer): Float32Array {
  const mono=new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1) for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;
  return mono;
}

function rmsDb(samples: Float32Array): number {
  let s=0;
  for(let i=0;i<samples.length;i++) s+=samples[i]**2;
  const rms=Math.sqrt(s/Math.max(1,samples.length));
  return rms>0?20*Math.log10(rms):-120;
}

// ── Spectral Continuity ───────────────────────────────────────────────────────

function checkSpectralContinuity(
  mono:        Float32Array,
  startSample: number,
  endSample:   number,
  sampleRate:  number
): number {
  const contextLen = Math.min(512, Math.floor((startSample)/2));
  if(contextLen < 64) return 0.8;

  const before = mono.subarray(Math.max(0,startSample-contextLen), startSample);
  const region = mono.subarray(startSample, Math.min(endSample, startSample+contextLen));
  const after  = mono.subarray(endSample, Math.min(mono.length, endSample+contextLen));

  if(before.length < 32 || region.length < 32) return 0.8;

  const magBefore = getMagnitude(new Float32Array(before), 512);
  const magRegion = getMagnitude(new Float32Array(region), 512);
  const magAfter  = after.length >= 32 ? getMagnitude(new Float32Array(after), 512) : magBefore;

  // Cosine similarity
  function cosSim(a: Float32Array, b: Float32Array): number {
    let dot=0,mA=0,mB=0;
    const len=Math.min(a.length,b.length);
    for(let i=0;i<len;i++){dot+=a[i]*b[i];mA+=a[i]**2;mB+=b[i]**2;}
    return mA>0&&mB>0?dot/(Math.sqrt(mA)*Math.sqrt(mB)):0;
  }

  const simBefore = cosSim(magBefore, magRegion);
  const simAfter  = cosSim(magAfter,  magRegion);
  return Math.max(0, Math.min(1, (simBefore+simAfter)/2));
}

// ── Digital Silence Check ─────────────────────────────────────────────────────

function checkDigitalSilence(samples: Float32Array): boolean {
  return samples.every(s=>s===0) || rmsDb(samples) < -110;
}

// ── Repeated Pattern Check ────────────────────────────────────────────────────

function checkRepeatedPattern(samples: Float32Array): boolean {
  if(samples.length < 256) return false;
  const halfLen = Math.floor(samples.length/2);
  const first   = samples.subarray(0,halfLen);
  const second  = samples.subarray(halfLen,halfLen*2);
  let dot=0,mA=0,mB=0;
  for(let i=0;i<halfLen;i++){
    dot+=first[i]*second[i];
    mA+=first[i]**2;
    mB+=second[i]**2;
  }
  const sim = mA>0&&mB>0?dot/(Math.sqrt(mA)*Math.sqrt(mB)):0;
  return sim > 0.95;
}

// ── Silence Realism ───────────────────────────────────────────────────────────

function checkSilenceRealism(
  samples:    Float32Array,
  sampleRate: number
): number {
  if(samples.length < 32) return 0.5;

  const db = rmsDb(samples);
  if(db < -110) return 0.1; // Digital silence
  if(db > -40)  return 0.1; // Too loud for silence

  // Spectral flatness
  const mag = getMagnitude(samples, Math.min(512, samples.length));
  let logSum=0,linSum=0;
  for(let i=1;i<mag.length;i++){logSum+=Math.log(mag[i]+1e-10);linSum+=mag[i];}
  const flatness = Math.exp(logSum/mag.length)/(linSum/mag.length+1e-10);

  // Check hum
  const binHz = sampleRate/512;
  const avg   = mag.reduce((s,v)=>s+v,0)/mag.length;
  const hum50 = mag[Math.round(50/binHz)]||0;
  const hum60 = mag[Math.round(60/binHz)]||0;
  const hasHum = hum50>avg*5 || hum60>avg*5;

  let score = 1.0;
  if(db > -80)   score -= Math.min(0.3,(db+80)/40*0.3);
  if(flatness>0.5) score -= 0.2;
  if(hasHum)     score -= 0.25;
  if(checkRepeatedPattern(samples)) score -= 0.25;

  return Math.max(0,Math.min(1,score));
}

// ── RMS Context Match ─────────────────────────────────────────────────────────

function checkRmsMatch(
  mono:        Float32Array,
  startSample: number,
  endSample:   number
): number {
  const contextLen = 256;
  const before = mono.subarray(Math.max(0,startSample-contextLen), startSample);
  const region = mono.subarray(startSample,endSample);
  const after  = mono.subarray(endSample, Math.min(mono.length,endSample+contextLen));

  if(before.length<16||region.length<16) return 0.8;

  const rmsBefore = rmsDb(new Float32Array(before));
  const rmsRegion = rmsDb(region);
  const rmsAfter  = after.length>=16 ? rmsDb(new Float32Array(after)) : rmsBefore;

  const contextAvg = (rmsBefore+rmsAfter)/2;
  if(contextAvg < -100) return 0.9;

  const diff = Math.abs(rmsRegion-contextAvg);
  return Math.max(0, 1-diff/20);
}

// ── Speech Preservation ───────────────────────────────────────────────────────

function checkSpeechPreservation(
  original:    AudioBuffer,
  repaired:    AudioBuffer,
  startSample: number,
  endSample:   number
): number {
  if(!original||!repaired) return 1.0;

  const origMono = toMono(original);
  const repMono  = toMono(repaired);
  const sr       = original.sampleRate;

  // Only check speech regions OUTSIDE the edited area
  const frameSize = Math.round(0.02*sr);
  let totalSim=0, count=0;
  const speechThresh = -35;

  for(let i=0; i+frameSize<=Math.min(origMono.length,repMono.length); i+=frameSize){
    // Skip the edited region
    if(i+frameSize > startSample && i < endSample) continue;

    const origFrame = origMono.subarray(i,i+frameSize);
    const repFrame  = repMono.subarray(i,i+frameSize);
    const rms       = rmsDb(origFrame);
    if(rms > speechThresh){
      let dot=0,mA=0,mB=0;
      for(let j=0;j<frameSize;j++){
        dot+=origFrame[j]*repFrame[j];
        mA+=origFrame[j]**2; mB+=repFrame[j]**2;
      }
      const sim=mA>0&&mB>0?dot/(Math.sqrt(mA)*Math.sqrt(mB)):1;
      totalSim+=Math.max(0,sim);
      count++;
    }
  }
  return count>0?totalSim/count:1.0;
}

// ── Main Region QA ────────────────────────────────────────────────────────────

export function runRegionQA(
  repaired:    AudioBuffer,
  startSample: number,
  endSample:   number,
  original?:   AudioBuffer
): RegionQAResult {
  const sr      = repaired.sampleRate;
  const mono    = toMono(repaired);
  const region  = mono.subarray(startSample, endSample);
  const blocking: string[] = [];
  const warnings: string[] = [];
  const fixes:    string[] = [];

  // 1. Boundary clicks
  const leftClick  = detectBoundaryClick(mono, startSample);
  const rightClick = detectBoundaryClick(mono, endSample);
  const leftRisk   = leftClick  ? 0.8 : detectWaveformDiscontinuity(mono, startSample).risk;
  const rightRisk  = rightClick ? 0.8 : detectWaveformDiscontinuity(mono, endSample).risk;

  if(leftClick)  { blocking.push("Click at left boundary");  fixes.push("Increase crossfade at start"); }
  if(rightClick) { blocking.push("Click at right boundary"); fixes.push("Increase crossfade at end"); }

  // 2. Seam risk
  const seamRisk = Math.max(leftRisk,rightRisk);
  if(seamRisk>0.6) { warnings.push(`High seam risk: ${(seamRisk*100).toFixed(0)}%`); fixes.push("Increase crossfade duration"); }

  // 3. Digital silence
  const isDigital = checkDigitalSilence(region);
  if(isDigital) { blocking.push("Digital flat silence detected"); fixes.push("Use reference grain synthesis"); }

  // 4. Repeated pattern
  const isRepeated = checkRepeatedPattern(region);
  if(isRepeated) { warnings.push("Repeated texture pattern — may be visible in spectrogram"); fixes.push("Rebuild grain library from longer reference"); }

  // 5. Spectral continuity
  const spectralScore = checkSpectralContinuity(mono, startSample, endSample, sr);
  if(spectralScore<0.60) { warnings.push(`Low spectral continuity: ${(spectralScore*100).toFixed(0)}%`); fixes.push("Use blend mode instead of replace"); }

  // 6. Silence realism
  const realismScore = checkSilenceRealism(region, sr);
  if(realismScore<0.50) { blocking.push(`Silence realism too low: ${(realismScore*100).toFixed(0)}%`); fixes.push("Choose a cleaner reference silence"); }
  else if(realismScore<0.75) { warnings.push(`Silence realism marginal: ${(realismScore*100).toFixed(0)}%`); }

  // 7. RMS context match
  const rmsMatch = checkRmsMatch(mono, startSample, endSample);
  if(rmsMatch<0.60) { warnings.push("RMS mismatch with surrounding context"); fixes.push("Enable RMS matching option"); }

  // 8. Speech preservation
  let speechScore = 1.0;
  if(original){
    speechScore = checkSpeechPreservation(original, repaired, startSample, endSample);
    if(speechScore<0.90) { blocking.push(`Speech modified outside edit region: ${(speechScore*100).toFixed(0)}%`); fixes.push("Use smaller region selection"); }
  }

  // 9. Hum check
  const mag = region.length>=512 ? getMagnitude(region, 512) : null;
  if(mag){
    const binHz = sr/512;
    const avg   = mag.reduce((s,v)=>s+v,0)/mag.length;
    const hum50 = mag[Math.round(50/binHz)]||0;
    const hum60 = mag[Math.round(60/binHz)]||0;
    if(hum50>avg*5||hum60>avg*5){
      warnings.push(`Hum detected in repaired region (${hum50>hum60?"50":"60"}Hz)`);
      fixes.push("Apply hum removal before silence repair");
    }
  }

  // Overall score
  let score = 1.0;
  score -= blocking.length  * 0.20;
  score -= warnings.length  * 0.08;
  score -= seamRisk         * 0.15;
  score -= (1-spectralScore)* 0.10;
  score -= (1-realismScore) * 0.15;
  score -= (1-rmsMatch)     * 0.10;
  score -= (1-speechScore)  * 0.20;
  score  = Math.max(0, Math.min(1, score));

  const status: RegionQAStatus =
    blocking.length>0 ? "FAIL" :
    score>=0.80       ? "PASS" : "REVIEW";

  return {
    status, score,
    leftBoundaryRisk:        leftRisk,
    rightBoundaryRisk:       rightRisk,
    seamRisk,
    spectralContinuityScore: spectralScore,
    silenceRealismScore:     realismScore,
    speechPreservationScore: speechScore,
    blockingReasons:         blocking,
    warnings,
    suggestedFixes:          [...new Set(fixes)],
  };
}
