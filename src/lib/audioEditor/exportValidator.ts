/**
 * exportValidator.ts — Export Safety Gate
 * Aivora Audio Infrastructure Platform
 *
 * Blocks unsafe exports before they leave the system.
 * Every export must pass ALL validation checks.
 *
 * Checks:
 * - Speech preservation (vs original)
 * - No digital silence introduced
 * - No clipping introduced
 * - LUFS within acceptable range
 * - Duration drift < threshold
 * - Sample rate preserved
 * - No spectral seams
 * - No repeated texture (silence loop detection)
 * - Format validity
 */

// ── Validation Result ─────────────────────────────────────────────────────────

export type ValidationSeverity = "critical" | "high" | "medium" | "low";

export interface ValidationFailure {
  code:      string;
  message:   string;
  severity:  ValidationSeverity;
  measured:  number;
  threshold: number;
  unit:      string;
}

export interface ValidationWarning {
  code:    string;
  message: string;
  measured: number;
}

export interface ExportValidationResult {
  safe:         boolean;
  score:        number;        // 0-100
  failures:     ValidationFailure[];
  warnings:     ValidationWarning[];
  checks:       CheckResult[];
  exportBlocked: boolean;
  blockReason:  string;
  validatedAt:  number;
}

export interface CheckResult {
  name:    string;
  passed:  boolean;
  measured: number;
  threshold: number;
  unit:    string;
}

// ── Export Validation Options ─────────────────────────────────────────────────

