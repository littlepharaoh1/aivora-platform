/**
 * AuditionWorkspace.tsx — Adaptive WebGL + Canvas2D Fallback
 * Aivora Platform
 *
 * Architecture:
 * - Device detection → adaptive FFT (512 mobile / 1024 desktop)
 * - WebGL2 primary → Canvas2D automatic fallback (no black screen)
 * - webglcontextlost listener → instant fallback
 * - Web Worker STFT with RAF throttle (no UI flood)
 * - LOD cache (8 levels)
 * - Stereo split viewport
 * - LED peak meter
 */

import React, {
  useRef, useEffect, useState,
  useCallback, useMemo, useLayoutEffect,
} from "react";

// ── Theme ─────────────────────────────────────────────────────────────────────

const AU = {
  bg:"#141414", bgPanel:"#1a1a1a", bgDark:"#111111",
  border:"#2d2d2d", borderLight:"#3a3a3a",
  text:"#cccccc", textDim:"#666666", textBright:"#ffffff",
  wave:"#10b981", waveAlt:"#00e676",
  playhead:"#ff6d00", rulerBg:"#161616", rulerText:"#888888",
  tabActive:"#252525", tabInactive:"#181818",
  ledGreen:"#00e676", ledYellow:"#ffeb3b", ledRed:"#f44336", ledOff:"#1a1a1a",
};

// ── Device Detection ──────────────────────────────────────────────────────────

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || window.innerWidth < 768;
}

function getAdaptiveFFT(): number {
  return isMobileDevice() ? 512 : 1024;
}

function getAdaptiveHop(fftSize: number): number {
  return Math.floor(fftSize / 4);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
  id:     string;
  name:   string;
  buffer: AudioBuffer;
}

export interface AuditionWorkspaceProps {
  files:        WorkspaceFile[];
  activeId:     string;
  onTabSelect:  (id: string) => void;
  onTabClose:   (id: string) => void;
  playheadSec:  number;
  playing:      boolean;
  onTogglePlay: () => void;
  onSeek:       (norm: number) => void;
  onDownload?:  () => void;
}

// ── LOD Cache ─────────────────────────────────────────────────────────────────

const LOD_STRIDES = [1, 2, 4, 8, 16, 64, 256, 1024];
interface LODLevel { min: Float32Array; max: Float32Array; stride: number; }

function buildLOD(data: Float32Array): LODLevel[] {
  return LOD_STRIDES.map(stride => {
    const n = Math.ceil(data.length / stride);
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    for(let i = 0; i < n; i++){
      let mn = 1, mx = -1;
      const e = Math.min((i+1)*stride, data.length);
      for(let j = i*stride; j < e; j++){
        if(data[j] < mn) mn = data[j];
        if(data[j] > mx) mx = data[j];
      }
      min[i]=mn; max[i]=mx;
    }
    return { min, max, stride };
  });
}

function pickLOD(lods: LODLevel[], spp: number): LODLevel {
  for(const l of lods) if(l.stride >= spp * 0.5) return l;
  return lods[lods.length-1];
}

// ── WebGL Shaders ─────────────────────────────────────────────────────────────

const VERT_SRC = `#version 300 es
precision highp float;
in float a_x;
in float a_y;
uniform float u_chTop;
uniform float u_chH;
out float v_y;
void main(){
  float ndcX = a_x * 2.0 - 1.0;
  float ndcY = (u_chTop + u_chH*0.5 + a_y*u_chH*0.5)*2.0 - 1.0;
  v_y = a_y;
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in  float v_y;
out vec4  fragColor;
void main(){
  float bright = 0.6 + 0.4*(1.0-abs(v_y));
  fragColor = vec4(0.063*bright, 0.725*bright, 0.506*bright, 0.9);
}`;

