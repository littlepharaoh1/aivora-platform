/**
 * audioMetrics.ts — Objective Audio Quality Metrics
 * Aivora Audio Infrastructure Platform
 *
 * Implements:
 * - SI-SDR (Scale-Invariant Signal-to-Distortion Ratio) — Le Roux et al. (2019)
 * - STOI approximation (Short-Time Objective Intelligibility) — Taal et al. (2011)
 * - PESQ proxy (Perceptual Evaluation of Speech Quality) — ITU-T P.862
 * - LSD (Log Spectral Distance) — spectral envelope fidelity
 * - DNSMOS proxy — DNS Mean Opinion Score approximation
 *
 * All metrics are reference-optional:
 * - With reference: full comparison (SI-SDR, STOI, PESQ proxy)
 * - Without reference: blind estimation (DNSMOS proxy, NORESQA-like)
 */

// ── FFT Utility ───────────────────────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
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

function buildHann(n: number): Float64Array {
  const w = new Float64Array(n);
  for(let i=0;i<n;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(n-1)));
  return w;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s;
}

function norm2(a: Float64Array): number {
  return Math.sqrt(dot(a,a));
}

function safeDiv(a: number, b: number): number {
  return Math.abs(b) > 1e-12 ? a/b : 0;
}

// ── SI-SDR ────────────────────────────────────────────────────────────────────
// Scale-Invariant Signal-to-Distortion Ratio
// Le Roux et al. (2019) "SDR - Half-baked or Well Done?"
// SI-SDR = 10*log10(||alpha*s||^2 / ||e||^2)
// where alpha = <s_hat, s> / <s, s>, e = s_hat - alpha*s

export function computeSISDR(
  reference: Float32Array,
  estimated: Float32Array
): number {
  const n = Math.min(reference.length, estimated.length);
  const s = new Float64Array(n);
  const e = new Float64Array(n);

  // Remove DC offset
  let refMean=0, estMean=0;
  for(let i=0;i<n;i++){ refMean+=reference[i]; estMean+=estimated[i]; }
  refMean/=n; estMean/=n;
  for(let i=0;i<n;i++){ s[i]=reference[i]-refMean; e[i]=estimated[i]-estMean; }

  // Scale factor: alpha = <e, s> / <s, s>
  const alpha = safeDiv(dot(e,s), dot(s,s));

  // Target: alpha*s
  const target = new Float64Array(n);
  for(let i=0;i<n;i++) target[i]=alpha*s[i];

  // Noise: e - target
  const noise = new Float64Array(n);
  for(let i=0;i<n;i++) noise[i]=e[i]-target[i];

  const targetPower = dot(target,target);
  const noisePower  = dot(noise,noise);

  if(noisePower < 1e-12) return 40; // essentially perfect
  if(targetPower < 1e-12) return -40;

  return 10*Math.log10(targetPower/noisePower);
}

// ── Log Spectral Distance ─────────────────────────────────────────────────────
// Measures spectral envelope fidelity
// LSD = sqrt(1/K * sum((log|H1(k)| - log|H2(k)|)^2))

export function computeLSD(
  reference: Float32Array,
  estimated: Float32Array,
  sr:        number,
  fftSize:   number = 1024
): number {
  const hop  = fftSize / 2;
  const win  = buildHann(fftSize);
  const n    = Math.min(reference.length, estimated.length);
  let   lsdSum = 0, frameCount = 0;

  for(let start=0; start+fftSize<=n; start+=hop) {
    const re1=new Float64Array(fftSize), im1=new Float64Array(fftSize);
    const re2=new Float64Array(fftSize), im2=new Float64Array(fftSize);
    for(let i=0;i<fftSize;i++){
      re1[i]=reference[start+i]*win[i];
      re2[i]=estimated[start+i]*win[i];
    }
    fft(re1,im1); fft(re2,im2);

    let frameLsd=0;
    const numBins=fftSize/2;
    for(let k=1;k<numBins;k++){
      const mag1=Math.sqrt(re1[k]**2+im1[k]**2)+1e-10;
      const mag2=Math.sqrt(re2[k]**2+im2[k]**2)+1e-10;
      frameLsd+=(Math.log(mag1)-Math.log(mag2))**2;
    }
    lsdSum+=Math.sqrt(frameLsd/numBins);
    frameCount++;
  }

  return frameCount>0 ? lsdSum/frameCount : 0;
}

// ── STOI Approximation ────────────────────────────────────────────────────────
// Short-Time Objective Intelligibility — Taal et al. (2011)
// Simplified: correlation of one-third octave band envelopes
// Full STOI requires 15 one-third octave bands, 30-frame sliding window

