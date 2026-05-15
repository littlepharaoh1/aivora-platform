/**
 * spectrogramPro.ts — Professional Spectrogram Renderer
 * High quality, cached, logarithmic frequency scale
 * Aivora Platform
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpectrogramProOptions {
  fftSize?:       number;    // 1024/2048/4096/8192 — default 4096
  minDb?:         number;    // default -90
  maxDb?:         number;    // default -10
  gain?:          number;    // brightness boost 0-3 — default 1.2
  logFreq?:       boolean;   // logarithmic frequency — default true
  colorMap?:      "plasma"|"viridis"|"inferno"|"aivora";
  showGrid?:      boolean;
  showLabels?:    boolean;
}

export interface SpectrogramProData {
  frames:         Float32Array[];
  numFrames:      number;
  numBins:        number;
  minDb:          number;
  maxDb:          number;
  sampleRate:     number;
  fftSize:        number;
  durationSec:    number;
}

// ── Color Maps ────────────────────────────────────────────────────────────────

const COLOR_MAPS = {
  // Aivora — Navy to Cyan to White
  aivora: [
    [  8,  12,  24],  // deep navy
    [  0,  40,  80],  // dark blue
    [  0,  80, 140],  // blue
    [  0, 140, 180],  // teal
    [ 14, 165, 233],  // sky blue
    [ 80, 200, 220],  // cyan
    [180, 230, 240],  // light cyan
    [255, 255, 255],  // white peak
  ] as [number,number,number][],

  // Plasma — Purple to Yellow
  plasma: [
    [ 13,   8, 135],
    [ 84,   2, 163],
    [139,  10, 165],
    [185,  50, 137],
    [219,  92,  97],
    [244, 136,  73],
    [254, 188,  43],
    [240, 249,  33],
  ] as [number,number,number][],

  // Viridis — Dark to Yellow-Green
  viridis: [
    [ 68,   1,  84],
    [ 59,  82, 139],
    [ 33, 145, 140],
    [ 94, 201, 98 ],
    [253, 231,  37],
  ] as [number,number,number][],

  // Inferno — Black to White via Orange
  inferno: [
    [  0,   0,   4],
    [ 40,  11,  84],
    [101,  21, 110],
    [159,  42,  99],
    [212,  72,  66],
    [245, 125,  21],
    [252, 193,  34],
    [252, 255, 164],
  ] as [number,number,number][],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function interpolateColor(
  t: number,
  map: [number,number,number][]
): [number,number,number] {
  const c = Math.max(0,Math.min(1,t));
  const idx = c*(map.length-1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo+1, map.length-1);
  const f  = idx-lo;
  return [
    Math.round(map[lo][0]*(1-f)+map[hi][0]*f),
    Math.round(map[lo][1]*(1-f)+map[hi][1]*f),
    Math.round(map[lo][2]*(1-f)+map[hi][2]*f),
  ];
}

function hannWindow(size: number): Float64Array {
  const w=new Float64Array(size);
  for(let i=0;i<size;i++) w[i]=0.5*(1-Math.cos(2*Math.PI*i/(size-1)));
  return w;
}

function runFFT(re: Float64Array, im: Float64Array): void {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=(-2*Math.PI)/len,wRe=Math.cos(ang),wIm=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cRe=1,cIm=0;
      for(let j=0;j<len>>1;j++){
        const uRe=re[i+j],uIm=im[i+j];
        const vRe=re[i+j+len/2]*cRe-im[i+j+len/2]*cIm;
        const vIm=re[i+j+len/2]*cIm+im[i+j+len/2]*cRe;
        re[i+j]=uRe+vRe;im[i+j]=uIm+vIm;
        re[i+j+len/2]=uRe-vRe;im[i+j+len/2]=uIm-vIm;
        const nRe=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nRe;
      }
    }
  }
}

// ── Compute ───────────────────────────────────────────────────────────────────

export function computeSpectrogramPro(
  buffer:  AudioBuffer,
  options: SpectrogramProOptions = {}
): SpectrogramProData {
  const fftSize = options.fftSize ?? 4096;
  const minDb   = options.minDb  ?? -90;
  const maxDb   = options.maxDb  ?? -10;
  const sr      = buffer.sampleRate;
  const hopSize = Math.floor(fftSize/4);
  const numBins = fftSize/2;
  const window  = hannWindow(fftSize);

  // Mix to mono
  const mono=new Float32Array(buffer.length);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const d=buffer.getChannelData(ch);
    for(let i=0;i<buffer.length;i++) mono[i]+=d[i];
  }
  if(buffer.numberOfChannels>1)
    for(let i=0;i<mono.length;i++) mono[i]/=buffer.numberOfChannels;

  // Compute frames
  const frames: Float32Array[]=[];
  for(let start=0;start+fftSize<=mono.length;start+=hopSize){
    const re=new Float64Array(fftSize);
    const im=new Float64Array(fftSize);
    for(let i=0;i<fftSize;i++) re[i]=mono[start+i]*window[i];
    runFFT(re,im);
    const mag=new Float32Array(numBins);
    for(let i=0;i<numBins;i++){
      const m=Math.sqrt(re[i]**2+im[i]**2)/fftSize;
      mag[i]=Math.max(minDb,Math.min(maxDb,20*Math.log10(m+1e-10)));
    }
    frames.push(mag);
  }

  return {
    frames,numFrames:frames.length,numBins,
    minDb,maxDb,sampleRate:sr,fftSize,
    durationSec:buffer.length/sr,
  };
}

// ── Draw Professional Spectrogram ─────────────────────────────────────────────

export function drawSpectrogramPro(
  canvas:  HTMLCanvasElement,
  data:    SpectrogramProData,
  options: SpectrogramProOptions = {}
): void {
  const ctx=canvas.getContext("2d"); if(!ctx||data.numFrames===0) return;
  const W=canvas.width, H=canvas.height;
  const gain     = options.gain    ?? 1.2;
  const logFreq  = options.logFreq ?? true;
  const colorKey = options.colorMap ?? "aivora";
  const colorMap = COLOR_MAPS[colorKey] ?? COLOR_MAPS.aivora;
  const showGrid = options.showGrid  ?? true;
  const showLabels = options.showLabels ?? true;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#080808";
  ctx.fillRect(0,0,W,H);

  const {frames,numFrames,numBins,minDb,maxDb,sampleRate,durationSec}=data;
  const nyquist=sampleRate/2;
  const imageData=ctx.createImageData(W,H);
  const pixels=imageData.data;

  for(let px=0;px<W;px++){
    const frameIdx=Math.min(Math.floor((px/W)*numFrames),numFrames-1);
    const frame=frames[frameIdx];

    for(let py=0;py<H;py++){
      // Linear or log frequency mapping
      let binIdx: number;
      const yNorm=(H-1-py)/H; // 0=bottom(low), 1=top(high)

      if(logFreq){
        const minHz=20, maxHz=nyquist;
        const logMin=Math.log10(minHz);
        const logMax=Math.log10(maxHz);
        const hz=Math.pow(10,logMin+yNorm*(logMax-logMin));
        binIdx=Math.round((hz/nyquist)*numBins);
      } else {
        binIdx=Math.round(yNorm*numBins);
      }

      binIdx=Math.max(0,Math.min(numBins-1,binIdx));
      const db=frame[binIdx];
      const t=Math.pow((db-minDb)/(maxDb-minDb)*gain,0.8);
      const [r,g,b]=interpolateColor(Math.min(1,t),colorMap);
      const i=(py*W+px)*4;
      pixels[i]=r; pixels[i+1]=g; pixels[i+2]=b; pixels[i+3]=255;
    }
  }

  ctx.putImageData(imageData,0,0);

  // Grid lines
  if(showGrid){
    const freqLines=[50,100,200,500,1000,2000,4000,8000,16000];
    freqLines.forEach(hz=>{
      if(hz>nyquist) return;
      let y: number;
      if(logFreq){
        const logMin=Math.log10(20),logMax=Math.log10(nyquist);
        y=H-(Math.log10(hz)-logMin)/(logMax-logMin)*H;
      } else {
        y=H-(hz/nyquist)*H;
      }
      ctx.strokeStyle="rgba(255,255,255,0.08)";
      ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();

      if(showLabels){
        ctx.font="9px 'JetBrains Mono',monospace";
        ctx.fillStyle="rgba(100,160,184,0.8)";
        const label=hz>=1000?`${hz/1000}k`:`${hz}`;
        ctx.fillText(label,4,y-3);
      }
    });

    // Time grid
    const timeStep=durationSec>30?10:durationSec>10?5:1;
    for(let t=timeStep;t<durationSec;t+=timeStep){
      const x=(t/durationSec)*W;
      ctx.strokeStyle="rgba(255,255,255,0.06)";
      ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
      if(showLabels){
        ctx.font="9px 'JetBrains Mono',monospace";
        ctx.fillStyle="rgba(100,160,184,0.7)";
        ctx.fillText(`${t}s`,x+3,H-6);
      }
    }
  }
}

// ── Colormap Legend ───────────────────────────────────────────────────────────

export function drawColorLegend(
  canvas: HTMLCanvasElement,
  minDb:  number,
  maxDb:  number,
  colorKey: "plasma"|"viridis"|"inferno"|"aivora" = "aivora"
): void {
  const ctx=canvas.getContext("2d"); if(!ctx) return;
  const W=canvas.width, H=canvas.height;
  const colorMap=COLOR_MAPS[colorKey];

  const grad=ctx.createLinearGradient(0,H,0,0);
  for(let i=0;i<colorMap.length;i++){
    const [r,g,b]=colorMap[i];
    grad.addColorStop(i/(colorMap.length-1),`rgb(${r},${g},${b})`);
  }
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);

  // Labels
  ctx.font="8px monospace";
  ctx.fillStyle="rgba(255,255,255,0.8)";
  ctx.fillText(`${maxDb}dB`,2,10);
  ctx.fillText(`${minDb}dB`,2,H-4);
}
