/**
 * roomFingerprint.ts — Acoustic Room Environment Fingerprinting
 * Aivora Audio Infrastructure Platform
 *
 * Extracts acoustic signature of recording environment:
 * - RT60 per frequency band (room decay fingerprint)
 * - Early reflection pattern (room geometry signature)
 * - Modal resonances (room standing waves)
 * - Background noise profile (environment signature)
 * - Reverberation fingerprint (RIR-inspired)
 *
 * Applications:
 * - Verify recordings made in same room
 * - Detect room switching (edited recordings)
 * - Dataset provenance validation
 * - Forensic audio authentication
 *
 * Reference:
 * - Schroeder (1965) backward integration RT60
 * - Papini & Farina (2001) room fingerprinting
 * - Perrot & Baudoin (2006) acoustic scene identification
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoomFingerprint {
  readonly rt60PerBand:      Float32Array;   // RT60 ms per octave band
  readonly earlyReflections: Float32Array;   // energy in early reflection windows
  readonly modalResonances:  ModalResonance[];
  readonly noiseProfile:     Float32Array;   // background noise per band
  readonly overallRT60Ms:    number;
  readonly roomVolumeMl:     number;         // estimated volume (Sabine formula)
  readonly signature:        Float32Array;   // 32-dim compact signature
}

export interface ModalResonance {
  freqHz:      number;
  decayMs:     number;
  magnitude:   number;
}

export interface RoomMatch {
  similarity:  number;   // 0-1
  isMatch:     boolean;
  rt60Match:   number;
  noiseMatch:  number;
  confidence:  number;
}

// ── Octave Band Centers (ISO 266) ─────────────────────────────────────────────

const OCTAVE_CENTERS = [63, 125, 250, 500, 1000, 2000, 4000, 8000]; // Hz
const NUM_BANDS      = OCTAVE_CENTERS.length;
const MATCH_THRESH   = 0.82;

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

// ── Bandpass Filter (2nd order Butterworth) ───────────────────────────────────

function bandpassFilter(
  data:   Float32Array,
  sr:     number,
  freqHz: number,
  bwOct:  number = 1.0
): Float32Array {
  const fLow  = freqHz / Math.pow(2, bwOct/2);
  const fHigh = freqHz * Math.pow(2, bwOct/2);
  const wLow  = 2*Math.PI*fLow/sr;
  const wHigh = 2*Math.PI*fHigh/sr;

  // Simple 1st order IIR approximation (computationally light)
  const aHigh = Math.exp(-wHigh);
  const aLow  = Math.exp(-wLow);
  const out   = new Float32Array(data.length);
  let   hpPrev = 0, lpPrev = 0;

  for(let i=0;i<data.length;i++){
    // HP then LP
    const hp = (1+aHigh)/2*(data[i]-hpPrev) + aHigh*lpPrev;
    hpPrev = data[i]; lpPrev = hp;
    out[i]  = (1-aLow)*hp + aLow*(i>0?out[i-1]:0);
  }

  return out;
}

// ── RT60 per Band (Schroeder) ─────────────────────────────────────────────────

function computeRT60Band(
  bandData: Float32Array,
  sr:       number
): number {
  const frameLen = Math.floor(0.01*sr); // 10ms frames
  const energies: number[] = [];

  for(let s=0;s+frameLen<=bandData.length;s+=frameLen){
    let e=0;
    for(let i=s;i<s+frameLen;i++) e+=bandData[i]**2;
    energies.push(e/frameLen);
  }

  // Backward integration (Schroeder)
  const edc=new Float64Array(energies.length);
  let cum=0;
  for(let i=energies.length-1;i>=0;i--){cum+=energies[i];edc[i]=cum;}

  const maxE=edc[0];
  if(maxE<1e-12) return 0;

  let t5=-1, t25=-1;
  for(let i=0;i<edc.length;i++){
    const db=10*Math.log10(edc[i]/maxE+1e-15);
    if(t5<0&&db<=-5)  t5=i;
    if(t25<0&&db<=-25) t25=i;
  }

  if(t5<0||t25<0) return 300; // fallback
  const t20=(t25-t5)*frameLen/sr*1000;
  return Math.max(10, Math.min(5000, t20*3));
}

// ── Early Reflection Analysis ─────────────────────────────────────────────────

function analyzeEarlyReflections(
  data: Float32Array,
  sr:   number
): Float32Array {
  const windows = [5, 10, 20, 40, 80, 160]; // ms
  const energy  = new Float32Array(windows.length);

  // Find onset (loudest transient)
  let maxE=0, onset=0;
  const frameLen=Math.floor(0.005*sr);
  for(let s=0;s+frameLen<=data.length;s+=frameLen){
    let e=0; for(let i=s;i<s+frameLen;i++) e+=data[i]**2;
    if(e>maxE){maxE=e;onset=s;}
  }

  // Energy in each window after onset
  for(let w=0;w<windows.length;w++){
    const winEnd=Math.min(data.length, onset+Math.floor(windows[w]*sr/1000));
    let e=0;
    for(let i=onset;i<winEnd;i++) e+=data[i]**2;
    energy[w]=e>0?10*Math.log10(e+1e-15):-120;
  }

  // Normalize
  const maxEn=energy.reduce((m,v)=>Math.max(m,v),-120);
  for(let w=0;w<windows.length;w++) energy[w]=(energy[w]-maxEn)/60+1; // 0-1

  return energy;
}

// ── Modal Resonance Detection ─────────────────────────────────────────────────

function detectModalResonances(
  data: Float32Array,
  sr:   number
): ModalResonance[] {
  const FFT_N = 16384; // very high resolution for room modes
  const resonances: ModalResonance[] = [];
  if(data.length < FFT_N) return resonances;

  const re=new Float64Array(FFT_N), im=new Float64Array(FFT_N);
  for(let i=0;i<FFT_N;i++) re[i]=data[i];
  fft(re,im);

  const mag=new Float64Array(FFT_N/2);
  for(let k=0;k<FFT_N/2;k++) mag[k]=Math.sqrt(re[k]**2+im[k]**2);

  // Look for peaks below 300Hz (typical room modes)
  const maxBin=Math.floor(300/(sr/2)*FFT_N/2);
  for(let k=2;k<Math.min(maxBin,mag.length-2);k++){
    if(mag[k]>mag[k-1]&&mag[k]>mag[k+1]&&mag[k]>mag[k-2]&&mag[k]>mag[k+2]){
      const freqHz=k*sr/(FFT_N);
      const magnitudeDb=mag[k]>0?20*Math.log10(mag[k]):-120;
      if(magnitudeDb>-80&&resonances.length<8){
        // Estimate decay via neighboring bins
        const decayMs=500/(freqHz+1)*100; // simplified
        resonances.push({freqHz:Math.round(freqHz*10)/10, decayMs, magnitude:magnitudeDb});
      }
    }
  }

  return resonances.sort((a,b)=>b.magnitude-a.magnitude).slice(0,5);
}

// ── Background Noise Profile ──────────────────────────────────────────────────

function extractNoiseProfile(
  data: Float32Array,
  sr:   number
): Float32Array {
  const profile = new Float32Array(NUM_BANDS);

  for(let b=0;b<NUM_BANDS;b++){
    const band = bandpassFilter(data, sr, OCTAVE_CENTERS[b]);
    // Take lowest 10% energy frames as noise
    const frameLen=Math.floor(0.02*sr);
    const energies:number[]=[];
    for(let s=0;s+frameLen<=band.length;s+=frameLen){
      let e=0; for(let i=s;i<s+frameLen;i++) e+=band[i]**2;
      energies.push(e/frameLen);
    }
    energies.sort((a,b)=>a-b);
    const noiseE=energies[Math.floor(energies.length*0.1)]??0;
    profile[b]=noiseE>0?10*Math.log10(noiseE):-120;
  }

  return profile;
}

// ── Compact Signature ─────────────────────────────────────────────────────────

function buildRoomSignature(
  rt60:  Float32Array,
  noise: Float32Array,
  early: Float32Array
): Float32Array {
  const sig=new Float32Array(32);

  // RT60 normalized (0=short, 1=long)
  const maxRT=rt60.reduce((m,v)=>Math.max(m,v),0)+1;
  for(let i=0;i<NUM_BANDS&&i<16;i++) sig[i]=rt60[i]/maxRT;

  // Noise profile normalized
  const minN=noise.reduce((m,v)=>Math.min(m,v),0);
  const maxN=noise.reduce((m,v)=>Math.max(m,v),-120);
  const rngN=maxN-minN+1e-10;
  for(let i=0;i<NUM_BANDS&&i<12;i++) sig[16+i]=(noise[i]-minN)/rngN;

  // Early reflections
  for(let i=0;i<6;i++) sig[28+i]=early[i]??0;

  return sig;
}

// ── Sabine Room Volume Estimate ───────────────────────────────────────────────

function estimateRoomVolume(rt60Ms: number, absorptionCoeff = 0.15): number {
  // Sabine: RT60 = 0.161 * V / (S * alpha)
  // Assuming typical room proportions: S ≈ 6 * V^(2/3)
  // Simplified: V ≈ (RT60 * S * alpha) / 0.161
  const rt60s = rt60Ms / 1000;
  const V_est = Math.pow(rt60s / 0.161 * 50 * absorptionCoeff, 1.5);
  return Math.round(Math.max(1, Math.min(10000, V_est)));
}

// ── Main API ──────────────────────────────────────────────────────────────────

export function extractRoomFingerprint(
  data: Float32Array,
  sr:   number
): RoomFingerprint {
  const rt60PerBand = new Float32Array(NUM_BANDS);

  for(let b=0;b<NUM_BANDS;b++){
    const band = bandpassFilter(data, sr, OCTAVE_CENTERS[b]);
    rt60PerBand[b] = Math.round(computeRT60Band(band, sr));
  }

  const overallRT60Ms = rt60PerBand.reduce((a,b)=>a+b)/NUM_BANDS;
  const earlyRefl     = analyzeEarlyReflections(data, sr);
  const modalRes      = detectModalResonances(data, sr);
  const noiseProfile  = extractNoiseProfile(data, sr);
  const signature     = buildRoomSignature(rt60PerBand, noiseProfile, earlyRefl);
  const roomVolume    = estimateRoomVolume(overallRT60Ms);

  return {
    rt60PerBand,
    earlyReflections: earlyRefl,
    modalResonances:  modalRes,
    noiseProfile,
    overallRT60Ms:    Math.round(overallRT60Ms),
    roomVolumeMl:     roomVolume,
    signature,
  };
}

export function compareRoomFingerprints(
  a: RoomFingerprint,
  b: RoomFingerprint
): RoomMatch {
  // Cosine similarity on compact signatures
  let dot=0,nA=0,nB=0;
  for(let i=0;i<32;i++){
    dot+=a.signature[i]*b.signature[i];
    nA+=a.signature[i]**2; nB+=b.signature[i]**2;
  }
  const similarity=Math.sqrt(nA*nB)>0?dot/Math.sqrt(nA*nB):0;

  // RT60 match
  let rt60Dot=0,rA=0,rB=0;
  for(let i=0;i<NUM_BANDS;i++){
    rt60Dot+=a.rt60PerBand[i]*b.rt60PerBand[i];
    rA+=a.rt60PerBand[i]**2; rB+=b.rt60PerBand[i]**2;
  }
  const rt60Match=Math.sqrt(rA*rB)>0?rt60Dot/Math.sqrt(rA*rB):0;

  // Noise match
  let noiseDot=0,nnA=0,nnB=0;
  for(let i=0;i<NUM_BANDS;i++){
    const na=a.noiseProfile[i]+120, nb=b.noiseProfile[i]+120;
    noiseDot+=na*nb; nnA+=na**2; nnB+=nb**2;
  }
  const noiseMatch=Math.sqrt(nnA*nnB)>0?noiseDot/Math.sqrt(nnA*nnB):0;

  return {
    similarity:  Math.round(similarity*1000)/1000,
    isMatch:     similarity>=MATCH_THRESH,
    rt60Match:   Math.round(rt60Match*1000)/1000,
    noiseMatch:  Math.round(noiseMatch*1000)/1000,
    confidence:  Math.round(Math.min(1,Math.abs(similarity-0.5)*2)*1000)/1000,
  };
}
