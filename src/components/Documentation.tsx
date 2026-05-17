// @ts-nocheck
/**
 * Documentation.tsx — Aivora Platform Documentation
 */
import React, { useState } from "react";

const DOCS = [
  {
    section: "GETTING STARTED",
    color: "#0EA5E9",
    items: [
      {
        title: "Platform Overview",
        content: `Aivora is an AI-native forensic audio infrastructure platform.

It combines professional DSP engineering with AI-powered analysis to deliver:
- Broadcast-grade audio QA (ITU-R BS.1770-4)
- Forensic silence repair and reconstruction
- Verifier-backed benchmark evaluation
- Enterprise batch processing (200+ files)
- Real-time AudioWorklet DSP pipeline

Built for: TTS dataset teams, ASR researchers, audio QA engineers, AI companies.`
      },
      {
        title: "Quick Start",
        content: `1. Open Platform → Dashboard
2. Choose your tool from Quick Access cards
3. Drop a WAV file (48kHz, 32-bit float recommended)
4. View analysis results and metrics
5. Export repaired audio

Supported formats: WAV (PCM16, PCM24, Float32), MP3, AAC (via browser decoder)`
      },
    ]
  },
  {
    section: "TOOLS",
    color: "#8B5CF6",
    items: [
      {
        title: "QC Workstation",
        content: `Professional audio quality control with 13 DSP phases.

Metrics computed:
- LUFS (ITU-R BS.1770-4 integrated, short-term, momentary)
- True Peak (4x oversampled interpolation)
- SNR (VAD-separated spectral estimate)
- RT60 reverb time (Schroeder backward integration)
- DNSMOS (blind quality estimation)
- Noise classification (HVAC/hum/hiss/AI artifacts)
- Export safety validation (10 checks)

Use for: Pre-delivery QA, dataset acceptance gates, compliance checking`
      },
      {
        title: "Forensic Silence Repair",
        content: `Adobe Audition-grade silence reconstruction.

Features:
- Silence detection (RMS threshold + duration filter)
- Room tone synthesis (spectral matching + noise shaping)
- Speech protection lock (VAD + safety margin expansion)
- Raised-cosine crossfades at all boundaries
- Noise Intelligence panel (RT60 + noise class + quality score)
- Batch mode (200+ files with progress tracking)
- Export: 32-bit float WAV

Critical rule: Never uses digital mute. Always synthesizes natural room tone.`
      },
      {
        title: "Audition Workstation (Pro Editor)",
        content: `Professional waveform + spectrogram editor.

Visualization:
- HDR spectrogram (bilinear interpolation, 87.5% overlap)
- 5 colormaps: plasma/inferno/aivora/forensic/MEL
- 5 window functions: Hann/Hamming/Blackman/Blackman-Harris/Kaiser
- Peak + RMS waveform with dB scale
- Sample-level zoom (dots + zero crossings + Catmull-Rom)
- WebGL GPU renderer (vertex + fragment shaders)
- Minimap overview + click-to-navigate

Intelligence:
- Noise fingerprinting (HVAC/hum/hiss/AI artifacts)
- DNSMOS MOS score
- Timeline Engine integration (non-destructive DAG)
- Forensic cursor inspector (SMPTE + spectral metrics)

FFT sizes: 512/1024/2048/4096/8192`
      },
      {
        title: "Enhancement Lab",
        content: `Level 2 DSP audio enhancement pipeline.

Processors (in order):
1. Spectral Denoising — Wiener filter with FFT spectral subtraction
2. Multi-band Compression — 4 bands (200Hz/1kHz/4kHz Butterworth crossovers)
3. De-click — Adaptive median filter + cubic interpolation
4. High-pass Filter — 2nd order Butterworth (12dB/octave)
5. Low-pass Filter — 2nd order Butterworth
6. Noise Gate — Envelope follower with attack/release
7. Silence Trim — Energy threshold trimming
8. Normalization — Peak or LUFS (ITU-R BS.1770-4)

Output: 32-bit float WAV`
      },
      {
        title: "Audio Bench",
        content: `Verifier-backed forensic audio benchmark system.

9 benchmark tasks:
- ABT-001: Noisy Silence Repair (Medium)
- ABT-002: 50Hz Hum Removal (Hard)
- ABT-003: Speech Preservation (Expert)
- ABT-004: ASR Dataset Readiness (Hard)
- ABT-005: Dead Silence Detection (Easy)
- ABT-006: Hiss Reduction (Hard)
- ABT-007: Clipping Recovery (Expert)
- ABT-008: Stereo Phase Repair (Medium)
- ABT-009: TTS Quality Gate (Expert)

Verifier metrics: LUFS, True Peak, SNR, Hum, Seam Risk, Speech Preservation
Scoring: 0-100 with grade A/B/C/D/F
Export: JSONL training data + manifest JSON`
      },
      {
        title: "Delivery Readiness",
        content: `10-check export safety gate before delivery.

Checks:
1. Format validity (sample rate, channels, length)
2. True Peak ≤ -1.0 dBTP
3. LUFS within -35 to -10 range
4. Clipping ratio < 0.1%
5. No digital mute (RMS > -90dB)
6. No repeated texture (silence loop detection)
7. Seam risk < 0.25
8. Duration drift < 50ms
9. Sample rate = 48000 Hz
10. Speech preservation > 95%

Results logged to Supabase activity database.
Export blocked automatically on critical failures.`
      },
      {
        title: "Batch Analyzer",
        content: `Process 200+ files simultaneously.

Features:
- Parallel processing with concurrency control
- Per-file QC scoring
- Silence repair pipeline
- LUFS normalization
- Export validation gate
- Progress tracking with ETA
- Pause/Resume/Cancel support
- Results saved to Supabase

Output: 32-bit float WAV files + QC report`
      },
    ]
  },
  {
    section: "DSP ENGINE",
    color: "#10B981",
    items: [
      {
        title: "Phase 1 — Professional DSP Core",
        content: `Linkwitz-Riley 4th order crossovers (LR4):
- Phase coherent at crossover point (-6dB)
- No comb filtering, no phase cancellation
- 3-way split: 200Hz / 1kHz / 4kHz

Lookahead Limiter:
- 5ms lookahead, zero overshoot guarantee
- Smooth release (50ms)
- True peak safety gate

Adaptive Noise Floor Tracker:
- Martin (2001) minimum statistics
- Per-bin noise estimation
- Adapts to slowly changing environments

Adaptive Wiener Filter:
- Temporal smoothing (α=0.7)
- Soft thresholding
- Overlap-add reconstruction`
      },
      {
        title: "Phase 2 — Spectral Intelligence",
        content: `Multi-Resolution FFT (simultaneous):
- Short FFT (256) — 5ms transient precision
- Medium FFT (1024) — 21ms speech clarity
- Large FFT (4096) — 85ms forensic precision

Frequency scales: Linear, Mel, Bark, Log
Window functions: Hann, Hamming, Blackman, Kaiser, Blackman-Harris

Formant Detection:
- LPC via Levinson-Durbin recursion
- Order: 12 (2 + sr/1000)
- F1/F2/F3/F4 extraction

24-band Bark filter bank (psychoacoustic analysis)`
      },
      {
        title: "Phase 3 — Forensic Engine",
        content: `Noise Classifier:
- 8 classes: HVAC/50Hz hum/60Hz hum/hiss/mic noise/room/AI artifacts/clean
- Harmonic series detector (50/60Hz + 6 harmonics)
- AI artifact detection (comb/metallic/discontinuity)
- Spectral slope estimation (dB/octave)

RT60 Estimation:
- Schroeder backward integration
- T20 extrapolation to RT60
- Early Decay Time (EDT)
- C80 clarity metric

Noise profile similarity (cosine distance)`
      },
      {
        title: "Phase 4 — AI Audio Intelligence",
        content: `Objective Metrics:
- SI-SDR (Le Roux et al. 2019)
- STOI approximation (Taal et al. 2011) — 19 one-third octave bands
- PESQ proxy (ITU-T P.862 approximation)
- DNSMOS proxy (blind quality estimation)
- Log Spectral Distance

Enhancement Agent:
- Autonomous pipeline selection
- Context-aware: TTS/ASR/broadcast/forensic/general
- Speech preservation validation
- Export safety gate
- Rollback on TTS speech damage

ONNX Runtime:
- WebGPU/WASM/CPU auto-selection
- DSP fallback when model unavailable
- VAD: energy + ZCR + hangover`
      },
      {
        title: "Phase 5 — Enterprise Infrastructure",
        content: `Export Validator (10 checks):
- True peak, LUFS, clipping, digital mute
- Seam risk, repeated texture, duration drift
- Sample rate, speech preservation
- Blocks export on critical failures

Batch Processor:
- Resumable job queue (pause/resume/cancel)
- Per-file validation gate
- Memory-safe chunk processing
- Progress reporting with ETA

AudioWorklet:
- Dedicated audio rendering thread
- Zero main-thread blocking
- Realtime RMS + peak metering
- Lookahead limiting
- Clip detection + ZCR`
      },
    ]
  },
  {
    section: "STANDARDS",
    color: "#F59E0B",
    items: [
      {
        title: "Audio Standards",
        content: `ITU-R BS.1770-4 — Loudness measurement
- K-weighting filter (pre-filter + RLB)
- Absolute gate: -70 LUFS
- Relative gate: -10 LU
- True peak: 4x oversampled interpolation

EBU R128 — Broadcast loudness
- Integrated: -23 LUFS ±1 LU
- True Peak: ≤ -1.0 dBTP
- Loudness Range (LRA)

Appen QA Standards:
- Silence RMS: -65 to -42 dB
- SNR: ≥ 15 dB
- Speech preservation: > 98%
- Duration drift: < 50ms`
      },
      {
        title: "File Requirements",
        content: `Recommended input format:
- Sample rate: 48000 Hz
- Bit depth: 32-bit float (or 16/24-bit PCM)
- Channels: Mono (stereo supported)
- Format: WAV (uncompressed)

Output format:
- Always 32-bit float WAV
- Sample rate preserved (or 48kHz normalized)
- Channels preserved

Naming convention (Appen):
- Sequential: S0001.wav → S0200.wav
- With task: S0001_T01.wav
- Speaker: SPK01_0001.wav`
      },
    ]
  },
];

