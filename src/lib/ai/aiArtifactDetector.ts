/**
 * aiArtifactDetector.ts — AI Audio Artifact Detection Engine
 * Aivora Audio Infrastructure Platform
 *
 * Detects artifacts introduced by AI speech synthesis and enhancement:
 * - Metallic/robotic artifacts (comb filtering patterns)
 * - Phase discontinuities (TTS stitching artifacts)
 * - Spectral holes (over-suppression artifacts)
 * - Unnatural periodicity (vocoder/neural artifacts)
 * - Bandwidth artifacts (bandwidth extension errors)
 * - Clonality: repetitive spectral patterns (copy-paste synthesis)
 *
 * Methods:
 * - Comb filter detection via autocorrelation analysis
 * - Phase coherence anomaly detection
 * - Spectral hole detection (sustained energy gaps)
 * - Periodicity analysis (AMDF-based)
 * - Spectral entropy analysis
 *
 * Outputs per-frame artifact probability + overall score.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const FFT_SIZE      = 2048;
const HOP_SIZE      = FFT_SIZE / 4;
const FRAME_MS      = 20;
const COMB_THRESH   = 0.7;    // comb filter correlation threshold
const HOLE_DB_THRESH = -40;   // spectral hole detection (dB below max)
const ENTROPY_MIN   = 2.0;    // minimum expected spectral entropy

// ── Types ─────────────────────────────────────────────────────────────────────

export type ArtifactType =
  | "metallic_comb"       // comb filtering = robotic TTS
  | "phase_discontinuity" // phase jumps at stitching points
  | "spectral_hole"       // sustained energy gaps
  | "unnatural_periodicity" // excess periodicity = vocoder
  | "bandwidth_artifact"  // unnatural high-freq rolloff
  | "spectral_clone"      // repetitive pattern = synthesis
  | "over_suppressed";    // noise suppressor over-applied

export interface ArtifactFrame {
  readonly timestampSec:   number;
  readonly type:           ArtifactType;
  readonly probability:    number;   // 0-1
  readonly severity:       "low" | "medium" | "high";
  readonly description:    string;
}

export interface ArtifactReport {
  readonly artifacts:      ArtifactFrame[];
  readonly overallScore:   number;    // 0-100 (100 = clean)
  readonly isAIGenerated:  boolean;   // likely synthetic
  readonly confidence:     number;    // 0-1
  readonly dominantType:   ArtifactType | null;
  readonly summary:        string;
  readonly framesAnalyzed: number;
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cR=1,cI=0;
      for(let j=0;j<len>>1;j++){
        const uR=re[i+j],uI=im[i+j];
        const vR=re[i+j+len/2]*cR-im[i+j+len/2]*cI;
        const vI=re[i+j+len/2]*cI+im[i+j+len/2]*cR;
        re[i+j]=uR+vR;im[i+j]=uI+vI;
        re[i+j+len/2]=uR-vR;im[i+j+len/2]=uI-vI;
        const nR=cR*wR-cI*wI;cI=cR*wI+cI*wR;cR=nR;
      }
    }
  }
}

// ── Comb Filter Detection ─────────────────────────────────────────────────────
// Metallic TTS artifacts show regular spectral notches (comb pattern)

function detectCombFilter(spectrum: Float64Array): number {
  const n     = spectrum.length;
  const acf   = new Float64Array(n / 2);

  // Autocorrelation of log magnitude spectrum
  const logSpec = new Float64Array(n);
  for(let k=0;k<n;k++) logSpec[k] = Math.log(spectrum[k]+1e-10);

  let mean=0; for(let k=0;k<n;k++) mean+=logSpec[k]; mean/=n;
  for(let k=0;k<n;k++) logSpec[k]-=mean;

  let var0=0; for(let k=0;k<n;k++) var0+=logSpec[k]*logSpec[k];

  for(let lag=1;lag<n/2;lag++){
    let cross=0;
    for(let k=0;k<n-lag;k++) cross+=logSpec[k]*logSpec[k+lag];
    acf[lag]=var0>0 ? cross/var0 : 0;
  }

  // Find peak in ACF (excluding lag=0) — high peak = comb pattern
  let maxAcf=0;
  for(let lag=5;lag<acf.length;lag++) if(acf[lag]>maxAcf) maxAcf=acf[lag];

  return Math.min(1, maxAcf);
}

// ── Spectral Hole Detection ───────────────────────────────────────────────────
// Over-suppression creates sustained zero-energy frequency bands

function detectSpectralHoles(
  spectrum: Float64Array,
  threshold = HOLE_DB_THRESH
): number {
  const n   = spectrum.length;
  let maxE  = 0;
  for(let k=0;k<n;k++) if(spectrum[k]>maxE) maxE=spectrum[k];

  if(maxE < 1e-10) return 0;

  let holeCount = 0, prevWasHole = false;
  let holeRuns  = 0;

  for(let k=0;k<n;k++){
    const db = 20*Math.log10(spectrum[k]/maxE+1e-10);
    const isHole = db < threshold;
    if(isHole) holeCount++;
    if(isHole && prevWasHole) holeRuns++;
    prevWasHole=isHole;
  }

  const holeRatio    = holeCount / n;
  const runPenalty   = Math.min(1, holeRuns / 10);
  return Math.min(1, holeRatio * 2 + runPenalty * 0.3);
}

// ── Spectral Entropy ──────────────────────────────────────────────────────────
// Low entropy = unnatural periodicity (synthesized audio)

function computeSpectralEntropy(spectrum: Float64Array): number {
  const n    = spectrum.length;
  let   sum  = 0;
  for(let k=0;k<n;k++) sum+=spectrum[k];
  if(sum < 1e-10) return 0;

  let entropy=0;
  for(let k=0;k<n;k++){
    const p=spectrum[k]/sum;
    if(p>1e-10) entropy-=p*Math.log2(p);
  }
  return entropy;
}

// ── Phase Discontinuity Detection ────────────────────────────────────────────
// TTS stitching creates sudden phase jumps

function detectPhaseDiscontinuities(
  data:   Float32Array,
  sr:     number
): number {
  const frameLen = Math.floor(FRAME_MS * sr / 1000);
  let   jumps    = 0, frames = 0;
  let   prevPhase = 0;

  for(let s=frameLen; s+frameLen<=data.length; s+=frameLen){
    const re=new Float64Array(frameLen), im=new Float64Array(frameLen);
    for(let i=0;i<frameLen;i++) re[i]=data[s+i];
    fft(re,im);

    // Phase of dominant bin
    let maxMag=0, domPhase=0;
    for(let k=1;k<frameLen/2;k++){
      const mag=Math.sqrt(re[k]*re[k]+im[k]*im[k]);
      if(mag>maxMag){maxMag=mag;domPhase=Math.atan2(im[k],re[k]);}
    }

    if(frames>0){
      const phaseDiff=Math.abs(domPhase-prevPhase);
      const wrapped=Math.min(phaseDiff,2*Math.PI-phaseDiff);
      if(wrapped>Math.PI*0.8) jumps++;
    }
    prevPhase=domPhase; frames++;
  }

  return frames>0 ? Math.min(1, jumps/frames*3) : 0;
}

// ── Bandwidth Artifact Detection ──────────────────────────────────────────────
// Unnatural high-freq rolloff = bandwidth limiting artifact

function detectBandwidthArtifact(spectrum: Float64Array, sr: number): number {
  const n    = spectrum.length;
  const low  = Math.floor(2000 / (sr/2) * n);   // 2kHz
  const high = Math.floor(7000 / (sr/2) * n);   // 7kHz
  const nyq  = Math.floor(16000 / (sr/2) * n);  // 16kHz

  let lowE=0, highE=0, nyqE=0;
  for(let k=low;k<high;k++) lowE+=spectrum[k];
  for(let k=high;k<Math.min(nyq,n);k++) highE+=spectrum[k];
  for(let k=Math.min(nyq,n);k<n;k++) nyqE+=spectrum[k];

  // Natural speech has gradual rolloff
  // Bandwidth artifact = sharp cutoff above a frequency
  const highRatio = lowE>0 ? highE/lowE : 1;
  const nyqRatio  = highE>0 ? nyqE/highE : 1;

  // Unnatural = high energy drop-off
  if(highRatio < 0.01 && nyqRatio < 0.001) return 0.8;
  if(highRatio < 0.05) return 0.5;
  return 0;
}

// ── Spectral Clone Detection ─────────────────────────────────────────────────
// Copy-paste synthesis creates repeating spectral patterns

function detectSpectralClone(
  data: Float32Array,
  sr:   number
): number {
  const blockLen = Math.floor(0.5 * sr); // 500ms blocks
  if(data.length < blockLen * 3) return 0;

  const blocks: Float64Array[] = [];
  for(let s=0;s+blockLen<=data.length;s+=blockLen){
    const re=new Float64Array(blockLen), im=new Float64Array(blockLen);
    for(let i=0;i<blockLen;i++) re[i]=data[s+i];
    fft(re,im);
    const mag=new Float64Array(blockLen/2);
    for(let k=0;k<blockLen/2;k++) mag[k]=Math.sqrt(re[k]**2+im[k]**2);
    // Normalize
    const max=mag.reduce((m,v)=>Math.max(m,v),0);
    if(max>0) for(let k=0;k<mag.length;k++) mag[k]/=max;
    blocks.push(mag);
  }

  if(blocks.length<3) return 0;

  // Cross-correlation between non-adjacent blocks
  let maxSim=0;
  for(let i=0;i<blocks.length;i++){
    for(let j=i+2;j<blocks.length;j++){
      let dot=0,nA=0,nB=0;
      for(let k=0;k<blocks[i].length;k++){
        dot+=blocks[i][k]*blocks[j][k];
        nA+=blocks[i][k]**2; nB+=blocks[j][k]**2;
      }
      const sim=Math.sqrt(nA*nB)>0?dot/Math.sqrt(nA*nB):0;
      if(sim>maxSim) maxSim=sim;
    }
  }

  // High similarity between distant blocks = clone
  return maxSim > 0.95 ? (maxSim-0.95)/0.05 : 0;
}

// ── Over-Suppression Detection ────────────────────────────────────────────────
// Neural denoisers sometimes over-suppress, creating musical noise

function detectOverSuppression(
  data: Float32Array,
  sr:   number
): number {
  const frameLen=Math.floor(0.02*sr);
  let   musicalNoise=0, frames=0;
  let   prevEnergy=0;

  for(let s=0;s+frameLen<=data.length;s+=frameLen){
    let e=0;
    for(let i=s;i<s+frameLen;i++) e+=data[i]**2;
    e/=frameLen;

    if(frames>0&&prevEnergy>1e-8){
      // Rapid energy fluctuation = musical noise
      const ratio=Math.abs(Math.log10(e/(prevEnergy+1e-15)));
      if(ratio>1.5) musicalNoise++;
    }
    prevEnergy=e; frames++;
  }

  return frames>0?Math.min(1,musicalNoise/frames*5):0;
}

// ── Main Detector ─────────────────────────────────────────────────────────────

export function detectAIArtifacts(
  data: Float32Array,
  sr:   number
): ArtifactReport {
  const win    = new Float64Array(FFT_SIZE);
  for(let i=0;i<FFT_SIZE;i++) win[i]=0.5*(1-Math.cos(2*Math.PI*i/(FFT_SIZE-1)));

  const artifacts:     ArtifactFrame[] = [];
  const artifactCounts = new Map<ArtifactType, number>();
  let   frames         = 0;

  // Phase discontinuity (full signal analysis)
  const phaseProbability = detectPhaseDiscontinuities(data, sr);
  if(phaseProbability > 0.3){
    artifacts.push({
      timestampSec: 0,
      type:         "phase_discontinuity",
      probability:  phaseProbability,
      severity:     phaseProbability>0.6?"high":phaseProbability>0.4?"medium":"low",
      description:  `Phase discontinuities detected (${(phaseProbability*100).toFixed(0)}% frames)`,
    });
    artifactCounts.set("phase_discontinuity", Math.round(phaseProbability*10));
  }

  // Per-frame spectral analysis
  for(let s=0; s+FFT_SIZE<=data.length; s+=HOP_SIZE){
    const re=new Float64Array(FFT_SIZE), im=new Float64Array(FFT_SIZE);
    for(let i=0;i<FFT_SIZE;i++) re[i]=data[s+i]*win[i];
    fft(re,im);

    const spectrum=new Float64Array(FFT_SIZE/2);
    for(let k=0;k<FFT_SIZE/2;k++)
      spectrum[k]=Math.sqrt(re[k]*re[k]+im[k]*im[k]);

    const tSec  = s/sr;
    frames++;

    // Comb filter
    const combP = detectCombFilter(spectrum);
    if(combP>COMB_THRESH){
      artifacts.push({
        timestampSec: tSec, type:"metallic_comb",
        probability:  combP,
        severity:     combP>0.85?"high":combP>0.75?"medium":"low",
        description:  `Metallic comb filtering at ${tSec.toFixed(2)}s`,
      });
      artifactCounts.set("metallic_comb", (artifactCounts.get("metallic_comb")??0)+1);
    }

    // Spectral holes
    const holeP = detectSpectralHoles(spectrum);
    if(holeP>0.4){
      artifacts.push({
        timestampSec: tSec, type:"spectral_hole",
        probability:  holeP,
        severity:     holeP>0.7?"high":holeP>0.5?"medium":"low",
        description:  `Spectral holes (over-suppression) at ${tSec.toFixed(2)}s`,
      });
      artifactCounts.set("spectral_hole", (artifactCounts.get("spectral_hole")??0)+1);
    }

    // Spectral entropy
    const entropy = computeSpectralEntropy(spectrum);
    if(entropy < ENTROPY_MIN && entropy > 0){
      const prob = Math.max(0, 1 - entropy/ENTROPY_MIN);
      artifacts.push({
        timestampSec: tSec, type:"unnatural_periodicity",
        probability:  prob,
        severity:     prob>0.7?"high":"medium",
        description:  `Low spectral entropy (${entropy.toFixed(2)}) at ${tSec.toFixed(2)}s`,
      });
      artifactCounts.set("unnatural_periodicity", (artifactCounts.get("unnatural_periodicity")??0)+1);
    }

    // Bandwidth artifact (check less frequently)
    if(frames % 10 === 0){
      const bwP = detectBandwidthArtifact(spectrum, sr);
      if(bwP>0.4){
        artifacts.push({
          timestampSec: tSec, type:"bandwidth_artifact",
          probability:  bwP,
          severity:     bwP>0.7?"high":"medium",
          description:  `Unnatural bandwidth limitation at ${tSec.toFixed(2)}s`,
        });
        artifactCounts.set("bandwidth_artifact", (artifactCounts.get("bandwidth_artifact")??0)+1);
      }
    }
  }

  // Full-signal clone + over-suppression detection
  const cloneP = detectSpectralClone(data, sr);
  if(cloneP > 0.3){
    artifacts.push({
      timestampSec: 0, type:"spectral_clone",
      probability:  cloneP,
      severity:     cloneP>0.7?"high":"medium",
      description:  `Spectral clone pattern detected (copy-paste synthesis, score=${(cloneP*100).toFixed(0)}%)`,
    });
    artifactCounts.set("spectral_clone", Math.round(cloneP*10));
  }

  const overP = detectOverSuppression(data, sr);
  if(overP > 0.3){
    artifacts.push({
      timestampSec: 0, type:"over_suppressed",
      probability:  overP,
      severity:     overP>0.6?"high":"medium",
      description:  `Over-suppression artifacts (musical noise, score=${(overP*100).toFixed(0)}%)`,
    });
    artifactCounts.set("over_suppressed", Math.round(overP*10));
  }

  // Overall score: penalty per artifact type
  const artifactFrameRatio = artifacts.length / Math.max(1, frames);
  const overallScore = Math.max(0, Math.round((1 - Math.min(1, artifactFrameRatio)) * 100));

  // Dominant type
  let dominantType: ArtifactType | null = null;
  let maxCount = 0;
  for(const [type, count] of artifactCounts){
    if(count>maxCount){maxCount=count; dominantType=type;}
  }

  // AI-generated confidence
  const isAIGenerated = overallScore < 70 || phaseProbability > 0.5;
  const confidence    = Math.min(1, artifactFrameRatio * 3 + phaseProbability * 0.5);

  return {
    artifacts:      artifacts.slice(0, 100), // cap for memory safety
    overallScore,
    isAIGenerated,
    confidence:     Math.round(confidence*1000)/1000,
    dominantType,
    summary:        isAIGenerated
      ? `AI artifacts detected (score: ${overallScore}/100, dominant: ${dominantType})`
      : `Natural audio — no significant AI artifacts (score: ${overallScore}/100)`,
    framesAnalyzed: frames,
  };
}
