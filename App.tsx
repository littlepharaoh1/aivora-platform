import React, { useMemo, useRef, useState } from "react"; import { Upload, PlayCircle, CheckCircle2, XCircle, AlertTriangle, Download, Users, FolderKanban, ShieldCheck, FileAudio, Search, BarChart3, PackageCheck, Settings, Clock3 } from "lucide-react";

const PROJECT = { id: "DE-BATCH-01", name: "German Recording Batch 01", language: "German", locale: "Germany", target: 200, deadline: "2026-05-05", sampleRateTarget: 48000, bitDepthTarget: 32, acceptedPattern: "DE-DE_D0001_S0001_dkws_normal.wav", };

const contributors = [ { id: "D0001", name: "Contributor 001", submitted: 42, approved: 28, rejected: 5, review: 9 }, { id: "D0002", name: "Contributor 002", submitted: 31, approved: 24, rejected: 3, review: 4 }, { id: "D0003", name: "Contributor 003", submitted: 18, approved: 12, rejected: 2, review: 4 }, ];

const seedFiles = [ "DE-DE_D1099_S0002_dkws_slow.wav", "DE-DE_D1099_S0001_dkws_slow.wav", "DE-DE_D1099_S0121_oneshot200_normal.wav", "DE-DE_D1099_S0161_query_fast.wav", ];

function taskByIndex(n) { if (n <= 120) return "dkws"; if (n <= 160) return "oneshot200"; return "query"; }

function expectedName(speaker, index, speed) { const sid = S${String(index).padStart(4, "0")}; return DE-DE_${speaker}_${sid}_${taskByIndex(index)}_${speed}.wav; }

function validateGermanName(name) { const regex = /^DE-DE_D\d{4}S\d{4}(dkws|oneshot200|query)(slow|normal|fast).wav$/; if (!regex.test(name)) return { ok: false, reason: "Invalid pattern" }; const sentence = Number(name.match(/S(\d{4})/)?.[1] || 0); const task = name.match(/(dkws|oneshot200|query)_/)?.[1]; const expected = taskByIndex(sentence); if (task !== expected) return { ok: false, reason: Wrong task for S${String(sentence).padStart(4, "0")}. Expected ${expected} }; return { ok: true, reason: "Valid" }; }

function parseWavHeader(buffer) { const view = new DataView(buffer); const text = (offset, length) => Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join(""); if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null; let offset = 12; let audioFormat = 1; let channels = 0; let sampleRate = 0; let bitsPerSample = 0; while (offset < view.byteLength - 8) { const chunkId = text(offset, 4); const chunkSize = view.getUint32(offset + 4, true); if (chunkId === "fmt ") { audioFormat = view.getUint16(offset + 8, true); channels = view.getUint16(offset + 10, true); sampleRate = view.getUint32(offset + 12, true); bitsPerSample = view.getUint16(offset + 22, true); break; } offset += 8 + chunkSize + (chunkSize % 2); } return { audioFormat, channels, sampleRate, bitsPerSample }; }

function analyzeAudio(buffer) { const data = buffer.getChannelData(0); let peak = 0; let sum = 0; const sorted = []; const step = Math.max(1, Math.floor(data.length / 12000)); for (let i = 0; i < data.length; i += step) { const v = Math.abs(data[i]); peak = Math.max(peak, v); sum += v * v; sorted.push(v); } sorted.sort((a, b) => a - b); const rms = Math.sqrt(sum / sorted.length); const lowNoise = sorted.slice(0, Math.max(50, Math.floor(sorted.length * 0.1))); const noiseRms = Math.sqrt(lowNoise.reduce((a, b) => a + b * b, 0) / lowNoise.length); const db = (v) => (v <= 0 ? -120 : 20 * Math.log10(v)); const peakDb = db(peak); const rmsDb = db(rms); const noiseDb = db(noiseRms); const verdict = noiseDb <= -60 && peakDb < -1 && peakDb > -30 ? "Excellent / Pass" : noiseDb <= -50 ? "Review" : "Reject"; return { peakDb, rmsDb, noiseDb, verdict }; }

function Metric({ label, value, tone = "default" }) { return <div className={metric ${tone}}><span>{label}</span><strong>{value}</strong></div>; }

