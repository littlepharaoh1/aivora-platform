/**
 * AIVORAShowcase.tsx — Cinematic Visual Capabilities Showcase
 * Multimodal Intelligence Data for Frontier AI
 */

import React, { useState, useEffect, useRef } from "react";

const TABS = [
  {
    id:    "audio",
    icon:  "🔊",
    label: "Audio Engine",
    color: "#a855f7",
    glow:  "rgba(168,85,247,0.15)",
    angle: 90,
    title: "Forensic Voice Provenance Engine",
    subtitle: "Acoustic Traceability Layer",
    description: "Pure sensory datasets engineered for sub-millisecond voice activity detection, deep noise cancellation, and forensic naturalness assessment to train trusted ASR and emotional reasoning agents.",
    tags: ["Arabic Dialects", "Emotion Matrix", "Noise-Cancelled", "RT60 Calibrated", "32-bit Float"],
    metric: { value:"13", label:"DSP Phases" },
  },
  {
    id:    "video",
    icon:  "📹",
    label: "Video Engine",
    color: "#f59e0b",
    glow:  "rgba(245,158,11,0.12)",
    angle: 162,
    title: "Surveillance & Temporal Behavior Feeds",
    subtitle: "Multi-Object Temporal Intelligence",
    description: "Data engineered for high-fidelity multi-object tracking, action recognition, and temporal behavior maps for advanced CCTV, autonomous mobility, and embodied AI models.",
    tags: ["Frame-Level Labels", "Object Tracks", "3dp Timestamps", "120 Frames/seq"],
    metric: { value:"120", label:"Max Frames" },
  },
  {
    id:    "image",
    icon:  "🖼️",
    label: "Image Engine",
    color: "#22d3ee",
    glow:  "rgba(34,211,238,0.12)",
    angle: 234,
    title: "Image Foundation Arrays",
    subtitle: "Forensic-Grade Vision Datasets",
    description: "Data engineered for complex bounding box logic, medical segmentation maps, and algorithmic object detection datasets — with full SHA256 forensic lineage per annotation.",
    tags: ["COCO Format", "YOLO Format", "IoU Validated", "4096px Max", "EXIF-Stripped"],
    metric: { value:"64", label:"Tiles/Image" },
  },
  {
    id:    "transcription",
    icon:  "📝",
    label: "Transcription",
    color: "#3b82f6",
    glow:  "rgba(59,130,246,0.12)",
    angle: 306,
    title: "Deterministic ASR Intelligence",
    subtitle: "Enterprise Speech Dataset Engine",
    description: "Greedy-decoded, temperature-zero ASR pipelines with full RTL/Arabic support, code-switch detection, token alignment, and cryptographic replay guarantees for every transcript.",
    tags: ["RTL/Arabic", "Code-Switch", "Token Aligned", "Greedy Decoder", "Temp=0"],
    metric: { value:"100%", label:"Replay Safe" },
  },
  {
    id:    "annotator",
    icon:  "👥",
    label: "Annotator Suite",
    color: "#22c55e",
    glow:  "rgba(34,197,94,0.12)",
    angle: 18,
    title: "Human + AI Annotation Fabric",
    subtitle: "Enterprise Workforce Orchestration",
    description: "Consensus-driven annotation with deterministic routing, fraud detection heatmaps, reviewer confidence scoring, and append-only forensic evidence chains for every human decision.",
    tags: ["Consensus Engine", "Fraud Intel", "Deterministic Routing", "Evidence Chain"],
    metric: { value:"99%", label:"Accuracy SLA" },
  },
] as const;

type TabId = typeof TABS[number]["id"];

const FORGE_CARDS = [
  {
    icon: "⚡",
    title: "Sensory Ingestion",
    desc: "Unified audio, video, image, and document ingestion with GPU-accelerated preprocessing — deterministic output guaranteed.",
    color: "#a855f7",
  },
  {
    icon: "🚀",
    title: "50× Auto-Prelabeling",
    desc: "ONNX-governed model-assisted annotation accelerators with human-in-the-loop approval gates and advisory-only AI suggestions.",
    color: "#f59e0b",
  },
  {
    icon: "🔒",
    title: "Deterministic Compliance",
    desc: "Append-only SHA256 manifests, cryptographic provenance chains, and full replay-safe audit trails trusted by frontier AI teams.",
    color: "#22c55e",
  },
];

// ── Rotating Dial Component ───────────────────────────────────────────────────

