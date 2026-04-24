import { useMemo, useState } from "react";
import "./styles.css";

type Tab = "dashboard" | "qc" | "naming" | "audio" | "exports" | "team" | "client";
type Decision = "Pending" | "Approved" | "Review" | "Rejected";

type AudioStats = {
  fileName: string;
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  peakDb: number;
  rmsDb: number;
  noiseFloorDb: number;
  verdict: string;
  objectUrl: string;
  bars: number[];
};

const germanPatterns = {
  dkws: /^DE-DE_D\d{4}_S\d{4}_dkws_(slow|normal|fast)\.wav$/i,
  recording: /^DE-DE_D\d{4}_S\d{4}_recording_(slow|normal|fast)\.wav$/i,
  oneshot: /^DE-DE_D\d{4}_S\d{4}_oneshot\d+_(slow|normal|fast)\.wav$/i,
};

export default function App() {
  const [tab, setTab] = useState<Tab>("qc");
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [decision, setDecision] = useState<Decision>("Pending");
  const [notes, setNotes] = useState("");
  const [speaker, setSpeaker] = useState("D0001");
  const [sentence, setSentence] = useState("S0001");
  const [task, setTask] = useState<"dkws" | "recording" | "oneshot200">("dkws");
  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("normal");

  const generatedName = useMemo(() => {
    return task === "oneshot200"
      ? `DE-DE_${speaker}_${sentence}_oneshot200_${speed}.wav`
      : `DE-DE_${speaker}_${sentence}_${task}_${speed}.wav`;
  }, [speaker, sentence, task, speed]);

  async function handleAudioUpload(file: File) {
    const buffer = await file.arrayBuffer();
    const result = analyzeWav(buffer, file.name);
    const objectUrl = URL.createObjectURL(file);
    setStats({ ...result, objectUrl });
    setDecision("Pending");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" onError={(e) => ((e.currentTarget.style.display = "none"))} />
          <div className="brandMark">AI</div>
          <div>
            <h1>Aivora AI</h1>
            <p>AI · DATA · VISION</p>
          </div>
        </div>

        {[
          ["dashboard", "Dashboard"],
          ["qc", "QC Audio Analyzer"],
          ["naming", "German Naming"],
          ["audio", "Audio Lab"],
          ["exports", "Exports"],
          ["team", "Team"],
          ["client", "Client Portal"],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as Tab)} className={tab === id ? "nav active" : "nav"}>
            {label}
          </button>
        ))}
      </aside>

      <main className="main">
        <section className="hero">
          <div>
            <span>AIVORA AI · ENTERPRISE OPERATIONS</span>
            <h2>German Recording QC Engine</h2>
            <p>Real browser-based WAV playback, noise estimation, naming validation and reviewer decision control.</p>
          </div>
        </section>

        {tab === "dashboard" && (
          <section className="cards">
            <Metric title="Current File" value={stats?.fileName || "No file"} />
            <Metric title="Noise Floor" value={stats ? `${stats.noiseFloorDb.toFixed(1)} dB` : "-"} />
            <Metric title="Peak Level" value={stats ? `${stats.peakDb.toFixed(1)} dB` : "-"} />
            <Metric title="Decision" value={decision} />
          </section>
        )}

        {tab === "qc" && (
          <section className="panel">
            <h3>QC Audio Analyzer</h3>
            <label className="uploadBox">
              Upload WAV Recording
              <input
                type="file"
                accept=".wav,audio/wav,audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAudioUpload(file);
                }}
              />
            </label>

            {stats ? (
              <>
                <div className="fileName">{stats.fileName}</div>
                <audio className="player" controls src={stats.objectUrl} />

                <div className="meter">
                  {stats.bars.map((b, i) => (
                    <div key={i} className="bar" style={{ height: `${Math.max(8, b * 100)}%` }} />
                  ))}
                </div>

                <div className="cards small">
                  <Metric title="Duration" value={`${stats.duration.toFixed(2)}s`} />
                  <Metric title="Sample Rate" value={`${stats.sampleRate} Hz`} />
                  <Metric title="Channels" value={String(stats.channels)} />
                  <Metric title="Bit Depth" value={`${stats.bitDepth}-bit`} />
                  <Metric title="Peak" value={`${stats.peakDb.toFixed(1)} dBFS`} />
                  <Metric title="RMS" value={`${stats.rmsDb.toFixed(1)} dBFS`} />
                  <Metric title="Noise Floor" value={`${stats.noiseFloorDb.toFixed(1)} dBFS`} />
                  <Metric title="Verdict" value={stats.verdict} />
                </div>

                <div className="decision">
                  <button onClick={() => setDecision("Approved")} className="approve">Approve</button>
                  <button onClick={() => setDecision("Review")} className="review">Review</button>
                  <button onClick={() => setDecision("Rejected")} className="reject">Reject</button>
                </div>

                <textarea placeholder="Reviewer notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </>
            ) : (
              <div className="empty">Upload a WAV file to start playback and noise analysis.</div>
            )}
          </section>
        )}

        {tab === "naming" && (
          <section className="panel">
            <h3>German Project Naming Reference</h3>
            <div className="formGrid">
              <input value={speaker} onChange={(e) => setSpeaker(e.target.value.toUpperCase())} placeholder="D0001" />
              <input value={sentence} onChange={(e) => setSentence(e.target.value.toUpperCase())} placeholder="S0001" />
              <select value={task} onChange={(e) => setTask(e.target.value as any)}>
                <option value="dkws">Wake Word / dkws</option>
                <option value="recording">Recording</option>
                <option value="oneshot200">One Shot 200</option>
              </select>
              <select value={speed} onChange={(e) => setSpeed(e.target.value as any)}>
                <option value="slow">slow</option>
                <option value="normal">normal</option>
                <option value="fast">fast</option>
              </select>
            </div>

            <div className="generated">{generatedName}</div>
            <div className="valid">Approved German naming format</div>

            <div className="rules">
              <h4>Accepted German Naming Rules</h4>
              <p>Wake Word: DE-DE_D0001_S0001_dkws_slow.wav</p>
              <p>Recording: DE-DE_D0001_S0001_recording_normal.wav</p>
              <p>One Shot: DE-DE_D0001_S0001_oneshot200_fast.wav</p>
              <p>Speaker ID must be D + 4 digits. Sentence ID must be S + 4 digits.</p>
            </div>
          </section>
        )}

        {tab === "audio" && (
          <section className="panel">
            <h3>Audio Lab</h3>
            <p>Use QC Analyzer first. Current browser version analyzes and validates audio locally without uploading to a server.</p>
            <p>Next real backend step: server-side WAV conversion, ZIP export and permanent storage.</p>
          </section>
        )}

        {tab === "exports" && <Panel title="Exports" text="Prepare approved WAV files, metadata sheet and client delivery package." />}
        {tab === "team" && <Panel title="Team" text="Zakaria Ahmed — Founder. Hanan Youssef — Operations Manager. QA Team — Review / Approve / Reject." />}
        {tab === "client" && <Panel title="Client Portal" text="Client read-only progress view for German Recording Batch 01." />}
      </main>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="metric">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({ title, text }: { title: string; text: string }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <p>{text}</p>
    </section>
  );
}

