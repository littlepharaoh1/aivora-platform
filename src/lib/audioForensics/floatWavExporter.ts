/**
 * floatWavExporter.ts — 32-bit Float WAV Export
 * Aivora Platform — Adobe-Grade Silence Repair System
 * Preserves existing 16-bit export — does NOT replace it
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WavFormatInfo {
  format:      "WAV_32_FLOAT" | "WAV_16_PCM";
  sampleRate:  number;
  channels:    number;
  durationMs:  number;
  bitDepth:    16 | 32;
  encoding:    "IEEE_FLOAT" | "PCM";
  sizeBytes:   number;
}

export interface FloatWavExportResult {
  blob:       Blob;
  filename:   string;
  sizeBytes:  number;
  formatInfo: WavFormatInfo;
}

export interface PcmWavExportResult {
  blob:       Blob;
  filename:   string;
  sizeBytes:  number;
  formatInfo: WavFormatInfo;
}

// ── 32-bit Float WAV Export ───────────────────────────────────────────────────

/**
 * Export AudioBuffer as 32-bit IEEE Float WAV
 * - Does NOT normalize unless requested
 * - Does NOT alter speech samples
 * - Preserves channel count, sample rate, duration
 */
export function exportFloat32Wav(
  buffer:    AudioBuffer,
  filename:  string,
  normalize  = false
): FloatWavExportResult {
  const sr         = buffer.sampleRate;
  const numCh      = buffer.numberOfChannels;
  const numFrames  = buffer.length;
  const bitDepth   = 32;
  const blockAlign = numCh * (bitDepth / 8);   // 4 bytes per sample per channel
  const byteRate   = sr * blockAlign;
  const dataSize   = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize  = headerSize + dataSize;

  const wavBuffer = new ArrayBuffer(totalSize);
  const view      = new DataView(wavBuffer);

  // Helper — write ASCII string
  const writeStr = (s: string, offset: number) => {
    for(let i=0;i<s.length;i++) view.setUint8(offset+i, s.charCodeAt(i));
  };

  // RIFF header
  writeStr("RIFF", 0);
  view.setUint32(4,  36 + dataSize, true);   // File size - 8
  writeStr("WAVE", 8);

  // fmt chunk — IEEE_FLOAT (format code 3)
  writeStr("fmt ", 12);
  view.setUint32(16, 16,     true);   // Chunk size
  view.setUint16(20, 3,      true);   // Format: 3 = IEEE Float
  view.setUint16(22, numCh,  true);
  view.setUint32(24, sr,     true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeStr("data", 36);
  view.setUint32(40, dataSize, true);

  // Optional normalization
  let gainFactor = 1.0;
  if(normalize){
    let peak=0;
    for(let ch=0;ch<numCh;ch++){
      const d=buffer.getChannelData(ch);
      for(let i=0;i<d.length;i++){
        const a=Math.abs(d[i]);
        if(a>peak) peak=a;
      }
    }
    if(peak>0&&peak<0.99) gainFactor=0.99/peak;
  }

  // Write interleaved 32-bit float samples
  const channels = Array.from({length:numCh},(_,ch)=>buffer.getChannelData(ch));
  let offset = headerSize;
  for(let i=0;i<numFrames;i++){
    for(let ch=0;ch<numCh;ch++){
      view.setFloat32(offset, channels[ch][i]*gainFactor, true);
      offset += 4;
    }
  }

  const blob      = new Blob([wavBuffer], {type:"audio/wav"});
  const durationMs = (numFrames/sr)*1000;
  const baseName  = filename.replace(/\.wav$/i,"");
  const outName   = `${baseName}_repaired_32f.wav`;

  return {
    blob,
    filename:  outName,
    sizeBytes: totalSize,
    formatInfo: {
      format:    "WAV_32_FLOAT",
      sampleRate: sr,
      channels:  numCh,
      durationMs,
      bitDepth:  32,
      encoding:  "IEEE_FLOAT",
      sizeBytes: totalSize,
    },
  };
}

// ── 16-bit PCM WAV Export (preserved, not removed) ───────────────────────────

/**
 * Export AudioBuffer as 16-bit PCM WAV
 * Kept for backward compatibility with existing repair suite
 */
export function exportPcm16Wav(
  buffer:   AudioBuffer,
  filename: string
): PcmWavExportResult {
  const sr         = buffer.sampleRate;
  const numCh      = buffer.numberOfChannels;
  const numFrames  = buffer.length;
  const bitDepth   = 16;
  const blockAlign = numCh * (bitDepth / 8);
  const byteRate   = sr * blockAlign;
  const dataSize   = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize  = headerSize + dataSize;

  const wavBuffer = new ArrayBuffer(totalSize);
  const view      = new DataView(wavBuffer);

  const writeStr = (s: string, offset: number) => {
    for(let i=0;i<s.length;i++) view.setUint8(offset+i, s.charCodeAt(i));
  };

  writeStr("RIFF", 0);
  view.setUint32(4,  36 + dataSize, true);
  writeStr("WAVE", 8);
  writeStr("fmt ", 12);
  view.setUint32(16, 16,       true);
  view.setUint16(20, 1,        true);   // PCM = 1
  view.setUint16(22, numCh,    true);
  view.setUint32(24, sr,       true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr("data", 36);
  view.setUint32(40, dataSize, true);

  const channels = Array.from({length:numCh},(_,ch)=>buffer.getChannelData(ch));
  let offset = headerSize;
  for(let i=0;i<numFrames;i++){
    for(let ch=0;ch<numCh;ch++){
      const s=Math.max(-1,Math.min(1,channels[ch][i]));
      view.setInt16(offset, s<0 ? s*0x8000 : s*0x7FFF, true);
      offset += 2;
    }
  }

  const blob      = new Blob([wavBuffer], {type:"audio/wav"});
  const durationMs = (numFrames/sr)*1000;
  const baseName  = filename.replace(/\.wav$/i,"");
  const outName   = `${baseName}_repaired.wav`;

  return {
    blob,
    filename:  outName,
    sizeBytes: totalSize,
    formatInfo: {
      format:    "WAV_16_PCM",
      sampleRate: sr,
      channels:  numCh,
      durationMs,
      bitDepth:  16,
      encoding:  "PCM",
      sizeBytes: totalSize,
    },
  };
}

// ── Download Helper ───────────────────────────────────────────────────────────

export function downloadWavBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Format Info Display ───────────────────────────────────────────────────────

export function formatInfoToString(info: WavFormatInfo): string {
  const mb = (info.sizeBytes / (1024*1024)).toFixed(1);
  return `${info.format} · ${info.sampleRate}Hz · ${info.channels}ch · ${info.bitDepth}-bit · ${(info.durationMs/1000).toFixed(2)}s · ${mb}MB`;
}
