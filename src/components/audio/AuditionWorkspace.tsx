/**
 * AuditionWorkspace.tsx — True WebGL + Web Worker Audio Workstation
 * Aivora Platform
 *
 * Architecture:
 * - WebGL2 waveform: VBO Float32 → GLSL vertex/fragment shaders
 * - Phosphor green glow via fragment shader distance field
 * - STFT Web Worker (inline Blob URL) → transferable ArrayBuffer
 * - WebGL texture spectrogram (GPU colormap)
 * - LOD cache: downsampled min/max at 8 zoom levels
 * - Stereo: split viewport L/R
 * - RAF-synced playhead at 60fps
 * - Multi-file tab bar (10+ buffers)
 * - LED peak meter
 */

import React, {
  useRef, useEffect, useState, useCallback,
  useMemo, useLayoutEffect,
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
// Pre-aggregates min/max at 8 zoom levels per channel.
// Swaps to raw Float32 at sample-level zoom.

const LOD_LEVELS = [1, 2, 4, 8, 16, 64, 256, 1024];

interface LODLevel { min: Float32Array; max: Float32Array; stride: number; }

function buildLODCache(data: Float32Array): LODLevel[] {
  return LOD_LEVELS.map(stride => {
    const n   = Math.ceil(data.length / stride);
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    for(let i = 0; i < n; i++){
      let mn =  1, mx = -1;
      const e = Math.min((i + 1) * stride, data.length);
      for(let j = i * stride; j < e; j++){
        if(data[j] < mn) mn = data[j];
        if(data[j] > mx) mx = data[j];
      }
      min[i] = mn; max[i] = mx;
    }
    return { min, max, stride };
  });
}

function pickLOD(lods: LODLevel[], samplesPerPixel: number): LODLevel {
  for(const lod of lods){
    if(lod.stride >= samplesPerPixel * 0.5) return lod;
  }
  return lods[lods.length - 1];
}

// ── WebGL Waveform Renderer ───────────────────────────────────────────────────

const VERT_WAVEFORM = `#version 300 es
precision highp float;

in  float a_sample;     // raw sample value -1..1
in  float a_x;          // normalized x 0..1

uniform float u_chTop;  // normalized viewport top (0..1 in NDC space)
uniform float u_chH;    // normalized viewport height

out float v_y;
out float v_x;

void main() {
  // Map sample [-1,1] into channel viewport
  float ndcX =  a_x * 2.0 - 1.0;
  float ndcY =  (u_chTop + u_chH * 0.5 + a_sample * u_chH * 0.5) * 2.0 - 1.0;
  v_y = a_sample;
  v_x = a_x;
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  gl_PointSize = 2.0;
}`;

const FRAG_WAVEFORM = `#version 300 es
precision highp float;

in  float v_y;
in  float v_x;
out vec4  fragColor;

uniform vec3 u_waveColor;   // phosphor green

void main() {
  // Glow: bright center, fade edges for anti-aliasing
  float dist  = abs(gl_PointCoord.y - 0.5) * 2.0;
  float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
  vec3  glow  = u_waveColor * (0.6 + 0.4 * (1.0 - abs(v_y)));
  fragColor = vec4(glow, alpha * 0.9);
}`;

const VERT_SPECTROGRAM = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SPECTROGRAM = `#version 300 es
precision highp float;
in  vec2      v_uv;
out vec4      fragColor;
uniform sampler2D u_spec;    // magnitude texture [0..1]
uniform float u_viewStart;
uniform float u_viewEnd;

// Adobe Audition colormap
vec3 auditionColor(float t) {
  t = clamp(t, 0.0, 1.0);
  if(t < 0.20) {
    float s = t / 0.20;
    return vec3(s * 0.31, 0.0, s * 0.47);
  } else if(t < 0.40) {
    float s = (t - 0.20) / 0.20;
    return vec3(0.31 + s * 0.59, 0.0, 0.47 - s * 0.47);
  } else if(t < 0.65) {
    float s = (t - 0.40) / 0.25;
    return vec3(0.90, s * 0.47, 0.0);
  } else if(t < 0.85) {
    float s = (t - 0.65) / 0.20;
    return vec3(1.0, 0.47 + s * 0.53, 0.0);
  } else {
    float s = (t - 0.85) / 0.15;
    return vec3(1.0, 1.0, s);
  }
}

void main() {
  // Map viewport-relative UV to texture UV
  float texU = u_viewStart + v_uv.x * (u_viewEnd - u_viewStart);
  float mag   = texture(u_spec, vec2(texU, 1.0 - v_uv.y)).r;
  fragColor   = vec4(auditionColor(mag), 1.0);
}`;

// ── WebGL Helpers ─────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(`Shader error: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`Link error: ${gl.getProgramInfoLog(p)}`);
  return p;
}

