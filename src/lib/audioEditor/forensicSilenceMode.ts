/**
 * forensicSilenceMode.ts — Forensic Silence Analysis & Visualization
 * Aivora Forensic DSP Platform
 */

export interface SilenceSegment {
  startSec:      number;
  endSec:        number;
  rmsDb:         number;
  humScore:      number;      // 0-1
  hissScore:     number;      // 0-1
  seamScore:     number;      // 0-1
  purityScore:   number;      // 0=contaminated 1=clean
  type:          "digital"|"room"|"hum"|"hiss"|"seam"|"repaired"|"clean";
}

export interface ForensicSilenceReport {
  segments:        SilenceSegment[];
  overallPurity:   number;   // 0-1
  humBands:        number[]; // detected hum frequencies Hz
  noiseFloorDb:    number;
  contaminationPct: number;  // 0-100
}

// ── Analyze ───────────────────────────────────────────────────────────────────

export function analyzeForensicSilence(
  mono:       Float32Array,
  sampleRate: number,
  fftSize:    number = 2048
): ForensicSilenceReport {
  const hopSec    = 0.05;   // 50ms windows — less sensitive
  const hopSamples = Math.floor(hopSec * sampleRate);
  const segments: SilenceSegment[] = [];
  const humBands: number[] = [];

  let totalPurity = 0;
  let segCount    = 0;
  let noiseFloorDb = -120;
  let contaminatedSec = 0;
  let totalSilenceSec = 0;

  for (let start = 0; start + hopSamples < mono.length; start += hopSamples) {
    const end = Math.min(start + hopSamples, mono.length);
    const chunk = mono.slice(start, end);
    const startSec = start / sampleRate;
    const endSec   = end   / sampleRate;

    // RMS
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms   = Math.sqrt(sum / chunk.length);
    const rmsDb = rms > 1e-10 ? 20 * Math.log10(rms) : -120;

    if (rmsDb > -30) continue; // skip speech regions

    totalSilenceSec += hopSec;

    // Simple FFT for hum/hiss detection
    const N    = Math.min(fftSize, chunk.length);
    const bins = new Float32Array(N / 2);
    for (let k = 1; k < N / 2; k++) {
      let re = 0, im = 0;
      const step = Math.max(1, Math.floor(N / 64)); // fast approximation
      for (let n = 0; n < N; n += step) {
        const angle = (2 * Math.PI * k * n) / N;
        re += chunk[n] * Math.cos(angle);
        im += chunk[n] * Math.sin(angle);
      }
      bins[k] = Math.sqrt(re*re + im*im);
    }

    // Hum detection (50/60Hz harmonics)
    const bin50  = Math.round(50  * N / sampleRate);
    const bin60  = Math.round(60  * N / sampleRate);
    const bin100 = Math.round(100 * N / sampleRate);
    const bin120 = Math.round(120 * N / sampleRate);
    const avgBin = bins.reduce((a,b) => a+b, 0) / bins.length;
    const humScore = Math.min(1, (
      (bins[bin50]  ?? 0) +
      (bins[bin60]  ?? 0) +
      (bins[bin100] ?? 0) +
      (bins[bin120] ?? 0)
    ) / (avgBin * 20 + 1e-10));

    if (humScore > 0.3) {
      if (!humBands.includes(50))  humBands.push(50);
      if (!humBands.includes(100)) humBands.push(100);
    }

    // Hiss detection (high freq energy ratio)
    const lowEnergy  = bins.slice(0,  N/8).reduce((a,b) => a+b, 0);
    const highEnergy = bins.slice(N/4, N/2).reduce((a,b) => a+b, 0);
    const hissScore  = Math.min(1, highEnergy / (lowEnergy + 1e-10) * 0.5);

    // Seam detection (RMS discontinuity)
    const seamScore = rmsDb > -50 && rmsDb < -20 ? 0.5 : 0;

    // Purity score
    const purityScore = Math.max(0, 1 - humScore*0.4 - hissScore*0.3 - seamScore*0.3);

    // Type classification — stricter thresholds
    let type: SilenceSegment["type"] = "clean";
    if (rmsDb < -90)         type = "digital";
    else if (humScore > 0.7) type = "hum";
    else if (hissScore > 0.7) type = "hiss";
    else if (seamScore > 0.6) type = "seam";
    else if (rmsDb > -45 && rmsDb < -30) type = "room";

    if (type !== "clean" && type !== "digital") contaminatedSec += hopSec;

    noiseFloorDb = Math.max(noiseFloorDb, rmsDb);
    totalPurity += purityScore;
    segCount++;

    segments.push({ startSec, endSec, rmsDb, humScore, hissScore, seamScore, purityScore, type });
  }

  return {
    segments,
    overallPurity:    segCount > 0 ? totalPurity / segCount : 1,
    humBands,
    noiseFloorDb,
    contaminationPct: totalSilenceSec > 0 ? (contaminatedSec / totalSilenceSec) * 100 : 0,
  };
}

// ── Draw Forensic Silence Overlay ─────────────────────────────────────────────

export function drawForensicSilenceOverlay(
  canvas:  HTMLCanvasElement,
  report:  ForensicSilenceReport,
  opts: {
    zoom:      number;
    panOffset: number;
    height:    number;
    width:     number;
  }
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { zoom, panOffset, height, width } = opts;

  const TYPE_COLORS: Record<string, string> = {
    digital:  "rgba(34,211,238,0.15)",
    room:     "rgba(251,191,36,0.12)",
    hum:      "rgba(239,68,68,0.20)",
    hiss:     "rgba(168,85,247,0.15)",
    seam:     "rgba(255,50,50,0.30)",
    repaired: "rgba(0,255,136,0.15)",
    clean:    "rgba(0,255,136,0.00)",
  };

  for (const seg of report.segments) {
    const x1 = (seg.startSec - panOffset) * zoom;
    const x2 = (seg.endSec   - panOffset) * zoom;
    if (x2 < 0 || x1 > width) continue;

    // Fill
    ctx.fillStyle = TYPE_COLORS[seg.type] ?? "rgba(255,255,255,0.05)";
    ctx.fillRect(x1, 0, Math.max(1, x2-x1), height);

    // Seam glow
    if (seg.type === "seam") {
      ctx.shadowColor = "#ff3232";
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = "rgba(255,50,50,0.8)";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x1, 0); ctx.lineTo(x1, height);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Contamination intensity bar at bottom
    const intensity = 1 - seg.purityScore;
    if (intensity > 0.1) {
      const barH = intensity * 6;
      ctx.fillStyle = `rgba(239,68,68,${intensity * 0.8})`;
      ctx.fillRect(x1, height - barH, Math.max(1,x2-x1), barH);
    }
  }

  // Hum band lines
  for (const hz of report.humBands) {
    ctx.strokeStyle = "rgba(239,68,68,0.4)";
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, height * 0.1);
    ctx.lineTo(width, height * 0.1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(239,68,68,0.7)";
    ctx.font = "8px monospace";
    ctx.fillText(`${hz}Hz HUM`, 4, height * 0.1 - 2);
  }
}
