/**
 * reverbDetector.ts — RT60 Reverb Time Estimation
 * Aivora Audio QC Engine
 */

export interface ReverbResult {
  rt60Ms:       number;
  environment:  "anechoic" | "studio" | "office" | "room" | "hall" | "bathroom";
  drr:          number;    // Direct-to-Reverberant Ratio (dB)
  clarity:      number;    // C50 — speech clarity measure
  problems:     string[];
}

function computeEDC(signal: Float32Array): Float32Array {
  // Energy Decay Curve (Schroeder integral)
  const edc    = new Float32Array(signal.length);
  let totalE   = 0;
  for (let i = 0; i < signal.length; i++) totalE += signal[i] * signal[i];
  let cumE = 0;
  for (let i = 0; i < signal.length; i++) {
    cumE     += signal[i] * signal[i];
    edc[i]    = 10 * Math.log10((totalE - cumE + 1e-10) / (totalE + 1e-10));
  }
  return edc;
}

function estimateRT60(edc: Float32Array, sampleRate: number): number {
  // Find where EDC drops from -5dB to -35dB, extrapolate to -60dB
  let t5 = -1, t35 = -1;
  for (let i = 0; i < edc.length; i++) {
    if (t5  < 0 && edc[i] <= -5)  t5  = i / sampleRate;
    if (t35 < 0 && edc[i] <= -35) t35 = i / sampleRate;
  }
  if (t5 < 0 || t35 < 0 || t35 <= t5) return 0;
  // RT60 = 2 * (t35 - t5)  [extrapolate 30dB range to 60dB]
  return (t35 - t5) * 2 * 1000; // in ms
}

function computeC50(signal: Float32Array, sampleRate: number): number {
  // C50: ratio of energy in first 50ms to rest
  const cut = Math.round(0.05 * sampleRate);
  let early = 0, late = 0;
  for (let i = 0; i < Math.min(cut, signal.length); i++)
    early += signal[i] * signal[i];
  for (let i = cut; i < signal.length; i++)
    late  += signal[i] * signal[i];
  if (late < 1e-10) return 40;
  return 10 * Math.log10(early / late);
}

function computeDRR(signal: Float32Array, sampleRate: number): number {
  // DRR: energy in first 2.5ms vs rest
  const cut = Math.round(0.0025 * sampleRate);
  let direct = 0, reverb = 0;
  for (let i = 0; i < Math.min(cut, signal.length); i++)
    direct += signal[i] * signal[i];
  for (let i = cut; i < signal.length; i++)
    reverb += signal[i] * signal[i];
  if (reverb < 1e-10) return 40;
  return 10 * Math.log10(direct / reverb);
}

export function detectReverb(buffer: AudioBuffer): ReverbResult {
  const sr   = buffer.sampleRate;
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += d[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;

  const edc     = computeEDC(mono);
  const rt60Ms  = estimateRT60(edc, sr);
  const c50     = computeC50(mono, sr);
  const drr     = computeDRR(mono, sr);

  // Classify environment
  let environment: ReverbResult["environment"] =
    rt60Ms < 50   ? "anechoic"  :
    rt60Ms < 150  ? "studio"    :
    rt60Ms < 300  ? "office"    :
    rt60Ms < 500  ? "room"      :
    rt60Ms < 900  ? "hall"      : "bathroom";

  // Special case: high DRR with long RT = bathroom
  if (rt60Ms > 400 && drr < 0) environment = "bathroom";

  const problems: string[] = [];
  if (rt60Ms > 300) problems.push(`High reverb: RT60 = ${rt60Ms.toFixed(0)}ms — ${environment}`);
  if (c50 < 0)      problems.push(`Poor speech clarity: C50 = ${c50.toFixed(1)}dB`);
  if (drr < -5)     problems.push(`Low DRR: ${drr.toFixed(1)}dB — reverb dominant`);

  return { rt60Ms, environment, drr, clarity: c50, problems };
}
