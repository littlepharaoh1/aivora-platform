/**
 * audioBufferUtils.ts — AudioBuffer utilities
 * Aivora Waveform Workstation
 */

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1)
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

export function cloneBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels, buffer.length, buffer.sampleRate
  );
  const clone = ctx.createBuffer(
    buffer.numberOfChannels, buffer.length, buffer.sampleRate
  );
  for (let ch = 0; ch < buffer.numberOfChannels; ch++)
    clone.getChannelData(ch).set(buffer.getChannelData(ch));
  return clone;
}

export function sliceBuffer(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number
): AudioBuffer {
  const length = endSample - startSample;
  const ctx    = new OfflineAudioContext(
    buffer.numberOfChannels, length, buffer.sampleRate
  );
  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src  = buffer.getChannelData(ch);
    const dest = out.getChannelData(ch);
    dest.set(src.subarray(startSample, endSample));
  }
  return out;
}

export function formatTime(seconds: number): string {
  const m   = Math.floor(seconds / 60);
  const s   = Math.floor(seconds % 60);
  const ms  = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}

export function samplesToSeconds(samples: number, sampleRate: number): number {
  return samples / sampleRate;
}

export function secondsToSamples(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}
