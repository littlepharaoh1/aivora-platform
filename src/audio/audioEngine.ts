export type AudioMetrics = {
  duration: number;
  sampleRate: number;
  channels: number;
  peakDb: number;
  rmsDb: number;
  noiseDb: number;
  clippingCount: number;
};

function db(v: number) {
  return 20 * Math.log10(Math.max(v, 1e-12));
}

export function analyzeBuffer(buffer: AudioBuffer): AudioMetrics {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  let peak = 0;
  let sum = 0;
  let count = 0;
  let clippingCount = 0;
  const lows: number[] = [];

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);

    for (let i = 0; i < data.length; i++) {
      const s = data[i];
      const a = Math.abs(s);

      if (a > peak) peak = a;
      if (a >= 0.999) clippingCount++;

      sum += s * s;
      count++;

      if (i % 32 === 0) lows.push(a);
    }
  }

  lows.sort((a, b) => a - b);
  const slice = lows.slice(0, Math.max(64, Math.floor(lows.length * 0.1)));

  const rms = Math.sqrt(sum / Math.max(1, count));
  const noise = Math.sqrt(
    slice.reduce((acc, x) => acc + x * x, 0) /
      Math.max(1, slice.length)
  );

  return {
    duration,
    sampleRate,
    channels,
    peakDb: db(peak),
    rmsDb: db(rms),
    noiseDb: db(noise),
    clippingCount,
  };
  }