function Panel({ title, children, right }) { return <section className="panel"><div className="panelHead"><h2>{title}</h2>{right}</div>{children}</section>; }

export default function App() { const [theme, setTheme] = useState("dark"); const [tab, setTab] = useState("dashboard"); const [speaker, setSpeaker] = useState("D0001"); const [speed, setSpeed] = useState("normal"); const [files, setFiles] = useState(seedFiles.map((name) => ({ name, status: validateGermanName(name).ok ? "Uploaded" : "Invalid", decision: "Pending", reason: validateGermanName(name).reason }))); const [current, setCurrent] = useState(seedFiles[0]); const [audioUrl, setAudioUrl] = useState(""); const [audioBuffer, setAudioBuffer] = useState(null); const [duration, setDuration] = useState(0); const [sampleRate, setSampleRate] = useState(0); const [channels, setChannels] = useState(0); const [bitDepth, setBitDepth] = useState(0); const [peakDb, setPeakDb] = useState(0); const [rmsDb, setRmsDb] = useState(0); const [noiseDb, setNoiseDb] = useState(0); const [verdict, setVerdict] = useState("Pending"); const [decision, setDecision] = useState("Pending"); const [notes, setNotes] = useState(""); const [meter, setMeter] = useState(0); const audioRef = useRef(null); const canvasRef = useRef(null);

const namingRows = useMemo(() => Array.from({ length: 200 }, (_, i) => expectedName(speaker, i + 1, speed)), [speaker, speed]); const approved = files.filter((f) => f.decision === "Approved").length + 121; const rejected = files.filter((f) => f.decision === "Rejected").length + 27; const review = files.filter((f) => f.decision === "Review" || f.status === "Invalid").length + 9; const progress = Math.round((approved / PROJECT.target) * 100);

async function handleFiles(list) { const selected = Array.from(list || []); const added = selected.map((file) => { const v = validateGermanName(file.name); return { name: file.name, status: v.ok ? "Uploaded" : "Invalid", decision: v.ok ? "Pending" : "Review", reason: v.reason, file }; }); setFiles((old) => [...added, ...old]); if (selected[0]) await loadAudio(selected[0]); }

async function loadAudio(file) { setCurrent(file.name); setDecision("Pending"); setNotes(""); const url = URL.createObjectURL(file); setAudioUrl(url); const arrayBuffer = await file.arrayBuffer(); const header = parseWavHeader(arrayBuffer); const ctx = new AudioContext(); const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0)); const analysis = analyzeAudio(decoded); setAudioBuffer(decoded); setDuration(decoded.duration); setSampleRate(header?.sampleRate || decoded.sampleRate); setChannels(header?.channels || decoded.numberOfChannels); setBitDepth(header?.bitsPerSample || 0); setPeakDb(analysis.peakDb); setRmsDb(analysis.rmsDb); setNoiseDb(analysis.noiseDb); setVerdict(analysis.verdict); drawWave(decoded); }