const VERT_SPEC = `#version 300 es
precision highp float;
in  vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = vec2(a_pos.x*0.5+0.5, a_pos.y*0.5+0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SPEC = `#version 300 es
precision highp float;
in  vec2      v_uv;
out vec4      fragColor;
uniform sampler2D u_tex;
uniform float u_vs;
uniform float u_ve;
vec3 auColor(float t){
  t = clamp(t,0.0,1.0);
  if(t<0.20){ float s=t/0.20; return vec3(s*0.31,0.0,s*0.47); }
  if(t<0.40){ float s=(t-0.20)/0.20; return vec3(0.31+s*0.59,0.0,0.47-s*0.47); }
  if(t<0.65){ float s=(t-0.40)/0.25; return vec3(0.90,s*0.47,0.0); }
  if(t<0.85){ float s=(t-0.65)/0.20; return vec3(1.0,0.47+s*0.53,0.0); }
  float s=(t-0.85)/0.15; return vec3(1.0,1.0,s);
}
void main(){
  float u = u_vs + v_uv.x*(u_ve-u_vs);
  float m = texture(u_tex, vec2(u, 1.0-v_uv.y)).r;
  fragColor = vec4(auColor(m), 1.0);
}`;

// ── WebGL helpers ─────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader|null {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    console.warn("Shader compile:", gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

function linkProg(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram|null {
  const p = gl.createProgram()!;
  gl.attachShader(p,vs); gl.attachShader(p,fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    console.warn("Link:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ── Canvas2D Fallback Waveform ─────────────────────────────────────────────────

function draw2DWaveform(
  canvas:    HTMLCanvasElement,
  channels:  Float32Array[],
  lods:      LODLevel[][],
  viewStart: number,
  viewEnd:   number,
  phNorm:    number,
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  const W = canvas.width, H = canvas.height;
  const nCh = channels.length;
  const chH = Math.floor(H / nCh);

  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, W, H);

  for(let ch = 0; ch < nCh; ch++){
    const yBase = ch * chH;
    const yMid  = yBase + chH/2;
    // Grid
    ctx.strokeStyle = "#1e1e1e";
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0,yMid); ctx.lineTo(W,yMid); ctx.stroke();

    const visSamp = (viewEnd-viewStart) * channels[ch].length;
    const spp     = visSamp / W;
    const lod     = pickLOD(lods[ch], spp);
    const startS  = Math.floor(viewStart * channels[ch].length);
    const lodStart= Math.floor(startS / lod.stride);
    const lodEnd  = Math.min(Math.ceil((viewEnd*channels[ch].length)/lod.stride), lod.min.length);
    const nPts    = lodEnd - lodStart;
    if(nPts <= 0) continue;

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for(let i = 0; i < nPts; i++){
      const li = lodStart + i;
      const x  = (i / nPts) * W;
      const yT = yMid - (lod.max[li]??0) * (chH/2);
      const yB = yMid - (lod.min[li]??0) * (chH/2);
      ctx.moveTo(x, Math.max(yBase, yT));
      ctx.lineTo(x, Math.min(yBase+chH, yB));
    }
    ctx.stroke();

    // Channel label
    ctx.fillStyle = "#444";
    ctx.font      = "9px monospace";
    ctx.fillText(nCh > 1 ? (ch===0?"L":"R") : "Mono", 4, yBase+12);
  }

  // Playhead
  const phX = Math.round(((phNorm-viewStart)/(viewEnd-viewStart))*W);
  if(phX >= 0 && phX < W){
    ctx.strokeStyle = "#ff6d00";
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(phX,0); ctx.lineTo(phX,H); ctx.stroke();
    ctx.fillStyle = "#ff6d00";
    ctx.beginPath();
    ctx.moveTo(phX-5,0); ctx.lineTo(phX+5,0); ctx.lineTo(phX,8);
    ctx.fill();
  }
}

// ── Canvas2D Fallback Spectrogram ─────────────────────────────────────────────

function draw2DSpectrogram(
  canvas:    HTMLCanvasElement,
  texData:   Float32Array,
  nFrames:   number,
  nBins:     number,
  viewStart: number,
  viewEnd:   number,
): void {
  const ctx = canvas.getContext("2d");
  if(!ctx || nFrames === 0) return;
  const W = canvas.width, H = canvas.height;
  const imgData = ctx.createImageData(W, H);
  const px      = imgData.data;

  const fStart = Math.floor(viewStart * nFrames);
  const fEnd   = Math.min(Math.ceil(viewEnd * nFrames), nFrames);
  const fSpan  = fEnd - fStart;

  function auColor(t: number): [number,number,number] {
    t = Math.max(0,Math.min(1,t));
    if(t<0.20){ const s=t/0.20; return [Math.round(s*80),0,Math.round(s*120)]; }
    if(t<0.40){ const s=(t-0.20)/0.20; return [Math.round(80+s*150),0,0]; }
    if(t<0.65){ const s=(t-0.40)/0.25; return [230,Math.round(s*120),0]; }
    if(t<0.85){ const s=(t-0.65)/0.20; return [255,Math.round(120+s*135),0]; }
    const s=(t-0.85)/0.15; return [255,255,Math.round(s*255)];
  }

  for(let px_x = 0; px_x < W; px_x++){
    const frame = fStart + Math.floor((px_x/W)*fSpan);
    if(frame >= nFrames) continue;
    for(let px_y = 0; px_y < H; px_y++){
      const bin = Math.floor((1-(px_y/H))*nBins);
      if(bin >= nBins) continue;
      const mag = texData[frame*nBins+bin] ?? 0;
      const [r,g,b] = auColor(mag);
      const idx = (px_y*W+px_x)*4;
      px[idx]=r; px[idx+1]=g; px[idx+2]=b; px[idx+3]=255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ── Web Worker (inline Blob) ──────────────────────────────────────────────────

const WORKER_SRC = `
self.onmessage = function(e){
  const { samples, fftSize, hopSize, id } = e.data;
  const nFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1);
  const nBins   = fftSize >> 1;
  const tex     = new Float32Array(nFrames * nBins);
  const re      = new Float64Array(fftSize);
  const im      = new Float64Array(fftSize);

  function fft(){
    const n=re.length;
    for(let i=1,j=0;i<n;i++){
      let b=n>>1; for(;j&b;b>>=1)j^=b; j^=b;
      if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}
    }
    for(let len=2;len<=n;len<<=1){
      const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
      for(let i=0;i<n;i+=len){
        let cR=1,cI=0;
        for(let j=0;j<len>>1;j++){
          const uR=re[i+j],uI=im[i+j];
          const vR=re[i+j+len/2]*cR-im[i+j+len/2]*cI;
          const vI=re[i+j+len/2]*cI+im[i+j+len/2]*cR;
          re[i+j]=uR+vR;im[i+j]=uI+vI;
          re[i+j+len/2]=uR-vR;im[i+j+len/2]=uI-vI;
          const nR=cR*wR-cI*wI;cI=cR*wI+cI*wR;cR=nR;
        }
      }
    }
  }

  let globalMax=1e-10;
  const raw=new Float32Array(nFrames*nBins);
  for(let f=0;f<nFrames;f++){
    const off=f*hopSize;
    re.fill(0);im.fill(0);
    for(let i=0;i<fftSize;i++){
      const w=0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)));
      re[i]=(samples[off+i]||0)*w;
    }
    fft();
    for(let b=0;b<nBins;b++){
      const m=Math.sqrt(re[b]*re[b]+im[b]*im[b]);
      raw[f*nBins+b]=m;
      if(m>globalMax)globalMax=m;
    }
  }
  for(let i=0;i<raw.length;i++){
    const db=raw[i]>1e-10?20*Math.log10(raw[i]/globalMax):-90;
    tex[i]=Math.max(0,Math.min(1,(db+90)/90));
  }
  self.postMessage({id,nFrames,nBins,tex:tex.buffer},[tex.buffer]);
};
`;

function makeWorker(): Worker {
  const blob = new Blob([WORKER_SRC], { type:"application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

// ── LED Meter ─────────────────────────────────────────────────────────────────

function LEDMeter({ level }: { level:number }) {
  const db = level>0 ? 20*Math.log10(level) : -60;
  const N  = 20, minDb=-57, maxDb=0;
  return (
    <div style={{display:"flex",gap:2,alignItems:"flex-end",height:50}}>
      {Array.from({length:N},(_,i)=>{
        const thr = minDb+(i/N)*(maxDb-minDb);
        const lit = db>=thr;
        const col = i<14?AU.ledGreen:i<18?AU.ledYellow:AU.ledRed;
        return <div key={i} style={{
          width:5, height:3+i*2.2,
          background:lit?col:AU.ledOff, borderRadius:1,
          boxShadow:lit?`0 0 3px ${col}`:"none",
          transition:"background 0.05s",
        }}/>;
      })}
    </div>
  );
}

// ── Time Ruler ─────────────────────────────────────────────────────────────────

function TimeRuler({duration,viewStart,viewEnd}:{duration:number;viewStart:number;viewEnd:number}) {
  const visDur = (viewEnd-viewStart)*duration;
  const step   = visDur>60?10:visDur>10?1:visDur>2?0.5:0.1;
  const startT = viewStart*duration;
  const ticks: {pct:number;label:string}[] = [];
  for(let t=Math.ceil(startT/step)*step; t<=viewEnd*duration; t+=step){
    const pct = ((t-startT)/visDur)*100;
    const m=Math.floor(t/60), s=(t%60).toFixed(step<0.5?2:1);
    ticks.push({pct, label:m>0?`${m}:${s.padStart(5,"0")}`:s+"s"});
  }
  return (
    <div style={{position:"relative",height:20,background:AU.rulerBg,
      borderBottom:`1px solid ${AU.border}`,overflow:"hidden",flexShrink:0}}>
      {ticks.map((t,i)=>(
        <div key={i} style={{position:"absolute",left:`${t.pct}%`,top:0,
          borderLeft:`1px solid ${AU.border}`,paddingLeft:3,height:"100%",
          display:"flex",alignItems:"flex-end",paddingBottom:2}}>
          <span style={{fontSize:8,color:AU.rulerText,whiteSpace:"nowrap"}}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AuditionWorkspace({
  files,activeId,onTabSelect,onTabClose,
  playheadSec,playing,onTogglePlay,onSeek,onDownload,
}: AuditionWorkspaceProps) {

  const activeFile = useMemo(()=>files.find(f=>f.id===activeId),[files,activeId]);
  const buf        = activeFile?.buffer ?? null;

  const waveRef    = useRef<HTMLCanvasElement>(null);
  const specRef    = useRef<HTMLCanvasElement>(null);
  const workerRef  = useRef<Worker|null>(null);
  const rafRef     = useRef(0);

  // WebGL state
  const wglRef  = useRef<{
    gl:WebGL2RenderingContext; prog:WebGLProgram;
    vboX:WebGLBuffer; vboY:WebGLBuffer;
    aX:number; aY:number;
    uChTop:WebGLUniformLocation; uChH:WebGLUniformLocation;
  }|null>(null);
  const sglRef  = useRef<{
    gl:WebGL2RenderingContext; prog:WebGLProgram;
    tex:WebGLTexture; vbo:WebGLBuffer;
    aPos:number;
    uTex:WebGLUniformLocation;
    uVs:WebGLUniformLocation; uVe:WebGLUniformLocation;
  }|null>(null);

  const [useWebGL,   setUseWebGL]   = useState(true);
  const [specReady,  setSpecReady]  = useState(false);
  const [viewStart,  setViewStart]  = useState(0);
  const [viewEnd,    setViewEnd]    = useState(1);
  const [dragging,   setDragging]   = useState(false);
  const [peakLevel,  setPeakLevel]  = useState(0);

  const lodRef      = useRef<LODLevel[][]>([]);
  const channelsRef = useRef<Float32Array[]>([]);
  const specTexRef  = useRef<Float32Array>(new Float32Array(0));
  const specDimRef  = useRef({nFrames:0,nBins:0});
  const peakDecRef  = useRef(0);

  const duration  = buf?.duration ?? 1;
  const phNorm    = duration>0 ? playheadSec/duration : 0;
  const mobile    = isMobileDevice();
  const fftSize   = getAdaptiveFFT();
  const hopSize   = getAdaptiveHop(fftSize);

  // ── Init / reinit canvases ────────────────────────────────────────────────
  function resizeCanvas(cv: HTMLCanvasElement) {
    const w = cv.offsetWidth || 800;
    const h = cv.offsetHeight || 160;
    if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
  }

  // ── Try WebGL2 init ───────────────────────────────────────────────────────
  function tryInitWebGL(): boolean {
    const wc = waveRef.current;
    const sc = specRef.current;
    if(!wc || !sc) return false;

    try {
      // Waveform GL
      const wgl = wc.getContext("webgl2",{antialias:!mobile,alpha:false}) as WebGL2RenderingContext|null;
      if(!wgl) return false;

      const vs  = compileShader(wgl, wgl.VERTEX_SHADER,   VERT_SRC);
      const fs  = compileShader(wgl, wgl.FRAGMENT_SHADER, FRAG_SRC);
      if(!vs||!fs) return false;
      const prog = linkProg(wgl, vs, fs);
      if(!prog) return false;

      wgl.enable(wgl.BLEND);
      wgl.blendFunc(wgl.SRC_ALPHA, wgl.ONE_MINUS_SRC_ALPHA);

      wglRef.current = {
        gl:wgl, prog,
        vboX: wgl.createBuffer()!,
        vboY: wgl.createBuffer()!,
        aX:   wgl.getAttribLocation(prog,"a_x"),
        aY:   wgl.getAttribLocation(prog,"a_y"),
        uChTop: wgl.getUniformLocation(prog,"u_chTop")!,
        uChH:   wgl.getUniformLocation(prog,"u_chH")!,
      };

      // Context loss handler
      wc.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        console.warn("WebGL context lost — switching to Canvas2D");
        setUseWebGL(false);
      });

      // Spectrogram GL
      const sgl = sc.getContext("webgl2",{antialias:false,alpha:false}) as WebGL2RenderingContext|null;
      if(!sgl) return false;

      const svs  = compileShader(sgl, sgl.VERTEX_SHADER,   VERT_SPEC);
      const sfs  = compileShader(sgl, sgl.FRAGMENT_SHADER, FRAG_SPEC);
      if(!svs||!sfs) return false;
      const sprog = linkProg(sgl, svs, sfs);
      if(!sprog) return false;

      const quad = new Float32Array([-1,-1,1,-1,-1,1,1,1]);
      const svbo = sgl.createBuffer()!;
      sgl.bindBuffer(sgl.ARRAY_BUFFER, svbo);
      sgl.bufferData(sgl.ARRAY_BUFFER, quad, sgl.STATIC_DRAW);

      const stex = sgl.createTexture()!;
      sgl.bindTexture(sgl.TEXTURE_2D, stex);
      sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_MIN_FILTER, sgl.LINEAR);
      sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_MAG_FILTER, sgl.LINEAR);
      sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_WRAP_S, sgl.CLAMP_TO_EDGE);
      sgl.texParameteri(sgl.TEXTURE_2D, sgl.TEXTURE_WRAP_T, sgl.CLAMP_TO_EDGE);

      sglRef.current = {
        gl:sgl, prog:sprog, tex:stex, vbo:svbo,
        aPos: sgl.getAttribLocation(sprog,"a_pos"),
        uTex: sgl.getUniformLocation(sprog,"u_tex")!,
        uVs:  sgl.getUniformLocation(sprog,"u_vs")!,
        uVe:  sgl.getUniformLocation(sprog,"u_ve")!,
      };

      sc.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        setUseWebGL(false);
      });

      return true;
    } catch(err) {
      console.warn("WebGL init failed:", err);
      return false;
    }
  }

  useLayoutEffect(() => {
    const wc = waveRef.current;
    const sc = specRef.current;
    if(wc) resizeCanvas(wc);
    if(sc) resizeCanvas(sc);

    // Mobile: skip WebGL, go straight to Canvas2D
    if(mobile){ setUseWebGL(false); return; }

    const ok = tryInitWebGL();
    if(!ok) setUseWebGL(false);
  }, []);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const wc = waveRef.current;
      const sc = specRef.current;
      if(wc) resizeCanvas(wc);
      if(sc) resizeCanvas(sc);
    });
    if(waveRef.current) obs.observe(waveRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Buffer change: LOD + Worker ───────────────────────────────────────────
  useEffect(() => {
    if(!buf) return;
    setSpecReady(false);
    setViewStart(0); setViewEnd(1);

    // Build channels + LOD
    const chs: Float32Array[] = [];
    const ls:  LODLevel[][]   = [];
    for(let ch=0;ch<buf.numberOfChannels;ch++){
      const d = buf.getChannelData(ch);
      chs.push(d);
      ls.push(buildLOD(d));
    }
    channelsRef.current = chs;
    lodRef.current      = ls;

    // Mono mix for STFT
    const mono = new Float32Array(buf.length);
    for(let ch=0;ch<buf.numberOfChannels;ch++){
      const d=buf.getChannelData(ch);
      for(let i=0;i<buf.length;i++) mono[i]+=d[i]/buf.numberOfChannels;
    }

    // Terminate previous worker
    workerRef.current?.terminate();
    workerRef.current = makeWorker();
    const id = Date.now();

    workerRef.current.onmessage = (e: MessageEvent) => {
      if(e.data.id !== id) return;
      const { nFrames, nBins, tex } = e.data;
      const arr = new Float32Array(tex);
      specTexRef.current  = arr;
      specDimRef.current  = { nFrames, nBins };

      // Upload to WebGL texture if available
      const sg = sglRef.current;
      if(sg && useWebGL){
        const { gl, tex:gltex } = sg;
        gl.bindTexture(gl.TEXTURE_2D, gltex);
        // Check EXT_color_buffer_float
        gl.getExtension("EXT_color_buffer_float");
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nFrames, nBins, 0, gl.RED, gl.FLOAT, arr);
        } catch {
          // Fallback: use R8 (normalized)
          const u8 = new Uint8Array(arr.length);
          for(let i=0;i<arr.length;i++) u8[i]=Math.round(arr[i]*255);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nFrames, nBins, 0, gl.RED, gl.UNSIGNED_BYTE, u8);
        }
      }
      setSpecReady(true);
    };

    const transfer = mono.buffer.slice(0);
    workerRef.current.postMessage(
      { samples: transfer, fftSize, hopSize, id },
      [transfer]
    );
  }, [buf, fftSize, hopSize, useWebGL]);

  // ── RAF render loop (throttled) ───────────────────────────────────────────
  useEffect(() => {
    let lastRender = 0;
    const TARGET_FPS = mobile ? 30 : 60;
    const FRAME_MS   = 1000 / TARGET_FPS;

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame);
      if(now - lastRender < FRAME_MS) return; // throttle
      lastRender = now;

      const wc = waveRef.current;
      const sc = specRef.current;
      if(!wc || !sc) return;

      // ── Waveform ──────────────────────────────────────────────────────
      if(useWebGL && wglRef.current && channelsRef.current.length>0){
        const { gl, prog, vboX, vboY, aX, aY, uChTop, uChH } = wglRef.current;
        const W = wc.width, H = wc.height;
        gl.viewport(0,0,W,H);
        gl.clearColor(0.082,0.082,0.082,1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);

        const nCh = channelsRef.current.length;
        const chHn = 1/nCh;

        for(let ch=0;ch<nCh;ch++){
          const data    = channelsRef.current[ch];
          const visSamp = (viewEnd-viewStart)*data.length;
          const spp     = Math.max(1, visSamp/W);
          const lod     = pickLOD(lodRef.current[ch], spp);
          const startS  = Math.floor(viewStart*data.length);
          const ls      = Math.floor(startS/lod.stride);
          const le      = Math.min(Math.ceil(viewEnd*data.length/lod.stride), lod.min.length);
          const nP      = le-ls;
          if(nP<=0) continue;

          const xArr = new Float32Array(nP*2);
          const yArr = new Float32Array(nP*2);
          for(let i=0;i<nP;i++){
            const li=ls+i;
            const x=(li*lod.stride-startS)/visSamp;
            xArr[i*2]=x; xArr[i*2+1]=x;
            yArr[i*2]=lod.max[li]??0;
            yArr[i*2+1]=lod.min[li]??0;
          }

          gl.bindBuffer(gl.ARRAY_BUFFER,vboX);
          gl.bufferData(gl.ARRAY_BUFFER,xArr,gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(aX);
          gl.vertexAttribPointer(aX,1,gl.FLOAT,false,0,0);

          gl.bindBuffer(gl.ARRAY_BUFFER,vboY);
          gl.bufferData(gl.ARRAY_BUFFER,yArr,gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(aY);
          gl.vertexAttribPointer(aY,1,gl.FLOAT,false,0,0);

          const chTop = 1-(ch+1)*chHn;
          gl.uniform1f(uChTop, chTop);
          gl.uniform1f(uChH,   chHn);
          gl.drawArrays(gl.LINES,0,nP*2);
        }

        // Playhead via scissor
        const phX = Math.round(((phNorm-viewStart)/(viewEnd-viewStart))*W);
        if(phX>=0&&phX<W){
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(phX,0,2,H);
          gl.clearColor(1,0.427,0,0.85);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.disable(gl.SCISSOR_TEST);
        }
      } else if(!useWebGL && channelsRef.current.length>0){
        draw2DWaveform(wc, channelsRef.current, lodRef.current, viewStart, viewEnd, phNorm);
      }

      // ── Spectrogram ───────────────────────────────────────────────────
      if(specReadyRef.current){
        if(useWebGL && sglRef.current){
          const { gl,prog,tex,vbo,aPos,uTex,uVs,uVe } = sglRef.current;
          const W=sc.width,H=sc.height;
          gl.viewport(0,0,W,H);
          gl.clearColor(0.04,0,0.06,1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(prog);
          gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
          gl.enableVertexAttribArray(aPos);
          gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D,tex);
          gl.uniform1i(uTex,0);
          gl.uniform1f(uVs,viewStart);
          gl.uniform1f(uVe,viewEnd);
          gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        } else if(!useWebGL){
          const {nFrames,nBins}=specDimRef.current;
          draw2DSpectrogram(sc,specTexRef.current,nFrames,nBins,viewStart,viewEnd);
        }
      }

      // ── Peak meter ────────────────────────────────────────────────────
      const ch0 = channelsRef.current[0];
      if(ch0 && playing){
        const fi    = Math.floor(phNorm*ch0.length);
        const slice = ch0.subarray(Math.max(0,fi-512),fi);
        let peak=0;
        for(let i=0;i<slice.length;i++){const v=Math.abs(slice[i]);if(v>peak)peak=v;}
        peakDecRef.current=Math.max(peak,peakDecRef.current*0.93);
      } else {
        peakDecRef.current*=0.92;
      }
      setPeakLevel(peakDecRef.current);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [buf, playing, viewStart, viewEnd, phNorm, useWebGL]);

  // specReady ref for RAF closure
  const specReadyRef = useRef(false);
  useEffect(()=>{ specReadyRef.current = specReady; },[specReady]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current);
    workerRef.current?.terminate();
  },[]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent)=>{
    e.preventDefault();
    const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx=(e.clientX-rect.left)/rect.width;
    const span=viewEnd-viewStart;
    const zf=e.deltaY<0?0.82:1.18;
    const ns2=Math.max(0.0001,Math.min(1,span*zf));
    const anchor=viewStart+cx*span;
    let ns=anchor-cx*ns2, ne=anchor+(1-cx)*ns2;
    if(ns<0){ne-=ns;ns=0;} if(ne>1){ns-=(ne-1);ne=1;}
    setViewStart(Math.max(0,ns)); setViewEnd(Math.min(1,ne));
  },[viewStart,viewEnd]);

  function normX(e: React.MouseEvent): number {
    const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width;
    return Math.max(0,Math.min(1,viewStart+x*(viewEnd-viewStart)));
  }

  // ── Touch zoom/pan ────────────────────────────────────────────────────────
  const touchRef = useRef<{dist:number;mid:number}>({dist:0,mid:0});

  function handleTouchStart(e: React.TouchEvent){
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const mid=(e.touches[0].clientX+e.touches[1].clientX)/2;
      touchRef.current={dist:Math.abs(dx),mid};
    } else if(e.touches.length===1){
      const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
      const x=(e.touches[0].clientX-rect.left)/rect.width;
      onSeek(Math.max(0,Math.min(1,viewStart+x*(viewEnd-viewStart))));
    }
  }

  function handleTouchMove(e: React.TouchEvent){
    e.preventDefault();
    if(e.touches.length===2){
      const dx=Math.abs(e.touches[0].clientX-e.touches[1].clientX);
      const prev=touchRef.current.dist||dx;
      const zf=prev/Math.max(1,dx);
      const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx=(touchRef.current.mid-rect.left)/rect.width;
      const span=viewEnd-viewStart;
      const ns2=Math.max(0.001,Math.min(1,span*zf));
      const anchor=viewStart+cx*span;
      let ns=anchor-cx*ns2,ne=anchor+(1-cx)*ns2;
      if(ns<0){ne-=ns;ns=0;}if(ne>1){ns-=(ne-1);ne=1;}
      setViewStart(Math.max(0,ns));setViewEnd(Math.min(1,ne));
      touchRef.current.dist=dx;
    }
  }

  // ── Properties ────────────────────────────────────────────────────────────
  const props_ = buf ? [
    ["SR",      buf.sampleRate+"Hz"],
    ["Ch",      buf.numberOfChannels===1?"Mono":"Stereo"],
    ["Dur",     buf.duration.toFixed(2)+"s"],
    ["Samples", buf.length.toLocaleString()],
    ["Bits",    "32f"],
    ["Renderer",useWebGL?"WebGL2":"Canvas2D"],
    ["FFT",     fftSize+""],
    ["Zoom",    ((viewEnd-viewStart)*100).toFixed(1)+"%"],
  ] : [];

  const nCh = buf?.numberOfChannels ?? 1;

  return (
    <div style={{display:"flex",flexDirection:"column",background:AU.bg,
      border:`1px solid ${AU.border}`,borderRadius:4,overflow:"hidden",
      fontFamily:"monospace",userSelect:"none"}}>

      {/* Tab Bar */}
      <div style={{display:"flex",alignItems:"stretch",background:AU.bgDark,
        borderBottom:`1px solid ${AU.border}`,minHeight:28,overflowX:"auto"}}>
        {files.map(f=>{
          const active=f.id===activeId;
          return (
            <div key={f.id} onClick={()=>onTabSelect(f.id)} style={{
              display:"flex",alignItems:"center",gap:5,padding:"0 8px",
              cursor:"pointer",flexShrink:0,
              background:active?AU.tabActive:AU.tabInactive,
              borderRight:`1px solid ${AU.border}`,
              borderBottom:active?`2px solid ${AU.wave}`:"2px solid transparent",
            }}>
              <span style={{fontSize:9,color:AU.waveAlt}}>≋</span>
              <span style={{fontSize:9,color:active?AU.textBright:AU.textDim,
                maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {f.name}
              </span>
              <span onClick={e=>{e.stopPropagation();onTabClose(f.id);}}
                style={{fontSize:8,color:AU.textDim,cursor:"pointer",marginLeft:2}}>✕</span>
            </div>
          );
        })}
        {files.length===0&&(
          <div style={{padding:"0 12px",fontSize:9,color:AU.textDim,
            display:"flex",alignItems:"center"}}>No files</div>
        )}
        {/* Renderer badge */}
        <div style={{marginLeft:"auto",padding:"0 8px",display:"flex",
          alignItems:"center",fontSize:8,
          color:useWebGL?"#10b981":"#f59e0b"}}>
          {useWebGL?"WebGL2":"Canvas2D"}
        </div>
      </div>

      {/* Body */}
      <div style={{display:"flex",flex:1,minHeight:0}}>

        {/* Left panel — hidden on mobile to save space */}
        {!mobile&&(
          <div style={{width:140,background:AU.bgPanel,
            borderRight:`1px solid ${AU.border}`,
            display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
            <div style={{padding:"5px 7px",fontSize:7,color:AU.textDim,
              letterSpacing:1,borderBottom:`1px solid ${AU.border}`}}>
              FILES & PROPERTIES
            </div>
            <div style={{borderBottom:`1px solid ${AU.border}`,padding:3}}>
              {files.map(f=>(
                <div key={f.id} onClick={()=>onTabSelect(f.id)} style={{
                  padding:"2px 5px",borderRadius:2,cursor:"pointer",
                  background:f.id===activeId?"#252525":"transparent",
                  fontSize:8,color:f.id===activeId?AU.wave:AU.textDim,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  ≋ {f.name}
                </div>
              ))}
            </div>
            <div style={{padding:"5px 7px",flex:1,overflowY:"auto"}}>
              {props_.map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",
                  padding:"1px 0",borderBottom:`1px solid ${AU.border}`}}>
                  <span style={{fontSize:7,color:AU.textDim}}>{l}</span>
                  <span style={{fontSize:7,color:AU.textBright}}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{padding:"5px 7px",borderTop:`1px solid ${AU.border}`,fontSize:7,color:AU.textDim}}>
              <div style={{color:playing?AU.ledGreen:AU.textDim}}>
                {playing?"▶ Playing":"■ Stopped"}
              </div>
              <div style={{marginTop:2}}>{playheadSec.toFixed(3)}s</div>
              <div style={{marginTop:2,color:"#444"}}>
                STFT: {specReady?"ready":"..."}
              </div>
            </div>
          </div>
        )}

        {/* Center */}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
          <TimeRuler duration={duration} viewStart={viewStart} viewEnd={viewEnd}/>

          {/* Waveform */}
          <canvas ref={waveRef}
            style={{width:"100%",height:nCh>1?200:150,display:"block",
              cursor:"crosshair",flexShrink:0,background:AU.bg}}
            onWheel={handleWheel}
            onMouseDown={e=>{setDragging(true);onSeek(normX(e));}}
            onMouseMove={e=>{if(dragging)onSeek(normX(e));}}
            onMouseUp={()=>setDragging(false)}
            onMouseLeave={()=>setDragging(false)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
          />

          <div style={{height:1,background:AU.border,flexShrink:0}}/>

          {/* Spectrogram */}
          <canvas ref={specRef}
            style={{width:"100%",height:mobile?80:110,display:"block",
              cursor:"crosshair",flexShrink:0,background:"#0a000f"}}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
          />
          {!specReady&&(
            <div style={{position:"relative",height:0,top:-45,left:8,
              fontSize:8,color:"#444",pointerEvents:"none"}}>
              Computing STFT...
            </div>
          )}

          {/* Scroll bar */}
          <div onClick={e=>{
            const rect=e.currentTarget.getBoundingClientRect();
            const x=(e.clientX-rect.left)/rect.width;
            const span=viewEnd-viewStart;
            const ns=Math.max(0,Math.min(1-span,x-span/2));
            setViewStart(ns);setViewEnd(ns+span);
          }} style={{height:8,background:AU.bgDark,
            borderTop:`1px solid ${AU.border}`,cursor:"pointer",
            position:"relative",flexShrink:0}}>
            <div style={{position:"absolute",left:`${viewStart*100}%`,
              width:`${(viewEnd-viewStart)*100}%`,height:"100%",
              background:AU.borderLight,borderRadius:2}}/>
          </div>

          {/* Transport */}
          <div style={{display:"flex",alignItems:"center",gap:6,
            padding:"5px 8px",background:AU.bgPanel,
            borderTop:`1px solid ${AU.border}`,flexShrink:0,flexWrap:"wrap"}}>

            <button onClick={onTogglePlay} style={{
              background:playing?"#ff6d0022":"#10b98122",
              border:`1px solid ${playing?"#ff6d0066":"#10b98166"}`,
              borderRadius:3,padding:"2px 10px",cursor:"pointer",
              color:playing?"#ff6d00":AU.wave,fontSize:12,fontWeight:700}}>
              {playing?"⏸":"▶"}
            </button>

            <button onClick={()=>onSeek(0)} style={{
              background:"#1a1a1a",border:`1px solid ${AU.border}`,
              borderRadius:3,padding:"2px 7px",cursor:"pointer",
              color:AU.textDim,fontSize:11}}>⏹</button>

            <div style={{background:"#000",border:`1px solid ${AU.border}`,
              borderRadius:3,padding:"2px 8px",
              fontFamily:"monospace",fontSize:10,
              color:"#00ff99",minWidth:70,textAlign:"center"}}>
              {playheadSec.toFixed(3)}s
            </div>

            <button onClick={()=>{const m=(viewStart+viewEnd)/2,h=(viewEnd-viewStart)/4;setViewStart(Math.max(0,m-h));setViewEnd(Math.min(1,m+h));}} style={{background:AU.bgDark,border:`1px solid ${AU.border}`,borderRadius:3,padding:"2px 6px",cursor:"pointer",color:AU.textDim,fontSize:10}}>+</button>
            <button onClick={()=>{const m=(viewStart+viewEnd)/2,h=(viewEnd-viewStart);setViewStart(Math.max(0,m-h));setViewEnd(Math.min(1,m+h));}} style={{background:AU.bgDark,border:`1px solid ${AU.border}`,borderRadius:3,padding:"2px 6px",cursor:"pointer",color:AU.textDim,fontSize:10}}>−</button>
            <button onClick={()=>{setViewStart(0);setViewEnd(1);}} style={{background:AU.bgDark,border:`1px solid ${AU.border}`,borderRadius:3,padding:"2px 5px",cursor:"pointer",color:AU.textDim,fontSize:8}}>FIT</button>

            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
              {!mobile&&<LEDMeter level={peakLevel}/>}
              {onDownload&&(
                <button onClick={onDownload} style={{
                  display:"flex",alignItems:"center",gap:4,
                  background:"#10b98122",border:"1px solid #10b98166",
                  borderRadius:3,padding:"3px 10px",cursor:"pointer",
                  color:AU.wave,fontSize:9,fontWeight:700,
                  boxShadow:"0 0 6px #10b98333"}}>
                  ⬇ Export WAV
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