export function computeSTOI(
  reference: Float32Array,
  estimated: Float32Array,
  sr:        number
): number {
  const FRAME_MS   = 25;
  const HOP_MS     = 10;
  const frameLen   = Math.floor(FRAME_MS*sr/1000);
  const hopLen     = Math.floor(HOP_MS*sr/1000);
  const n          = Math.min(reference.length, estimated.length);
  const win        = buildHann(frameLen);

  // One-third octave band center frequencies (Hz)
  const bands = [
    125,160,200,250,315,400,500,630,800,1000,
    1250,1600,2000,2500,3150,4000,5000,6300,8000
  ].filter(f => f < sr/2);

  const numBands = bands.length;
  const numFrames = Math.floor((n-frameLen)/hopLen)+1;

  // Per-band envelope correlation
  const refEnv = Array.from({length:numBands},()=>new Float64Array(numFrames));
  const estEnv = Array.from({length:numBands},()=>new Float64Array(numFrames));

  for(let f=0;f<numFrames;f++){
    const start = f*hopLen;
    const re1=new Float64Array(frameLen), im1=new Float64Array(frameLen);
    const re2=new Float64Array(frameLen), im2=new Float64Array(frameLen);
    for(let i=0;i<frameLen&&start+i<n;i++){
      re1[i]=reference[start+i]*win[i];
      re2[i]=estimated[start+i]*win[i];
    }
    fft(re1,im1); fft(re2,im2);

    for(let b=0;b<numBands;b++){
      const fc  = bands[b];
      const fl  = fc/Math.pow(2,1/6);
      const fh  = fc*Math.pow(2,1/6);
      const binL = Math.floor(fl*frameLen/sr);
      const binH = Math.ceil(fh*frameLen/sr);
      let e1=0,e2=0;
      for(let k=binL;k<=Math.min(binH,frameLen/2-1);k++){
        e1+=re1[k]**2+im1[k]**2;
        e2+=re2[k]**2+im2[k]**2;
      }
      refEnv[b][f]=Math.sqrt(e1);
      estEnv[b][f]=Math.sqrt(e2);
    }
  }

  // Correlation per band, averaged
  let totalCorr=0;
  for(let b=0;b<numBands;b++){
    const r=refEnv[b], e=estEnv[b];
    let rMean=0,eMean=0;
    for(let f=0;f<numFrames;f++){rMean+=r[f];eMean+=e[f];}
    rMean/=numFrames; eMean/=numFrames;

    let num=0,den1=0,den2=0;
    for(let f=0;f<numFrames;f++){
      const rd=r[f]-rMean, ed=e[f]-eMean;
      num+=rd*ed; den1+=rd**2; den2+=ed**2;
    }
    const corr=Math.sqrt(den1*den2)>1e-12 ? num/Math.sqrt(den1*den2) : 0;
    totalCorr+=Math.max(0,Math.min(1,corr));
  }

  return numBands>0 ? totalCorr/numBands : 0;
}

// ── PESQ Proxy ────────────────────────────────────────────────────────────────
// Approximation of PESQ (ITU-T P.862) using perceptual features
// NOT the full ITU standard — approximation for fast evaluation
// Correlates with PESQ via: LSD + SNR + STOI combination

export interface PESQProxy {
  mos:        number;   // 1.0-4.5 MOS-LQO approximation
  mosLqo:     number;   // mapped MOS-LQO
  snrDb:      number;
  lsd:        number;
  stoi:       number;
  siSdr:      number;
  confidence: number;   // 0-1 confidence in estimate
}

export function computePESQProxy(
  reference: Float32Array,
  estimated: Float32Array,
  sr:        number
): PESQProxy {
  const siSdr = computeSISDR(reference, estimated);
  const lsd   = computeLSD(reference, estimated, sr);
  const stoi  = computeSTOI(reference, estimated, sr);

  // SNR
  let sigPow=0, noisePow=0;
  const n = Math.min(reference.length, estimated.length);
  for(let i=0;i<n;i++){
    sigPow   += reference[i]**2;
    noisePow += (estimated[i]-reference[i])**2;
  }
  const snrDb = noisePow>1e-12 ? 10*Math.log10(sigPow/noisePow) : 40;

  // MOS approximation:
  // MOS ≈ 1 + 3.5*sigmoid(0.1*SI-SDR) * STOI * (1 - min(1, LSD/5))
  const sdrNorm  = 1/(1+Math.exp(-0.1*(siSdr-5)));
  const lsdPenalty = Math.max(0, 1-lsd/5);
  const mos = 1 + 3.5 * sdrNorm * stoi * lsdPenalty;
  const mosClamped = Math.max(1, Math.min(4.5, mos));

  // MOS-LQO mapping (P.862.2)
  const mosLqo = -0.0003*mosClamped**4 + 0.0058*mosClamped**3
               - 0.0401*mosClamped**2  + 0.1787*mosClamped + 0.8402;

  const confidence = Math.min(1, n/(sr*2)); // more confident with longer files

  return {
    mos:       Math.max(1,Math.min(4.5,mosClamped)),
    mosLqo:    Math.max(1,Math.min(4.5,mosLqo)),
    snrDb:     Math.min(40,snrDb),
    lsd,
    stoi,
    siSdr:     Math.max(-20,Math.min(40,siSdr)),
    confidence,
  };
}

// ── DNSMOS Proxy (Blind — no reference needed) ────────────────────────────────
// DNS Mean Opinion Score approximation without reference
// Uses spectral features + VAD + noise floor estimation

