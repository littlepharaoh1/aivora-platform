/**
 * dynamicCompressor.ts — Dynamic Range Compression
 * Aivora Audio QC Engine
 */

export interface CompressorOptions {
  threshold: number;  // dB (default -24)
  ratio:     number;  // 1:N (default 4)
  attack:    number;  // ms (default 10)
  release:   number;  // ms (default 100)
  makeupGain: number; // dB (default 6)
}

export interface CompressorResult {
  buffer:      AudioBuffer;
  changed:     boolean;
  gainReductionDb: number;
  warnings:    string[];
}

export function compressDynamics(
  buffer:  AudioBuffer,
  options: CompressorOptions = { threshold:-24, ratio:4, attack:10, release:100, makeupGain:6 }
): CompressorResult {
  const { threshold, ratio, attack, release, makeupGain } = options;
  const sr       = buffer.sampleRate;
  const warnings: string[] = [];

  if (ratio > 20) warnings.push("High ratio may cause pumping artifacts");

  const attackSamples  = Math.round((attack  / 1000) * sr);
  const releaseSamples = Math.round((release / 1000) * sr);
  const thresholdLin   = Math.pow(10, threshold / 20);
  const makeupLin      = Math.pow(10, makeupGain / 20);

  const ctx    = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sr);
  const outBuf = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);

  let maxGainReduction = 0;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = outBuf.getChannelData(ch);
    let envelope = 0;

    for (let i = 0; i < src.length; i++) {
      const abs = Math.abs(src[i]);
      // Envelope follower
      if (abs > envelope) {
        envelope += (abs - envelope) / (attackSamples  + 1);
      } else {
        envelope += (abs - envelope) / (releaseSamples + 1);
      }

      // Gain computation
      let gain = 1.0;
      if (envelope > thresholdLin) {
        const excessDb  = 20 * Math.log10(envelope / thresholdLin);
        const reductionDb = excessDb * (1 - 1/ratio);
        gain = Math.pow(10, -reductionDb / 20);
        if (reductionDb > maxGainReduction) maxGainReduction = reductionDb;
      }

      dest[i] = Math.max(-1, Math.min(1, src[i] * gain * makeupLin));
    }
  }

  return { buffer: outBuf, changed: true, gainReductionDb: maxGainReduction, warnings };
}
