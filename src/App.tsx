import React, { useMemo, useRef, useState } from "react";
import "./styles.css";

type Tab = "dashboard" | "upload" | "qc" | "contributors" | "naming" | "export";
type Decision = "Pending" | "Approved" | "Review" | "Rejected";
type Speed = "slow" | "normal" | "fast";

type FileRecord = {
  id: string;
  fileName: string;
  status: "Valid" | "Invalid";
  reason: string;
  decision: Decision;
  file?: File;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  peakDb?: number;
  rmsDb?: number;
  noiseDb?: number;
};

function expectedTask(index: number) {
  if (index <= 120) return "dkws";
  if (index <= 160) return "oneshot200";
  return "query";
}

function expectedName(speaker: string, index: number, speed: Speed) {
  return `DE-DE_${speaker}_S${String(index).padStart(4, "0")}_${expectedTask(index)}_${speed}.wav`;
}

function validateGermanName(fileName: string) {
  const match = fileName.match(/^DE-DE_(D\d{4})_S(\d{4})_(dkws|oneshot200|query)_(slow|normal|fast)\.wav$/i);
  if (!match) return { status: "Invalid" as const, reason: "Wrong pattern" };
  const n = Number(match[2]);
  const actual = match[3].toLowerCase();
  const expected = n >= 1 && n <= 200 ? expectedTask(n) : "out_of_range";
  if (expected === "out_of_range") return { status: "Invalid" as const, reason: "S number must be 0001-0200" };
  if (actual !== expected) return { status: "Invalid" as const, reason: `Expected ${expected} for S${String(n).padStart(4, "0")}` };
  return { status: "Valid" as const, reason: "Valid naming" };
}

function db(v: number) {
  return 20 * Math.log10(Math.max(v, 1e-9));
}

function parseHeader(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const read = (offset: number, length: number) =>
    Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");
  if (view.byteLength < 44 || read(0, 4) !== "RIFF" || read(8, 4) !== "WAVE") return { sampleRate: 0, channels: 0, bitDepth: 0 };
  let offset = 12;
  while (offset < view.byteLength - 8) {
    const id = read(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      return {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitDepth: view.getUint16(offset + 22, true),
      };
    }
    offset += 8 + size + (size % 2);
  }
  return { sampleRate: 0, channels: 0, bitDepth: 0 };
}

function analyze(buffer: AudioBuffer, bitDepth: number) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  const points: number[] = [];
  const step = Math.max(1, Math.floor(data.length / 20000));
  for (let i = 0; i < data.length; i += step) {
    const s = data[i] || 0;
    const a = Math.abs(s);
    peak = Math.max(peak, a);
    sum += s * s;
    points.push(a);
  }
  points.sort((a, b) => a - b);
  const rms = Math.sqrt(sum / Math.max(1, points.length));
  const quiet = points.slice(0, Math.max(64, Math.floor(points.length * 0.12)));
  const noise = Math.sqrt(quiet.reduce((acc, x) => acc + x * x, 0) / Math.max(1, quiet.length));
  const peakDb = db(peak);
  const rmsDb = db(rms);
  const noiseDb = db(noise);
  let verdict = "Pass";
  if (noiseDb > -50 || peakDb > -0.5 || rmsDb < -45 || buffer.duration < 0.25) verdict = "Reject Risk";
  else if (noiseDb > -60 || rmsDb < -35 || peakDb < -24) verdict = "Human Review";
  return { duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, bitDepth, peakDb, rmsDb, noiseDb, verdict };
}

function writeStr(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function audioBufferToWavFloat32(buffer: AudioBuffer, mode: "normal" | "normalize" | "silence") {
  const addSilence = mode === "silence";
  const normalize = mode === "normalize";
  const before = addSilence ? Math.floor(buffer.sampleRate * 0.5) : 0;
  const after = addSilence ? Math.floor(buffer.sampleRate * 0.5) : 0;
  const frames = buffer.length + before + after;
  const channels = buffer.numberOfChannels;
  let peak = 0;
  if (normalize) {
    for (let c = 0; c < channels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
  }
  const gain = normalize && peak > 0 ? 0.95 / peak : 1;
  const data = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const source = i - before;
      data[i * channels + c] = source >= 0 && source < buffer.length ? buffer.getChannelData(c)[source] * gain : 0;
    }
  }
  const wav = new ArrayBuffer(44 + data.length * 4);
  const view = new DataView(wav);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + data.length * 4, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  writeStr(view, 36, "data");
  view.setUint32(40, data.length * 4, true);
  let offset = 44;
  for (let i = 0; i < data.length; i++, offset += 4) view.setFloat32(offset, data[i], true);
  return wav;
}

