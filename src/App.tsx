import React, { useMemo, useRef, useState } from 'react'
import { AudioWaveform, BarChart3, CheckCircle2, Download, FolderKanban, Pause, Play, ShieldCheck, Upload, Wrench } from 'lucide-react'

type TabKey = 'dashboard' | 'projects' | 'upload' | 'qc' | 'audio' | 'export'
type Project = {
  id: string
  name: string
  type: 'German Recording' | 'Wake Word'
  language: string
  dialect: string
  namingPattern: string
  sampleRateTarget: number
  bitDepthTarget: 32
  silenceBeforeMs: number
  silenceAfterMs: number
}
type FileRecord = {
  id: string
  projectId: string
  originalName: string
  generatedName: string
  status: 'uploaded' | 'review' | 'approved' | 'rejected' | 'export_ready'
  durationSec?: number
  sampleRate?: number
  channels?: number
  rmsDb?: number
  peakDb?: number
  silenceRatio?: number
  noiseHint?: 'Low' | 'Medium' | 'High'
  localUrl: string
}

const PROJECTS: Project[] = [
  { id: 'proj_de_recording', name: 'German Recording', type: 'German Recording', language: 'German', dialect: 'Germany', namingPattern: 'DE-DE_D0001_S0001_recording_normal.wav', sampleRateTarget: 48000, bitDepthTarget: 32, silenceBeforeMs: 500, silenceAfterMs: 500 },
  { id: 'proj_wake_word', name: 'Wake Word', type: 'Wake Word', language: 'German', dialect: 'Germany', namingPattern: 'DE-DE_D0001_S0001_dkws_normal.wav', sampleRateTarget: 48000, bitDepthTarget: 32, silenceBeforeMs: 700, silenceAfterMs: 700 },
]

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return <div className="card"><div className="card-title">{title}</div><div className="card-value">{value}</div>{sub ? <div className="card-sub">{sub}</div> : null}</div>
}
function EmptyState({ text }: { text: string }) { return <div className="empty-state">{text}</div> }

function encodeWavFloat32(interleaved: Float32Array, sampleRate: number, channels: number) {
  const bytesPerSample = 4
  const blockAlign = channels * bytesPerSample
  const buffer = new ArrayBuffer(44 + interleaved.length * bytesPerSample)
  const view = new DataView(buffer)
  const writeString = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + interleaved.length * bytesPerSample, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 32, true)
  writeString(36, 'data')
  view.setUint32(40, interleaved.length * bytesPerSample, true)
  let offset = 44
  for (let i = 0; i < interleaved.length; i++, offset += 4) view.setFloat32(offset, interleaved[i], true)
  return new Blob([buffer], { type: 'audio/wav' })
}

