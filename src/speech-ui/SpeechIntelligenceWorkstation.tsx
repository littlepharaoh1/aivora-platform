/**
 * SpeechIntelligenceWorkstation.tsx — Enterprise Speech Intelligence UI
 * Aivora Platform — Phase 11
 */

import React, { useState, useRef, useCallback } from "react";
import { useASRState } from "./hooks/useASRState";
import type { ASRModelId, ASRLanguage } from "../lib/transcription/asrTypes";
import { DECODER_GOVERNANCE } from "../lib/transcription/greedyDecoder";
import { WHISPER_TOKENIZER_CONFIG } from "../lib/transcription/tokenizerGovernance";
import TranscriptWorkstationPro from "./TranscriptWorkstationPro";

const MODELS: { value:ASRModelId; label:string; size:string }[] = [
  { value:"whisper_tiny",   label:"Whisper Tiny",   size:"39M"  },
  { value:"whisper_base",   label:"Whisper Base",   size:"74M"  },
  { value:"whisper_small",  label:"Whisper Small",  size:"244M" },
  { value:"whisper_medium", label:"Whisper Medium", size:"769M" },
];

const LANGUAGES: { value:string; label:string }[] = [
  { value:"auto", label:"🔍 Auto-detect" },
  // ── >95% Accuracy ──────────────────────────────────
  { value:"ar",   label:"🇸🇦 العربية (Arabic)" },
  { value:"en",   label:"🇺🇸 English" },
  { value:"fr",   label:"🇫🇷 Français (French)" },
  { value:"de",   label:"🇩🇪 Deutsch (German)" },
  { value:"es",   label:"🇪🇸 Español (Spanish)" },
  { value:"it",   label:"🇮🇹 Italiano (Italian)" },
  { value:"pt",   label:"🇧🇷 Português (Portuguese)" },
  { value:"ru",   label:"🇷🇺 Русский (Russian)" },
  { value:"ja",   label:"🇯🇵 日本語 (Japanese)" },
  { value:"zh",   label:"🇨🇳 中文 (Chinese)" },
  { value:"ko",   label:"🇰🇷 한국어 (Korean)" },
  { value:"hi",   label:"🇮🇳 हिन्दी (Hindi)" },
  { value:"nl",   label:"🇳🇱 Nederlands (Dutch)" },
  { value:"pl",   label:"🇵🇱 Polski (Polish)" },
  { value:"sv",   label:"🇸🇪 Svenska (Swedish)" },
  { value:"tr",   label:"🇹🇷 Türkçe (Turkish)" },
  // ── 85-95% Accuracy ────────────────────────────────
  { value:"fa",   label:"🇮🇷 فارسی (Persian)" },
  { value:"ur",   label:"🇵🇰 اردو (Urdu)" },
  { value:"id",   label:"🇮🇩 Bahasa Indonesia" },
  { value:"ms",   label:"🇲🇾 Bahasa Melayu" },
  { value:"th",   label:"🇹🇭 ภาษาไทย (Thai)" },
  { value:"vi",   label:"🇻🇳 Tiếng Việt (Vietnamese)" },
  { value:"el",   label:"🇬🇷 Ελληνικά (Greek)" },
  { value:"cs",   label:"🇨🇿 Čeština (Czech)" },
  { value:"ro",   label:"🇷🇴 Română (Romanian)" },
  { value:"hu",   label:"🇭🇺 Magyar (Hungarian)" },
  { value:"uk",   label:"🇺🇦 Українська (Ukrainian)" },
  { value:"da",   label:"🇩🇰 Dansk (Danish)" },
  { value:"fi",   label:"🇫🇮 Suomi (Finnish)" },
  { value:"no",   label:"🇳🇴 Norsk (Norwegian)" },
  { value:"sk",   label:"🇸🇰 Slovenčina (Slovak)" },
  { value:"bg",   label:"🇧🇬 Български (Bulgarian)" },
  { value:"hr",   label:"🇭🇷 Hrvatski (Croatian)" },
  { value:"ca",   label:"🏴 Català (Catalan)" },
  { value:"lt",   label:"🇱🇹 Lietuvių (Lithuanian)" },
  { value:"lv",   label:"🇱🇻 Latviešu (Latvian)" },
  { value:"sl",   label:"🇸🇮 Slovenščina (Slovenian)" },
  { value:"sr",   label:"🇷🇸 Српски (Serbian)" },
  { value:"he",   label:"🇮🇱 עברית (Hebrew)" },
  { value:"bn",   label:"🇧🇩 বাংলা (Bengali)" },
  { value:"ta",   label:"🇮🇳 தமிழ் (Tamil)" },
  { value:"te",   label:"🇮🇳 తెలుగు (Telugu)" },
  { value:"ml",   label:"🇮🇳 മലയാളം (Malayalam)" },
  { value:"ne",   label:"🇳🇵 नेपाली (Nepali)" },
  { value:"si",   label:"🇱🇰 සිංහල (Sinhala)" },
  { value:"km",   label:"🇰🇭 ខ្មែរ (Khmer)" },
  { value:"lo",   label:"🇱🇦 ລາວ (Lao)" },
  { value:"my",   label:"🇲🇲 မြန်မာ (Burmese)" },
  { value:"ka",   label:"🇬🇪 ქართული (Georgian)" },
  { value:"hy",   label:"🇦🇲 Հայերեն (Armenian)" },
  { value:"az",   label:"🇦🇿 Azərbaycan (Azerbaijani)" },
  { value:"kk",   label:"🇰🇿 Қазақша (Kazakh)" },
  { value:"uz",   label:"🇺🇿 Ozbek (Uzbek)" },
  { value:"sw",   label:"🇰🇪 Kiswahili (Swahili)" },
  { value:"af",   label:"🇿🇦 Afrikaans" },
];