function analyzeWav(buffer: ArrayBuffer, fileName: string): Omit<AudioStats, "objectUrl"> {
  const view = new DataView(buffer);
  let offset = 12;
  let channels = 1;
  let sampleRate = 48000;
  let bitDepth = 16;
  let audioFormat = 1;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < view.byteLength - 8) {
    const id = readStr(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      audioFormat = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitDepth = view.getUint16(offset + 22, true);
    }
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (!dataOffset || !dataSize) {
    throw new Error("Invalid WAV file: data chunk not found.");
  }

  const bytesPerSample = bitDepth / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const frames = Math.floor(totalSamples / channels);
  const samples: number[] = [];

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const pos = dataOffset + (i * channels + ch) * bytesPerSample;
      sum += readSample(view, pos, bitDepth, audioFormat);
    }
    samples.push(sum / channels);
  }

  let peak = 0;
  let totalSq = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
    totalSq += s * s;
  }

  const rms = Math.sqrt(totalSq / Math.max(1, samples.length));
  const blockSize = Math.max(256, Math.floor(sampleRate * 0.05));
  const blockRms: number[] = [];

  for (let i = 0; i < samples.length; i += blockSize) {
    const block = samples.slice(i, i + blockSize);
    const value = Math.sqrt(block.reduce((a, b) => a + b * b, 0) / Math.max(1, block.length));
    blockRms.push(value);
  }

  const sorted = [...blockRms].sort((a, b) => a - b);
  const quietCount = Math.max(1, Math.floor(sorted.length * 0.15));
  const noise = sorted.slice(0, quietCount).reduce((a, b) => a + b, 0) / quietCount;

  const bars = blockRms.slice(0, 80).map((v) => Math.min(1, v * 18));
  const noiseDb = toDb(noise);
  const verdict =
    noiseDb <= -60 ? "Excellent / Pass" :
    noiseDb <= -50 ? "Good / Review recommended" :
    "High Noise / Reject risk";

  return {
    fileName,
    duration: frames / sampleRate,
    sampleRate,
    channels,
    bitDepth,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    noiseFloorDb: noiseDb,
    verdict,
    bars,
  };
}

function readSample(view: DataView, pos: number, bitDepth: number, format: number) {
  if (format === 3 && bitDepth === 32) return view.getFloat32(pos, true);
  if (bitDepth === 8) return (view.getUint8(pos) - 128) / 128;
  if (bitDepth === 16) return view.getInt16(pos, true) / 32768;
  if (bitDepth === 24) {
    let v = view.getUint8(pos) | (view.getUint8(pos + 1) << 8) | (view.getUint8(pos + 2) << 16);
    if (v & 0x800000) v |= 0xff000000;
    return v / 8388608;
  }
  if (bitDepth === 32) return view.getInt32(pos, true) / 2147483648;
  return 0;
}

function readStr(view: DataView, offset: number, len: number) {
  return Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");
}

function toDb(v: number) {
  return 20 * Math.log10(Math.max(v, 1e-9));
}