export interface DNSMOSResult {
  ovrl:   number;   // 1-5 overall MOS
  sig:    number;   // 1-5 signal quality
  bak:    number;   // 1-5 background noise quality
  p808:   number;   // P.808 MOS approximation
}

export function computeDNSMOSProxy(
  data: Float32Array,
  sr:   number
): DNSMOSResult {
  const fftSize = 512;
  const hop     = 256;
  const win     = buildHann(fftSize);
  const numBins = fftSize/2;

  let speechFrames=0, noiseFrames=0, totalFrames=0;
  let avgSnr=0, avgHfRatio=0, avgEntropy=0;

  for(let start=0;start+fftSize<=data.length;start+=hop){
    const re=new Float64Array(fftSize), im=new Float64Array(fftSize);
    for(let i=0;i<fftSize;i++) re[i]=data[start+i]*win[i];
    fft(re,im);

    let totalE=0, hfE=0, entropy=0;
    const mags=new Float64Array(numBins);
    for(let k=0;k<numBins;k++){
      mags[k]=Math.sqrt(re[k]**2+im[k]**2);
      totalE+=mags[k];
      if(k>fftSize*0.4) hfE+=mags[k];
    }

    for(let k=0;k<numBins;k++){
      const p=totalE>0?mags[k]/totalE:0;
      if(p>0) entropy-=p*Math.log2(p);
    }
    entropy/=Math.log2(numBins);

    let ms=0;
    for(let i=0;i<fftSize;i++) ms+=data[start+i]**2;
    const rmsDb=10*Math.log10(ms/fftSize+1e-10);

    if(rmsDb>-35) speechFrames++;
    else           noiseFrames++;

    const hfRatio=totalE>1e-12?hfE/totalE:0;

    // Estimate local SNR
    const speechE  = speechFrames>0 ? ms/fftSize : 1e-10;
    const sortedM  = Array.from(mags).sort((a,b)=>a-b);
    const noiseEst = sortedM[Math.floor(numBins*0.1)]**2;
    const localSnr = noiseEst>1e-12 ? 10*Math.log10(speechE/noiseEst) : 0;

    avgSnr      += localSnr;
    avgHfRatio  += hfRatio;
    avgEntropy  += entropy;
    totalFrames++;
  }

  if(totalFrames===0) return {ovrl:1,sig:1,bak:1,p808:1};
  avgSnr/=totalFrames; avgHfRatio/=totalFrames; avgEntropy/=totalFrames;

  const speechRatio = speechFrames/Math.max(1,totalFrames);

  // Signal quality: based on SNR + speech presence
  const sig = Math.max(1,Math.min(5,
    1 + 2*Math.min(1,speechRatio) + 2*Math.min(1,avgSnr/30)
  ));

  // Background quality: inverse of noise features
  const noisePenalty = avgHfRatio*2 + (1-speechRatio);
  const bak = Math.max(1,Math.min(5, 5-noisePenalty*2));

  // Overall
  const ovrl = Math.max(1,Math.min(5, (sig*0.4+bak*0.4+avgEntropy*0.2*5)));

  // P.808 approximation
  const p808 = Math.max(1,Math.min(5, 0.3*sig+0.4*bak+0.3*ovrl));

  return { ovrl, sig, bak, p808 };
}

// ── Full Quality Report ───────────────────────────────────────────────────────

export interface AudioQualityReport {
  siSdr:       number;
  lsd:         number;
  stoi:        number;
  pesqProxy:   PESQProxy | null;
  dnsmos:      DNSMOSResult;
  snrDb:       number;
  hasReference: boolean;
  grade:       "excellent"|"good"|"fair"|"poor"|"bad";
  score:       number;  // 0-100
}

export function computeFullQualityReport(
  estimated:  Float32Array,
  sr:         number,
  reference?: Float32Array
): AudioQualityReport {
  const dnsmos = computeDNSMOSProxy(estimated, sr);
  const hasRef = !!reference && reference.length > 0;

  let siSdr=0, lsd=0, stoi=0, pesqProxy: PESQProxy|null=null, snrDb=0;

  if(hasRef && reference) {
    siSdr      = computeSISDR(reference, estimated);
    lsd        = computeLSD(reference, estimated, sr);
    stoi       = computeSTOI(reference, estimated, sr);
    pesqProxy  = computePESQProxy(reference, estimated, sr);
    snrDb      = pesqProxy.snrDb;
  }

  // Score: weighted combination
  const score = hasRef
    ? Math.round(Math.max(0,Math.min(100,
        (Math.max(0,Math.min(1,(siSdr+10)/30))*30) +
        (stoi*30) +
        ((dnsmos.ovrl-1)/4*25) +
        (Math.max(0,1-lsd/3)*15)
      )))
    : Math.round((dnsmos.ovrl-1)/4*100);

  const grade =
    score>=90?"excellent":score>=75?"good":score>=55?"fair":score>=35?"poor":"bad";

  return { siSdr, lsd, stoi, pesqProxy, dnsmos, snrDb, hasReference:hasRef, grade, score };
}