// ── STFT Web Worker (inline Blob) ─────────────────────────────────────────────
// Runs Cooley-Tukey FFT off the UI thread.
// Returns magnitude texture as Float32Array (transferable, zero-copy).

const WORKER_SRC = `
self.onmessage = function(e) {
  const { samples, sr, fftSize, hopSize, id } = e.data;

  const nFrames = Math.floor((samples.length - fftSize) / hopSize) + 1;
  const nBins   = fftSize / 2;
  // Row-major: [frame][bin] → normalized magnitude [0..1]
  const tex     = new Float32Array(nFrames * nBins);

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  function fft() {
    const n = re.length;
    for(let i=1,j=0;i<n;i++){
      let bit=n>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit;
      if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}
    }
    for(let len=2;len<=n;len<<=1){
      const ang=-2*Math.PI/len, wR=Math.cos(ang), wI=Math.sin(ang);
      for(let i=0;i<n;i+=len){
        let cR=1, cI=0;
        for(let j=0;j<len>>1;j++){
          const uR=re[i+j],uI=im[i+j];
          const vR=re[i+j+len/2]*cR-im[i+j+len/2]*cI;
          const vI=re[i+j+len/2]*cI+im[i+j+len/2]*cR;
          re[i+j]=uR+vR; im[i+j]=uI+vI;
          re[i+j+len/2]=uR-vR; im[i+j+len/2]=uI-vI;
          const nR=cR*wR-cI*wI; cI=cR*wI+cI*wR; cR=nR;
        }
      }
    }
  }

  let globalMax = 1e-10;

  // Pass 1: compute FFT frames, collect raw magnitudes
  const rawMag = new Float32Array(nFrames * nBins);
  for(let f=0; f<nFrames; f++){
    const off = f * hopSize;
    re.fill(0); im.fill(0);
    for(let i=0;i<fftSize;i++){
      const w = 0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)));
      re[i] = (samples[off+i] || 0) * w;
    }
    fft();
    for(let b=0;b<nBins;b++){
      const m = Math.sqrt(re[b]*re[b]+im[b]*im[b]);
      rawMag[f*nBins+b] = m;
      if(m > globalMax) globalMax = m;
    }
  }

  // Pass 2: normalize to [0..1] using global max
  for(let i=0;i<rawMag.length;i++){
    const db  = rawMag[i] > 1e-10 ? 20*Math.log10(rawMag[i]/globalMax) : -90;
    tex[i]    = Math.max(0, Math.min(1, (db + 90) / 90));
  }

  // Transfer zero-copy
  self.postMessage(
    { id, nFrames, nBins, tex: tex.buffer },
    [tex.buffer]
  );
};
`;