function GlowDial({ angle, color }: { angle: number; color: string }) {
  return (
    <div style={{ position:"relative", width:180, height:180, flexShrink:0 }}>
      {/* Outer ring */}
      <div style={{ position:"absolute", inset:0, borderRadius:"50%",
        border:`1px solid ${color}44`,
        boxShadow:`0 0 40px ${color}22, inset 0 0 40px ${color}11`,
        transition:"all 0.6s ease" }} />
      {/* Mid ring */}
      <div style={{ position:"absolute", inset:16, borderRadius:"50%",
        border:`1px solid ${color}33`,
        animation:"spin 12s linear infinite" }} />
      {/* Inner glow */}
      <div style={{ position:"absolute", inset:32, borderRadius:"50%",
        background:`radial-gradient(circle, ${color}22 0%, transparent 70%)`,
        transition:"all 0.6s ease" }} />
      {/* Center mark */}
      <div style={{ position:"absolute", inset:0, display:"flex",
        alignItems:"center", justifyContent:"center" }}>
        <div style={{ width:12, height:12, borderRadius:"50%",
          background:color, boxShadow:`0 0 16px ${color}` }} />
      </div>
      {/* Needle */}
      <div style={{ position:"absolute", inset:0, borderRadius:"50%",
        transform:`rotate(${angle}deg)`, transition:"transform 0.8s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ position:"absolute", top:"8%", left:"50%",
          transform:"translateX(-50%)",
          width:3, height:"42%", background:`linear-gradient(to bottom, ${color}, transparent)`,
          borderRadius:4, boxShadow:`0 0 8px ${color}` }} />
      </div>
      {/* Tick marks */}
      {Array.from({length:12}).map((_,i) => (
        <div key={i} style={{ position:"absolute", inset:0,
          transform:`rotate(${i*30}deg)` }}>
          <div style={{ position:"absolute", top:4, left:"50%",
            transform:"translateX(-50%)",
            width:1, height:8,
            background: i%3===0 ? `${color}88` : `${color}33` }} />
        </div>
      ))}
      <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main Showcase ─────────────────────────────────────────────────────────────

export default function AIVORAShowcase({ onEnter }: { onEnter?: () => void }) {
  const [activeId, setActiveId] = useState<TabId>("audio");
  const [visible,  setVisible]  = useState(false);
  const [textKey,  setTextKey]  = useState(0);

  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);

  const active = TABS.find(t => t.id === activeId)!;

  const handleTab = (id: TabId) => {
    setActiveId(id);
    setTextKey(k => k + 1);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#050506",
      display:"flex", flexDirection:"column", alignItems:"center",
      position:"relative", overflow:"hidden",
      fontFamily:"'JetBrains Mono', 'Courier New', monospace" }}>

      {/* Grid background */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none",
        backgroundImage:`
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
        backgroundSize:"48px 48px",
        transition:"all 1s ease",
      }} />

      {/* Dynamic background glow */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none",
        background:`radial-gradient(ellipse 80% 60% at 50% 40%, ${active.glow} 0%, transparent 70%)`,
        transition:"background 0.8s ease" }} />

      {/* Content */}
      <div style={{ position:"relative", zIndex:1, width:"100%",
        maxWidth:1100, padding:"48px 24px", display:"flex",
        flexDirection:"column", alignItems:"center", gap:48 }}>

        {/* Hero */}
        <div style={{ textAlign:"center",
          opacity:visible?1:0, transform:visible?"none":"translateY(20px)",
          transition:"all 0.8s ease" }}>
          <div style={{ fontSize:10, letterSpacing:4, color:"#4b5563",
            marginBottom:16 }}>
            AIVORA PLATFORM · ENTERPRISE AI INFRASTRUCTURE
          </div>
          <h1 style={{ margin:0, fontSize:"clamp(24px,4vw,48px)",
            fontWeight:900, letterSpacing:-1, lineHeight:1.1,
            color:"#f9fafb" }}>
            Multimodal Intelligence Data
            <br />
            <span style={{ color:active.color, transition:"color 0.6s ease",
              textShadow:`0 0 40px ${active.color}66` }}>
              for Frontier AI
            </span>
          </h1>
          <p style={{ marginTop:16, fontSize:12, color:"#6b7280",
            maxWidth:500, lineHeight:1.6 }}>
            Deterministic, forensic-grade AI datasets across audio, video,
            image, and transcription — with full cryptographic provenance.
          </p>
        </div>

        {/* Tab switcher */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap",
          justifyContent:"center",
          opacity:visible?1:0, transition:"opacity 0.8s ease 0.2s" }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => handleTab(tab.id)}
              style={{ padding:"8px 16px", borderRadius:8, cursor:"pointer",
                fontSize:11, fontWeight:600, letterSpacing:0.5,
                border:`1px solid ${activeId===tab.id ? tab.color : "#1f2937"}`,
                background:activeId===tab.id ? `${tab.color}18` : "transparent",
                color:activeId===tab.id ? tab.color : "#6b7280",
                boxShadow:activeId===tab.id
                  ? `0 0 20px ${tab.color}33, inset 0 0 20px ${tab.color}11`
                  : "none",
                transition:"all 0.3s ease",
                display:"flex", alignItems:"center", gap:6 }}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Main hub */}
        <div style={{ width:"100%",
          background:"rgba(255,255,255,0.02)",
          border:`1px solid ${active.color}33`,
          borderRadius:16, padding:"32px",
          boxShadow:`0 0 60px ${active.glow}`,
          transition:"border-color 0.6s ease, box-shadow 0.6s ease",
          display:"flex", gap:32, alignItems:"center",
          flexWrap:"wrap", justifyContent:"center" }}>

          {/* Dial */}
          <GlowDial angle={active.angle} color={active.color} />

          {/* Content */}
          <div key={textKey} style={{ flex:1, minWidth:280,
            animation:"fadeIn 0.4s ease" }}>
            <div style={{ fontSize:9, color:active.color,
              letterSpacing:3, marginBottom:8, transition:"color 0.6s" }}>
              {active.subtitle.toUpperCase()}
            </div>
            <h2 style={{ margin:"0 0 12px", fontSize:"clamp(18px,2.5vw,28px)",
              fontWeight:800, color:"#f9fafb", lineHeight:1.2 }}>
              {active.title}
            </h2>
            <p style={{ margin:"0 0 20px", fontSize:13, color:"#9ca3af",
              lineHeight:1.7, maxWidth:480 }}>
              {active.description}
            </p>
            {/* Tags */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {active.tags.map(tag => (
                <span key={tag} style={{ padding:"3px 10px",
                  borderRadius:20, fontSize:9, letterSpacing:0.5,
                  border:`1px solid ${active.color}44`,
                  color:active.color, background:`${active.color}11` }}>
                  # {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Metric */}
          <div style={{ textAlign:"center", minWidth:100 }}>
            <div style={{ fontSize:48, fontWeight:900,
              color:active.color,
              textShadow:`0 0 30px ${active.color}`,
              transition:"color 0.6s, text-shadow 0.6s",
              lineHeight:1 }}>
              {active.metric.value}
            </div>
            <div style={{ fontSize:9, color:"#4b5563",
              letterSpacing:2, marginTop:6 }}>
              {active.metric.label.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Forge cards */}
        <div style={{ width:"100%", display:"grid",
          gridTemplateColumns:"repeat(auto-fit, minmax(280px,1fr))",
          gap:16,
          opacity:visible?1:0, transition:"opacity 0.8s ease 0.4s" }}>
          {FORGE_CARDS.map(card => (
            <div key={card.title} style={{ background:"rgba(255,255,255,0.02)",
              border:`1px solid ${card.color}22`,
              borderRadius:12, padding:"24px",
              transition:"border-color 0.3s, box-shadow 0.3s" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = `${card.color}66`;
                (e.currentTarget as HTMLElement).style.boxShadow   = `0 0 30px ${card.color}22`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = `${card.color}22`;
                (e.currentTarget as HTMLElement).style.boxShadow   = "none";
              }}>
              <div style={{ fontSize:28, marginBottom:12 }}>{card.icon}</div>
              <div style={{ fontSize:13, fontWeight:700, color:card.color,
                marginBottom:8 }}>{card.title}</div>
              <div style={{ fontSize:11, color:"#6b7280",
                lineHeight:1.6 }}>{card.desc}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        {onEnter && (
          <button onClick={onEnter}
            style={{ padding:"14px 40px", borderRadius:10,
              fontSize:13, fontWeight:700, letterSpacing:1,
              background:`linear-gradient(135deg, ${active.color}33, transparent)`,
              border:`1px solid ${active.color}`,
              color:active.color,
              boxShadow:`0 0 30px ${active.color}44`,
              cursor:"pointer", transition:"all 0.3s ease",
              opacity:visible?1:0, transform:visible?"none":"translateY(10px)" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = `${active.color}22`;
              (e.currentTarget as HTMLElement).style.boxShadow  = `0 0 50px ${active.color}66`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg, ${active.color}33, transparent)`;
              (e.currentTarget as HTMLElement).style.boxShadow  = `0 0 30px ${active.color}44`;
            }}>
            ENTER PLATFORM →
          </button>
        )}

        {/* Footer */}
        <div style={{ fontSize:9, color:"#374151", letterSpacing:2,
          textAlign:"center" }}>
          AIVORA · DETERMINISTIC · FORENSIC-GRADE · BROWSER-NATIVE
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  );
}
