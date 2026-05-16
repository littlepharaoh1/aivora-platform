/**
 * webglRenderer.ts — WebGL GPU Accelerated Renderer
 * Aivora Forensic DSP Platform
 */

// ── Vertex Shader ─────────────────────────────────────────────────────────────

const VERT_SHADER = `
attribute vec2 a_position;
attribute float a_value;
uniform vec2 u_resolution;
uniform float u_zoom;
uniform float u_pan;
uniform float u_duration;
varying float v_value;

void main() {
  vec2 pos = a_position;
  // Convert to clip space
  vec2 clip = (pos / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0, 1);
  v_value = a_value;
}
`;

// ── Fragment Shader — Waveform ────────────────────────────────────────────────

const FRAG_WAVEFORM = `
precision mediump float;
varying float v_value;
uniform float u_mode; // 0=peak, 1=rms

void main() {
  vec3 color;
  float v = abs(v_value);
  if(u_mode < 0.5) {
    // Peak — dark green fill
    color = mix(vec3(0.0,0.4,0.2), vec3(0.0,1.0,0.5), v);
  } else {
    // RMS — bright green line
    color = vec3(0.0,1.0,0.53);
  }
  gl_FragColor = vec4(color, 0.85);
}
`;

// ── Fragment Shader — Spectrogram ─────────────────────────────────────────────

const FRAG_SPECTROGRAM = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_gain;
uniform float u_colormap; // 0=inferno, 1=plasma, 2=forensic
varying vec2 v_texCoord;

vec3 inferno(float t) {
  vec3 c0 = vec3(0.0,0.0,0.016);
  vec3 c1 = vec3(0.157,0.043,0.329);
  vec3 c2 = vec3(0.396,0.082,0.431);
  vec3 c3 = vec3(0.624,0.165,0.388);
  vec3 c4 = vec3(0.831,0.282,0.259);
  vec3 c5 = vec3(0.961,0.490,0.082);
  vec3 c6 = vec3(0.988,0.757,0.133);
  vec3 c7 = vec3(0.988,1.0,0.643);
  float s = t * 7.0;
  int i = int(s);
  float f = fract(s);
  if(i==0) return mix(c0,c1,f);
  if(i==1) return mix(c1,c2,f);
  if(i==2) return mix(c2,c3,f);
  if(i==3) return mix(c3,c4,f);
  if(i==4) return mix(c4,c5,f);
  if(i==5) return mix(c5,c6,f);
  return mix(c6,c7,f);
}

vec3 plasma(float t) {
  vec3 c0 = vec3(0.051,0.031,0.529);
  vec3 c1 = vec3(0.329,0.008,0.639);
  vec3 c2 = vec3(0.545,0.039,0.647);
  vec3 c3 = vec3(0.725,0.196,0.537);
  vec3 c4 = vec3(0.859,0.361,0.380);
  vec3 c5 = vec3(0.957,0.533,0.286);
  vec3 c6 = vec3(0.996,0.737,0.169);
  vec3 c7 = vec3(0.941,0.976,0.129);
  float s = t * 7.0;
  int i = int(s);
  float f = fract(s);
  if(i==0) return mix(c0,c1,f);
  if(i==1) return mix(c1,c2,f);
  if(i==2) return mix(c2,c3,f);
  if(i==3) return mix(c3,c4,f);
  if(i==4) return mix(c4,c5,f);
  if(i==5) return mix(c5,c6,f);
  return mix(c6,c7,f);
}

vec3 forensic(float t) {
  vec3 c0 = vec3(0.0,0.0,0.0);
  vec3 c1 = vec3(0.0,0.078,0.157);
  vec3 c2 = vec3(0.0,0.235,0.314);
  vec3 c3 = vec3(0.078,0.706,0.392);
  vec3 c4 = vec3(0.706,0.863,0.0);
  vec3 c5 = vec3(1.0,0.627,0.0);
  vec3 c6 = vec3(1.0,1.0,1.0);
  float s = t * 6.0;
  int i = int(s);
  float f = fract(s);
  if(i==0) return mix(c0,c1,f);
  if(i==1) return mix(c1,c2,f);
  if(i==2) return mix(c2,c3,f);
  if(i==3) return mix(c3,c4,f);
  if(i==4) return mix(c4,c5,f);
  return mix(c5,c6,f);
}

void main() {
  float val = texture2D(u_texture, v_texCoord).r;

  // HDR pipeline
  float linear = val;
  float logMapped = log(1.0 + linear * 9.0) / log(10.0);
  float gamma = linear < 0.15 ? 0.4 : linear < 0.4 ? 0.6 : 0.85;
  float corrected = pow(logMapped, gamma);
  float boosted = min(1.0, corrected * u_gain);
  float t = boosted < 0.5
    ? 2.0 * boosted * boosted
    : 1.0 - pow(-2.0*boosted+2.0,2.0)/2.0;
  t = clamp(t, 0.0, 1.0);

  vec3 color;
  if(u_colormap < 0.5)      color = inferno(t);
  else if(u_colormap < 1.5) color = plasma(t);
  else                       color = forensic(t);

  gl_FragColor = vec4(color, 1.0);
}
`;

const VERT_TEXTURE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  vec2 clip = a_position * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0, 1);
  v_texCoord = a_texCoord;
}
`;

// ── WebGL Context Manager ─────────────────────────────────────────────────────