export default function Documentation() {
  const [activeSection, setActiveSection] = useState("GETTING STARTED");
  const [activeItem,    setActiveItem]    = useState(0);
  const [search,        setSearch]        = useState("");

  const filtered = DOCS.map(s => ({
    ...s,
    items: s.items.filter(i =>
      !search || i.title.toLowerCase().includes(search.toLowerCase()) ||
      i.content.toLowerCase().includes(search.toLowerCase())
    )
  })).filter(s => s.items.length > 0);

  const currentSection = filtered.find(s => s.section === activeSection) ?? filtered[0];
  const currentItem    = currentSection?.items[activeItem] ?? currentSection?.items[0];

  return (
    <div style={{ height:"100%", display:"flex", background:"#020608",
      fontFamily:"'JetBrains Mono',monospace", color:"#a0c4cc", overflow:"hidden" }}>

      {/* Sidebar */}
      <div style={{ width:200, borderRight:"1px solid #0a1520", overflow:"auto",
        flexShrink:0, padding:"12px 0" }}>
        <div style={{ padding:"0 12px 12px", borderBottom:"1px solid #0a1520",
          marginBottom:8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search docs..."
            style={{ width:"100%", boxSizing:"border-box",
              background:"#030810", border:"1px solid #1a3a5a",
              borderRadius:6, padding:"6px 8px", color:"#E2EEF6",
              fontSize:9, fontFamily:"inherit", outline:"none" }}/>
        </div>

        {filtered.map(section => (
          <div key={section.section}>
            <div style={{ fontSize:7, color:section.color, letterSpacing:2,
              padding:"6px 12px 4px", fontWeight:700 }}>
              {section.section}
            </div>
            {section.items.map((item, i) => (
              <div key={i} onClick={()=>{setActiveSection(section.section);setActiveItem(i);}}
                style={{ padding:"5px 12px", cursor:"pointer", fontSize:9,
                  color: activeSection===section.section&&activeItem===i
                    ? section.color : "#4a6a7a",
                  background: activeSection===section.section&&activeItem===i
                    ? `${section.color}10` : "transparent",
                  borderLeft: activeSection===section.section&&activeItem===i
                    ? `2px solid ${section.color}` : "2px solid transparent",
                }}>
                {item.title}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflow:"auto", padding:24 }}>
        {currentItem ? (
          <>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:8, color:currentSection?.color,
                letterSpacing:2, marginBottom:4 }}>
                {currentSection?.section}
              </div>
              <div style={{ fontSize:20, fontWeight:700, color:"#E2EEF6" }}>
                {currentItem.title}
              </div>
            </div>
            <div style={{ fontSize:11, color:"#64A0B8", lineHeight:1.8,
              whiteSpace:"pre-wrap",
              background:"#050d18", border:"1px solid #0f2030",
              borderRadius:8, padding:20 }}>
              {currentItem.content}
            </div>
          </>
        ) : (
          <div style={{ color:"#2a5a6a", fontSize:10, marginTop:40,
            textAlign:"center" }}>
            No results for "{search}"
          </div>
        )}
      </div>
    </div>
  );
}