function createSTFTWorker(): Worker {
  const blob = new Blob([WORKER_SRC], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

// ── WebGL Waveform Canvas ─────────────────────────────────────────────────────

interface WaveGLState {
  gl:      WebGL2RenderingContext;
  prog:    WebGLProgram;
  vao:     WebGLVertexArrayObject;
  vboX:    WebGLBuffer;
  vboY:    WebGLBuffer;
  locs: {
    aSample: number; aX: number;
    uChTop: WebGLUniformLocation; uChH: WebGLUniformLocation;
    uWaveColor: WebGLUniformLocation;
  };
}

function initWaveGL(canvas: HTMLCanvasElement): WaveGLState | null {
  const gl = canvas.getContext("webgl2", {
    antialias: true, alpha: false, premultipliedAlpha: false,
  }) as WebGL2RenderingContext | null;
  if(!gl) return null;

  const vs   = compileShader(gl, gl.VERTEX_SHADER,   VERT_WAVEFORM);
  const fs   = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_WAVEFORM);
  const prog = linkProgram(gl, vs, fs);

  const vao  = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const vboX = gl.createBuffer()!;
  const vboY = gl.createBuffer()!;

  const aSample    = gl.getAttribLocation(prog, "a_sample");
  const aX         = gl.getAttribLocation(prog, "a_x");
  const uChTop     = gl.getUniformLocation(prog, "u_chTop")!;
  const uChH       = gl.getUniformLocation(prog, "u_chH")!;
  const uWaveColor = gl.getUniformLocation(prog, "u_waveColor")!;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return { gl, prog, vao, vboX, vboY, locs:{ aSample, aX, uChTop, uChH, uWaveColor } };
}

function renderWaveGL(
  state:     WaveGLState,
  channels:  Float32Array[],
  lods:      LODLevel[][],
  viewStart: number,
  viewEnd:   number,
  playhead:  number,
  W:         number,
  H:         number,
): void {
  const { gl, prog, vao, vboX, vboY, locs } = state;

  gl.viewport(0, 0, W, H);
  gl.clearColor(0.078, 0.078, 0.078, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);
  gl.bindVertexArray(vao);

  const nCh      = channels.length;
  const chH_norm = 1.0 / nCh;

  for(let ch = 0; ch < nCh; ch++){
    const data       = channels[ch];
    const totalSamp  = data.length;
    const startSamp  = Math.floor(viewStart * totalSamp);
    const endSamp    = Math.floor(viewEnd   * totalSamp);
    const visSamp    = endSamp - startSamp;
    const spp        = visSamp / W;

    // Pick LOD
    const lod        = pickLOD(lods[ch], spp);
    const stride     = lod.stride;
    const lodStart   = Math.floor(startSamp / stride);
    const lodEnd     = Math.min(Math.ceil(endSamp   / stride), lod.min.length);
    const nPts       = lodEnd - lodStart;

    if(nPts <= 0) continue;

    // Build VBO data for this LOD band
    // Each pixel → 2 points (min, max) for filled waveform
    const xArr = new Float32Array(nPts * 2);
    const yArr = new Float32Array(nPts * 2);

    for(let i = 0; i < nPts; i++){
      const li = lodStart + i;
      const x  = (li * stride - startSamp) / visSamp;
      xArr[i * 2]     = x;
      xArr[i * 2 + 1] = x;
      yArr[i * 2]     = lod.min[li] ?? 0;
      yArr[i * 2 + 1] = lod.max[li] ?? 0;
    }

    // Upload VBOs
    gl.bindBuffer(gl.ARRAY_BUFFER, vboX);
    gl.bufferData(gl.ARRAY_BUFFER, xArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locs.aX);
    gl.vertexAttribPointer(locs.aX, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vboY);
    gl.bufferData(gl.ARRAY_BUFFER, yArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locs.aSample);
    gl.vertexAttribPointer(locs.aSample, 1, gl.FLOAT, false, 0, 0);

    // Channel viewport (top → bottom)
    const chTop = 1.0 - (ch + 1) * chH_norm;
    gl.uniform1f(locs.uChTop,  chTop);
    gl.uniform1f(locs.uChH,    chH_norm);

    // Phosphor green
    gl.uniform3f(locs.uWaveColor, 0.063, 0.725, 0.506);

    gl.drawArrays(gl.LINES, 0, nPts * 2);
  }

  // Playhead line (2D overlay via scissor)
  const phX = Math.round(((playhead - viewStart) / (viewEnd - viewStart)) * W);
  if(phX >= 0 && phX < W){
    // Draw as a 1px wide strip via scissor
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(phX, 0, 2, H);
    gl.clearColor(1.0, 0.427, 0.0, 0.9);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    // Restore bg color
    gl.clearColor(0.078, 0.078, 0.078, 1.0);
  }
}

// ── WebGL Spectrogram Canvas ──────────────────────────────────────────────────

interface SpecGLState {
  gl:      WebGL2RenderingContext;
  prog:    WebGLProgram;
  tex:     WebGLTexture;
  vbo:     WebGLBuffer;
  locs: {
    aPos:      number;
    uSpec:     WebGLUniformLocation;
    uViewStart:WebGLUniformLocation;
    uViewEnd:  WebGLUniformLocation;
  };
  nFrames: number;
  nBins:   number;
}

function initSpecGL(canvas: HTMLCanvasElement): SpecGLState | null {
  const gl = canvas.getContext("webgl2", {
    antialias:false, alpha:false,
  }) as WebGL2RenderingContext | null;
  if(!gl) return null;

  const vs   = compileShader(gl, gl.VERTEX_SHADER,   VERT_SPECTROGRAM);
  const fs   = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SPECTROGRAM);
  const prog = linkProgram(gl, vs, fs);

  // Full-screen quad
  const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  const vbo  = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    gl, prog, tex, vbo,
    locs: {
      aPos:       gl.getAttribLocation(prog, "a_pos"),
      uSpec:      gl.getUniformLocation(prog, "u_spec")!,
      uViewStart: gl.getUniformLocation(prog, "u_viewStart")!,
      uViewEnd:   gl.getUniformLocation(prog, "u_viewEnd")!,
    },
    nFrames: 0, nBins: 0,
  };
}

