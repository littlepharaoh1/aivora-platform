import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

type Tab = "qc" | "naming" | "audio" | "export";
type Speed = "slow" | "normal" | "fast";

const speedMap = { slow: 0.75, normal: 1, fast: 1.25 };

export default function App() {
  const [tab, setTab] = useState<Tab>("qc");
  const [fileName, setFileName] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  const [channels, setChannels] = useState(0);
  const [bitDepth, setBitDepth] = useState(0);
  const [peakDb, setPeakDb] = useState(0);
  const [rmsDb, setRmsDb] = useState(0);
  const [noiseDb, setNoiseDb] = useState(0);
  const [decision, setDecision] = useState("Pending");
  const [speed, setSpeed] = useState<Speed>("normal");
  const [speaker, setSpeaker] = useState("D0001");
  const [task, setTask] = useState("dkws");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useRef<HTMLCanvasElement | null>(null);

  const namingRows = useMemo(() => {
    return Array.from({ length: 200 }, (_, i) => {
      const sid = `S${String(i + 1).padStart(4, "0")}`;
      return `DE-DE_${speaker}_${sid}_${task}_${speed}.wav`;
    });
  }, [speaker, task, speed]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speedMap[speed];
  }, [speed, audioUrl]);

  async function loadAudio(file: File) {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const wavInfo = parseWav(arrayBuffer);

    const values = analyze(decoded);
    const url = URL.createObjectURL(file);

    setFileName(file.name);
    setAudioUrl(url);
    setAudioBuffer(decoded);
    setDuration(decoded.duration);
    setSampleRate(decoded.sampleRate);
    setChannels(decoded.numberOfChannels);
    setBitDepth(wavInfo.bitDepth || 32);
    setPeakDb(values.peakDb);
    setRmsDb(values.rmsDb);
    setNoiseDb(values.noiseDb);
    setDecision("Pending");

    setTimeout(() => drawWave(decoded), 50);
  }

  function startLiveMeter() {
    const audio = audioRef.current;
    if (!audio || !meterRef.current) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const data = new Uint8Array(analyser.frequencyBinCount);

    function loop() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const percent = Math.min(100, Math.max(4, avg / 2.2));
      if (meterRef.current) meterRef.current.style.width = `${percent}%`;
      requestAnimationFrame(loop);
    }

    loop();
  }

  function drawWave(buffer: AudioBuffer) {
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = buffer.getChannelData(0);
    canvas.width = canvas.clientWidth * 2;
    canvas.height = 220;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#35e6ff";
    ctx.lineWidth = 2;

    const step = Math.ceil(data.length / canvas.width);
    const mid = canvas.height / 2;

    ctx.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      let min = 1;
      let max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[x * step + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x, mid + min * mid);
      ctx.lineTo(x, mid + max * mid);
    }
    ctx.stroke();
  }

  async function downloadProcessed(mode: "normalize" | "silence") {
    if (!audioBuffer) return alert("Upload WAV first");

    let processed = audioBuffer;
    if (mode === "normalize") processed = normalizeBuffer(audioBuffer);
    if (mode === "silence") processed = addSilence(audioBuffer, 0.5, 0.5);

    const wav = audioBufferToWav(processed);
    const blob = new Blob([wav], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(".wav", `_${mode}.wav`);
    a.click();
  }

  return (
    <div className="shell">
      <aside>
        <div className="logoRow">
          <img src="/logo.png" onError={(e) => (e.currentTarget.style.display = "none")} />
          <div>
            <h1>Aivora AI</h1>
            <p>AI · DATA · VISION</p>
          </div>
        </div>

        <button className={tab === "qc" ? "active" : ""} onClick={() => setTab("qc")}>QC Workstation</button>
        <button className={tab === "naming" ? "active" : ""} onClick={() => setTab("naming")}>German Naming 1–200</button>
        <button className={tab === "audio" ? "active" : ""} onClick={() => setTab("audio")}>Audio Tools</button>
        <button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>Export Package</button>
      </aside>

      <main>
        <section className="hero">
          <span>AIVORA AI · REAL QC ENGINE</span>
          <h2>German Recording QC Workstation</h2>
          <p>Live playback, waveform, live noise meter, German naming, reviewer decision, normalize, silence tools and WAV download.</p>
        </section>

        {tab === "qc" && (
          <section className="card">
            <h3>QC Audio Analyzer</h3>

            <label className="upload">
              Upload WAV Recording
              <input type="file" accept=".wav,audio/*" onChange={(e) => e.target.files?.[0] && loadAudio(e.target.files[0])} />
            </label>

            {audioUrl && (
              <>
                <div className="filename">{fileName}</div>

                <audio ref={audioRef} src={audioUrl} controls onPlay={startLiveMeter} />

                <div className="speedRow">
                  <label>Playback Speed</label>
                  <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                    <option value="slow">Slow 0.75x</option>
                    <option value="normal">Normal 1x</option>
                    <option value="fast">Fast 1.25x</option>
                  </select>
                </div>

                <h4>Live Noise Meter</h4>
                <div className="liveMeter"><div ref={meterRef}></div></div>

                <h4>Waveform</h4>
                <canvas ref={waveRef} className="wave" />

                <div className="metrics">
                  <Metric title="Duration" value={`${duration.toFixed(2)}s`} />
                  <Metric title="Sample Rate" value={`${sampleRate} Hz`} />
                  <Metric title="Channels" value={`${channels}`} />
                  <Metric title="Bit Depth" value={`${bitDepth}-bit`} />
                  <Metric title="Peak" value={`${peakDb.toFixed(1)} dBFS`} />
                  <Metric title="RMS" value={`${rmsDb.toFixed(1)} dBFS`} />
                  <Metric title="Noise Floor" value={`${noiseDb.toFixed(1)} dBFS`} />
                  <Metric title="Verdict" value={noiseDb <= -60 ? "Excellent / Pass" : noiseDb <= -50 ? "Review" : "Reject Risk"} />
                </div>

                <div className="decisions">
                  <button className="ok" onClick={() => setDecision("Approved")}>Approve</button>
                  <button className="warn" onClick={() => setDecision("Review")}>Review</button>
                  <button className="bad" onClick={() => setDecision("Rejected")}>Reject</button>
                  <strong>Decision: {decision}</strong>
                </div>

                <textarea placeholder="Reviewer notes..." />
              </>
            )}
          </section>
        )}

        {tab === "naming" && (
          <section className="card">
            <h3>German Naming Reference — S0001 to S0200</h3>

            <div className="grid4">
              <input value={speaker} onChange={(e) => setSpeaker(e.target.value.toUpperCase())} />
              <select value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="dkws">dkws</option>
                <option value="recording">recording</option>
                <option value="oneshot200">oneshot200</option>
              </select>
              <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                <option value="slow">slow</option>
                <option value="normal">normal</option>
                <option value="fast">fast</option>
              </select>
              <button onClick={() => navigator.clipboard.writeText(namingRows.join("\n"))}>Copy 200 Names</button>
            </div>

            <div className="table">
              {namingRows.map((name, i) => (
                <div className="row" key={name}>
                  <span>{i + 1}</span>
                  <code>{name}</code>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "audio" && (
          <section className="card">
            <h3>Audio Tools</h3>
            <button onClick={() => downloadProcessed("normalize")}>Normalize + Download WAV</button>
            <button onClick={() => downloadProcessed("silence")}>Add 0.5s Silence Before/After + Download WAV</button>
            <p>الملف بعد التحويل ينزل مباشرة في Downloads على جهازك.</p>
          </section>
        )}

        {tab === "export" && (
          <section className="card">
            <h3>Export Package</h3>
            <p>Approved WAV + German naming sheet + reviewer notes + QC metrics.</p>
            <button onClick={() => navigator.clipboard.writeText(namingRows.join("\n"))}>Copy Naming Sheet</button>
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <div className="metric"><span>{title}</span><strong>{value}</strong></div>;
}

function parseWav(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let offset = 12;
  let bitDepth = 0;
  while (offset < view.byteLength - 8) {
    const id = readStr(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") bitDepth = view.getUint16(offset + 22, true);
    offset += 8 + size + (size % 2);
  }
  return { bitDepth };
}

function analyze(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0);
  let peak = 0, sq = 0;
  for (const s of data) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sq += s * s;
  }
  const rms = Math.sqrt(sq / data.length);
  const block = Math.floor(buffer.sampleRate * 0.05);
  const blocks:number[] = [];
  for (let i = 0; i < data.length; i += block) {
    let b = 0;
    for (let j = i; j < Math.min(i + block, data.length); j++) b += data[j] * data[j];
    blocks.push(Math.sqrt(b / block));
  }
  blocks.sort((a,b)=>a-b);
  const noise = blocks.slice(0, Math.max(1, Math.floor(blocks.length * .15))).reduce((a,b)=>a+b,0) / Math.max(1, Math.floor(blocks.length * .15));
  return { peakDb: db(peak), rmsDb: db(rms), noiseDb: db(noise) };
}

function normalizeBuffer(buffer: AudioBuffer) {
  const ctx = new AudioContext();
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (const s of d) peak = Math.max(peak, Math.abs(s));
  }
  const gain = peak ? 0.95 / peak : 1;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const input = buffer.getChannelData(c);
    const output = out.getChannelData(c);
    for (let i = 0; i < input.length; i++) output[i] = input[i] * gain;
  }
  return out;
}

function addSilence(buffer: AudioBuffer, before: number, after: number) {
  const ctx = new AudioContext();
  const beforeFrames = Math.floor(before * buffer.sampleRate);
  const afterFrames = Math.floor(after * buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length + beforeFrames + afterFrames, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c), beforeFrames);
  }
  return out;
}

function audioBufferToWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * channels * 2 + 44;
  const array = new ArrayBuffer(length);
  const view = new DataView(array);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, length - 8, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, length - 44, true);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return array;
}

function readStr(view: DataView, offset: number, len: number) {
  return Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");
}
function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
function db(v:number){ return 20 * Math.log10(Math.max(v, 1e-9)); }
