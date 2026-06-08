// @ts-nocheck
/**
 * Documentation.tsx — Aivora AI Platform Documentation
 * Comprehensive reference: company, vision, every module, usage guides.
 */
import React, { useState } from "react";

const DOCS = [
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "WHO WE ARE",
    color: "#0EA5E9",
    items: [
      {
        title: "Aivora AI — Overview",
        content: `Aivora AI

We build the infrastructure for trustworthy AI data — a unified, browser-native platform for producing, processing, and verifying multimodal AI training data across audio, speech, image, and video.

WHAT WE DO
Aivora AI unifies professional-grade data production, quality assurance, and a forensic-grade trust layer in a single deterministic system that runs entirely in the browser — no mandatory cloud, no hidden state.

Our domain:
- AI dataset production and preparation
- Forensic-grade quality assurance for data
- Annotation and review workforce management
- Data integrity verification and auditability`
      },
      {
        title: "Our Mission",
        content: `OUR MISSION

To solve the hardest problem in the AI data industry: trust.

The challenge isn't producing labeled data — it's proving that data is clean, consistent, and free of tampering. Most platforms optimize for speed and volume. We optimize for what is harder and rarer: provable quality.

Every operation in Aivora is:
- Deterministic — the same input always produces the same output
- Auditable — an immutable record of every action
- Verifiable — checksums and full provenance tracking

We build the verification layer the industry is missing.`
      },
      {
        title: "Our Vision",
        content: `OUR VISION

To become the standard trust layer for the AI data industry — the platform that data companies themselves rely on to verify and prove the quality of their output to their clients and to regulators.

As regulation tightens (EU AI Act, GDPR) and proving data provenance and integrity becomes mandatory, Aivora aims to be the infrastructure that makes it possible — deterministically, transparently, and in the browser.

WHERE WE ARE TODAY
A complete technical platform spanning 12+ subsystems, built on a deterministic, offline-first, GPU-native architecture. We are building the technical foundation on which the trust layer stands.`
      },
      {
        title: "Who It's For",
        content: `WHO IT'S FOR

- Data labeling companies that need to prove quality
- ML teams building proprietary datasets that need consistency guarantees
- Speech, TTS, and ASR teams that need precise QA
- Researchers who need reproducible, auditable data
- Organizations operating under regulatory data requirements

Whether you produce data, review it, or depend on its integrity — Aivora gives you the tools to trust what you ship.`
      },
    ]
  },
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "PLATFORM ARCHITECTURE",
    color: "#8b5cf6",
    items: [
      {
        title: "Core Principles",
        content: `CORE ENGINEERING PRINCIPLES

1. DETERMINISM FIRST
The same input always produces the same output, routing, and ordering. No hidden randomness. This is what makes results reproducible and auditable.

2. BROWSER-NATIVE COMPUTE
Runs on your GPU through the browser — WebGPU, with automatic fallback. No mandatory cloud inference, no data leaving your machine unless you choose.

3. OFFLINE-FIRST
Every operation has an offline fallback. Work continues without a connection; changes sync when you reconnect.

4. ENTERPRISE GOVERNANCE
Every critical operation is observable, replayable, versioned, and checksummed.`
      },
      {
        title: "Execution & Fallback Chain",
        content: `EXECUTION MODEL

Aivora runs compute on the best available backend and falls back gracefully:

WebGPU → WebGL2 → WASM SIMD → CPU Workers

If your device supports WebGPU, heavy work (FFT, spectrograms, model inference) runs GPU-accelerated. If not, it falls back automatically — the same operation still completes, just slower. You never hit a hard failure because a backend is missing.`
      },
      {
        title: "Technology Stack",
        content: `TECHNOLOGY STACK

Frontend:    React + TypeScript + Vite
Backend:     Supabase (PostgreSQL) with Row-Level Security everywhere
Runtime:     WebGPU, SharedArrayBuffer, ONNX Runtime Web
Compute:     Worker pools, shared memory, deterministic orchestration

All data access is governed by Row-Level Security. All AI models pass through a governed registry with version and checksum tracking.`
      },
    ]
  },
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "GETTING STARTED",
    color: "#22c55e",
    items: [
      {
        title: "Navigating the Platform",
        content: `NAVIGATING AIVORA

The sidebar groups tools into sections:

PRODUCTION — daily audio work (Dashboard, QC, Batch, Naming, Enhancement, Pipeline, Conversation Rooms)
REPAIR — the Professional Audio Editor
MANAGE — Contributors, Activity Monitor
SYSTEM — DSP Management, Validation, Bench, Observability, Store, Documentation
ENTERPRISE — the advanced suite (AI OS, Runtime, Analytics, Speech, Dataset Factory, QA Intelligence, Multimodal, Image/Video Annotation, Project Management, Workforce OS)

Hover any sidebar icon to see its label. Click to open that workstation.`
      },
      {
        title: "Your First Workflow",
        content: `A TYPICAL FIRST SESSION

1. Open QC Workstation and upload an audio file (drag-and-drop or Upload).
2. Review the quality metrics (LUFS, SNR, clipping, silence analysis).
3. If issues are found, send the file to Enhancement Lab or Forensic Repair.
4. Validate with Delivery Readiness before exporting.
5. Export in your required format.

Every step is logged and reproducible — you can always trace what was done to a file.`
      },
    ]
  },
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "AUDIO & PRODUCTION",
    color: "#22d3ee",
    items: [
      {
        title: "QC Workstation",
        content: `QC WORKSTATION

Analyze audio quality against broadcast and dataset standards.

What it checks:
- Loudness (LUFS, ITU-R BS.1770-4)
- Signal-to-noise ratio (SNR)
- Clipping and digital silence detection
- Hard cuts, reverb, spectral noise
- Voice activity (VAD)

How to use:
1. Upload a WAV/MP3/AAC file.
2. The workstation runs all analyzers automatically.
3. Review the metric panel — green means within spec, amber/red flags issues.
4. Send flagged files to Enhancement Lab or Forensic Repair.`
      },
      {
        title: "Batch Analyzer",
        content: `BATCH ANALYZER

Process 200+ files at once with the same QC pipeline.

How to use:
1. Drag a folder or multiple files into the batch area.
2. The analyzer queues and processes them deterministically.
3. Review the summary table — sort by any metric to find problem files.
4. Export the batch report or send flagged files downstream.

Ideal for validating an entire dataset before delivery.`
      },
      {
        title: "Enhancement Lab",
        content: `ENHANCEMENT LAB

Improve audio quality with professional DSP.

Available processing:
- Noise reduction and hum removal
- Loudness normalization
- Multi-band EQ
- Dynamic compression
- Silence trimming

How to use:
1. Upload your file.
2. Choose the enhancement chain (or apply individually).
3. Compare before/after with the A/B preview.
4. Export the processed result.`
      },
      {
        title: "Audio Pipeline",
        content: `AUDIO PIPELINE

End-to-end processing: take raw audio through analysis, repair, enhancement, and validation in one flow.

How to use:
1. Define your pipeline stages (or use a preset).
2. Upload input audio.
3. The pipeline runs each stage deterministically, logging every step.
4. Review the per-stage output and export the final result.`
      },
      {
        title: "Smart Naming",
        content: `SMART NAMING

Automatically generate consistent, sequenced file names for datasets, including Arabic numeral support and German sequencing.

How to use:
1. Load your files.
2. Choose a naming template and sequence rule.
3. Preview the generated names.
4. Apply and export the renamed set (with a ZIP option).`
      },
      {
        title: "Conversation Rooms",
        content: `CONVERSATION ROOMS

Mix and manage 2-speaker conversation audio — useful for dialogue datasets and TTS training data.

How to use:
1. Load speaker tracks.
2. Arrange turns on the timeline.
3. Balance levels and validate the mix.
4. Export the combined conversation.`
      },
      {
        title: "Professional Audio Editor (Pro Editor)",
        content: `PRO EDITOR

A full professional waveform and spectral editor — Adobe Audition-style.

Features:
- Green waveform renderer with dB scale
- Spectrogram Pro (4 colormaps, log frequency, FFT size control)
- Forensic silence repair and reconstruction
- 32-bit float export
- Region editing, time-stretch, spectral repair

How to use:
1. Open a WAV file.
2. Use the toolbar to zoom, select regions, and switch between waveform and spectrogram views.
3. Apply repairs or edits to selected regions.
4. Export in your required bit depth.`
      },
    ]
  },
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "SPEECH & ANNOTATION",
    color: "#f59e0b",
    items: [
      {
        title: "Speech Intelligence",
        content: `SPEECH INTELLIGENCE

Automatic speech recognition (ASR) and transcription across 53 languages, with right-to-left support.

How to use:
1. Upload audio.
2. Select the language (or auto-detect).
3. The system transcribes with word-level timestamps.
4. Review and export the transcript.`
      },
      {
        title: "Transcript Workstation Pro",
        content: `TRANSCRIPT WORKSTATION PRO

A professional transcript editor with word-level timestamps and versioning.

Features:
- Click any word to jump to that point in the audio
- Search and replace across the transcript
- Multiple export formats
- Full edit history and versioning

How to use:
1. Open a transcript (or generate one from Speech Intelligence).
2. Edit text while audio stays synced.
3. Save versions as you go.
4. Export in your required format.`
      },
      {
        title: "Image Annotator",
        content: `IMAGE ANNOTATOR

A professional image annotation workstation with 9 annotation tools, layers, and QA flags.

Features:
- Bounding boxes, polygons, and more (9 tools)
- Layers and a taxonomy/class system
- Zoom (0.1x–40x) with snapping
- Export to COCO, YOLO, Pascal VOC, JSONL, and AIVORA native formats
- AI Assist panel for model-suggested annotations (with human approval)

How to use:
1. Upload an image.
2. Pick a tool and class, then draw annotations.
3. Optionally open AI Assist to get model proposals — review and accept/reject each.
4. Export in your required format.`
      },
      {
        title: "Video Annotator",
        content: `VIDEO ANNOTATOR

Annotate video with object tracking across frames.

Features:
- Tracks and keyframes with deterministic interpolation
- Timeline scrubber
- Handles long videos via frame windowing
- Export to COCO Video, MOT, YOLO Video, and JSONL

How to use:
1. Load a video.
2. Annotate objects on keyframes; the system interpolates between them.
3. Navigate windows for long videos using Prev/Next.
4. Export in your required tracking format.`
      },
      {
        title: "AI-Assisted Annotation",
        content: `AI-ASSISTED ANNOTATION

Enhances manual annotation — it never replaces it. Models propose annotations; humans approve.

Supported models:
- YOLO — object detection (bounding boxes)
- SAM2 — segmentation masks
- Grounding DINO — text-guided detection
- CLIP — semantic classification

How it works:
1. In the Image Annotator, open the AI Assist panel.
2. Choose a model and run one-click auto-annotate.
3. Proposals appear with confidence colors.
4. Accept, reject, or edit each — accepted proposals become real annotations through the same path as manual drawing.

Note: model weights are configured per deployment. When a model's weights are not yet hosted, the panel shows its availability status.`
      },
    ]
  },
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "DATA & ENTERPRISE",
    color: "#f97316",
    items: [
      {
        title: "Dataset Factory",
        content: `DATASET FACTORY

Turn annotated and processed data into clean, versioned, enterprise-ready datasets.

Features:
- Pipeline definitions with quality gates
- Train/validation/test split visualization
- Dataset versioning
- Multi-format export

How to use:
1. Define a pipeline (sources, quality gates, splits).
2. Run it — the factory reads from authoritative tables only.
3. Review the quality gate results and split distribution.
4. Export the versioned dataset.`
      },
      {
        title: "QA Intelligence",
        content: `QA INTELLIGENCE

Workforce quality and integrity intelligence — consensus, fraud signals, routing, and review queues.

Panels:
- Consensus — multi-reviewer agreement resolution
- Fraud Intel — advisory signals on suspicious patterns
- Review Queue — pending review management
- Routing — task routing logic
- Workforce — reviewer overview

How to use:
Open QA Intelligence to monitor review quality across your workforce. All signals are advisory — they surface issues for human decision, never act automatically.`
      },
      {
        title: "Workforce OS",
        content: `WORKFORCE OS

Manage your annotation and review workforce at scale (validated to 10,000 workers / 100,000 assignments).

Six views:
- Workers — identity, activity, skills overview
- Skill Matrix — proficiency across 6 skill types
- Performance — throughput, acceptance, QA, rework, disagreement
- Capacity — workload, overload risk, assignment suggestions
- Fraud — advisory integrity signals (speed, copy, repeat, agreement)
- Analytics — rankings and trends

How to use:
Open Workforce OS to see your team's performance and capacity. Use the capacity view to balance new assignments, and the fraud view to flag workers for human review. All scoring is deterministic and advisory.`
      },
      {
        title: "Project Management",
        content: `PROJECT MANAGEMENT

Organize work into projects with role-based access and an immutable audit trail.

Features:
- Projects, task board, and team views
- Role-based permissions (mapped from platform roles)
- Immutable audit log (insert-only, SHA-256 checksummed, tamper-detectable)

How to use:
1. Create a project and add members with roles.
2. Assign and track tasks on the board.
3. Every action is recorded in the audit trail — review it anytime for full accountability.`
      },
      {
        title: "Analytics",
        content: `ANALYTICS

Platform-wide analytics across processing, QA, routing, and workforce.

Includes charts for:
- DSP timing
- Forensic verdicts
- Fraud heatmap
- Queue/retry behavior
- Reviewer throughput
- Routing decisions

How to use:
Open Analytics for a live dashboard of platform activity. Use it to spot bottlenecks, quality trends, and workforce patterns.`
      },
      {
        title: "Runtime Center & AI OS",
        content: `RUNTIME CENTER & AI OS

The control plane for the platform's compute runtime.

Runtime Center panels:
- GPU Operations
- Inference Operations
- Memory Governance
- Worker Pool Inspector
- Session Survivability

AI OS:
A unified operations center for AI model execution and monitoring.

How to use:
These are advanced operational tools. Open Runtime Center to monitor GPU usage, worker pools, and memory; open AI OS to oversee model inference across the platform.`
      },
    ]
  },
  // ════════════════════════════════════════════════════════════════════════
  {
    section: "TRUST & DETERMINISM",
    color: "#ef4444",
    items: [
      {
        title: "Why Determinism Matters",
        content: `WHY DETERMINISM MATTERS

In most data platforms, you cannot prove how a result was produced. Aivora is built so that every result is reproducible: run the same operation on the same input, and you get an identical output — every time.

This is the foundation of trust. If a dataset is questioned — by a client, an auditor, or a regulator — you can replay exactly how it was produced.`
      },
      {
        title: "The Trust Layer",
        content: `THE TRUST LAYER

Aivora's strongest differentiator is its forensic-grade trust and verification layer:

- Immutable audit — every critical action is logged insert-only, with SHA-256 checksums, and tamper is detectable.
- Consensus engine — multi-reviewer agreement is resolved deterministically.
- Fraud detection — advisory signals surface suspicious annotation patterns.
- Provenance — full lineage tracking for data and model inference.

Together, these let you not just produce data — but prove it is clean and consistent.`
      },
    ]
  },
];