function uploadSpecTex(state: SpecGLState, data: Float32Array, nFrames: number, nBins: number): void {
  const { gl, tex } = state;
  state.nFrames = nFrames;
  state.nBins   = nBins;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.R32F,
    nFrames, nBins, 0,
    gl.RED, gl.FLOAT,
    data
  );
}

function renderSpecGL(state: SpecGLState, viewStart: number, viewEnd: number, W: number, H: number): void {
  if(state.nFrames === 0) return;
  const { gl, prog, tex, vbo, locs } = state;
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.04, 0, 0.06, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(locs.aPos);
  gl.vertexAttribPointer(locs.aPos, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(locs.uSpec,      0);
  gl.uniform1f(locs.uViewStart, viewStart);
  gl.uniform1f(locs.uViewEnd,   viewEnd);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── LED Meter ─────────────────────────────────────────────────────────────────

function LEDMeter({ level }: { level: number }) {
  const db    = level > 0 ? 20 * Math.log10(level) : -60;
  const BANDS = 20;
  const minDb = -57, maxDb = 0;
  return (
    <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:60 }}>
      {Array.from({ length: BANDS }, (_, i) => {
        const threshold = minDb + (i / BANDS) * (maxDb - minDb);
        const lit       = db >= threshold;
        const color     = i < 14 ? AU.ledGreen : i < 18 ? AU.ledYellow : AU.ledRed;
        return (
          <div key={i} style={{
            width:6, height: 3 + i * 2.5,
            background: lit ? color : AU.ledOff,
            borderRadius:1,
            boxShadow: lit ? `0 0 4px ${color}` : "none",
            transition:"background 0.04s",
          }}/>
        );
      })}
    </div>
  );
}

// ── Time Ruler ─────────────────────────────────────────────────────────────────

