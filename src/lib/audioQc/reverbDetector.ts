/**
 * reverbDetector.ts — Advanced RT60 & Reverb Analysis
 * Multi-band RT60 + Stable C50/DRR + Room Classification
 * Aivora Platform — Phase 8
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoomType =
  | "anechoic"
  | "studio"
  | "office"
  | "room"
  | "hall"
  | "bathroom"
  | "outdoor";

export interface BandRT60 {
  bandHz:   string;
  lowHz:    number;
  highHz:   number;
  rt60Ms:   number;
  valid:    boolean;
}

export interface ReverbResult {
  rt60Ms:          number;        // Broadband RT60
  rt60Bands:       BandRT60[];    // Per-band RT60
  environment:     RoomType;
  drr:             number;        // Direct-to-Reverberant Ratio (dB)
  clarity:         number;        // C50 (dB)
  definition:      number;        // D50 (0-1)
  roomConfidence:  number;        // 0-1
  problems:        string[];
  isReliable:      boolean;       // RT60 estimate reliability
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function fftPower(
  samples:    Float32Array,
  fftSize:    number,
  lowBin:     number,
  highBin:    number
): Float32Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const len = Math.min(fftSize, samples.length);

  for(let i=0;i<len;i++)
    re[i]=samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(len-1)));

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

  const power = new Float32Array(Math.max(0, highBin-lowBin));
  for(let i=lowBin;i<highBin&&i<fftSize/2;i++)
    power[i-lowBin] = re[i]**2+im[i]**2;
  return power;
}

// ── Energy Decay Curve (Schroeder) ────────────────────────────────────────────

function computeEDC(signal: Float32Array): Float32Array {
  let totalE = 0;
  for(let i=0;i<signal.length;i++) totalE+=signal[i]**2;
  if(totalE<1e-10) return new Float32Array(signal.length).fill(-120);

  const edc = new Float32Array(signal.length);
  let cumE  = 0;
  for(let i=0;i<signal.length;i++){
    cumE += signal[i]**2;
    const remaining = totalE-cumE;
    edc[i] = remaining>0 ? 10*Math.log10(remaining/totalE) : -120;
  }
  return edc;
}

// ── Smooth EDC ────────────────────────────────────────────────────────────────

function smoothEDC(edc: Float32Array, windowSize: number): Float32Array {
  const smoothed = new Float32Array(edc.length);
  const half     = Math.floor(windowSize/2);
  for(let i=0;i<edc.length;i++){
    let sum=0, count=0;
    for(let j=Math.max(0,i-half);j<=Math.min(edc.length-1,i+half);j++){
      sum+=edc[j]; count++;
    }
    smoothed[i] = count>0 ? sum/count : edc[i];
  }
  return smoothed;
}

// ── RT60 from EDC ─────────────────────────────────────────────────────────────

function estimateRT60FromEDC(
  edc:        Float32Array,
  sampleRate: number
): { rt60Ms: number; valid: boolean; r2: number } {
  // Find -5dB and -35dB points (T30 method)
  let t5=-1, t35=-1;
  for(let i=0;i<edc.length;i++){
    if(t5  <0 && edc[i]<=-5)  t5  = i/sampleRate;
    if(t35 <0 && edc[i]<=-35) t35 = i/sampleRate;
    if(t5>=0 && t35>=0) break;
  }

  if(t5<0 || t35<0 || t35<=t5)
    return { rt60Ms:0, valid:false, r2:0 };

  // T30 → RT60 extrapolation
  const rt60Ms = (t35-t5)*2*1000;

  // Linearity check (R²) — good RT60 should be linear in dB
  const startIdx = Math.round(t5*sampleRate);
  const endIdx   = Math.round(t35*sampleRate);
  const rangeLen = endIdx-startIdx;
  if(rangeLen<5) return { rt60Ms, valid:false, r2:0 };

  let sumX=0,sumY=0,sumXY=0,sumX2=0;
  const n=rangeLen;
  for(let i=0;i<n;i++){
    const x=i, y=edc[startIdx+i];
    sumX+=x; sumY+=y; sumXY+=x*y; sumX2+=x*x;
  }
  const slope  = (n*sumXY-sumX*sumY)/(n*sumX2-sumX**2+1e-10);
  const intcpt = (sumY-slope*sumX)/n;
  let   ssRes  = 0, ssTot = 0;
  const meanY  = sumY/n;
  for(let i=0;i<n;i++){
    const y=edc[startIdx+i], pred=slope*i+intcpt;
    ssRes+=(y-pred)**2; ssTot+=(y-meanY)**2;
  }
  const r2 = ssTot>0 ? 1-ssRes/ssTot : 0;

  return {
    rt60Ms: Math.max(0, Math.min(5000, rt60Ms)),
    valid:  r2>0.85 && rt60Ms>10,
    r2,
  };
}

// ── Band-filtered Signal ──────────────────────────────────────────────────────

function bandpassFilter(
  mono:       Float32Array,
  sampleRate: number,
  lowHz:      number,
  highHz:     number
): Float32Array {
  // Simple IIR bandpass using two first-order filters
  const nyq    = sampleRate/2;
  const lowNorm  = Math.min(lowHz/nyq, 0.99);
  const highNorm = Math.min(highHz/nyq, 0.99);

  // High-pass (RC filter)
  const rcHP = 1/(2*Math.PI*lowHz/sampleRate + 1);
  const hpOut = new Float32Array(mono.length);
  let prevIn=0, prevOut=0;
  for(let i=0;i<mono.length;i++){
    hpOut[i]  = rcHP*(prevOut+mono[i]-prevIn);
    prevIn    = mono[i]; prevOut = hpOut[i];
  }

  // Low-pass (RC filter)
  const rcLP  = 2*Math.PI*highHz/sampleRate;
  const alpha = rcLP/(rcLP+1);
  const lpOut = new Float32Array(mono.length);
  lpOut[0]    = hpOut[0];
  for(let i=1;i<mono.length;i++)
    lpOut[i] = alpha*hpOut[i]+(1-alpha)*lpOut[i-1];

  return lpOut;
}

// ── C50 & DRR ─────────────────────────────────────────────────────────────────

function computeC50(mono: Float32Array, sampleRate: number): number {
  const cut50ms = Math.round(0.05*sampleRate);
  let early=0, late=0;
  for(let i=0;i<Math.min(cut50ms,mono.length);i++) early+=mono[i]**2;
  for(let i=cut50ms;i<mono.length;i++) late+=mono[i]**2;
  if(late<1e-10) return 40;
  const c50 = 10*Math.log10(early/(late+1e-10));
  return Math.max(-40, Math.min(40, c50));
}

function computeD50(mono: Float32Array, sampleRate: number): number {
  const cut50ms = Math.round(0.05*sampleRate);
  let early=0, total=0;
  for(let i=0;i<mono.length;i++){
    const e=mono[i]**2;
    total+=e;
    if(i<cut50ms) early+=e;
  }
  return total>0 ? Math.min(1, early/total) : 0;
}

function computeDRR(mono: Float32Array, sampleRate: number): number {
  const cut2ms = Math.round(0.0025*sampleRate);
  let direct=0, reverb=0;
  for(let i=0;i<Math.min(cut2ms,mono.length);i++) direct+=mono[i]**2;
  for(let i=cut2ms;i<mono.length;i++) reverb+=mono[i]**2;
  if(reverb<1e-10) return 40;
  const drr = 10*Math.log10(direct/(reverb+1e-10));
  return Math.max(-40, Math.min(40, drr));
}

// ── Room Classifier ───────────────────────────────────────────────────────────

function classifyRoom(
  rt60Ms:  number,
  c50:     number,
  drr:     number,
  bands:   BandRT60[]
): { type: RoomType; confidence: number } {
  let scores: Record<RoomType, number> = {
    anechoic: 0, studio: 0, office: 0,
    room: 0, hall: 0, bathroom: 0, outdoor: 0,
  };

  // RT60-based scoring
  if(rt60Ms < 30)  scores.anechoic += 4;
  if(rt60Ms < 100) scores.studio   += 3;
  if(rt60Ms < 150) scores.studio   += 2;
  if(rt60Ms < 300) scores.office   += 3;
  if(rt60Ms < 500) scores.room     += 3;
  if(rt60Ms < 900) scores.hall     += 3;
  if(rt60Ms >= 500) scores.bathroom += 2;

  // C50-based scoring (clarity)
  if(c50 > 15)  { scores.anechoic+=2; scores.studio+=2; }
  if(c50 > 5)   { scores.office+=2; scores.room+=1; }
  if(c50 < 0)   { scores.hall+=2; scores.bathroom+=2; }
  if(c50 < -10) { scores.bathroom+=3; }

  // DRR-based scoring
  if(drr > 10)  { scores.anechoic+=2; scores.studio+=1; }
  if(drr < 0)   { scores.hall+=2; scores.bathroom+=2; }
  if(drr < -10) { scores.bathroom+=3; }

  // Bathroom special case: high RT60 + low DRR + low C50
  if(rt60Ms > 400 && drr < 0 && c50 < 0) scores.bathroom += 5;

  // Hall: very long RT60
  if(rt60Ms > 800) { scores.hall += 4; scores.bathroom -= 2; }

  // Band analysis — bathroom has high-freq RT60
  const highBand = bands.find(b=>b.bandHz==="2k-4kHz");
  if(highBand?.valid && highBand.rt60Ms > 400) scores.bathroom += 2;

  // Find best
  let best: RoomType = "room", bestScore = -1;
  for(const [type, score] of Object.entries(scores)){
    if(score > bestScore){ bestScore=score; best=type as RoomType; }
  }

  const totalScore = Object.values(scores).reduce((s,v)=>s+v,0);
  const confidence = totalScore>0 ? Math.min(1, bestScore/totalScore*2) : 0;

  return { type: best, confidence };
}

// ── Main Reverb Detector ──────────────────────────────────────────────────────

export function detectReverb(buffer: AudioBuffer): ReverbResult {
  const sr   = buffer.sampleRate;
  const mono = new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  // ── Broadband RT60 ────────────────────────────────────────────────────────

  const edcRaw    = computeEDC(mono);
  const edcSmooth = smoothEDC(edcRaw, Math.round(0.01*sr));
  const broadband = estimateRT60FromEDC(edcSmooth, sr);

  // ── Multi-band RT60 ───────────────────────────────────────────────────────

  const BANDS = [
    { bandHz:"125-250Hz",  lowHz:125,  highHz:250  },
    { bandHz:"250-500Hz",  lowHz:250,  highHz:500  },
    { bandHz:"500Hz-1kHz", lowHz:500,  highHz:1000 },
    { bandHz:"1k-2kHz",    lowHz:1000, highHz:2000 },
    { bandHz:"2k-4kHz",    lowHz:2000, highHz:4000 },
    { bandHz:"4k-8kHz",    lowHz:4000, highHz:8000 },
  ];

  const rt60Bands: BandRT60[] = BANDS.map(band => {
    const filtered = bandpassFilter(mono, sr, band.lowHz, band.highHz);
    const edc      = computeEDC(filtered);
    const smooth   = smoothEDC(edc, Math.round(0.01*sr));
    const result   = estimateRT60FromEDC(smooth, sr);
    return {
      bandHz:  band.bandHz,
      lowHz:   band.lowHz,
      highHz:  band.highHz,
      rt60Ms:  result.rt60Ms,
      valid:   result.valid,
    };
  });

  // ── C50 / D50 / DRR ───────────────────────────────────────────────────────

  const c50 = computeC50(mono, sr);
  const d50 = computeD50(mono, sr);
  const drr = computeDRR(mono, sr);

  // ── Room Classification ───────────────────────────────────────────────────

  const rt60Ms     = broadband.valid ? broadband.rt60Ms
    : rt60Bands.filter(b=>b.valid).length > 0
      ? rt60Bands.filter(b=>b.valid).reduce((s,b)=>s+b.rt60Ms,0)
        / rt60Bands.filter(b=>b.valid).length
      : 0;

  const { type: environment, confidence: roomConfidence } =
    classifyRoom(rt60Ms, c50, drr, rt60Bands);

  // ── Problems ──────────────────────────────────────────────────────────────

  const problems: string[] = [];

  if(rt60Ms > 300)
    problems.push(`High reverb: RT60 = ${rt60Ms.toFixed(0)}ms — ${environment}`);

  if(c50 < 0)
    problems.push(`Poor speech clarity: C50 = ${c50.toFixed(1)} dB`);

  if(drr < -5)
    problems.push(`Reverb dominant: DRR = ${drr.toFixed(1)} dB`);

  if(environment==="bathroom")
    problems.push("Bathroom / high-reverb environment detected");

  if(environment==="hall" && rt60Ms>600)
    problems.push("Concert hall acoustics — unsuitable for speech recording");

  return {
    rt60Ms,
    rt60Bands,
    environment,
    drr:            isFinite(drr) ? drr : -40,
    clarity:        isFinite(c50) ? c50 : -40,
    definition:     d50,
    roomConfidence,
    problems,
    isReliable:     broadband.valid && broadband.r2 > 0.85,
  };
}
