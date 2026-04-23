import { useMemo, useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Upload,
  ShieldCheck,
  SlidersHorizontal,
  Download,
  Users,
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileAudio,
  Clock3,
  BadgeCheck,
} from 'lucide-react'
import './styles.css'

type TabKey =
  | 'dashboard'
  | 'projects'
  | 'upload'
  | 'qc'
  | 'audio'
  | 'export'
  | 'team'
  | 'client'

type ProjectType = 'German Recording' | 'Wake Word' | 'ASR' | 'TTS'

type Project = {
  id: string
  name: string
  client: string
  language: string
  country: string
  type: ProjectType
  required: number
  uploaded: number
  review: number
  approved: number
  rejected: number
  deadline: string
  namingPattern: string
  sampleRateTarget: string
}

type UploadItem = {
  originalName: string
  generatedName: string
  status: 'uploaded' | 'review' | 'approved' | 'rejected'
  validNaming: boolean
  reason?: string
}

type QCStatus = 'approved' | 'review' | 'rejected'

const projects: Project[] = [
  {
    id: 'german-recording',
    name: 'German Recording Batch 01',
    client: 'Aivora Internal',
    language: 'German',
    country: 'Germany',
    type: 'German Recording',
    required: 200,
    uploaded: 42,
    review: 9,
    approved: 28,
    rejected: 5,
    deadline: '2026-05-05',
    namingPattern: 'DE-DE_D0001_S0001_recording_normal.wav',
    sampleRateTarget: '48 kHz / 32-bit',
  },
  {
    id: 'wake-word',
    name: 'Wake Word QA Set',
    client: 'Confidential Client',
    language: 'German',
    country: 'Germany',
    type: 'Wake Word',
    required: 120,
    uploaded: 18,
    review: 6,
    approved: 9,
    rejected: 3,
    deadline: '2026-05-10',
    namingPattern: 'DE-DE_D0001_S0001_dkws_normal.wav',
    sampleRateTarget: '48 kHz / 32-bit',
  },
  {
    id: 'asr-ar',
    name: 'Arabic ASR Pilot',
    client: 'Enterprise Buyer',
    language: 'Arabic',
    country: 'Egypt',
    type: 'ASR',
    required: 500,
    uploaded: 123,
    review: 20,
    approved: 84,
    rejected: 19,
    deadline: '2026-05-20',
    namingPattern: 'AR-EG_A0001_S0001_asr_normal.wav',
    sampleRateTarget: '48 kHz / 24-bit',
  },
]

const navItems: [TabKey, string, any][] = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['projects', 'Projects', FolderKanban],
  ['upload', 'Upload Center', Upload],
  ['qc', 'QC Center', ShieldCheck],
  ['audio', 'Audio Lab', SlidersHorizontal],
  ['export', 'Exports', Download],
  ['team', 'Team', Users],
  ['client', 'Client Portal', Building2],
]

const seedUploads: UploadItem[] = [
  {
    originalName: '1. Hi BYD (slow).wav',
    generatedName: 'DE-DE_D0001_S0001_recording_normal.wav',
    status: 'uploaded',
    validNaming: true,
  },
  {
    originalName: 'DE-DE_D1099_S0002_dkws_slow.wav',
    generatedName: 'DE-DE_D1099_S0002_dkws_slow.wav',
    status: 'review',
    validNaming: true,
  },
]

function validateWavFileName(name: string): boolean {
  return /^[A-Z]{2}-[A-Z]{2}_[A-Z]\d{4}_S\d{4}_(recording|dkws|asr|tts)_(slow|normal|fast)\.wav$/i.test(
    name,
  )
}

function badgeClass(status: UploadItem['status'] | QCStatus) {
  if (status === 'approved') return 'badge success'
  if (status === 'review') return 'badge warn'
  if (status === 'rejected') return 'badge danger'
  return 'badge info'
}

function progressPercent(project: Project) {
  return Math.min(100, Math.round((project.uploaded / project.required) * 100))
}