function TimeRuler({ duration, viewStart, viewEnd }: {
  duration:number; viewStart:number; viewEnd:number;
}) {
  const visDur = (viewEnd - viewStart) * duration;
  const step   = visDur > 60 ? 10 : visDur > 10 ? 1 : visDur > 2 ? 0.5 : 0.1;
  const startT = viewStart * duration;
  const ticks: { pct:number; label:string }[] = [];
  for(let t = Math.ceil(startT/step)*step; t <= viewEnd*duration; t += step){
    const pct = ((t - startT) / visDur) * 100;
    const m   = Math.floor(t / 60);
    const s   = (t % 60).toFixed(step < 0.5 ? 2 : 1);
    ticks.push({ pct, label: m > 0 ? `${m}:${s.padStart(5,"0")}` : `${s}s` });
  }
  return (
    <div style={{
      position:"relative", height:20, background:AU.rulerBg,
      borderBottom:`1px solid ${AU.border}`, overflow:"hidden", flexShrink:0,
    }}>
      {ticks.map((t, i) => (
        <div key={i} style={{
          position:"absolute", left:`${t.pct}%`, top:0,
          borderLeft:`1px solid ${AU.border}`, paddingLeft:3,
          height:"100%", display:"flex", alignItems:"flex-end", paddingBottom:2,
        }}>
          <span style={{ fontSize:8, color:AU.rulerText, whiteSpace:"nowrap" }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Workspace ─────────────────────────────────────────────────────────────

export default function AuditionWorkspace({
  files, activeId, onTabSelect, onTabClose,
  playheadSec, playing, onTogglePlay, onSeek, onDownload,
}: AuditionWorkspaceProps) {

  const activeFile = useMemo(() => files.find(f => f.id === activeId), [files, activeId]);
  const buf        = activeFile?.buffer ?? null;

  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveGLRef     = useRef<WaveGLState | null>(null);
  const specGLRef     = useRef<SpecGLState | null>(null);
  const workerRef     = useRef<Worker | null>(null);
  const rafRef        = useRef(0);

  // LOD cache per channel [ch][lodLevel]
  const lodCacheRef   = useRef<LODLevel[][]>([]);
  const channelsRef   = useRef<Float32Array[]>([]);

  const [viewStart, setViewStart] = useState(0);
  const [viewEnd,   setViewEnd]   = useState(1);
  const [dragging,  setDragging]  = useState(false);
  const [peakLevel, setPeakLevel] = useState(0);
  const peakDecayRef = useRef(0);
  const specReadyRef = useRef(false);

  const duration = buf?.duration ?? 1;
  const phNorm   = duration > 0 ? playheadSec / duration : 0;

  // ── Init WebGL contexts ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    const wc = waveCanvasRef.current;
    const sc = specCanvasRef.current;
    if(wc && !waveGLRef.current){
      try { waveGLRef.current = initWaveGL(wc); } catch(e){ console.warn("WaveGL:", e); }
    }
    if(sc && !specGLRef.current){
      try { specGLRef.current = initSpecGL(sc); } catch(e){ console.warn("SpecGL:", e); }
    }
  }, []);

  // ── Build LOD + dispatch STFT Worker on buffer change ─────────────────────
  useEffect(() => {
    if(!buf) return;
    specReadyRef.current = false;

    // Build LOD cache per channel (fast — 8 levels)
    const channels: Float32Array[] = [];
    const lods:     LODLevel[][]   = [];
    for(let ch = 0; ch < buf.numberOfChannels; ch++){
      const data = buf.getChannelData(ch);
      channels.push(data);
      lods.push(buildLODCache(data));
    }
    channelsRef.current = channels;
    lodCacheRef.current = lods;

    // Reset view
    setViewStart(0); setViewEnd(1);

    // Dispatch STFT to Web Worker (mono mix for spectrogram)
    if(!workerRef.current) workerRef.current = createSTFTWorker();
    const worker  = workerRef.current;
    const fftSize = 1024;
    const hopSize = 256;
    const mono    = new Float32Array(buf.length);
    for(let ch = 0; ch < buf.numberOfChannels; ch++){
      const d = buf.getChannelData(ch);
      for(let i = 0; i < buf.length; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    // Slice + transfer zero-copy
    const transfer = mono.buffer.slice(0);
    const workerId = Date.now();
    worker.onmessage = (e: MessageEvent) => {
      if(e.data.id !== workerId) return;
      const { nFrames, nBins, tex } = e.data;
      const texArr = new Float32Array(tex);
      // Upload to WebGL texture on main thread
      const spec = specGLRef.current;
      if(spec) uploadSpecTex(spec, texArr, nFrames, nBins);
      specReadyRef.current = true;
    };
    worker.postMessage(
      { samples: transfer, sr: buf.sampleRate, fftSize, hopSize, id: workerId },
      [transfer]
    );
  }, [buf]);

  // ── RAF render loop ───────────────────────────────────────────────────────
  useEffect(() => {
    function frame() {
      const wc = waveCanvasRef.current;
      const sc = specCanvasRef.current;

      if(wc && waveGLRef.current && channelsRef.current.length > 0){
        const W = wc.width, H = wc.height;
        renderWaveGL(
          waveGLRef.current,
          channelsRef.current,
          lodCacheRef.current,
          viewStart, viewEnd, phNorm, W, H,
        );
      }

      if(sc && specGLRef.current && specReadyRef.current){
        const W = sc.width, H = sc.height;
        renderSpecGL(specGLRef.current, viewStart, viewEnd, W, H);
      }

      // LED peak meter
      if(playing && buf){
        const ch0   = channelsRef.current[0];
        const frame_ = Math.floor(phNorm * (ch0?.length ?? 0));
        const slice  = ch0?.subarray(Math.max(0, frame_ - 512), frame_);
        let peak = 0;
        if(slice) for(let i = 0; i < slice.length; i++){
          const v = Math.abs(slice[i]);
          if(v > peak) peak = v;
        }
        peakDecayRef.current = Math.max(peak, peakDecayRef.current * 0.93);
        setPeakLevel(peakDecayRef.current);
      } else {
        peakDecayRef.current *= 0.9;
        setPeakLevel(peakDecayRef.current);
      }

      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [buf, playing, viewStart, viewEnd, phNorm]);

  // ── Resize canvases ───────────────────────────────────────────────────────
  useEffect(() => {
    function resize() {
      const wc = waveCanvasRef.current;
      const sc = specCanvasRef.current;
      if(wc){ wc.width = wc.offsetWidth || 800; wc.height = wc.offsetHeight || 160; }
      if(sc){ sc.width = sc.offsetWidth || 800; sc.height = sc.offsetHeight || 120; }
    }
    resize();
    const obs = new ResizeObserver(resize);
    if(waveCanvasRef.current) obs.observe(waveCanvasRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect    = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx      = (e.clientX - rect.left) / rect.width;
    const span    = viewEnd - viewStart;
    const zoomF   = e.deltaY < 0 ? 0.82 : 1.18;
    const newSpan = Math.max(0.0001, Math.min(1, span * zoomF));
    const anchor  = viewStart + cx * span;
    let ns = anchor - cx * newSpan;
    let ne = anchor + (1 - cx) * newSpan;
    if(ns < 0){ ne -= ns; ns = 0; }
    if(ne > 1){ ns -= (ne-1); ne = 1; }
    setViewStart(Math.max(0, ns));
    setViewEnd(Math.min(1, ne));
  }, [viewStart, viewEnd]);

  // ── Mouse seek ────────────────────────────────────────────────────────────
  function getCanvasNorm(e: React.MouseEvent): number {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x    = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, viewStart + x * (viewEnd - viewStart)));
  }

  function handleMouseDown(e: React.MouseEvent) {
    setDragging(true);
    onSeek(getCanvasNorm(e));
  }
  function handleMouseMove(e: React.MouseEvent) {
    if(!dragging) return;
    onSeek(getCanvasNorm(e));
  }
  function handleMouseUp() { setDragging(false); }

  // ── Scroll thumb drag ─────────────────────────────────────────────────────
  function handleScrollDrag(e: React.MouseEvent<HTMLDivElement>) {
    const rect  = e.currentTarget.getBoundingClientRect();
    const x     = (e.clientX - rect.left) / rect.width;
    const span  = viewEnd - viewStart;
    const ns    = Math.max(0, Math.min(1 - span, x - span/2));
    setViewStart(ns); setViewEnd(ns + span);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      workerRef.current?.terminate();
    };
  }, []);

  // ── Properties ────────────────────────────────────────────────────────────
  const props_ = buf ? [
    ["Sample Rate", buf.sampleRate + " Hz"],
    ["Channels",    buf.numberOfChannels === 1 ? "Mono" : "Stereo"],
    ["Duration",    buf.duration.toFixed(3) + "s"],
    ["Samples",     buf.length.toLocaleString()],
    ["Bit Depth",   "32-bit Float"],
    ["Zoom",        ((viewEnd-viewStart)*100).toFixed(2)+"%"],
    ["LOD Level",   (() => {
      const spp = (viewEnd-viewStart)*(buf.length) / 800;
      const l   = LOD_LEVELS.findIndex(s => s >= spp*0.5);
      return l < 0 ? "Full" : `1:${LOD_LEVELS[l]}`;
    })()],
  ] : [];

  const nCh = buf?.numberOfChannels ?? 1;

  return (
    <div style={{
      display:"flex", flexDirection:"column",
      background:AU.bg, border:`1px solid ${AU.border}`,
      borderRadius:4, overflow:"hidden",
      fontFamily:"monospace", userSelect:"none",
    }}>

      {/* Tab Bar */}
      <div style={{
        display:"flex", alignItems:"stretch",
        background:AU.bgDark, borderBottom:`1px solid ${AU.border}`,
        minHeight:30, overflowX:"auto",
      }}>
        {files.map(f => {
          const active = f.id === activeId;
          return (
            <div key={f.id} onClick={() => onTabSelect(f.id)} style={{
              display:"flex", alignItems:"center", gap:5,
              padding:"0 10px", cursor:"pointer", flexShrink:0,
              background: active ? AU.tabActive : AU.tabInactive,
              borderRight:`1px solid ${AU.border}`,
              borderBottom: active ? `2px solid ${AU.wave}` : "2px solid transparent",
            }}>
              <span style={{ fontSize:9, color:AU.waveAlt }}>≋</span>
              <span style={{
                fontSize:10, color: active ? AU.textBright : AU.textDim,
                maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              }}>{f.name}</span>
              <span onClick={e=>{e.stopPropagation();onTabClose(f.id);}}
                style={{ fontSize:9, color:AU.textDim, cursor:"pointer",
                  padding:"0 2px", marginLeft:2 }}
                title="Close">✕</span>
            </div>
          );
        })}
        {files.length===0&&(
          <div style={{padding:"0 12px",fontSize:10,color:AU.textDim,
            display:"flex",alignItems:"center"}}>No files loaded</div>
        )}
      </div>

      {/* Body */}
      <div style={{ display:"flex", flex:1, minHeight:0 }}>

        {/* Left panel */}
        <div style={{
          width:160, background:AU.bgPanel,
          borderRight:`1px solid ${AU.border}`,
          display:"flex", flexDirection:"column",
          flexShrink:0, overflow:"hidden",
        }}>
          <div style={{
            padding:"6px 8px", fontSize:8, color:AU.textDim,
            letterSpacing:1, borderBottom:`1px solid ${AU.border}`,
          }}>FILES & PROPERTIES</div>
          <div style={{ borderBottom:`1px solid ${AU.border}`, padding:4 }}>
            {files.map(f=>(
              <div key={f.id} onClick={()=>onTabSelect(f.id)} style={{
                padding:"3px 6px", borderRadius:2, cursor:"pointer",
                background: f.id===activeId?"#252525":"transparent",
                fontSize:9, color: f.id===activeId?AU.wave:AU.textDim,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              }}>≋ {f.name}</div>
            ))}
          </div>
          <div style={{ padding:"6px 8px", flex:1, overflowY:"auto" }}>
            {props_.map(([l,v])=>(
              <div key={l} style={{
                display:"flex", justifyContent:"space-between",
                padding:"2px 0", borderBottom:`1px solid ${AU.border}`,
              }}>
                <span style={{fontSize:8,color:AU.textDim}}>{l}</span>
                <span style={{fontSize:8,color:AU.textBright}}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{
            padding:"6px 8px", borderTop:`1px solid ${AU.border}`,
            fontSize:8, color:AU.textDim,
          }}>
            <div style={{marginBottom:3}}>OPERATION LOG</div>
            <div style={{color:playing?AU.ledGreen:AU.textDim}}>
              {playing?"▶ Playback":"■ Stopped"}
            </div>
            <div style={{marginTop:2}}>
              {playheadSec.toFixed(3)}s / {duration.toFixed(3)}s
            </div>
            <div style={{marginTop:2,color:"#444"}}>
              {specReadyRef.current?"STFT: ready":"STFT: computing..."}
            </div>
          </div>
        </div>

        {/* Center */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>

          {/* Ruler */}
          <TimeRuler duration={duration} viewStart={viewStart} viewEnd={viewEnd}/>

          {/* Channel labels */}
          {nCh > 1 && (
            <div style={{
              display:"flex", flexDirection:"column",
              position:"relative", height:0,
            }}>
              {["L","R"].slice(0, nCh).map((label, i) => (
                <div key={i} style={{
                  position:"absolute", top: 0, left:4,
                  fontSize:8, color:AU.textDim,
                  transform:`translateY(${i * 160}px)`,
                }}>CH {label}</div>
              ))}
            </div>
          )}

          {/* WebGL Waveform */}
          <canvas
            ref={waveCanvasRef}
            style={{
              width:"100%",
              height: nCh > 1 ? 220 : 160,
              display:"block", cursor:"crosshair", flexShrink:0,
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          <div style={{height:1,background:AU.border,flexShrink:0}}/>

          {/* WebGL Spectrogram */}
          <canvas
            ref={specCanvasRef}
            style={{
              width:"100%", height:120,
              display:"block", cursor:"crosshair", flexShrink:0,
            }}
            onWheel={handleWheel}
          />

          {/* Freq labels overlay */}
          <div style={{
            position:"relative", height:0, pointerEvents:"none",
          }}>
            {buf && [100,500,1000,4000,8000,16000].map(f => {
              if(f > buf.sampleRate/2) return null;
              const nyq = buf.sampleRate/2;
              const pct = (1 - f/nyq) * 100;
              return (
                <div key={f} style={{
                  position:"absolute",
                  top:`-${120 - pct*1.2}px`,
                  left:4, fontSize:7, color:"rgba(255,255,255,0.3)",
                }}>
                  {f>=1000?(f/1000)+"k":f}Hz
                </div>
              );
            })}
          </div>

          {/* Scroll bar */}
          <div onClick={handleScrollDrag} style={{
            height:10, background:AU.bgDark,
            borderTop:`1px solid ${AU.border}`,
            cursor:"pointer", position:"relative", flexShrink:0,
          }}>
            <div style={{
              position:"absolute", left:`${viewStart*100}%`,
              width:`${(viewEnd-viewStart)*100}%`,
              height:"100%", background:AU.borderLight, borderRadius:2,
            }}/>
          </div>

          {/* Transport */}
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            padding:"6px 10px",
            background:AU.bgPanel, borderTop:`1px solid ${AU.border}`,
            flexShrink:0, flexWrap:"wrap",
          }}>
            <button onClick={onTogglePlay} style={{
              background: playing?"#ff6d0022":"#10b98122",
              border:`1px solid ${playing?"#ff6d0066":"#10b98166"}`,
              borderRadius:3, padding:"3px 12px",
              cursor:"pointer", color:playing?"#ff6d00":AU.wave,
              fontSize:13, fontWeight:700,
            }}>{playing?"⏸":"▶"}</button>

            <button onClick={()=>onSeek(0)} style={{
              background:"#1a1a1a", border:`1px solid ${AU.border}`,
              borderRadius:3, padding:"3px 8px",
              cursor:"pointer", color:AU.textDim, fontSize:11,
            }}>⏹</button>

            <div style={{
              background:"#000", border:`1px solid ${AU.border}`,
              borderRadius:3, padding:"3px 10px",
              fontFamily:"monospace", fontSize:11,
              color:"#00ff99", minWidth:80, textAlign:"center",
            }}>
              {playheadSec.toFixed(3)}s
            </div>

            {/* Zoom buttons */}
            {[
              ["+", ()=>{ const m=(viewStart+viewEnd)/2,h=(viewEnd-viewStart)/4; setViewStart(Math.max(0,m-h));setViewEnd(Math.min(1,m+h)); }],
              ["−", ()=>{ const m=(viewStart+viewEnd)/2,h=(viewEnd-viewStart);   setViewStart(Math.max(0,m-h));setViewEnd(Math.min(1,m+h)); }],
              ["FIT",()=>{ setViewStart(0);setViewEnd(1); }],
            ] as [string,(()=>void)][]).map(([l,fn],i)=>(
              <button key={i} onClick={fn} style={{
                background:AU.bgDark, border:`1px solid ${AU.border}`,
                borderRadius:3, padding:"2px 8px",
                cursor:"pointer", color:AU.textDim, fontSize:10,
              }}>{l}</button>
            ))}

            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
              <LEDMeter level={peakLevel}/>
              {onDownload&&(
                <button onClick={onDownload} style={{
                  display:"flex",alignItems:"center",gap:5,
                  background:"#10b98122",border:"1px solid #10b98166",
                  borderRadius:3,padding:"4px 12px",
                  cursor:"pointer",color:AU.wave,fontSize:10,fontWeight:700,
                  boxShadow:"0 0 8px #10b98333",
                }}>⬇ Export WAV</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
