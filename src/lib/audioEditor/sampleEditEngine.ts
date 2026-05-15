/**
 * sampleEditEngine.ts — Sample-Accurate Non-Destructive Edit Engine
 * Aivora Platform — Audition Workstation
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditOptions {
  crossfadeMs?:    number;   // Default 8ms
  snapZeroCross?:  boolean;  // Default true
  preserveDuration?: boolean; // Default true
}

export interface EditManifest {
  operation:       string;
  startSample:     number;
  endSample:       number;
  durationSamples: number;
  crossfadeMs:     number;
  timestamp:       string;
  warnings:        string[];
}

export interface EditResult {
  buffer:       AudioBuffer;
  editManifest: EditManifest;
  warnings:     string[];
  speechTouched: boolean;
  seamRisk:     number;
}

// ── Zero Crossing ─────────────────────────────────────────────────────────────

export function findZeroCrossing(
  samples:    Float32Array,
  position:   number,
  searchMs:   number,
  sampleRate: number,
  direction:  "nearest"|"forward"|"backward" = "nearest"
): number {
  const searchSamples=Math.round(searchMs/1000*sampleRate);
  const start=Math.max(0,position-searchSamples);
  const end  =Math.min(samples.length-2,position+searchSamples);

  if(direction==="forward"){
    for(let i=position;i<end;i++)
      if(samples[i]*samples[i+1]<=0) return i;
    return position;
  }

  if(direction==="backward"){
    for(let i=position;i>start;i--)
      if(samples[i]*samples[i-1]<=0) return i;
    return position;
  }

  // Nearest
  let bestPos=position, bestDist=Infinity;
  for(let i=start;i<end;i++){
    if(samples[i]*samples[i+1]<=0){
      const dist=Math.abs(i-position);
      if(dist<bestDist){bestDist=dist;bestPos=i;}
    }
  }
  return bestPos;
}

// ── Boundary Click Detector ───────────────────────────────────────────────────

export function detectBoundaryClick(
  samples:    Float32Array,
  sampleIdx:  number,
  windowSize  = 16
): boolean {
  const start=Math.max(0,sampleIdx-windowSize);
  const end  =Math.min(samples.length-1,sampleIdx+windowSize);
  let maxDiff=0;
  for(let i=start;i<end-1;i++){
    const diff=Math.abs(samples[i+1]-samples[i]);
    if(diff>maxDiff) maxDiff=diff;
  }
  return maxDiff>0.05;
}

// ── Waveform Discontinuity ────────────────────────────────────────────────────

export function detectWaveformDiscontinuity(
  samples:    Float32Array,
  sampleIdx:  number,
  windowSize  = 64
): { risk:number; hasJump:boolean } {
  const before=samples.subarray(Math.max(0,sampleIdx-windowSize),sampleIdx);
  const after =samples.subarray(sampleIdx,Math.min(samples.length,sampleIdx+windowSize));

  let rmsBefore=0,rmsAfter=0;
  for(let i=0;i<before.length;i++) rmsBefore+=before[i]**2;
  for(let i=0;i<after.length;i++)  rmsAfter +=after[i]**2;
  rmsBefore=Math.sqrt(rmsBefore/Math.max(1,before.length));
  rmsAfter =Math.sqrt(rmsAfter/Math.max(1,after.length));

  const energyJump=rmsBefore>0&&rmsAfter>0
    ? Math.abs(20*Math.log10(rmsAfter/rmsBefore)) : 0;

  // Phase continuity
  const lastBefore=before.length>0?before[before.length-1]:0;
  const firstAfter=after.length>0?after[0]:0;
  const phaseDiff =Math.abs(firstAfter-lastBefore);

  const risk=Math.min(1,energyJump/30+phaseDiff*2);
  return {risk,hasJump:risk>0.4};
}

// ── Hann Crossfade ────────────────────────────────────────────────────────────

function applyHannCrossfade(
  dest:      Float32Array,
  src:       Float32Array,
  startPos:  number,
  fadeLen:   number
): void {
  for(let i=0;i<fadeLen&&startPos+i<dest.length&&i<src.length;i++){
    const t=i/fadeLen;
    const fadeIn =0.5*(1-Math.cos(Math.PI*t));
    const fadeOut=1-fadeIn;
    dest[startPos+i]=dest[startPos+i]*fadeOut+src[i]*fadeIn;
  }
}

function applyFadeOut(dest:Float32Array,startPos:number,fadeLen:number):void{
  for(let i=0;i<fadeLen&&startPos+i<dest.length;i++){
    const t=i/fadeLen;
    dest[startPos+i]*=0.5*(1+Math.cos(Math.PI*t));
  }
}

function applyFadeIn(dest:Float32Array,startPos:number,fadeLen:number):void{
  for(let i=0;i<fadeLen&&startPos+i<dest.length;i++){
    const t=i/fadeLen;
    dest[startPos+i]*=0.5*(1-Math.cos(Math.PI*t));
  }
}

// ── Clone Buffer ──────────────────────────────────────────────────────────────

function cloneBuffer(buffer:AudioBuffer):AudioBuffer{
  const ctx=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
  const out=ctx.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
  for(let ch=0;ch<buffer.numberOfChannels;ch++)
    out.getChannelData(ch).set(buffer.getChannelData(ch));
  return out;
}

// ── Copy Region ───────────────────────────────────────────────────────────────

export function copyRegion(
  buffer:      AudioBuffer,
  startSample: number,
  endSample:   number
): AudioBuffer {
  const sr    =buffer.sampleRate;
  const len   =endSample-startSample;
  const ctx   =new OfflineAudioContext(buffer.numberOfChannels,len,sr);
  const out   =ctx.createBuffer(buffer.numberOfChannels,len,sr);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const src=buffer.getChannelData(ch);
    const dst=out.getChannelData(ch);
    for(let i=0;i<len;i++) dst[i]=src[startSample+i]??0;
  }
  return out;
}

// ── Replace Region ────────────────────────────────────────────────────────────

export function replaceRegion(
  buffer:      AudioBuffer,
  startSample: number,
  endSample:   number,
  replacement: AudioBuffer,
  options:     EditOptions = {}
): EditResult {
  const sr          =buffer.sampleRate;
  const crossfadeMs =options.crossfadeMs??8;
  const snapZC      =options.snapZeroCross??true;
  const fadeLen     =Math.round(crossfadeMs/1000*sr);
  const warnings:   string[]=[];

  // Clone
  const out=cloneBuffer(buffer);

  // Get mono for zero crossing detection
  const mono=new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1) for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  // Snap to zero crossings
  let s=startSample, e=endSample;
  if(snapZC){
    s=findZeroCrossing(mono,startSample,5,sr,"nearest");
    e=findZeroCrossing(mono,endSample,  5,sr,"nearest");
  }

  const targetLen=e-s;

  // Speech check — detect if high energy in region
  let speechTouched=false;
  let frameE=0;
  for(let i=s;i<e;i++) frameE+=mono[i]**2;
  frameE/=Math.max(1,targetLen);
  const allE:number[]=[];
  const fs=Math.round(0.02*sr);
  for(let i=0;i+fs<=mono.length;i+=fs){
    let e2=0;
    for(let j=0;j<fs;j++) e2+=mono[i+j]**2;
    allE.push(e2/fs);
  }
  allE.sort((a,b)=>a-b);
  const cut=Math.max(1,Math.floor(allE.length*0.1));
  const noiseFloor=allE.slice(0,cut).reduce((sv,v)=>sv+v,0)/cut;
  if(frameE>noiseFloor*20){
    speechTouched=true;
    warnings.push("Selection overlaps high-energy region — possible speech");
  }

  // Apply replacement per channel
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const dst=out.getChannelData(ch);
    const rep=replacement.getChannelData(Math.min(ch,replacement.numberOfChannels-1));

    // Fade out original at start boundary
    applyFadeOut(dst,Math.max(0,s-fadeLen),fadeLen);

    // Write replacement
    for(let i=0;i<targetLen&&s+i<dst.length;i++){
      let gain=1.0;
      if(i<fadeLen)            gain=0.5*(1-Math.cos(Math.PI*i/fadeLen));
      if(i>targetLen-fadeLen)  gain=0.5*(1-Math.cos(Math.PI*(targetLen-i)/fadeLen));
      const repSample=i<rep.length?rep[i]:0;
      dst[s+i]=repSample*gain;
    }

    // Fade in original at end boundary
    applyFadeIn(dst,e,fadeLen);
  }

  // Seam risk
  const discStart=detectWaveformDiscontinuity(out.getChannelData(0),s);
  const discEnd  =detectWaveformDiscontinuity(out.getChannelData(0),e);
  const seamRisk =Math.max(discStart.risk,discEnd.risk);

  if(seamRisk>0.5) warnings.push(`Seam risk elevated: ${(seamRisk*100).toFixed(0)}%`);

  return {
    buffer: out,
    editManifest:{
      operation:"replaceRegion",
      startSample:s, endSample:e,
      durationSamples:targetLen,
      crossfadeMs, timestamp:new Date().toISOString(),
      warnings,
    },
    warnings, speechTouched, seamRisk,
  };
}

// ── Apply Crossfade ───────────────────────────────────────────────────────────

export function applyCrossfade(
  buffer:      AudioBuffer,
  startSample: number,
  endSample:   number,
  fadeMs:      number
): EditResult {
  const sr     =buffer.sampleRate;
  const fadeLen=Math.round(fadeMs/1000*sr);
  const out    =cloneBuffer(buffer);
  const warnings:string[]=[];

  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const dst=out.getChannelData(ch);
    applyFadeOut(dst,startSample,fadeLen);
    applyFadeIn(dst,endSample-fadeLen,fadeLen);
  }

  return {
    buffer:out,
    editManifest:{
      operation:"applyCrossfade",
      startSample,endSample,
      durationSamples:endSample-startSample,
      crossfadeMs:fadeMs,timestamp:new Date().toISOString(),
      warnings,
    },
    warnings,speechTouched:false,seamRisk:0.1,
  };
}