function buildSuggestedName(project: Project, speakerId: string, sentenceId: string, speed: string) {
  const prefix =
    project.language === 'German'
      ? 'DE-DE'
      : project.language === 'Arabic'
      ? 'AR-EG'
      : 'XX-XX'
  const family =
    project.type === 'Wake Word'
      ? 'dkws'
      : project.type === 'ASR'
      ? 'asr'
      : project.type === 'TTS'
      ? 'tts'
      : 'recording'

  return `${prefix}_${speakerId}_${sentenceId}_${family}_${speed}.wav`
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone = 'default',
}: {
  title: string
  value: string
  icon: any
  tone?: 'default' | 'success' | 'danger' | 'warn'
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{title}</span>
        <Icon size={18} />
      </div>
      <div className="stat-value">{value}</div>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0].id)
  const [uploads, setUploads] = useState<UploadItem[]>(seedUploads)
  const [qcIndex, setQcIndex] = useState<number>(0)
  const [speakerId, setSpeakerId] = useState('D0001')
  const [sentenceId, setSentenceId] = useState('S0001')
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal')
  const [auditLog, setAuditLog] = useState<string[]>([
    'Production platform initialized',
    'Branding mode: Aivora AI',
  ])

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0],
    [selectedProjectId],
  )

  const totalStats = useMemo(() => {
    const totalRequired = projects.reduce((sum, p) => sum + p.required, 0)
    const totalUploaded = projects.reduce((sum, p) => sum + p.uploaded, 0)
    const totalApproved = projects.reduce((sum, p) => sum + p.approved, 0)
    const totalRejected = projects.reduce((sum, p) => sum + p.rejected, 0)
    const approvalRate = totalApproved + totalRejected > 0
      ? Math.round((totalApproved / (totalApproved + totalRejected)) * 100)
      : 0

    return {
      totalRequired,
      totalUploaded,
      totalApproved,
      totalRejected,
      approvalRate,
      activeProjects: projects.length,
    }
  }, [])

  const currentQC = uploads[qcIndex] ?? null

  const suggestedName = buildSuggestedName(selectedProject, speakerId, sentenceId, speed)

  function onUploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return

    const newItems: UploadItem[] = Array.from(fileList).map((file, idx) => {
      const generated = buildSuggestedName(
        selectedProject,
        `D${String(1000 + uploads.length + idx).padStart(4, '0')}`,
        `S${String(uploads.length + idx + 1).padStart(4, '0')}`,
        selectedProject.type === 'Wake Word' ? 'slow' : 'normal',
      )

      return {
        originalName: file.name,
        generatedName: file.name.toLowerCase().endsWith('.wav') ? file.name : generated,
        status: 'uploaded',
        validNaming: validateWavFileName(file.name),
        reason: validateWavFileName(file.name) ? undefined : 'Naming format mismatch',
      }
    })

    setUploads((prev) => [...newItems, ...prev])
    setAuditLog((prev) => [
      `Uploaded ${newItems.length} file(s) into ${selectedProject.name}`,
      ...prev,
    ])
  }

  function updateQC(status: QCStatus, reason?: string) {
    if (!currentQC) return
    const next = [...uploads]
    next[qcIndex] = {
      ...currentQC,
      status,
      reason: reason ?? currentQC.reason,
    }
    setUploads(next)
    setAuditLog((prev) => [
      `QC ${status.toUpperCase()} → ${currentQC.generatedName}${reason ? ` | ${reason}` : ''}`,
      ...prev,
    ])
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div>
            <div className="brand-title">Aivora AI</div>
            <div className="brand-sub">Data Operations Platform</div>
          </div>
        </div>

        <div className="logo-box">
          <img
            src="/logo.png"
            alt="Aivora AI"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          <div className="logo-fallback">Upload /public/logo.png to show company logo</div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const [id, label, Icon] = item as [TabKey, string, any]
            const Cmp = Icon
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={tab === id ? 'nav-btn active' : 'nav-btn'}
              >
                <Cmp size={16} />
                <span>{label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="content">
        <section className="hero">
          <div>
            <div className="eyebrow">AIVORA AI · AI DATA VISION</div>
            <h1>Aivora AI Production Platform</h1>
            <p>
              Voice data operations, bulk upload, naming control, QC decisions, exports, and
              client-facing project visibility.
            </p>
          </div>

          <div className="hero-actions">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="select"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="upload-btn">
              <Upload size={16} />
              Bulk Upload
              <input
                type="file"
                accept="audio/*"
                multiple
                hidden
                onChange={(e) => onUploadFiles(e.target.files)}
              />
            </label>
          </div>
        </section>

        {tab === 'dashboard' && (
          <section className="panel-stack">
            <div className="grid stats-grid">
              <StatCard title="Active Projects" value={String(totalStats.activeProjects)} icon={FolderKanban} />
              <StatCard title="Uploaded Files" value={String(totalStats.totalUploaded)} icon={FileAudio} />
              <StatCard title="Approved" value={String(totalStats.totalApproved)} icon={CheckCircle2} tone="success" />
              <StatCard title="Rejected" value={String(totalStats.totalRejected)} icon={XCircle} tone="danger" />
              <StatCard title="Approval Rate" value={`${totalStats.approvalRate}%`} icon={BadgeCheck} tone="success" />
              <StatCard title="Due Soon" value={selectedProject.deadline} icon={Clock3} tone="warn" />
            </div>

            <div className="grid two-col">
              <section className="panel">
                <h3>Project Rules</h3>
                <div className="stack">
                  <div className="info-box">{selectedProject.name}</div>
                  <div className="info-box">
                    {selectedProject.language} · {selectedProject.country} · {selectedProject.type}
                  </div>
                  <div className="info-box">{selectedProject.sampleRateTarget}</div>
                  <div className="info-box break">{selectedProject.namingPattern}</div>
                </div>
              </section>

              <section className="panel">
                <h3>Audit Log</h3>
                <div className="stack small">
                  {auditLog.slice(0, 8).map((entry, i) => (
                    <div className="log-row" key={`${entry}-${i}`}>
                      {entry}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        )}

        {tab === 'projects' && (
          <section className="panel">
            <h3>Active Projects</h3>
            <div className="project-grid">
              {projects.map((project) => (
                <div className="project-card" key={project.id}>
                  <div className="project-head">
                    <div>
                      <div className="project-title">{project.name}</div>
                      <div className="project-sub">{project.client}</div>
                    </div>
                    <div className="badge info">{project.type}</div>
                  </div>

                  <div className="project-meta">
                    <span>{project.language}</span>
                    <span>{project.country}</span>
                    <span>Deadline: {project.deadline}</span>
                  </div>

                  <div className="progress-wrap">
                    <div className="progress-label">
                      <span>Progress</span>
                      <span>{progressPercent(project)}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progressPercent(project)}%` }} />
                    </div>
                  </div>

                  <div className="mini-stats">
                    <div>Required: {project.required}</div>
                    <div>Uploaded: {project.uploaded}</div>
                    <div>Review: {project.review}</div>
                    <div>Approved: {project.approved}</div>
                    <div>Rejected: {project.rejected}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'upload' && (
          <section className="panel">
            <h3>Upload Center</h3>
            <div className="toolbar">
              <label className="upload-btn">
                <Upload size={16} />
                Upload Files / ZIP
                <input
                  type="file"
                  accept=".wav,.zip,audio/*"
                  multiple
                  hidden
                  onChange={(e) => onUploadFiles(e.target.files)}
                />
              </label>

              <div className="info-box break">
                Bulk upload enabled. Naming validator runs immediately after selection.
              </div>
            </div>

            <div className="table">
              <div className="table-row head">
                <div>Original File</div>
                <div>Generated / Uploaded Name</div>
                <div>Naming Check</div>
                <div>Status</div>
              </div>

              {uploads.map((item, i) => (
                <div className="table-row" key={`${item.generatedName}-${i}`}>
                  <div className="break">{item.originalName}</div>
                  <div className="break">{item.generatedName}</div>
                  <div>
                    {item.validNaming ? (
                      <span className="badge success">Valid</span>
                    ) : (
                      <span className="badge danger">Invalid</span>
                    )}
                  </div>
                  <div>
                    <span className={badgeClass(item.status)}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'qc' && (
          <section className="panel-stack">
            <section className="panel">
              <h3>QC Center</h3>
              {currentQC ? (
                <div className="stack">
                  <div className="info-box break">{currentQC.generatedName}</div>
                  <div className="info-box">Original: {currentQC.originalName}</div>
                  <div className="grid qc-grid">
                    <div className="info-box">Duration: 4.2s</div>
                    <div className="info-box">Sample Rate: 48000 Hz</div>
                    <div className="info-box">Channels: 1</div>
                    <div className="info-box">Noise Hint: Low</div>
                  </div>
                  <div className="action-row">
                    <button className="btn success" onClick={() => updateQC('approved')}>
                      Approve
                    </button>
                    <button className="btn warn" onClick={() => updateQC('review', 'Needs manual listen')}>
                      Review
                    </button>
                    <button className="btn danger" onClick={() => updateQC('rejected', 'Noise / naming / silence')}>
                      Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty">No file available for QC.</div>
              )}
            </section>

            <section className="panel">
              <h3>Noise / Reject Examples</h3>
              <div className="noise-grid">
                <div className="noise-card">Background noise spike</div>
                <div className="noise-card">Long silence gap</div>
                <div className="noise-card">Clipping / over-peak</div>
                <div className="noise-card">Wrong speed / delivery</div>
              </div>
            </section>
          </section>
        )}

        {tab === 'audio' && (
          <section className="panel">
            <h3>Audio Lab</h3>
            <div className="grid form-grid">
              <label>
                Speaker ID
                <input value={speakerId} onChange={(e) => setSpeakerId(e.target.value)} />
              </label>
              <label>
                Sentence ID
                <input value={sentenceId} onChange={(e) => setSentenceId(e.target.value)} />
              </label>
              <label>
                Speed
                <select value={speed} onChange={(e) => setSpeed(e.target.value as any)}>
                  <option value="slow">slow</option>
                  <option value="normal">normal</option>
                  <option value="fast">fast</option>
                </select>
              </label>
              <label>
                Naming Preview
                <input value={suggestedName} readOnly />
              </label>
            </div>

            <div className="stack">
              <div className={validateWavFileName(suggestedName) ? 'info-box success-line' : 'info-box danger-line'}>
                {validateWavFileName(suggestedName) ? 'Naming format valid' : 'Naming format invalid'}
              </div>
              <div className="info-box">Use this preview as the reference naming for contributors and team leaders.</div>
            </div>
          </section>
        )}

        {tab === 'export' && (
          <section className="panel">
            <h3>Exports</h3>
            <div className="stack">
              <div className="info-box">Ready for handoff when approved files reach target threshold.</div>
              <div className="info-box">Export format: WAV / metadata sheet / client-ready package.</div>
              <button className="btn primary">Prepare Export Package</button>
            </div>
          </section>
        )}

        {tab === 'team' && (
          <section className="panel">
            <h3>Team Management</h3>
            <div className="team-grid">
              <div className="member-card">
                <div className="member-name">Zakaria Ahmed</div>
                <div className="member-role">Founder & Admin</div>
              </div>
              <div className="member-card">
                <div className="member-name">Hanan Youssef</div>
                <div className="member-role">Operations Manager</div>
              </div>
              <div className="member-card">
                <div className="member-name">QA Team</div>
                <div className="member-role">Review / Approve / Reject</div>
              </div>
              <div className="member-card">
                <div className="member-name">Client View</div>
                <div className="member-role">Read-only progress access</div>
              </div>
            </div>
          </section>
        )}

        {tab === 'client' && (
          <section className="panel">
            <h3>Client Portal</h3>
            <div className="stack">
              <div className="info-box">Client: {selectedProject.client}</div>
              <div className="info-box">Project: {selectedProject.name}</div>
              <div className="progress-wrap">
                <div className="progress-label">
                  <span>Delivery Progress</span>
                  <span>{progressPercent(selectedProject)}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progressPercent(selectedProject)}%` }} />
                </div>
              </div>
              <div className="grid qc-grid">
                <div className="info-box">Uploaded: {selectedProject.uploaded}</div>
                <div className="info-box">Approved: {selectedProject.approved}</div>
                <div className="info-box">Rejected: {selectedProject.rejected}</div>
                <div className="info-box">Deadline: {selectedProject.deadline}</div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