export class WebGLRenderer {
  private gl:       WebGLRenderingContext | null = null;
  private canvas:   HTMLCanvasElement;
  private programs: Map<string, WebGLProgram> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.gl = canvas.getContext("webgl", {
        antialias:   true,
        alpha:       true,
        premultipliedAlpha: false,
      });
    } catch(e) {
      this.gl = null;
    }
  }

  isAvailable(): boolean { return this.gl !== null; }

  private compileShader(src: string, type: number): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if(!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader error:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  private getProgram(key: string, vert: string, frag: string): WebGLProgram | null {
    if(this.programs.has(key)) return this.programs.get(key)!;
    const gl = this.gl!;
    const vs = this.compileShader(vert, gl.VERTEX_SHADER);
    const fs = this.compileShader(frag, gl.FRAGMENT_SHADER);
    if(!vs||!fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program error:", gl.getProgramInfoLog(prog));
      return null;
    }
    this.programs.set(key, prog);
    return prog;
  }

  // ── Render Waveform via WebGL ───────────────────────────────────────────────

  renderWaveform(
    mono:       Float32Array,
    sampleRate: number,
    zoom:       number,
    panOffset:  number,
    width:      number,
    height:     number,
    autoGain:   number = 1
  ): void {
    const gl = this.gl;
    if(!gl) return;

    const prog = this.getProgram("waveform", VERT_SHADER, FRAG_WAVEFORM);
    if(!prog) return;

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.008, 0.024, 0.063, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);

    const RULER_H = 24;
    const WAVE_H  = height - RULER_H;
    const centerY = RULER_H + WAVE_H / 2;

    const startSample = Math.floor(panOffset * sampleRate);
    const endSample   = Math.min(mono.length, Math.ceil((panOffset + width/zoom)*sampleRate));
    const spp = Math.max(1, (endSample-startSample)/width);

    // Build peak geometry
    const positions: number[] = [];
    const values:    number[] = [];

    for(let px=0; px<width; px++) {
      const s0 = Math.floor(startSample + px*spp);
      const s1 = Math.min(mono.length, Math.floor(s0+spp)+1);
      let min=0, max=0, sumSq=0;
      for(let i=s0;i<s1;i++) {
        if(mono[i]>max) max=mono[i];
        if(mono[i]<min) min=mono[i];
        sumSq+=mono[i]**2;
      }
      const rms = Math.sqrt(sumSq/Math.max(1,s1-s0));
      const yMax = centerY - max*autoGain*(WAVE_H/2-4);
      const yMin = centerY - min*autoGain*(WAVE_H/2-4);
      const yRms1 = centerY - rms*autoGain*(WAVE_H/2-4);
      const yRms2 = centerY + rms*autoGain*(WAVE_H/2-4);

      // Peak quad
      positions.push(px,yMax, px+1,yMax, px,yMin, px+1,yMin);
      values.push(max,max,min,min);

      // RMS line
      positions.push(px,yRms1, px+1,yRms1);
      values.push(rms,rms);
    }

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    const aPosLoc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    const valBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, valBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
    const aValLoc = gl.getAttribLocation(prog, "a_value");
    gl.enableVertexAttribArray(aValLoc);
    gl.vertexAttribPointer(aValLoc, 1, gl.FLOAT, false, 0, 0);

    gl.uniform2f(gl.getUniformLocation(prog,"u_resolution"), width, height);
    gl.uniform1f(gl.getUniformLocation(prog,"u_mode"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, positions.length/2);

    gl.deleteBuffer(posBuf);
    gl.deleteBuffer(valBuf);
  }

  // ── Render Spectrogram Texture ──────────────────────────────────────────────

  renderSpectrogramTexture(
    frames:     Float32Array[],
    numFrames:  number,
    numBins:    number,
    minDb:      number,
    maxDb:      number,
    colormap:   number,  // 0=inferno, 1=plasma, 2=forensic
    gain:       number,
    width:      number,
    height:     number
  ): void {
    const gl = this.gl;
    if(!gl||numFrames===0) return;

    const prog = this.getProgram("spectrogram", VERT_TEXTURE, FRAG_SPECTROGRAM);
    if(!prog) return;

    // Build texture data
    const texW = Math.min(2048, numFrames);
    const texH = Math.min(512,  numBins);
    const texData = new Uint8Array(texW * texH);

    for(let x=0;x<texW;x++) {
      const fi = Math.floor((x/texW)*numFrames);
      const frame = frames[Math.min(fi,numFrames-1)];
      for(let y=0;y<texH;y++) {
        const bi = Math.floor(((texH-1-y)/texH)*numBins);
        const db = frame[Math.min(bi,numBins-1)];
        const t  = Math.max(0,Math.min(1,(db-minDb)/(maxDb-minDb)));
        texData[y*texW+x] = Math.floor(t*255);
      }
    }

    // Upload texture
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,texW,texH,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,texData);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);

    gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);

    const quad = new Float32Array([0,0,1,0,0,1,1,1]);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER,posBuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    const aPosLoc=gl.getAttribLocation(prog,"a_position");
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc,2,gl.FLOAT,false,0,0);

    const texBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER,texBuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    const aTexLoc=gl.getAttribLocation(prog,"a_texCoord");
    gl.enableVertexAttribArray(aTexLoc);
    gl.vertexAttribPointer(aTexLoc,2,gl.FLOAT,false,0,0);

    gl.uniform1i(gl.getUniformLocation(prog,"u_texture"),0);
    gl.uniform1f(gl.getUniformLocation(prog,"u_gain"),gain);
    gl.uniform1f(gl.getUniformLocation(prog,"u_colormap"),colormap);

    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    gl.deleteBuffer(posBuf);
    gl.deleteBuffer(texBuf);
    gl.deleteTexture(tex);
  }

  dispose(): void {
    const gl = this.gl;
    if(!gl) return;
    this.programs.forEach(p=>gl.deleteProgram(p));
    this.programs.clear();
  }
}
