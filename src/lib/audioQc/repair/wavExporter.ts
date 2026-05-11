/**
 * wavExporter.ts — AudioBuffer to 16-bit PCM WAV Blob
 * Aivora Honest Audio Repair Suite — Batch 9
 */

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++)
    view.setUint8(offset + i, str.charCodeAt(i));
}

function clamp16(val: number): number {
  const s = Math.max(-1, Math.min(1, val));
  return s < 0 ? s * 0x8000 : s * 0x7FFF;
}

export interface WavExportResult {
  blob:     Blob;
  filename: string;
  sizeKb:   number;
}

export function exportToWav(
  buffer: AudioBuffer,
  suggestedName: string
): WavExportResult {
  const numChannels = buffer.numberOfChannels;
  const sampleRate  = buffer.sampleRate;
  const numSamples  = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign  = numChannels * bytesPerSample;
  const byteRate    = sampleRate * blockAlign;
  const dataSize    = numSamples * blockAlign;
  const bufferSize  = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view        = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0,  "RIFF");
  view.setUint32(4,  bufferSize - 8,   true);
  writeString(view, 8,  "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16,           true); // PCM chunk size
  view.setUint16(20, 1,            true); // PCM format
  view.setUint16(22, numChannels,  true);
  view.setUint32(24, sampleRate,   true);
  view.setUint32(28, byteRate,     true);
  view.setUint16(32, blockAlign,   true);
  view.setUint16(34, 16,           true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, dataSize,     true);

  // Interleaved PCM samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = clamp16(buffer.getChannelData(ch)[i]);
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  const blob     = new Blob([arrayBuffer], { type: "audio/wav" });
  const filename = suggestedName.replace(/\.wav$/i, "") + "_repaired.wav";

  return { blob, filename, sizeKb: Math.round(bufferSize / 1024) };
}

export function downloadWav(result: WavExportResult): void {
  const url  = URL.createObjectURL(result.blob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