export default function Documentation() {
  const [active, setActive] = useState(0);
  const [openItem, setOpenItem] = useState<string | null>(null);

  return (
    <div style={{height:"100%",display:"flex",background:"#080c14",
      color:"#e5e7eb",fontFamily:"'JetBrains Mono',monospace",overflow:"hidden"}}>

      {/* Section nav */}
      <div style={{width:240,borderRight:"1px solid #1f2937",background:"#0a0f1a",
        overflowY:"auto",flexShrink:0,padding:"12px 0"}}>
        <div style={{padding:"0 16px 12px",fontSize:11,fontWeight:700,
          color:"#22d3ee",letterSpacing:1}}>
          DOCUMENTATION
        </div>
        {DOCS.map((s, i) => (
          <button key={i} onClick={()=>{setActive(i);setOpenItem(null);}}
            style={{display:"block",width:"100%",textAlign:"left",padding:"9px 16px",
              border:"none",borderLeft:`2px solid ${active===i?s.color:"transparent"}`,
              background:active===i?`${s.color}14`:"transparent",
              color:active===i?s.color:"#9ca3af",cursor:"pointer",
              fontSize:10,fontFamily:"inherit",letterSpacing:0.5}}>
            {s.section}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
        <div style={{fontSize:18,fontWeight:700,color:DOCS[active].color,
          marginBottom:20,letterSpacing:0.5}}>
          {DOCS[active].section}
        </div>
        <div style={{display:"grid",gap:10,maxWidth:820}}>
          {DOCS[active].items.map((item, j) => {
            const key = `${active}-${j}`;
            const isOpen = openItem === key;
            return (
              <div key={j} style={{background:"#0a0f1a",border:"1px solid #1f2937",
                borderRadius:10,overflow:"hidden"}}>
                <button onClick={()=>setOpenItem(isOpen?null:key)}
                  style={{width:"100%",textAlign:"left",padding:"13px 16px",
                    border:"none",background:"transparent",color:"#e5e7eb",
                    cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",
                    display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>{item.title}</span>
                  <span style={{color:DOCS[active].color,fontSize:11}}>{isOpen?"−":"+"}</span>
                </button>
                {isOpen && (
                  <div style={{padding:"0 16px 16px",fontSize:12,lineHeight:1.7,
                    color:"#9ca3af",whiteSpace:"pre-wrap",
                    borderTop:"1px solid #1f2937",paddingTop:14}}>
                    {item.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