async function decodeAudio(file: File) {
  const ctx = new AudioContext()
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  await ctx.close()
  return buffer
}
function interleave(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels
  const out = new Float32Array(buffer.length * channels)
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i))
  let index = 0
  for (let i = 0; i < buffer.length; i++) { for (let c = 0; c < channels; c++) out[index++] = data[c][i] }
  return out
}
async function buildAdjustedExport(buffer: AudioBuffer, targetSampleRate: number, silenceBeforeMs: number, silenceAfterMs: number, gain: number, playbackRate: number) {
  const sourceDuration = buffer.duration / Math.max(playbackRate, 0.1)
  const beforeSec = silenceBeforeMs / 1000
  const afterSec = silenceAfterMs / 1000
  const totalDuration = beforeSec + sourceDuration + afterSec
  const offline = new OfflineAudioContext({ numberOfChannels: buffer.numberOfChannels, length: Math.ceil(totalDuration * targetSampleRate), sampleRate: targetSampleRate })
  const src = offline.createBufferSource()
  const gainNode = offline.createGain()
  src.buffer = buffer
  src.playbackRate.value = playbackRate
  gainNode.gain.value = gain
  src.connect(gainNode).connect(offline.destination)
  src.start(beforeSec)
  const rendered = await offline.startRendering()
  const blob = encodeWavFloat32(interleave(rendered), targetSampleRate, rendered.numberOfChannels)
  return { rendered, blob }
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [projects] = useState(PROJECTS)
  const [selectedProjectId, setSelectedProjectId] = useState(PROJECTS[0].id)
  const [records, setRecords] = useState<FileRecord[]>([])
  const [speakerId, setSpeakerId] = useState('D0001')
  const [sentenceId, setSentenceId] = useState('S0001')
  const [mode, setMode] = useState<'slow' | 'normal' | 'fast'>('normal')
  const [playbackRate, setPlaybackRate] = useState(1)
  const [gain, setGain] = useState(1)
  const [silenceBeforeMs, setSilenceBeforeMs] = useState(PROJECTS[0].silenceBeforeMs)
  const [silenceAfterMs, setSilenceAfterMs] = useState(PROJECTS[0].silenceAfterMs)
  const [currentAudioUrl, setCurrentAudioUrl] = useState('')
  const [currentBuffer, setCurrentBuffer] = useState<AudioBuffer | null>(null)
  const [exportUrl, setExportUrl] = useState('')
  const [exportName, setExportName] = useState('')
  const [exportMeta, setExportMeta] = useState('48 kHz / 32-bit target')
  const [processing, setProcessing] = useState(false)
  const [auditLog, setAuditLog] = useState<string[]>(['Internal test build initialized'])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) || projects[0], [projects, selectedProjectId])
  const stats = useMemo(() => ({
    total: records.length,
    uploaded: records.filter((r) => r.status === 'uploaded').length,
    review: records.filter((r) => r.status === 'review').length,
    approved: records.filter((r) => r.status === 'approved').length,
    rejected: records.filter((r) => r.status === 'rejected').length,
    exportReady: records.filter((r) => r.status === 'export_ready').length,
  }), [records])

  function generatedName(project: Project) {
    const prefix = 'DE-DE'
    return project.type === 'Wake Word' ? `${prefix}_${speakerId}_${sentenceId}_dkws_${mode}.wav` : `${prefix}_${speakerId}_${sentenceId}_recording_${mode}.wav`
  }

  function applyProject(projectId: string) {
    const p = projects.find((x) => x.id === projectId) || projects[0]
    setSelectedProjectId(p.id)
    setSilenceBeforeMs(p.silenceBeforeMs)
    setSilenceAfterMs(p.silenceAfterMs)
    setAuditLog((prev) => [`Preset applied: ${p.name}`, ...prev])
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return
    const file = files[0]
    const url = URL.createObjectURL(file)
    const buffer = await decodeAudio(file)
    setCurrentAudioUrl(url)
    setCurrentBuffer(buffer)
    setExportUrl('')

    let peak = 0, sumSq = 0, silenceCount = 0, total = 0
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c)
      total += data.length
      for (let i = 0; i < data.length; i++) {
        const x = Math.abs(data[i]); if (x > peak) peak = x
        sumSq += data[i] * data[i]
        if (x < 0.01) silenceCount++
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(total, 1))
    const rmsDb = 20 * Math.log10(Math.max(rms, 0.000001))
    const peakDb = 20 * Math.log10(Math.max(peak, 0.000001))
    const silenceRatio = Number(((silenceCount / Math.max(total, 1)) * 100).toFixed(1))
    let noiseHint: FileRecord['noiseHint'] = 'Low'
    if (rmsDb > -18) noiseHint = 'Medium'
    if (rmsDb > -12 || peakDb > -1.5) noiseHint = 'High'

    const record: FileRecord = {
      id: 'rec_' + Date.now(),
      projectId: selectedProject.id,
      originalName: file.name,
      generatedName: generatedName(selectedProject),
      status: 'uploaded',
      durationSec: Number(buffer.duration.toFixed(2)),
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      rmsDb: Number(rmsDb.toFixed(1)),
      peakDb: Number(peakDb.toFixed(1)),
      silenceRatio,
      noiseHint,
      localUrl: url,
    }
    setRecords((prev) => [record, ...prev])
    setAuditLog((prev) => [`Uploaded: ${file.name}`, ...prev])
    setTab('qc')
  }

  function updateLatestStatus(status: FileRecord['status']) {
    setRecords((prev) => prev.map((r, idx) => idx === 0 ? { ...r, status } : r))
    setAuditLog((prev) => [`QC status changed to ${status}`, ...prev])
  }

  async function exportAdjustedAudio() {
    if (!currentBuffer) return
    setProcessing(true)
    try {
      const outName = generatedName(selectedProject).replace('.wav', '_48k_32bit.wav')
      const { rendered, blob } = await buildAdjustedExport(currentBuffer, 48000, silenceBeforeMs, silenceAfterMs, gain, playbackRate)
      const url = URL.createObjectURL(blob)
      setExportUrl(url)
      setExportName(outName)
      setExportMeta(`${rendered.sampleRate} Hz / 32-bit float WAV / ${rendered.numberOfChannels} ch`)
      setRecords((prev) => prev.map((r, idx) => idx === 0 ? { ...r, generatedName: outName, status: 'export_ready' } : r))
      setAuditLog((prev) => [`Exported: ${outName}`, ...prev])
      setTab('export')
    } finally { setProcessing(false) }
  }

  const latest = records[0]

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand-card">
          <div className="badge"><ShieldCheck size={14} /> Internal Test Build</div>
          <h1>Aivora Platform</h1>
          <p>German Recording + Wake Word today-ready flow.</p>
        </div>
        <div className="nav-list">
          {[
            ['dashboard', 'Dashboard', BarChart3],
            ['projects', 'Projects', FolderKanban],
            ['upload', 'Upload', Upload],
            ['qc', 'QC Center', CheckCircle2],
            ['audio', 'Audio Adjust', Wrench],
            ['export', 'Export', Download],
          ].map(([id, label, Icon]) => {
            const Cmp = Icon as any
            return <button key={id} onClick={() => setTab(id as TabKey)} className={tab === id ? 'nav-btn active' : 'nav-btn'}><Cmp size={16} /><span>{label}</span></button>
          })}
        </div>
      </div>

      <main className="content">
        <div className="hero">
          <div>
            <h2>Internal Test Build</h2>
            <div className="hero-sub">Export target: 48 kHz / 32-bit</div>
          </div>
          <div className="hero-actions">
            <select value={selectedProjectId} onChange={(e) => applyProject(e.target.value)} className="input">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label className="upload-btn">
              <Upload size={16} /> Upload Audio
              <input type="file" accept="audio/*" hidden onChange={(e) => onUpload(e.target.files)} />
            </label>
          </div>
        </div>

        {tab === 'dashboard' && <div className="space-y">
          <div className="cards-grid">
            <Card title="Total Files" value={String(stats.total)} />
            <Card title="Uploaded" value={String(stats.uploaded)} />
            <Card title="Review" value={String(stats.review)} />
            <Card title="Approved" value={String(stats.approved)} />
            <Card title="Rejected" value={String(stats.rejected)} />
            <Card title="Export Ready" value={String(stats.exportReady)} />
          </div>
          <div className="two-col">
            <section className="panel">
              <h3>Project Rules</h3>
              <div className="stack">
                <div className="info-box">{selectedProject.name} · {selectedProject.language} · {selectedProject.dialect}</div>
                <div className="info-box">{selectedProject.sampleRateTarget} Hz / {selectedProject.bitDepthTarget}-bit</div>
                <div className="info-box break">{selectedProject.namingPattern}</div>
              </div>
            </section>
            <section className="panel">
              <h3>Audit Log</h3>
              <div className="stack small">{auditLog.slice(0, 10).map((item, idx) => <div key={idx} className="info-box">{item}</div>)}</div>
            </section>
          </div>
        </div>}

        {tab === 'projects' && <div className="two-col">
          {projects.map((project) => <section key={project.id} className="panel"><h3>{project.name}</h3><div className="stack"><div className="info-box">{project.language} · {project.dialect}</div><div className="info-box">{project.sampleRateTarget} Hz / {project.bitDepthTarget}-bit</div><div className="info-box break">{project.namingPattern}</div></div></section>)}
        </div>}

        {tab === 'upload' && <section className="panel"><h3>Upload + Registry</h3><div className="stack">{records.length === 0 ? <EmptyState text="No files uploaded yet." /> : records.map((item) => <div key={item.id} className="info-box"><div>{item.originalName}</div><div className="muted break">{item.generatedName}</div><div className="muted">Status: {item.status}</div></div>)}</div></section>}

        {tab === 'qc' && <div className="two-col">
          <section className="panel">
            <h3>QC Indicators</h3>
            {latest ? <div className="stack">
              <div className="info-box">Duration: {latest.durationSec}s</div>
              <div className="info-box">Sample Rate: {latest.sampleRate} Hz</div>
              <div className="info-box">Channels: {latest.channels}</div>
              <div className="info-box">RMS: {latest.rmsDb} dB</div>
              <div className="info-box">Peak: {latest.peakDb} dBFS</div>
              <div className="info-box">Silence Ratio: {latest.silenceRatio}%</div>
              <div className={`info-box risk ${latest.noiseHint?.toLowerCase()}`}>Noise Hint: {latest.noiseHint}</div>
            </div> : <EmptyState text="Upload first file to view QC indicators." />}
          </section>
          <section className="panel">
            <h3>QC Actions</h3>
            <div className="row">
              <button className="approve-btn" onClick={() => updateLatestStatus('approved')}>Approve</button>
              <button className="review-btn" onClick={() => updateLatestStatus('review')}>Review</button>
              <button className="reject-btn" onClick={() => updateLatestStatus('rejected')}>Reject</button>
            </div>
          </section>
        </div>}

        {tab === 'audio' && <div className="two-col">
          <section className="panel">
            <h3>Audio Adjustment</h3>
            <div className="form-grid">
              <label><div className="label">Speaker ID</div><input value={speakerId} onChange={(e) => setSpeakerId(e.target.value)} className="input" /></label>
              <label><div className="label">Sentence ID</div><input value={sentenceId} onChange={(e) => setSentenceId(e.target.value)} className="input" /></label>
              <label><div className="label">Mode</div><select value={mode} onChange={(e) => setMode(e.target.value as any)} className="input"><option value="slow">slow</option><option value="normal">normal</option><option value="fast">fast</option></select></label>
              <label><div className="label">Playback Speed</div><input type="range" min="0.8" max="1.2" step="0.05" value={playbackRate} onChange={(e) => setPlaybackRate(Number(e.target.value))} /></label>
              <label><div className="label">Silence Before (ms)</div><input type="number" value={silenceBeforeMs} onChange={(e) => setSilenceBeforeMs(Number(e.target.value))} className="input" /></label>
              <label><div className="label">Silence After (ms)</div><input type="number" value={silenceAfterMs} onChange={(e) => setSilenceAfterMs(Number(e.target.value))} className="input" /></label>
              <label className="span-2"><div className="label">Gain</div><input type="range" min="0.5" max="2" step="0.1" value={gain} onChange={(e) => setGain(Number(e.target.value))} /></label>
            </div>
            <div className="row">
              <button className="primary-btn" onClick={() => audioRef.current?.play()} disabled={!currentAudioUrl}><Play size={16} /> Play</button>
              <button className="secondary-btn" onClick={() => audioRef.current?.pause()} disabled={!currentAudioUrl}><Pause size={16} /> Pause</button>
              <button className="export-btn" onClick={exportAdjustedAudio} disabled={!currentBuffer || processing}><Wrench size={16} /> {processing ? 'Exporting...' : 'Export 48k / 32-bit'}</button>
            </div>
            <div className="audio-box"><audio ref={audioRef} controls className="audio-el" src={currentAudioUrl} /></div>
          </section>
          <section className="panel">
            <h3>Audio Notes</h3>
            <div className="stack">
              <div className="info-box">Use this for internal dry runs today.</div>
              <div className="info-box">Export writes 48 kHz / 32-bit float WAV.</div>
              <div className="info-box break">Generated Name: {generatedName(selectedProject)}</div>
            </div>
          </section>
        </div>}

        {tab === 'export' && <section className="panel">
          <h3>Export / Handoff</h3>
          {exportUrl ? <div className="stack">
            <div className="info-box break">{exportName}</div>
            <div className="info-box">{exportMeta}</div>
            <audio controls className="audio-el" src={exportUrl} />
            <a href={exportUrl} download={exportName} className="upload-btn no-underline"><Download size={16} /> Download Export</a>
          </div> : <EmptyState text="Run export from Audio Adjust to create handoff file." />}
        </section>}
      </main>
    </div>
  )
}