function Section({ title, children, source }:
  { title:string; children:React.ReactNode; source?:string }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
        <span style={{ fontSize:11, color:"#6b7280", letterSpacing:1,
          textTransform:"uppercase" }}>{title}</span>
        {source && <span style={{ fontSize:9, color:"#374151" }}>src: {source}</span>}
      </div>
      {children}
    </div>
  );
}

function GovernanceBadge({ label, value, locked=false }:
  { label:string; value:string; locked?:boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6,
      padding:"3px 8px", borderRadius:4,
      background: locked ? "#052e16" : "#0f172a",
      border:`1px solid ${locked ? "#166534" : "#1f2937"}` }}>
      <span style={{ fontSize:9, color:"#6b7280" }}>{label}</span>
      <span style={{ fontSize:11, color: locked ? "#22c55e" : "#22d3ee",
        fontWeight:700 }}>{value}</span>
      {locked && <span style={{ fontSize:9 }}>🔒</span>}
    </div>
  );
}

function TokenTimeline({ segments, durationSec }:
  { segments:any[]; durationSec:number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    if(!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0,0,W,H);
    if(!durationSec || segments.length === 0) {
      ctx.fillStyle = "#4b5563";
      ctx.font = "11px monospace";
      ctx.fillText("Load audio to see timeline", 20, H/2);
      return;
    }
    const scaleX = W / durationSec;
    const segH   = Math.max(8, H / Math.max(1, segments.length));
    segments.forEach((seg, i) => {
      const x = seg.start_sec * scaleX;
      const w = Math.max(2, (seg.end_sec - seg.start_sec) * scaleX);
      const y = i * segH;
      const color = seg.is_rtl ? "#8b5cf6" : "#22d3ee";
      ctx.fillStyle = color + "33";
      ctx.fillRect(x, y, w, segH - 1);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 2, segH - 1);
    });
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1;
    for(let t = 0; t <= durationSec; t += 5) {
      const x = t * scaleX;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
      ctx.fillStyle = "#374151"; ctx.font = "9px monospace";
      ctx.fillText(`${t}s`, x+2, H-2);
    }
  }, [segments, durationSec]);

  return (
    <canvas ref={canvasRef} width={800} height={80}
      style={{ width:"100%", height:80, borderRadius:4,
        border:"1px solid #1f2937" }} />
  );
}