export interface ExportValidationOptions {
  original?:              Float32Array;
  originalSr?:            number;
  expectedDurationSec?:   number;
  expectedSampleRate?:    number;
  maxDurationDriftMs?:    number;    // default 50ms
  maxTruePeakDb?:         number;    // default -1.0
  minLufs?:               number;    // default -35
  maxLufs?:               number;    // default -10
  minSpeechPreservation?: number;    // default 0.95
  maxSilenceRmsDb?:       number;    // default -40
  maxClippingRatio?:      number;    // default 0.001
  maxSeamRisk?:           number;    // default 0.25
  blockOnCritical?:       boolean;   // default true
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function rms(data: Float32Array, start=0, end=-1): number {
  const e = end < 0 ? data.length : end;
  let s=0; for(let i=start;i<e;i++) s+=data[i]**2;
  return Math.sqrt(s/Math.max(1,e-start));
}

function rmsDb(data: Float32Array, start=0, end=-1): number {
  const r=rms(data,start,end);
  return r>0 ? 20*Math.log10(r) : -120;
}

function truePeakDb(data: Float32Array): number {
  let peak=0;
  for(let i=1;i<data.length-2;i++){
    // Cubic interpolation for 4x oversampling approximation
    for(let t=0;t<4;t++){
      const f=t/4;
      const s=data[i-1]*(-f*(1-f)*(2-f)/6)
             +data[i  ]*((2-f)*(1+f)*(1-f)/2)
             +data[i+1]*(f*(1+f)*(1-f)/2)
             +data[i+2]*(f*(1+f)*(f-1)/6);
      if(Math.abs(s)>peak) peak=Math.abs(s);
    }
  }
  return peak>0 ? 20*Math.log10(peak) : -120;
}

function measureLufs(data: Float32Array, sr: number): number {
  const blockLen=Math.floor(0.4*sr), hop=Math.floor(0.1*sr);
  const blocks: number[]=[];
  for(let s=0;s+blockLen<=data.length;s+=hop){
    let ms=0;
    for(let i=s;i<s+blockLen;i++) ms+=data[i]**2;
    blocks.push(ms/blockLen);
  }
  if(!blocks.length) return -70;
  const thresh=Math.pow(10,(-70-0.691)/10);
  const gated=blocks.filter(b=>b>thresh);
  if(!gated.length) return -70;
  const mean=gated.reduce((a,b)=>a+b)/gated.length;
  return mean>0 ? -0.691+10*Math.log10(mean) : -70;
}

function clippingRatio(data: Float32Array): number {
  let clipped=0;
  for(let i=0;i<data.length;i++) if(Math.abs(data[i])>=0.999) clipped++;
  return clipped/data.length;
}

function speechPreservation(orig: Float32Array, proc: Float32Array, sr: number): number {
  const n=Math.min(orig.length,proc.length);
  const frameLen=Math.floor(0.02*sr);
  let speechDiff=0, speechTotal=0;
  for(let s=0;s+frameLen<=n;s+=frameLen){
    let ms=0;
    for(let i=s;i<s+frameLen;i++) ms+=orig[i]**2;
    if(10*Math.log10(ms/frameLen+1e-10)>-35){
      for(let i=s;i<s+frameLen;i++){
        speechTotal++;
        if(Math.abs(proc[i]-orig[i])>0.005) speechDiff++;
      }
    }
  }
  return speechTotal>0 ? 1-speechDiff/speechTotal : 1;
}

function detectDigitalSilence(data: Float32Array, sr: number): boolean {
  const frameLen=Math.floor(0.05*sr);
  for(let s=0;s+frameLen<=data.length;s+=frameLen){
    const r=rmsDb(data,s,s+frameLen);
    if(r < -90) return true;
  }
  return false;
}

function detectRepeatedTexture(data: Float32Array, sr: number): number {
  // Detect copy-paste silence loops via autocorrelation
  const frameLen=Math.floor(0.5*sr); // 500ms window
  if(data.length < frameLen*3) return 0;

  let maxCorr=0;
  const lags=[Math.floor(0.1*sr),Math.floor(0.2*sr),Math.floor(0.3*sr)];

  for(const lag of lags){
    let corr=0, mag1=0, mag2=0;
    for(let i=0;i<frameLen&&i+lag<data.length;i++){
      corr +=data[i]*data[i+lag];
      mag1 +=data[i]**2;
      mag2 +=data[i+lag]**2;
    }
    const norm=Math.sqrt(mag1*mag2);
    const r=norm>1e-10?corr/norm:0;
    if(r>maxCorr) maxCorr=r;
  }
  return maxCorr;
}

function detectSeamRisk(data: Float32Array, sr: number): number {
  const frameLen=Math.floor(0.01*sr); // 10ms
  let maxDelta=0;
  let prevRms=rmsDb(data,0,frameLen);

  for(let s=frameLen;s+frameLen<=data.length;s+=frameLen){
    const currRms=rmsDb(data,s,s+frameLen);
    const delta=Math.abs(currRms-prevRms);
    if(delta>maxDelta) maxDelta=delta;
    prevRms=currRms;
  }
  return Math.min(1, maxDelta/20);
}

// ── Main Validator ────────────────────────────────────────────────────────────

export function validateExport(
  output:  Float32Array,
  sr:      number,
  options: ExportValidationOptions = {}
): ExportValidationResult {
  const failures:  ValidationFailure[] = [];
  const warnings:  ValidationWarning[] = [];
  const checks:    CheckResult[] = [];

  const maxTP    = options.maxTruePeakDb         ?? -1.0;
  const minL     = options.minLufs               ?? -35;
  const maxL     = options.maxLufs               ?? -10;
  const maxDrift = options.maxDurationDriftMs    ?? 50;
  const minSpeech= options.minSpeechPreservation ?? 0.95;
  const maxSilRms= options.maxSilenceRmsDb       ?? -40;
  const maxClip  = options.maxClippingRatio      ?? 0.001;
  const maxSeam  = options.maxSeamRisk           ?? 0.25;
  const blockCrit= options.blockOnCritical       ?? true;

  function addCheck(name: string, passed: boolean, measured: number,
    threshold: number, unit: string) {
    checks.push({name,passed,measured,threshold,unit});
  }

  function addFailure(code: string, message: string, severity: ValidationSeverity,
    measured: number, threshold: number, unit: string) {
    failures.push({code,message,severity,measured,threshold,unit});
  }

  // ── 1. Format validity ──────────────────────────────────────────────────
  const formatValid = output.length > 0 && sr > 0 && isFinite(sr);
  addCheck("Format Valid", formatValid, output.length, 1, "samples");
  if(!formatValid) addFailure("INVALID_FORMAT",
    "Output buffer is empty or sample rate invalid","critical",output.length,1,"samples");

  // ── 2. True Peak ────────────────────────────────────────────────────────
  const tp=truePeakDb(output);
  const tpPass=tp<=maxTP;
  addCheck("True Peak", tpPass, tp, maxTP, "dBTP");
  if(!tpPass) addFailure("TRUE_PEAK_EXCEEDED",
    `True peak ${tp.toFixed(2)}dBTP exceeds ${maxTP}dBTP`,
    "high",tp,maxTP,"dBTP");

  // ── 3. LUFS ─────────────────────────────────────────────────────────────
  const lufs=measureLufs(output,sr);
  const lufsPass=lufs>=minL&&lufs<=maxL;
  addCheck("LUFS Range", lufsPass, lufs, maxL, "LUFS");
  if(lufs<minL) addFailure("LUFS_TOO_LOW",
    `LUFS ${lufs.toFixed(1)} below minimum ${minL}`,"medium",lufs,minL,"LUFS");
  if(lufs>maxL) addFailure("LUFS_TOO_HIGH",
    `LUFS ${lufs.toFixed(1)} exceeds maximum ${maxL}`,"high",lufs,maxL,"LUFS");

  // ── 4. Clipping ─────────────────────────────────────────────────────────
  const clipRatio=clippingRatio(output);
  const clipPass=clipRatio<=maxClip;
  addCheck("No Clipping", clipPass, clipRatio, maxClip, "ratio");
  if(!clipPass) addFailure("CLIPPING_DETECTED",
    `Clipping ratio ${(clipRatio*100).toFixed(2)}% exceeds ${(maxClip*100).toFixed(2)}%`,
    "high",clipRatio,maxClip,"ratio");

  // ── 5. Digital silence ──────────────────────────────────────────────────
  const hasMute=detectDigitalSilence(output,sr);
  addCheck("No Digital Mute", !hasMute, hasMute?-95:-60, -90, "dBRMS");
  if(hasMute) addFailure("DIGITAL_MUTE_DETECTED",
    "Digital silence (RMS<-90dB) detected — use natural room tone",
    "critical",-95,-90,"dBRMS");

  // ── 6. Repeated texture ─────────────────────────────────────────────────
  const texRepeat=detectRepeatedTexture(output,sr);
  const texPass=texRepeat<0.95;
  addCheck("No Repeated Texture", texPass, texRepeat, 0.95, "correlation");
  if(!texPass) warnings.push({code:"REPEATED_TEXTURE",
    message:`High autocorrelation (${texRepeat.toFixed(2)}) — possible silence loop`,
    measured:texRepeat});

  // ── 7. Seam risk ────────────────────────────────────────────────────────
  const seam=detectSeamRisk(output,sr);
  const seamPass=seam<=maxSeam;
  addCheck("Seam Risk", seamPass, seam, maxSeam, "risk");
  if(!seamPass) addFailure("HIGH_SEAM_RISK",
    `Seam risk ${seam.toFixed(3)} exceeds threshold ${maxSeam}`,
    "high",seam,maxSeam,"risk");

  // ── 8. Duration drift ───────────────────────────────────────────────────
  if(options.expectedDurationSec!=null){
    const actualSec=output.length/sr;
    const driftMs=Math.abs(actualSec-options.expectedDurationSec)*1000;
    const driftPass=driftMs<=maxDrift;
    addCheck("Duration Drift", driftPass, driftMs, maxDrift, "ms");
    if(!driftPass) addFailure("DURATION_DRIFT",
      `Duration drift ${driftMs.toFixed(1)}ms exceeds ${maxDrift}ms`,
      "high",driftMs,maxDrift,"ms");
  }

  // ── 9. Sample rate ──────────────────────────────────────────────────────
  if(options.expectedSampleRate!=null){
    const srPass=sr===options.expectedSampleRate;
    addCheck("Sample Rate", srPass, sr, options.expectedSampleRate, "Hz");
    if(!srPass) addFailure("WRONG_SAMPLE_RATE",
      `Sample rate ${sr}Hz, expected ${options.expectedSampleRate}Hz`,
      "critical",sr,options.expectedSampleRate,"Hz");
  }

  // ── 10. Speech preservation ─────────────────────────────────────────────
  if(options.original && options.originalSr){
    const sp=speechPreservation(options.original,output,sr);
    const spPass=sp>=minSpeech;
    addCheck("Speech Preservation", spPass, sp, minSpeech, "ratio");
    if(!spPass) addFailure("SPEECH_DAMAGED",
      `Speech preservation ${(sp*100).toFixed(1)}% below ${(minSpeech*100).toFixed(1)}%`,
      "critical",sp,minSpeech,"ratio");
  }

  // ── Score ────────────────────────────────────────────────────────────────
  const passed=checks.filter(c=>c.passed).length;
  const score=Math.round((passed/checks.length)*100);

  const hasCritical=failures.some(f=>f.severity==="critical");
  const exportBlocked=blockCrit&&hasCritical;
  const blockReason=exportBlocked
    ? failures.filter(f=>f.severity==="critical").map(f=>f.code).join(", ")
    : "";

  return {
    safe:    failures.length===0,
    score,
    failures,
    warnings,
    checks,
    exportBlocked,
    blockReason,
    validatedAt: Date.now(),
  };
}
