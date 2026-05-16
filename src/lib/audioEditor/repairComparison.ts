/**
 * repairComparison.ts — Before/After Repair Comparison & Confidence Heatmap
 * Aivora Forensic DSP Platform
 */

export interface RepairComparisonData {
  diffEnergy:     Float32Array;  // per-frame energy difference
  speechRisk:     Float32Array;  // 0-1 speech modification risk
  silenceChange:  Float32Array;  // 0-1 silence region change
  confidence:     Float32Array;  // 0-1 repair confidence
  numFrames:      number;
  durationSec:    number;
}

export function computeRepairComparison(
  original: Float32Array,
  repaired: Float32Array,
  sampleRate: number,
  windowSec: number = 0.02
): RepairComparisonData {
  const windowSamples = Math.floor(windowSec * sampleRate);
  const len = Math.min(original.length, repaired.length);
  const numFrames = Math.floor(len / windowSamples);

  const diffEnergy    = new Float32Array(numFrames);
  const speechRisk    = new Float32Array(numFrames);
  const silenceChange = new Float32Array(numFrames);
  const confidence    = new Float32Array(numFrames);

  for(let f=0; f<numFrames; f++) {
    const start = f * windowSamples;
    const end   = Math.min(len, start + windowSamples);

    let origRms=0, repRms=0, diffRms=0;
    for(let i=start; i<end; i++) {
      origRms += original[i]**2;
      repRms  += repaired[i]**2;
      diffRms += (repaired[i]-original[i])**2;
    }
    const n = end-start;
    origRms = Math.sqrt(origRms/n);
    repRms  = Math.sqrt(repRms/n);
    diffRms = Math.sqrt(diffRms/n);

    const origDb = origRms>1e-10 ? 20*Math.log10(origRms) : -120;
    const diffDb = diffRms>1e-10 ? 20*Math.log10(diffRms) : -120;

    diffEnergy[f] = Math.min(1, diffRms * 20);

    // Speech risk — high if original had speech AND diff is significant
    speechRisk[f] = origDb > -30 && diffDb > -60
      ? Math.min(1, diffRms/Math.max(1e-10,origRms))
      : 0;

    // Silence change — original was silent but now different
    silenceChange[f] = origDb < -50 && diffDb > -80
      ? Math.min(1, diffRms * 50)
      : 0;

    // Repair confidence — high if only silence changed (not speech)
    confidence[f] = speechRisk[f] < 0.1
      ? Math.max(0, 1 - silenceChange[f] * 2)
      : Math.max(0, 1 - speechRisk[f]);
  }

  return {
    diffEnergy, speechRisk, silenceChange, confidence,
    numFrames, durationSec: len/sampleRate,
  };
}

export function drawRepairHeatmap(
  canvas:  HTMLCanvasElement,
  data:    RepairComparisonData,
  opts: {
    zoom:      number;
    panOffset: number;
    height:    number;
    width:     number;
    mode:      "diff"|"speech"|"silence"|"confidence";
  }
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx || data.numFrames===0) return;
  const {zoom, panOffset, height, width, mode} = opts;

  const map = mode==="diff"       ? data.diffEnergy   :
              mode==="speech"     ? data.speechRisk    :
              mode==="silence"    ? data.silenceChange :
                                    data.confidence;

  const frameDur = data.durationSec / data.numFrames;

  for(let f=0; f<data.numFrames; f++) {
    const sec = f * frameDur;
    const x1  = (sec - panOffset) * zoom;
    const x2  = ((sec+frameDur) - panOffset) * zoom;
    if(x2<0||x1>width) continue;

    const val = map[f];
    if(val < 0.01) continue;

    let color: string;
    if(mode==="speech") {
      // Speech risk — RED glow
      color = `rgba(239,68,68,${Math.min(0.85,val*0.85)})`;
    } else if(mode==="silence") {
      // Silence change — CYAN
      color = `rgba(34,211,238,${Math.min(0.7,val*0.7)})`;
    } else if(mode==="confidence") {
      // Confidence — GREEN=good, RED=bad
      const r = Math.floor(val<0.5 ? 255 : (1-val)*2*255);
      const g = Math.floor(val>0.5 ? 255 : val*2*255);
      color = `rgba(${r},${g},0,${Math.min(0.6,val*0.4+0.1)})`;
    } else {
      // Diff energy — YELLOW
      color = `rgba(251,191,36,${Math.min(0.7,val*0.7)})`;
    }

    ctx.fillStyle = color;
    ctx.fillRect(x1, 0, Math.max(1,x2-x1), height);

    // Top intensity bar
    const barH = val * 4;
    ctx.fillStyle = color.replace(/[\d.]+\)$/, "0.9)");
    ctx.fillRect(x1, 0, Math.max(1,x2-x1), barH);
  }
}
