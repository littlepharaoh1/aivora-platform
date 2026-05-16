/**
 * forensicSilenceOverlay.ts — Forensic Silence & Anomaly Overlay
 * Aivora Forensic DSP Platform
 */

export interface SilenceRegion {
  startSec: number;
  endSec:   number;
  type:     "digital" | "room" | "hum" | "repaired";
  rmsDb:    number;
}

export interface ForensicOverlayData {
  silenceRegions: SilenceRegion[];
  humBands:       number[];   // Hz
  peakSec:        number[];   // transient positions
}

export function analyzeSilence(
  mono:       Float32Array,
  sampleRate: number,
  options: {
    silenceThreshDb?: number;  // default -60
    roomToneThreshDb?: number; // default -40
    windowSec?: number;        // default 0.05
  } = {}
): ForensicOverlayData {
  const silenceThreshDb  = options.silenceThreshDb  ?? -60;
  const roomToneThreshDb = options.roomToneThreshDb  ?? -40;
  const windowSec        = options.windowSec         ?? 0.05;
  const windowSamples    = Math.floor(windowSec * sampleRate);

  const silenceRegions: SilenceRegion[] = [];
  const peakSec: number[] = [];
  let inSilence   = false;
  let silenceStart = 0;
  let prevRms     = 0;

  for (let i = 0; i + windowSamples < mono.length; i += windowSamples) {
    let sum = 0;
    for (let j = i; j < i + windowSamples; j++) sum += mono[j] * mono[j];
    const rms   = Math.sqrt(sum / windowSamples);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -120;
    const sec   = i / sampleRate;

    // Transient detection
    if (prevRms > 0 && rms / prevRms > 8) peakSec.push(sec);
    prevRms = rms;

    // Silence detection
    if (rmsDb < silenceThreshDb) {
      if (!inSilence) { inSilence = true; silenceStart = sec; }
    } else {
      if (inSilence) {
        inSilence = false;
        silenceRegions.push({
          startSec: silenceStart,
          endSec:   sec,
          type:     "digital",
          rmsDb,
        });
      }
      // Room tone detection
      if (rmsDb < roomToneThreshDb && rmsDb > silenceThreshDb) {
        silenceRegions.push({
          startSec: sec,
          endSec:   sec + windowSec,
          type:     "room",
          rmsDb,
        });
      }
    }
  }

  return { silenceRegions, humBands: [50, 100, 150, 200], peakSec };
}

export function drawForensicOverlay(
  canvas:  HTMLCanvasElement,
  data:    ForensicOverlayData,
  opts: {
    zoom:      number;
    panOffset: number;
    height:    number;
    width:     number;
    duration:  number;
  }
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { zoom, panOffset, height, width } = opts;

  // Draw silence regions
  for (const region of data.silenceRegions) {
    const x1 = (region.startSec - panOffset) * zoom;
    const x2 = (region.endSec   - panOffset) * zoom;
    if (x2 < 0 || x1 > width) continue;

    const color = region.type === "digital" ? "rgba(34,211,238,0.15)" :
                  region.type === "room"    ? "rgba(251,191,36,0.10)" :
                  region.type === "repaired"? "rgba(0,255,136,0.12)"  :
                                              "rgba(239,68,68,0.12)";
    ctx.fillStyle = color;
    ctx.fillRect(x1, 0, x2 - x1, height);

    // Border
    ctx.strokeStyle = color.replace("0.1", "0.4").replace("0.15","0.5").replace("0.12","0.4");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, 0); ctx.lineTo(x1, height);
    ctx.moveTo(x2, 0); ctx.lineTo(x2, height);
    ctx.stroke();
  }

  // Draw transient markers
  for (const sec of data.peakSec) {
    const x = (sec - panOffset) * zoom;
    if (x < 0 || x > width) continue;
    ctx.strokeStyle = "rgba(239,68,68,0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