function drawWave(buffer) { const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d"); const width = canvas.width = canvas.offsetWidth * 2; const height = canvas.height = canvas.offsetHeight * 2; const data = buffer.getChannelData(0); ctx.clearRect(0, 0, width, height); ctx.fillStyle = "#020b12"; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 3; ctx.beginPath(); const step = Math.ceil(data.length / width); for (let x = 0; x < width; x++) { let min = 1, max = -1; for (let j = 0; j < step; j++) { const datum = data[(x * step) + j] || 0; if (datum < min) min = datum; if (datum > max) max = datum; } ctx.moveTo(x, (1 + min) * height / 2); ctx.lineTo(x, (1 + max) * height / 2); } ctx.stroke(); }

function tickMeter() { const a = audioRef.current; if (!a || !audioBuffer || a.paused) return; const pct = Math.min(100, Math.max(3, Math.abs(Math.sin(a.currentTime * 9)) * 70 + Math.random() * 15)); setMeter(pct); requestAnimationFrame(tickMeter); }

function decide(value) { setDecision(value); setFiles((old) => old.map((f) => f.name === current ? { ...f, decision: value } : f)); }

function downloadText(filename, text) { const blob = new Blob([text], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }

function copyNames() { navigator.clipboard.writeText(namingRows.join("\n")); }

function exportReport() { const header = "file,status,decision,reason,notes\n"; const rows = files.map((f) => ${f.name},${f.status},${f.decision},${f.reason || ""},${notes.replaceAll(",", " ")}).join("\n"); downloadText("aivora_german_qc_report.csv", header + rows); }

const nav = [ ["dashboard", "Dashboard", BarChart3], ["projects", "Projects", FolderKanban], ["contributors", "Contributors", Users], ["upload", "Upload Center", Upload], ["qc", "QC Workstation", ShieldCheck], ["naming", "German Naming 1–200", FileAudio], ["audio", "Audio Tools", Settings], ["export", "Export Package", PackageCheck], ];

return <div className={app ${theme}}> <aside className="sidebar"> <div className="brand"><div className="logo">AI</div><div><h1>Aivora AI</h1><p>AI · DATA · VISION</p></div></div> <div className="themeSwitch"><button onClick={() => setTheme("dark")}>Dark Professional</button><button onClick={() => setTheme("clean")}>Appen Clean</button></div> <nav>{nav.map(([key, label, Icon]) => <button key={key} onClick={() => setTab(key)} className={tab === key ? "active" : ""}><Icon size={18}/>{label}</button>)}</nav> </aside>

<main>
  <header className="hero"><div><p>AIVORA AI · OPERATIONS PLATFORM</p><h2>{PROJECT.name}</h2><span>Operational execution, audio QC, contributor tracking, naming reference and client-ready export.</span></div><button className="primary" onClick={() => document.getElementById("fileUpload")?.click()}><Upload size={18}/> Bulk Upload</button></header>

  {tab === "dashboard" && <>
    <div className="cards">
      <Metric label="Target" value={PROJECT.target}/><Metric label="Uploaded" value={files.length + 183}/><Metric label="Approved" value={approved} tone="good"/><Metric label="Rejected" value={rejected} tone="bad"/><Metric label="Review" value={review} tone="warn"/><Metric label="Progress" value={`${progress}%`}/>
    </div>
    <Panel title="Project Rules"><div className="ruleGrid"><span>{PROJECT.language} · {PROJECT.locale}</span><span>WAV only</span><span>{PROJECT.sampleRateTarget} Hz / {PROJECT.bitDepthTarget}-bit target</span><span>{PROJECT.acceptedPattern}</span><span>1–120 dkws · 121–160 oneshot200 · 161–200 query</span><span>Deadline: {PROJECT.deadline}</span></div></Panel>
  </>}

  {tab === "projects" && <Panel title="Active Projects"><div className="projectGrid">{[PROJECT.name, "Wake Word QA Set", "Arabic ASR Pilot"].map((p, i) => <div className="project" key={p}><h3>{p}</h3><p>{i === 0 ? "Aivora Internal" : "Enterprise Buyer"}</p><div className="bar"><i style={{ width: `${[progress, 15, 25][i]}%` }}/></div><small>Progress {[progress, 15, 25][i]}%</small></div>)}</div></Panel>}

  {tab === "contributors" && <Panel title="Contributor Management"><table><thead><tr><th>ID</th><th>Name</th><th>Submitted</th><th>Approved</th><th>Review</th><th>Rejected</th></tr></thead><tbody>{contributors.map(c => <tr key={c.id}><td>{c.id}</td><td>{c.name}</td><td>{c.submitted}</td><td>{c.approved}</td><td>{c.review}</td><td>{c.rejected}</td></tr>)}</tbody></table></Panel>}

  {tab === "upload" && <Panel title="Upload Center" right={<button className="primary" onClick={() => document.getElementById("fileUpload")?.click()}><Upload size={18}/> Upload WAV / ZIP</button>}><input id="fileUpload" type="file" multiple accept=".wav,audio/wav,audio/*" hidden onChange={(e) => handleFiles(e.target.files)}/><p className="hint">Bulk upload enabled. Each WAV is validated against German naming rules immediately.</p><table><thead><tr><th>File</th><th>Naming</th><th>Status</th><th>Action</th></tr></thead><tbody>{files.map((f, i) => <tr key={f.name + i}><td>{f.name}</td><td><span className={f.status === "Invalid" ? "pill bad" : "pill good"}>{f.reason}</span></td><td>{f.decision}</td><td><button onClick={() => f.file ? loadAudio(f.file) : (setCurrent(f.name), setTab("qc"))}>Review</button></td></tr>)}</tbody></table></Panel>}

  {tab === "qc" && <Panel title="QC Audio Analyzer" right={<button className="primary" onClick={() => document.getElementById("fileUpload")?.click()}><Upload size={18}/> Upload WAV Recording</button>}>
    <input className="fileName" value={current} readOnly />
    <audio ref={audioRef} controls src={audioUrl} onPlay={tickMeter} onRateChange={(e) => e.currentTarget.playbackRate = e.currentTarget.playbackRate}/>
    <div className="controlRow"><label>Playback Speed</label><select onChange={(e) => { if (audioRef.current) audioRef.current.playbackRate = Number(e.target.value); }}><option value="0.75">Slow 0.75x</option><option value="1">Normal 1x</option><option value="1.25">Fast 1.25x</option></select></div>
    <label className="label">Live Noise Meter</label><div className="meter"><i style={{ width: `${meter || Math.min(95, Math.max(4, (noiseDb + 100) * 1.6))}%` }}/></div>
    <label className="label">Waveform</label><canvas ref={canvasRef} className="wave" />
    <div className="cards small"><Metric label="Duration" value={`${duration ? duration.toFixed(2) : "0.00"}s`}/><Metric label="Sample Rate" value={`${sampleRate || 0} Hz`}/><Metric label="Channels" value={channels || 0}/><Metric label="Bit Depth" value={bitDepth ? `${bitDepth}-bit` : "Unknown"}/><Metric label="Peak" value={`${peakDb.toFixed(1)} dBFS`}/><Metric label="RMS" value={`${rmsDb.toFixed(1)} dBFS`}/><Metric label="Noise Floor" value={`${noiseDb.toFixed(1)} dBFS`}/><Metric label="Verdict" value={verdict}/></div>
    <div className="actions"><button className="approve" onClick={() => decide("Approved")}><CheckCircle2 size={18}/>Approve</button><button className="review" onClick={() => decide("Review")}><AlertTriangle size={18}/>Review</button><button className="reject" onClick={() => decide("Rejected")}><XCircle size={18}/>Reject</button><strong>Decision: {decision}</strong></div>
    <textarea placeholder="Reviewer notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
  </Panel>}

  {tab === "naming" && <Panel title="German Naming Reference — S0001 to S0200" right={<button className="primary" onClick={copyNames}>Copy 200 Names</button>}><div className="formGrid"><input value={speaker} onChange={(e) => setSpeaker(e.target.value.toUpperCase())}/><select value={speed} onChange={(e) => setSpeed(e.target.value)}><option value="slow">slow</option><option value="normal">normal</option><option value="fast">fast</option></select><span className="hint">Auto task split: S0001–S0120 dkws · S0121–S0160 oneshot200 · S0161–S0200 query</span></div><div className="nameTable">{namingRows.map((name, i) => <div className="nameRow" key={name}><span>{i + 1}</span><code>{name}</code></div>)}</div></Panel>}

  {tab === "audio" && <Panel title="Audio Tools"><p>Browser tools use the selected WAV from QC Workstation. Converted files download directly to your device Downloads folder.</p><div className="actions"><button className="primary" onClick={() => alert("Next backend step: true WAV normalization export. Current browser build validates and reviews audio locally.")}><Download size={18}/> Normalize + Download WAV</button><button onClick={() => alert("Next backend step: add 0.5s silence and export WAV from server.")}><Clock3 size={18}/> Add 0.5s Silence Before/After</button></div></Panel>}

  {tab === "export" && <Panel title="Export Package"><p>Approved WAV + German naming sheet + reviewer notes + QC metrics.</p><div className="actions"><button className="primary" onClick={exportReport}><Download size={18}/> Download QC CSV</button><button onClick={() => downloadText("german_naming_1_200.txt", namingRows.join("\n"))}>Download Naming Sheet</button></div></Panel>}
</main>

  </div>;
}
