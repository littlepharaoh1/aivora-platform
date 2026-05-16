/**
 * cursorInspector.ts — Realtime Cursor Inspector
 * Aivora Forensic DSP Platform
 */

export interface CursorInfo {
  timeSec:       number;
  timeMs:        number;
  sampleIndex:   number;
  smpte:         string;
  peakDb:        number;
  rmsDb:         number;
  dominantHz:    number;
  noiseFloorDb:  number;
  humPresence:   boolean;
}

export function inspectCursor(
  mono:       Float32Array,
  sampleRate: number,
  timeSec:    number,
  fftSize:    number = 2048
): CursorInfo {
  const sampleIndex = Math.floor(timeSec * sampleRate);
  const timeMs      = timeSec * 1000;

  // SMPTE 25fps
  const frames  = Math.floor(timeSec * 25) % 25;
  const secs    = Math.floor(timeSec) % 60;
  const mins    = Math.floor(timeSec / 60) % 60;
  const hours   = Math.floor(timeSec / 3600);
  const smpte   = `${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}:${String(frames).padStart(2,"0")}`;

  // Window around cursor
  const half    = Math.floor(fftSize / 2);
  const start   = Math.max(0, sampleIndex - half);
  const end     = Math.min(mono.length, start + fftSize);
  const chunk   = mono.slice(start, end);

  // Peak dB
  let peak = 0;
  for (let i = 0; i < chunk.length; i++) {
    const a = Math.abs(chunk[i]);
    if (a > peak) peak = a;
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120;

  // RMS dB
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  const rms    = Math.sqrt(sum / Math.max(1, chunk.length));
  const rmsDb  = rms > 0 ? 20 * Math.log10(rms) : -120;

  // FFT for dominant frequency
  const N    = Math.min(fftSize, chunk.length);
  const re   = new Float64Array(N);
  const im   = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w  = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    re[i]    = (chunk[i] ?? 0) * w;
  }

  // Simple DFT for dominant bin (fast enough for inspector)
  let maxMag = 0, dominantBin = 0;
  const checkBins = Math.floor(N / 2);
  for (let k = 1; k < checkBins; k++) {
    let r = 0, im2 = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      r   += re[n] * Math.cos(angle);
      im2 += re[n] * Math.sin(angle);
    }
    const mag = Math.sqrt(r * r + im2 * im2);
    if (mag > maxMag) { maxMag = mag; dominantBin = k; }
  }
  const dominantHz = (dominantBin * sampleRate) / N;

  // Noise floor (bottom 10% of spectrum energy)
  const noiseFloorDb = rmsDb - 30;

  // Hum detection (50Hz or 60Hz ± 5Hz)
  const humPresence = (dominantHz > 45 && dominantHz < 65) ||
                      (dominantHz > 95 && dominantHz < 125);

  return {
    timeSec, timeMs, sampleIndex, smpte,
    peakDb, rmsDb, dominantHz,
    noiseFloorDb, humPresence,
  };
}