export default function SpeechIntelligenceWorkstation() {
  const { state, transcribe, reset, setModel, setLanguage, GOVERNANCE }
    = useASRState();
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [fileName,    setFileName]    = useState<string>("");
  const [audioUrl,    setAudioUrl]    = useState<string>("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [showWS, setShowWS] = React.useState(false);

  const handleFile = useCallback(async (file: File) => {
    try {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      const ab  = await file.arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(ab);
      await ctx.close();
      setAudioBuffer(buf); setFileName(file.name);
    } catch(e) { console.error("Audio decode failed:", e); }
  }, []);

  // Export helpers
  const exportTXT = () => {
    if(!state.transcript) return;
    const blob = new Blob([state.transcript.full_text], { type:"text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.[^.]+$/, "") + "_transcript.txt"; a.click();
  };

  const exportJSONL = () => {
    if(!state.transcript) return;
    const lines = state.transcript.segments.map((s:any) => JSON.stringify({
      text: s.text, start: s.start_sec, end: s.end_sec,
      language: s.language, is_rtl: s.is_rtl,
      model: state.transcript!.model_id,
      generated_at: state.transcript!.generated_at,
    }));
    const blob = new Blob([lines.join("\n")], { type:"application/jsonl" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.[^.]+$/, "") + "_transcript.jsonl"; a.click();
  };

  const exportSRT = () => {
    if(!state.transcript) return;
    const toSRT = (sec: number) => {
      const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60),
            s = Math.floor(sec%60), ms = Math.floor((sec%1)*1000);
      return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
    };
    const lines = state.transcript.segments.map((s:any, i:number) =>
      `${i+1}\n${toSRT(s.start_sec)} --> ${toSRT(s.end_sec)}\n${s.text}\n`
    );
    const blob = new Blob([lines.join("\n")], { type:"text/srt" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.[^.]+$/, "") + "_transcript.srt"; a.click();
  };

  const exportCSV = () => {
    if(!state.transcript) return;
    const rows = ["start_sec,end_sec,text,language,is_rtl,confidence",
      ...state.transcript.segments.map((s:any) =>
        `${s.start_sec},${s.end_sec},"${s.text.replace(/"/g,"")}",${s.language},${s.is_rtl},${s.confidence ?? ""}`
      )];
    const blob = new Blob([rows.join("\n")], { type:"text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.[^.]+$/, "") + "_transcript.csv"; a.click();
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if(file) handleFile(file);
  }, [handleFile]);

  const isRunning = ["loading","chunking","inferring","aligning"].includes(state.status);

  return (<>
    <div style={{ background:"#080c14", minHeight:"100%", color:"#e5e7eb",
      fontFamily:"'JetBrains Mono', monospace" }}>

      <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1f2937",
        background:"#0a0f1a" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
          <span style={{ fontSize:16, fontWeight:700, color:"#22d3ee",
            letterSpacing:1 }}>SPEECH INTELLIGENCE WORKSTATION</span>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <GovernanceBadge label="DECODER"     value={GOVERNANCE.decoder.toUpperCase()} locked />
          <GovernanceBadge label="TEMPERATURE" value={String(GOVERNANCE.temperature)}   locked />
          <GovernanceBadge label="BEAM SEARCH" value="DISABLED" locked />
          <GovernanceBadge label="PROTOCOL"    value={GOVERNANCE.protocol} />
          <GovernanceBadge label="TOKENIZER"   value={WHISPER_TOKENIZER_CONFIG.version} />
        </div>
      </div>

      <div style={{ padding:16 }}>
        <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", gap:16 }}>

          {/* Left */}
          <div>
            <Section title="Model">
              <div style={{ marginBottom:8 }}>
                <label style={{ fontSize:10, color:"#6b7280",
                  display:"block", marginBottom:4 }}>ASR MODEL</label>
                <select value={state.model_id}
                  onChange={e => setModel(e.target.value as ASRModelId)}
                  disabled={isRunning}
                  style={{ width:"100%", background:"#111827", color:"#e5e7eb",
                    border:"1px solid #1f2937", borderRadius:4,
                    padding:"6px 8px", fontSize:12 }}>
                  {MODELS.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label} ({m.size})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:"#6b7280",
                  display:"block", marginBottom:4 }}>LANGUAGE</label>
                <select value={state.language}
                  onChange={e => setLanguage(e.target.value as ASRLanguage)}
                  disabled={isRunning}
                  style={{ width:"100%", background:"#111827", color:"#e5e7eb",
                    border:"1px solid #1f2937", borderRadius:4,
                    padding:"6px 8px", fontSize:12 }}>
                  {LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </Section>

            <Section title="Audio Input">
              <div onDrop={handleDrop} onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{ border:"2px dashed #1f2937", borderRadius:6,
                  padding:"20px 12px", textAlign:"center", cursor:"pointer",
                  borderColor: audioBuffer ? "#22d3ee44" : "#1f2937" }}>
                {audioBuffer ? (
                  <div>
                    <div style={{ fontSize:12, color:"#22d3ee", marginBottom:4 }}>
                      ✅ {fileName}
                    </div>
                    <div style={{ fontSize:10, color:"#6b7280" }}>
                      {audioBuffer.duration.toFixed(1)}s · {audioBuffer.sampleRate}Hz
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:24, marginBottom:4 }}>🎙</div>
                    <div style={{ fontSize:12, color:"#6b7280" }}>
                      Drop audio or click
                    </div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="audio/*"
                style={{ display:"none" }}
                onChange={e => { const f=e.target.files?.[0]; if(f) handleFile(f); }} />
              {audioUrl && (
                <div style={{ marginTop:10 }}>
                  <audio ref={audioRef} controls src={audioUrl}
                    style={{ width:"100%", height:36,
                      filter:"invert(1) hue-rotate(180deg)" }} />
                </div>
              )}
            </Section>

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => audioBuffer && transcribe(audioBuffer)}
                disabled={!audioBuffer || isRunning}
                style={{ flex:1, padding:"10px 0", borderRadius:6, border:"none",
                  cursor:(!audioBuffer||isRunning)?"not-allowed":"pointer",
                  background:(!audioBuffer||isRunning)?"#1f2937":"#0891b2",
                  color:(!audioBuffer||isRunning)?"#4b5563":"#fff",
                  fontSize:12, fontWeight:700 }}>
                {isRunning ? "⏳ INFERRING..." : "▶ TRANSCRIBE"}
              </button>
              {state.status !== "idle" && (
                <button onClick={reset}
                  style={{ padding:"10px 12px", borderRadius:6,
                    border:"1px solid #374151", cursor:"pointer",
                    background:"transparent", color:"#6b7280", fontSize:12 }}>
                  ✕
                </button>
              )}
            </div>

            {state.status !== "idle" && (
              <div style={{ marginTop:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  marginBottom:3 }}>
                  <span style={{ fontSize:10, color:"#6b7280",
                    textTransform:"capitalize" }}>{state.status}</span>
                  <span style={{ fontSize:10,
                    color:state.status==="error"?"#ef4444":
                          state.status==="complete"?"#22c55e":"#22d3ee" }}>
                    {Math.round(state.progress*100)}%
                  </span>
                </div>
                <div style={{ height:4, background:"#1f2937", borderRadius:2 }}>
                  <div style={{ width:`${state.progress*100}%`, height:"100%",
                    background:state.status==="error"?"#ef4444":
                               state.status==="complete"?"#22c55e":"#22d3ee",
                    borderRadius:2, transition:"width 0.3s" }} />
                </div>
                {state.error && (
                  <div style={{ fontSize:11, color:"#ef4444", marginTop:6 }}>
                    ⚠ {state.error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right */}
          <div>
            <Section title="Token Alignment Timeline" source="tokenAlignment.ts">
              <TokenTimeline
                segments={state.transcript?.segments ?? []}
                durationSec={audioBuffer?.duration ?? 0} />
              <div style={{ fontSize:9, color:"#374151", marginTop:4 }}>
                🟣 RTL · 🔵 LTR · confidence = bar height
              </div>
            </Section>

            <Section title="Transcript" source="asrRuntime.ts">
              {state.transcript ? (
                <div>
                  <div style={{ padding:12, background:"#111827", borderRadius:6,
                    direction: (["ar","fa","ur","he"].includes(state.transcript.language_detected as string))?"rtl":"ltr",
                    textAlign: (["ar","fa","ur","he"].includes(state.transcript.language_detected as string))?"right":"left" as const,
                    fontFamily: "system-ui, sans-serif",
                    fontSize: 15, letterSpacing: 0.3,
                    marginBottom:8 }}>
                    {state.transcript.full_text || "(No speech detected — try Auto-detect language)"}
                  </div>
                  {state.rtlTranscript && (
                    <div style={{ display:"flex", gap:12, fontSize:10,
                      color:"#6b7280" }}>
                      <span>Lang: <span style={{ color:"#22d3ee" }}>
                        {state.rtlTranscript.primary_lang}</span></span>
                      <span>RTL: <span style={{ color:"#a5b4fc" }}>
                        {Math.round(state.rtlTranscript.rtl_ratio*100)}%</span></span>
                      <span>Switches: <span style={{ color:"#f59e0b" }}>
                        {state.rtlTranscript.code_switches.length}</span></span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color:"#4b5563", fontSize:12, textAlign:"center",
                  padding:24, border:"1px dashed #1f2937", borderRadius:6 }}>
                  Transcript appears after inference
                </div>
              )}
            </Section>

            {state.transcript && (
              <div style={{padding:'4px 0 8px'}}>
                <button onClick={()=>setShowWS(true)} style={{width:'100%',padding:'10px',borderRadius:8,cursor:'pointer',background:'#0d1117',border:'1px solid #22d3ee55',color:'#22d3ee',fontSize:11,fontWeight:700,letterSpacing:1}}>⚡ OPEN TRANSCRIPT WORKSTATION PRO</button>
              </div>
            )}
            {state.transcript && state.transcript.full_text && (
              <Section title="Export">
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[
                    { label:"TXT",   fn: exportTXT,   color:"#22d3ee" },
                    { label:"JSONL", fn: exportJSONL, color:"#a855f7" },
                    { label:"SRT",   fn: exportSRT,   color:"#f59e0b" },
                    { label:"CSV",   fn: exportCSV,   color:"#22c55e" },
                  ].map(({label, fn, color}) => (
                    <button key={label} onClick={fn}
                      style={{ padding:"8px 16px", borderRadius:6,
                        border:`1px solid ${color}44`,
                        background:`${color}11`, color,
                        fontSize:11, fontWeight:700, cursor:"pointer",
                        transition:"all 0.2s" }}
                      onMouseOver={e=>(e.currentTarget.style.background=`${color}22`)}
                      onMouseOut={e=>(e.currentTarget.style.background=`${color}11`)}>
                      ⬇ {label}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {state.qaReport && (
              <Section title="Speech QA" source="speechQA.ts">
                <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:12, fontWeight:700,
                    color:state.qaReport.passed?"#22c55e":"#f59e0b" }}>
                    {state.qaReport.passed?"✅ PASSED":"⚠️ WARNINGS"}
                  </span>
                  <span style={{ fontSize:11, color:"#6b7280" }}>
                    conf: {(state.qaReport.mean_confidence*100).toFixed(1)}%
                  </span>
                </div>
                {state.qaReport.issues.length === 0 ? (
                  <div style={{ fontSize:11, color:"#22c55e" }}>No issues</div>
                ) : state.qaReport.issues.map((issue, i) => (
                  <div key={i} style={{ fontSize:11, padding:"3px 0",
                    color:issue.severity==="error"?"#ef4444":"#f59e0b",
                    borderBottom:"1px solid #111827" }}>
                    {issue.severity==="error"?"❌":"⚠️"} {issue.message}
                  </div>
                ))}
              </Section>
            )}

            {state.transcript && (
              <Section title="Inference Metadata">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
                  gap:4, fontSize:11 }}>
                  {([
                    ["Model",    state.transcript.model_id],
                    ["Backend",  state.transcript.backend],
                    ["Decoder",  state.transcript.decoder_strategy],
                    ["Protocol", state.transcript.inference_protocol],
                    ["Chunks",   state.transcript.chunk_count],
                    ["Duration", `${state.transcript.duration_sec.toFixed(1)}s`],
                  ] as [string,any][]).map(([label,value]) => (
                    <div key={label} style={{ padding:"3px 0" }}>
                      <span style={{ color:"#6b7280" }}>{label}: </span>
                      <span style={{ color:"#22d3ee" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
    {showWS && state.transcript && (
      <div style={{position:'fixed',inset:0,zIndex:500,background:'#080c14'}}>
        <TranscriptWorkstationPro
          asrTranscript={state.transcript as any}
          audioUrl={audioUrl}
          onClose={() => setShowWS(false)}
        />
      </div>
    )}
  </>);
}