function Metric({ label, value, tone = "" }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "clean">("dark");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [speaker, setSpeaker] = useState("D0001");
  const [speed, setSpeed] = useState<Speed>("normal");
  const [records, setRecords] = useState<FileRecord[]>([]);
  const [selected, setSelected] = useState<FileRecord | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [meter, setMeter] = useState(0);
  const [notes, setNotes] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveRef = useRef<HTMLCanvasElement | null>(null);

  const namingRows = useMemo(() => Array.from({ length: 200 }, (_, i) => expectedName(speaker, i + 1, speed)), [speaker, speed]);
  const validCount = records.filter(r => r.status === "Valid").length;
  const approved = records.filter(r => r.decision === "Approved").length;
  const review = records.filter(r => r.decision === "Review" || r.status === "Invalid").length;
  const rejected = records.filter(r => r.decision === "Rejected").length;

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    const next: FileRecord[] = Array.from(files).map((file, i) => {
      const v = validateGermanName(file.name);
      return { id: `${Date.now()}-${i}`, fileName: file.name, status: v.status, reason: v.reason, decision: v.status === "Invalid" ? "Review" : "Pending", file };
    });
    setRecords(old => [...next, ...old]);
    await selectRecord(next[0]);
    setTab("qc");
  }

  async function selectRecord(record: FileRecord) {
    setSelected(record);
    setNotes("");
    if (!record.file) return;
    const url = URL.createObjectURL(record.file);
    setAudioUrl(url);
    const arr = await record.file.arrayBuffer();
    const header = parseHeader(arr);
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arr.slice(0));
    setAudioBuffer(decoded);
    const m = analyze(decoded, header.bitDepth || 0);
    const enriched = { ...record, duration: m.duration, sampleRate: m.sampleRate, channels: m.channels, bitDepth: m.bitDepth || header.bitDepth, peakDb: m.peakDb, rmsDb: m.rmsDb, noiseDb: m.noiseDb, reason: record.status === "Invalid" ? record.reason : m.verdict };
    setSelected(enriched);
    setRecords(old => old.map(r => r.id === record.id ? enriched : r));
    drawWave(decoded);
  }

  function drawWave(buffer: AudioBuffer) {
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    const d = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(d.length / w));
    ctx.fillStyle = "#020817"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#12d6ff"; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = d[x * step + j] || 0;
        min = Math.min(min, v); max = Math.max(max, v);
      }
      ctx.moveTo(x, ((1 + min) * h) / 2);
      ctx.lineTo(x, ((1 + max) * h) / 2);
    }
    ctx.stroke();
  }

  function animateMeter() {
    const audio = audioRef.current;
    if (!audio || !audioBuffer || audio.paused) return;
    const d = audioBuffer.getChannelData(0);
    const idx = Math.floor(audio.currentTime * audioBuffer.sampleRate);
    const win = Math.floor(audioBuffer.sampleRate * 0.04);
    let sum = 0;
    for (let i = idx; i < Math.min(d.length, idx + win); i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / Math.max(1, win));
    setMeter(Math.min(100, Math.max(3, rms * 250)));
    requestAnimationFrame(animateMeter);
  }

  function setDecision(decision: Decision) {
    if (!selected) return;
    const updated = { ...selected, decision };
    setSelected(updated);
    setRecords(old => old.map(r => r.id === selected.id ? updated : r));
  }

  function downloadText(name: string, text: string, type = "text/plain") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadProcessed(mode: "normalize" | "silence") {
    if (!audioBuffer || !selected) return alert("Upload and select WAV first");
    const wav = audioBufferToWavFloat32(audioBuffer, mode);
    const blob = new Blob([wav], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const suffix = mode === "normalize" ? "normalized_32bit" : "silence_32bit";
    a.href = url;
    a.download = selected.fileName.replace(/\.wav$/i, `_${suffix}.wav`);
    a.click();
    URL.revokeObjectURL(url);
  }

  function csv() {
    const header = "file,status,decision,reason,duration,sampleRate,channels,bitDepth,peakDb,rmsDb,noiseDb,notes\n";
    const rows = records.map(r => [r.fileName, r.status, r.decision, r.reason, r.duration?.toFixed(2) || "", r.sampleRate || "", r.channels || "", r.bitDepth || "", r.peakDb?.toFixed(1) || "", r.rmsDb?.toFixed(1) || "", r.noiseDb?.toFixed(1) || "", notes.replace(",", " ")].join(","));
    return header + rows.join("\n");
  }

  const tabs: [Tab, string][] = [["dashboard","Dashboard"],["upload","Upload Center"],["qc","QC Workstation"],["contributors","Contributors"],["naming","German Naming 1–200"],["export","Export Package"]];

  return <div className={`app ${theme}`}>
    <aside className="sidebar">
      <div className="brand"><div className="logo">AI</div><div><h1>Aivora AI</h1><p>AI · DATA · VISION</p></div></div>
      <div className="themeSwitch"><button onClick={() => setTheme("dark")}>Dark Professional</button><button onClick={() => setTheme("clean")}>Appen Clean</button></div>
      <nav>{tabs.map(([id,label]) => <button key={id} className={tab===id?"active":""} onClick={() => setTab(id)}>{label}</button>)}</nav>
    </aside>
    <main>
      <header className="hero"><div><p>AIVORA OPS PLATFORM · REAL REVIEW WORKSTATION</p><h2>German Recording Batch 01</h2><span>Upload, validate, review, analyze audio, export reports, and control German naming from S0001 to S0200.</span></div><label className="primary">Bulk Upload<input type="file" multiple accept=".wav,audio/wav,audio/*" hidden onChange={e=>handleUpload(e.target.files)} /></label></header>

      {tab==="dashboard" && <>
        <section className="metrics"><Metric label="Project Target" value="200" /><Metric label="Uploaded" value={records.length} /><Metric label="Valid Naming" value={validCount} tone="good"/><Metric label="Approved" value={approved} tone="good"/><Metric label="Review" value={review} tone="warn"/><Metric label="Rejected" value={rejected} tone="bad"/></section>
        <section className="panel"><h2>Project Rules</h2><div className="ruleGrid"><div>Language: German</div><div>Locale: DE-DE</div><div>Target: 200 files</div><div>Format target: 48 kHz / 32-bit float WAV</div><div>S0001–S0120 dkws</div><div>S0121–S0160 oneshot200</div><div>S0161–S0200 query</div><div>Deadline: 2026-05-05</div></div></section>
      </>}

      {tab==="upload" && <section className="panel"><div className="panelHead"><h2>Upload Center</h2><label className="primary">Upload WAV Files<input type="file" multiple accept=".wav,audio/wav,audio/*" hidden onChange={e=>handleUpload(e.target.files)} /></label></div><p className="hint">Bulk upload is enabled. Every file is checked against German naming rules immediately.</p><table><thead><tr><th>File</th><th>Naming</th><th>Reason</th><th>Decision</th><th>Action</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>{r.fileName}</td><td><span className={`pill ${r.status==="Valid"?"good":"bad"}`}>{r.status}</span></td><td>{r.reason}</td><td>{r.decision}</td><td><button onClick={()=>selectRecord(r)}>Review</button></td></tr>)}</tbody></table></section>}

      {tab==="qc" && <section className="panel"><div className="panelHead"><h2>QC Audio Analyzer</h2><label className="primary">Upload WAV Recording<input type="file" multiple accept=".wav,audio/wav,audio/*" hidden onChange={e=>handleUpload(e.target.files)} /></label></div><input className="fileName" value={selected?.fileName || "No selected file"} readOnly/><audio ref={audioRef} controls src={audioUrl} onPlay={animateMeter}/><div className="controlRow"><label>Playback Speed</label><select onChange={e=>{if(audioRef.current) audioRef.current.playbackRate=Number(e.target.value)}}><option value="0.75">Slow 0.75x</option><option value="1">Normal 1x</option><option value="1.25">Fast 1.25x</option></select></div><label className="label">Live Noise Meter</label><div className="meter"><i style={{width:`${meter || Math.min(100, Math.max(3, ((selected?.noiseDb || -100)+100)*1.8))}%`}}/></div><label className="label">Waveform</label><canvas ref={waveRef} className="wave"/><section className="metrics small"><Metric label="Duration" value={selected?.duration?`${selected.duration.toFixed(2)}s`:"0.00s"}/><Metric label="Sample Rate" value={selected?.sampleRate?`${selected.sampleRate} Hz`:"0 Hz"}/><Metric label="Channels" value={selected?.channels || 0}/><Metric label="Bit Depth" value={selected?.bitDepth?`${selected.bitDepth}-bit`:"Unknown"}/><Metric label="Peak" value={selected?.peakDb?`${selected.peakDb.toFixed(1)} dBFS`:"-"}/><Metric label="RMS" value={selected?.rmsDb?`${selected.rmsDb.toFixed(1)} dBFS`:"-"}/><Metric label="Noise Floor" value={selected?.noiseDb?`${selected.noiseDb.toFixed(1)} dBFS`:"-"}/><Metric label="QC Verdict" value={selected?.reason || "Pending"}/></section><div className="actions"><button className="approve" onClick={()=>setDecision("Approved")}>Approve</button><button className="review" onClick={()=>setDecision("Review")}>Review</button><button className="reject" onClick={()=>setDecision("Rejected")}>Reject</button><strong>Decision: {selected?.decision || "Pending"}</strong></div><textarea placeholder="Reviewer notes..." value={notes} onChange={e=>setNotes(e.target.value)}/></section>}

      {tab==="contributors" && <section className="panel"><h2>Contributor Management</h2><table><thead><tr><th>ID</th><th>Name</th><th>Submitted</th><th>Approved</th><th>Review</th><th>Rejected</th></tr></thead><tbody>{["D0001","D0002","D0003","D0004"].map((id,i)=><tr key={id}><td>{id}</td><td>Contributor {String(i+1).padStart(3,"0")}</td><td>{[42,31,18,0][i]}</td><td>{[28,24,12,0][i]}</td><td>{[9,4,4,0][i]}</td><td>{[5,3,2,0][i]}</td></tr>)}</tbody></table></section>}

      {tab==="naming" && <section className="panel"><div className="panelHead"><h2>German Naming Reference — S0001 to S0200</h2><div className="actions compact"><button onClick={()=>navigator.clipboard.writeText(namingRows.join("\n"))}>Copy 200 Names</button><button onClick={()=>downloadText("german_naming_1_200.txt", namingRows.join("\n"))}>Download TXT</button></div></div><div className="formGrid"><input value={speaker} onChange={e=>setSpeaker(e.target.value.toUpperCase())}/><select value={speed} onChange={e=>setSpeed(e.target.value as Speed)}><option value="slow">slow</option><option value="normal">normal</option><option value="fast">fast</option></select><span>S0001–S0120 dkws · S0121–S0160 oneshot200 · S0161–S0200 query</span></div><div className="nameTable">{namingRows.map((name,i)=><div className="nameRow" key={name}><span>{i+1}</span><code>{name}</code></div>)}</div></section>}

      {tab==="export" && <section className="panel"><h2>Export Package</h2><p>Export QC report, naming sheet, and reviewer decisions for client delivery.</p><div className="actions"><button className="primary" onClick={()=>downloadText("aivora_qc_report.csv", csv(), "text/csv")}>Download QC CSV</button><button onClick={()=>downloadText("german_naming_1_200.txt", namingRows.join("\n"))}>Download Naming Sheet</button><button onClick={()=>downloadProcessed("normalize")}>Download Normalized 32-bit WAV</button><button onClick={()=>downloadProcessed("silence")}>Download +0.5s Silence 32-bit WAV</button></div></section>}
    </main>
  </div>;
}
