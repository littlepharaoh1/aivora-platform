// @ts-nocheck
/**
 * App.tsx — Aivora Platform v2.0
 * Unified — GPT components + Custom components + New Design System + Global DSP Engines
 */
import React, { useEffect, useState } from "react";
import NavIcon, { GROUP_COLORS } from "./components/ui/NavIcon";
import LoginPage from "./components/LoginPage";
import AivoraAudioBench from "./components/AivoraAudioBench";
import ActivityMonitor from "./components/ActivityMonitor";
import Documentation from "./components/Documentation";
import ObservabilityDashboard from "./components/ObservabilityDashboard";
import Contributors from "./components/Contributors";
import ConversationRooms from "./components/ConversationRooms";
import { supabase } from "./lib/supabase";
// useRuntimeState + useQASummary: lazy-required in Dashboard only
import { ErrorBoundary }   from "./components/ErrorBoundary";

import React, { Suspense } from "react";
import "./styles.css";

// Layout
import AppSidebar from "./components/layout/AppSidebar";
import AppTopBar   from "./components/layout/AppTopBar";
import { colors }  from "./lib/design/tokens";

// Auth
import AuthGate        from "./components/AuthGate";
import ForensicIntelPanel from "./components/ForensicIntelPanel";
import QCWorkstationV2    from "./components/qc/QCWorkstationV2";
import { useAuth }     from "./lib/auth/AuthContext";
import UserAvatar      from "./components/UserAvatar";
import NetworkStatus   from "./components/NetworkStatus";
import GlobalAudioPlayer from "./components/GlobalAudioPlayer";

// Store
import { AivoraProvider, useAivora } from "./lib/store/AivoraContext";
import { GlobalAudioProvider }       from "./lib/store/GlobalAudioContext";

// Tracking
import { trackEvent } from "./lib/tracking/activityTracker";

// Components — Production
import AudioQualityAnalyzer  from "./components/AudioQualityAnalyzer";
import BatchAnalyzer          from "./components/BatchAnalyzer";
import SmartNamingSequencer   from "./components/SmartNamingSequencer";
import AudioEnhancementLab    from "./components/AudioEnhancementLab";
import AudioPipeline          from "./components/AudioPipeline";

// Components — Global DSP Deployments (Aivora Core v2.5)
import DSPManagementDashboard from "./components/dashboard/DSPManagementDashboard";
import AudioAnnotationWorkspace from "./components/workspace/AudioAnnotationWorkspace";

// Components — Repair
import ForensicSilenceRepair      from "./components/ForensicSilenceRepair";
import AivoraAuditionWorkstation  from "./components/AivoraAuditionWorkstation";
import ProfessionalAudioEditor     from "./components/ProfessionalAudioEditor";

// Components — Manage
import DspValidationDashboard from "./components/DspValidationDashboard";
import StorePanel           from "./components/StorePanel";
// Enterprise modules — lazy loaded to prevent module-init crashes
const RuntimeControlCenter          = React.lazy(() => import("./runtime-ui/RuntimeControlCenter"));
const AnalyticsDashboard            = React.lazy(() => import("./analytics-ui/AnalyticsDashboard"));
const SpeechIntelligenceWorkstation = React.lazy(() => import("./speech-ui/SpeechIntelligenceWorkstation"));
const DatasetFactoryWorkstation     = React.lazy(() => import("./dataset-ui/DatasetFactoryWorkstation"));
const QAIntelligenceWorkstation     = React.lazy(() => import("./qa-ui/QAIntelligenceWorkstation"));
const MultimodalWorkstation         = React.lazy(() => import("./multimodal-ui/MultimodalWorkstation"));
const AIOperationsCenter            = React.lazy(() => import("./os-ui/AIOperationsCenter"));
const ImageAnnotationWorkstation    = React.lazy(() => import("./annotation/ImageAnnotationWorkstation"));
const VideoAnnotationWorkstation    = React.lazy(() => import("./annotation/VideoAnnotationWorkstation"));

// ── Tab Type ──────────────────────────────────────────────────────────────────

type Tab =
  | "dashboard"
  | "audio_workspace"
  | "qc"
  | "batch"
  | "naming"
  | "enhancement"
  | "pipeline"
  | "contributors"
  | "monitor"
  | "dsp_management"
  | "dsp_validation"
  | "store"
  | "proeditor"
  | "audiobench"
  | "documentation"
  | "conversations"
  | "observability"
  | "runtime_center"
  | "analytics"
  | "speech"
  | "dataset_factory"
  | "qa_intel"
  | "multimodal"
  | "ai_os"
  | "annotation"
  | "video_annotation";

// ── Tab Meta ──────────────────────────────────────────────────────────────────

const TAB_META: Record<Tab,{title:string;subtitle:string}> = {
  dashboard:       { title:"Dashboard",               subtitle:"AIVORA PLATFORM OVERVIEW" },
  audio_workspace: { title:"Audio Workspace",         subtitle:"TASK-LINKED ANNOTATION & FILTERING WORKSPACE" },
  qc:              { title:"QC Workstation",          subtitle:"AUDIO QUALITY CONTROL" },
  batch:           { title:"Batch Analyzer",          subtitle:"MULTI-FILE QC PROCESSING" },
  naming:          { title:"Smart Naming",            subtitle:"SMART SEQUENCER S0001–S0200" },
  enhancement:     { title:"Enhancement Lab",         subtitle:"AUDIO REPAIR & ENHANCEMENT" },
  pipeline:        { title:"Audio Pipeline",          subtitle:"END-TO-END PROCESSING" },
  contributors:    { title:"Contributors",            subtitle:"TEAM MANAGEMENT" },
  monitor:         { title:"Activity Monitor",        subtitle:"REAL-TIME TRACKING" },
  dsp_management:  { title:"DSP Management",         subtitle:"GLOBAL HARDWARE OPTIMIZATION & DE-NOISE PARAMETERS" },
  dsp_validation:  { title:"DSP Validation",          subtitle:"ACCURACY TESTING SUITE" },
  store:           { title:"Aivora Store",            subtitle:"RESOURCES & TOOLS" },
  proeditor:       { title:"Professional Editor",      subtitle:"ADOBE-STYLE FULL SCREEN EDITOR" },
  audiobench:      { title:"Audio Bench",               subtitle:"VERIFIER-BACKED FORENSIC BENCHMARK" },
  documentation:   { title:"Documentation",             subtitle:"PLATFORM REFERENCE & GUIDES" },
  conversations:   { title:"Conversation Rooms",         subtitle:"DUAL-TRACK PODCAST MIXER" },
  observability:   { title:"Observability",              subtitle:"DSP RUNTIME TELEMETRY" },
  runtime_center:  { title:"Runtime Center",            subtitle:"GPU · MEMORY · WORKERS · SCHEDULER" },
  analytics:       { title:"Analytics Dashboard",       subtitle:"ENTERPRISE TELEMETRY & MATERIALIZED VIEWS" },
  speech:          { title:"Speech Intelligence",       subtitle:"DETERMINISTIC ASR · RTL · ARABIC" },
  dataset_factory: { title:"Dataset Factory",           subtitle:"ENTERPRISE DATASET PRODUCTION SYSTEM" },
  qa_intel:        { title:"QA Intelligence",           subtitle:"WORKFORCE · CONSENSUS · FRAUD INTEL" },
  multimodal:      { title:"Multimodal Intelligence",   subtitle:"IMAGE · VIDEO · OCR · VISION QA" },
  ai_os:           { title:"AI Operating System",       subtitle:"UNIFIED ENTERPRISE AI INFRASTRUCTURE" },
  annotation:      { title:"Image Annotation",          subtitle:"PRODUCTION ANNOTATION WORKSTATION" },
  video_annotation:{ title:"Video Annotation",          subtitle:"FRAME-BY-FRAME VIDEO LABELING TIMELINE" },
};

// ── Sidebar Nav Items ─────────────────────────────────────────────────────────

const NAV_ITEMS = [
  // Production
  { id:"dashboard",       icon:"dashboard",    label:"Dashboard",          group:"production" },
  { id:"audio_workspace", icon:"qc",           label:"Audio Workspace",     group:"production" },
  { id:"qc",              icon:"qc",           label:"QC Workstation",      group:"production" },
  { id:"batch",           icon:"batch",        label:"Batch Analyzer",      group:"production" },
  { id:"naming",          icon:"naming",       label:"Smart Naming",        group:"production" },
  { id:"enhancement",     icon:"enhancement",  label:"Enhancement Lab",     group:"production" },
  { id:"pipeline",        icon:"pipeline",     label:"Audio Pipeline",      group:"production" },
  { id:"conversations",   icon:"rooms",        label:"Conv. Rooms",         group:"production" },
  
  // Repair
  { id:"proeditor",       icon:"proeditor",    label:"Pro Editor",          group:"repair"     },
  
  // Manage
  { id:"contributors",    icon:"contributors", label:"Contributors",        group:"manage"     },
  { id:"monitor",         icon:"monitor",      label:"Activity Monitor",    group:"manage"     },
  
  // System Controls
  { id:"dsp_management",  icon:"dsp",          label:"DSP Management",      group:"system"     },
  { id:"dsp_validation",  icon:"dsp",          label:"DSP Validation",      group:"system"     },
  { id:"audiobench",      icon:"dsp",          label:"Audio Bench",         group:"system"     },
  { id:"observability",   icon:"dsp",          label:"Observability",       group:"system"     },
  { id:"store",           icon:"store",        label:"Store",               group:"system"     },
  { id:"documentation",   icon:"info",         label:"Documentation",       group:"system"     },
  { id:"ai_os",           icon:"dsp",          label:"AI OS",               group:"enterprise" },
  { id:"runtime_center",  icon:"dsp",          label:"Runtime Center",      group:"enterprise" },
  { id:"analytics",       icon:"dsp",          label:"Analytics",           group:"enterprise" },
  { id:"speech",          icon:"dsp",          label:"Speech Intel",        group:"enterprise" },
  { id:"dataset_factory", icon:"dsp",          label:"Dataset Factory",     group:"enterprise" },
  { id:"qa_intel",        icon:"qc",           label:"QA Intelligence",     group:"enterprise" },
  { id:"multimodal",      icon:"dsp",          label:"Multimodal Intel",    group:"enterprise" },
  { id:"annotation",     icon:"qc",           label:"Image Annotator",     group:"enterprise" },
  { id:"video_annotation",icon:"qc",          label:"Video Annotator",     group:"enterprise" },
];

const GROUP_LABELS: Record<string,string> = {
  production:"PRODUCTION", repair:"REPAIR",
  manage:"MANAGE", system:"SYSTEM", enterprise:"ENTERPRISE",
};

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ activeTab, onTabChange }:{ activeTab:Tab; onTabChange:(t:Tab)=>void }){
  const [expanded,setExpanded]=useState(false);
  const [tooltip,setTooltip]=useState<{label:string;y:number}|null>(null);
  const W=expanded?200:56;
  const groups=["production","repair","manage","system","enterprise"] as const;

  return(
    <div style={{width:W,minWidth:W,height:"100%",
      background:colors.bg.surface,
      borderRight:`1px solid ${colors.bg.border}`,
      display:"flex",flexDirection:"column",
      transition:"width 0.2s ease",overflow:"hidden",
      flexShrink:0,position:"relative",zIndex:10}}>

      {/* Logo */}
      <div style={{height:52,display:"flex",alignItems:"center",
        padding:"0 14px",borderBottom:`1px solid ${colors.bg.border}`,
        gap:10,flexShrink:0}}>
        <img src="/aivora-logo.svg" alt="Aivora"
          style={{width:36,height:36,flexShrink:0,objectFit:"contain"}}/>
        {expanded&&<div style={{fontSize:13,fontWeight:700,
          color:colors.text.primary,letterSpacing:2,whiteSpace:"nowrap"}}>AIVORA</div>}
      </div>

      {/* Nav */}
      <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:"6px 0"}}>
        {groups.map((group,gi)=>{
          const items=NAV_ITEMS.filter(i=>i.group===group);
          return(
            <div key={group}>
              {expanded&&<div style={{fontSize:7,color:colors.text.muted,
                letterSpacing:2,padding:gi===0?"8px 14px 4px":"14px 14px 4px",
                fontFamily:"monospace"}}>{GROUP_LABELS[group]}</div>}
              {!expanded&&gi>0&&<div style={{height:1,
                background:colors.bg.border,margin:"6px 10px"}}/>}
              {items.map(item=>{
                const active=activeTab===item.id;
                return(
                  <div key={item.id}
                    onClick={()=>onTabChange(item.id as Tab)}
                    onMouseEnter={e=>{
                      if(!expanded){
                        const r=(e.currentTarget as HTMLElement).getBoundingClientRect();
                        setTooltip({label:item.label,y:r.top+r.height/2});
                      }
                    }}
                    onMouseLeave={()=>setTooltip(null)}
                    style={{display:"flex",alignItems:"center",gap:10,
                      padding:expanded?"7px 14px":"7px 0",
                      justifyContent:expanded?"flex-start":"center",
                      margin:"1px 5px",borderRadius:8,cursor:"pointer",
                      background:active
                        ?`linear-gradient(90deg,${colors.accent.skyDim},transparent)`
                        :"transparent",
                      borderLeft:active
                        ?`2px solid ${colors.accent.sky}`
                        :"2px solid transparent",
                      transition:"all 0.15s"}}>
                    <span style={{width:20,display:"flex",alignItems:"center",
                      justifyContent:"center",flexShrink:0}}>
                      <NavIcon name={item.icon} size={18}
                        color={active ? GROUP_COLORS[item.group]??"#0EA5E9" : "#4a6a7a"}/>
                    </span>
                    {expanded&&<span style={{fontSize:11,fontWeight:active?600:400,
                      whiteSpace:"nowrap",
                      color:active?colors.text.primary:colors.text.secondary}}>
                      {item.label}
                    </span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Toggle */}
      <div onClick={()=>setExpanded(v=>!v)}
        style={{height:38,display:"flex",alignItems:"center",
          justifyContent:expanded?"flex-end":"center",
          padding:expanded?"0 12px":"0",
          borderTop:`1px solid ${colors.bg.border}`,
          cursor:"pointer",color:colors.text.muted,
          fontSize:11,flexShrink:0}}>
        {expanded?"◀":"▶"}
      </div>

      {/* Tooltip */}
      {tooltip&&!expanded&&(
        <div style={{position:"fixed",left:62,top:tooltip.y-13,
          background:colors.bg.elevated,
          border:`1px solid ${colors.bg.border}`,
          borderRadius:6,padding:"4px 10px",
          fontSize:11,color:colors.text.primary,
          pointerEvents:"none",zIndex:9999,
          whiteSpace:"nowrap",
          boxShadow:"0 4px 12px #00000044"}}>
          {tooltip.label}
        </div>
      )}
    </div>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────

function TopBar({ title, subtitle }:{ title:string; subtitle:string }){
  const { user, signOut } = useAuth();
  return(
    <div style={{height:52,flexShrink:0,
      background:colors.bg.surface,
      borderBottom:`1px solid ${colors.bg.border}`,
      display:"flex",alignItems:"center",
      padding:"0 20px",gap:12}}>
      <div>
        <div style={{fontSize:13,fontWeight:700,
          color:colors.text.primary,letterSpacing:0.5}}>{title}</div>
        <div style={{fontSize:9,color:colors.text.muted,letterSpacing:1}}>{subtitle}</div>
      </div>
      <div style={{flex:1}}/>
      <NetworkStatus/>
      <div style={{display:"flex",alignItems:"center",gap:4,
        padding:"3px 10px",borderRadius:20,
        background:colors.accent.greenDim,
        border:`1px solid ${colors.accent.green}44`}}>
        <div style={{width:6,height:6,borderRadius:"50%",
          background:colors.accent.green}}/>
        <span style={{fontSize:9,color:colors.accent.green,fontWeight:600}}>ONLINE</span>
      </div>
      {user&&<>
        <div style={{fontSize:9,color:colors.text.secondary,
          maxWidth:130,overflow:"hidden",
          textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
        <UserAvatar/>
      </>}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ onNavigate }:{ onNavigate:(t:Tab)=>void }){
  const { user }  = useAuth();
  // Safe runtime state — defaults if runtime not available
  const [snap, setSnap] = React.useState({
    session_health:1, gpu_backend:"CPU", gpu_context_lost:false,
    active_workers:0, max_workers:4, worker_pressure:0,
    heap_used_mb:0, memory_pressure:0, gpu_pressure:0,
    sab_available:false, execution_mode:"DESKTOP_BALANCED",
  });
  const [summary, setSummary] = React.useState<{pending_tasks:number;total_reviews:number}|null>(null);

  React.useEffect(() => {
    // Lazy-load runtime hooks to prevent module init crash
    let cancelled = false;
    import("./runtime-ui/hooks/useRuntimeState").then(m => {
      if(!cancelled) {
        try {
          const s = m.buildSnapshot ? m.buildSnapshot() : null;
          if(s) setSnap(s as any);
        } catch { /* silent — runtime may not be ready */ }
      }
    }).catch(() => { /* silent */ });
    import("./qa-ui/hooks/useQAIntelligence").then(async m => {
      if(!cancelled && m.supabase) {
        // Don't call hooks outside React — just show defaults
      }
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  // Enterprise quick-access cards — real tabs
  const productionCards = [
    { icon:"qc",          label:"QC Workstation",   sub:"Analyze audio quality",       tab:"qc"             as Tab, color:colors.accent.cyan   },
    { icon:"batch",       label:"Batch Analyzer",   sub:"Process 200+ files",          tab:"batch"          as Tab, color:colors.accent.purple },
    { icon:"pipeline",    label:"Audio Pipeline",   sub:"End-to-end processing",       tab:"pipeline"       as Tab, color:colors.accent.green  },
    { icon:"proeditor",   label:"Pro Editor",       sub:"Professional workstation",    tab:"proeditor"      as Tab, color:colors.accent.sky    },
  ];

  const enterpriseCards = [
    { icon:"dsp",  label:"AI OS",           sub:"Unified operations center",   tab:"ai_os"          as Tab, color:"#22d3ee" },
    { icon:"dsp",  label:"Runtime Center",  sub:"GPU · Memory · Workers",      tab:"runtime_center" as Tab, color:"#3b82f6" },
    { icon:"dsp",  label:"Analytics",       sub:"6 materialized views",        tab:"analytics"      as Tab, color:"#8b5cf6" },
    { icon:"dsp",  label:"Speech Intel",    sub:"Deterministic ASR",           tab:"speech"         as Tab, color:"#22c55e" },
    { icon:"dsp",  label:"Dataset Factory", sub:"Enterprise exports",          tab:"dataset_factory"as Tab, color:"#f59e0b" },
    { icon:"qc",   label:"QA Intelligence", sub:"Workforce + fraud intel",     tab:"qa_intel"       as Tab, color:"#f97316" },
    { icon:"dsp",  label:"Multimodal",      sub:"Image · Video · OCR",         tab:"multimodal"     as Tab, color:"#ec4899" },
  ];

  const healthColor = snap.session_health > 0.7 ? "#22c55e"
                    : snap.session_health > 0.4 ? "#f59e0b" : "#ef4444";

  return(
    <div style={{ padding:16, fontFamily:"'JetBrains Mono', monospace" }}>

      {/* OS Status Strip — real telemetry */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
        gap:8, marginBottom:16 }}>
        {[
          { label:"Session Health",
            value:`${Math.round(snap.session_health*100)}%`,
            color:healthColor },
          { label:"GPU Backend",
            value:snap.gpu_backend,
            color:snap.gpu_context_lost?"#ef4444":"#22c55e" },
          { label:"Workers",
            value:`${snap.active_workers}/${snap.max_workers}`,
            color:"#22d3ee" },
          { label:"Pending Reviews",
            value:String(summary?.pending_tasks ?? "—"),
            color:(summary?.pending_tasks ?? 0) > 50 ? "#f59e0b" : "#9ca3af" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background:"#0d1117",
            border:"1px solid #1f2937", borderRadius:8,
            padding:"10px 14px" }}>
            <div style={{ fontSize:18, fontWeight:700, color }}>{value}</div>
            <div style={{ fontSize:9, color:"#4b5563" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Welcome */}
      <div style={{ background:`linear-gradient(135deg,${colors.bg.elevated},${colors.bg.surface})`,
        border:`1px solid ${colors.bg.border}`,
        borderRadius:12, padding:"14px 18px", marginBottom:16,
        display:"flex", alignItems:"center", gap:12 }}>
        <img src="/aivora-logo.svg" alt="Aivora"
          style={{ width:40, height:40, flexShrink:0, objectFit:"contain" }} />
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:colors.text.primary }}>
            AIVORA AI OS
          </div>
          <div style={{ fontSize:10, color:colors.text.secondary, marginTop:1 }}>
            {user?.email} · Enterprise AI Infrastructure
          </div>
        </div>
        <div style={{ marginLeft:"auto", textAlign:"right" }}>
          <div style={{ fontSize:9, color:"#4b5563", letterSpacing:1 }}>TIERS</div>
          <div style={{ fontSize:13, color:"#22d3ee", fontWeight:700 }}>0–15</div>
        </div>
      </div>

      {/* Enterprise Surfaces */}
      <div style={{ fontSize:9, color:"#4b5563", letterSpacing:2, marginBottom:8 }}>
        ENTERPRISE INTELLIGENCE
      </div>
      <div style={{ display:"grid",
        gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:8,
        marginBottom:16 }}>
        {enterpriseCards.map(card => (
          <div key={card.tab} onClick={() => onNavigate(card.tab)}
            style={{ background:"#0d1117",
              border:`1px solid #1f2937`,
              borderTop:`2px solid ${card.color}`,
              borderRadius:10, padding:"12px 14px", cursor:"pointer" }}>
            <div style={{ fontSize:11, fontWeight:700,
              color:card.color, marginBottom:2 }}>{card.label}</div>
            <div style={{ fontSize:9, color:"#4b5563" }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Production Workflows */}
      <div style={{ fontSize:9, color:"#4b5563", letterSpacing:2, marginBottom:8 }}>
        PRODUCTION WORKFLOWS
      </div>
      <div style={{ display:"grid",
        gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:8 }}>
        {productionCards.map(card => (
          <div key={card.tab} onClick={() => onNavigate(card.tab)}
            style={{ background:colors.bg.surface,
              border:`1px solid ${colors.bg.border}`,
              borderTop:`2px solid ${card.color}`,
              borderRadius:10, padding:"12px 14px", cursor:"pointer" }}>
            <div style={{ fontSize:11, fontWeight:600,
              color:colors.text.primary, marginBottom:2 }}>{card.label}</div>
            <div style={{ fontSize:9, color:colors.text.secondary }}>{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Coming Soon ───────────────────────────────────────────────────────────────

function ComingSoon({ title }:{ title:string }){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      height:"100%",flexDirection:"column",gap:12,opacity:0.4}}>
      <div style={{fontSize:40}}>🚧</div>
      <div style={{fontSize:14,color:colors.text.secondary}}>{title}</div>
      <div style={{fontSize:11,color:colors.text.muted}}>Coming soon</div>
    </div>
  );
}

// ── App Content ───────────────────────────────────────────────────────────────

function AppContent(){
  const [tab,setTab]=useState<Tab>("dashboard");

  // Clear Supabase auth params from URL
  useEffect(()=>{
    if(window.location.hash.includes("access_token") ||
       window.location.hash.includes("refresh_token")) {
      window.history.replaceState({},"",window.location.pathname);
      return;
    }
    const url=new URL(window.location.href);
    if(url.searchParams.has("error")){
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      url.searchParams.delete("error_code");
      window.history.replaceState({},"",url.toString());
    }
  },[]);
  const { records, setRecords } = useAivora();
  const meta=TAB_META[tab];

  // Track tab changes
  useEffect(()=>{
    trackEvent("tab_opened",{tab});
  },[tab]);

  // Landing page
  if(!localStorage.getItem('skip_showcase')) {
    window.location.replace('/showcase.html');
    return null;
  }

  // Audition = full screen

  return(
    <div style={{display:"flex",height:"100vh",width:"100vw",
      background:colors.bg.base,overflow:"hidden",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif"}}>

      <Sidebar activeTab={tab} onTabChange={setTab}/>

      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <TopBar title={meta.title} subtitle={meta.subtitle}/>

        <div style={{flex:1,overflow:"auto",background:colors.bg.base}}>
          {tab==="dashboard"       && <Dashboard onNavigate={setTab}/>}
          {tab==="audio_workspace" && <AudioAnnotationWorkspace/>}
          {tab==="qc"              && <QCWorkstationV2/>}
          {tab==="batch"           && <BatchAnalyzer/>}
          {tab==="naming"          && <SmartNamingSequencer/>}
          {tab==="enhancement"     && <AudioEnhancementLab/>}
          {tab==="pipeline"        && <AudioPipeline/>}
          {tab==="dsp_management"  && <DSPManagementDashboard/>}
          {tab==="dsp_validation"  && <DspValidationDashboard/>}
          {tab==="store"           && <StorePanel/>}
          {tab==="contributors"    && <Contributors/>}
          {tab==="monitor"         && <ActivityMonitor/>}
          {tab==="documentation"   && <Documentation/>}
          {tab==="observability"   && <ObservabilityDashboard/>}
          {tab==="runtime_center"  && (
            <ErrorBoundary label="RuntimeCenter">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>Runtime Center loading...</div>}>
                <RuntimeControlCenter/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="analytics"       && (
            <ErrorBoundary label="Analytics">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>Analytics loading...</div>}>
                <AnalyticsDashboard/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="speech"          && (
            <ErrorBoundary label="Speech">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>Speech Intelligence loading...</div>}>
                <SpeechIntelligenceWorkstation/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="dataset_factory" && (
            <ErrorBoundary label="DatasetFactory">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>Dataset Factory loading...</div>}>
                <DatasetFactoryWorkstation/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="qa_intel"        && (
            <ErrorBoundary label="QAIntel">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>QA Intelligence loading...</div>}>
                <QAIntelligenceWorkstation/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="multimodal"      && (
            <ErrorBoundary label="Multimodal">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>Multimodal Intel loading...</div>}>
                <MultimodalWorkstation/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="video_annotation" && (
            <ErrorBoundary label="VideoAnnotation">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontSize:12}}>Loading video annotator...</div>}>
                <VideoAnnotationWorkstation />
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="annotation"      && (
            <ErrorBoundary label="Annotation">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontSize:12}}>Loading annotator...</div>}>
                <ImageAnnotationWorkstation />
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="ai_os"           && (
            <ErrorBoundary label="AIOperations">
              <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:"#22d3ee",fontFamily:"monospace",fontSize:12}}>AI OS loading...</div>}>
                <AIOperationsCenter/>
              </React.Suspense>
            </ErrorBoundary>
          )}
          {tab==="audiobench"      && <AivoraAudioBench/>}
          {tab==="conversations"   && <ConversationRooms/>}
          {tab==="proeditor"       && <ProfessionalAudioEditor/>}
        </div>
      </div>

      <GlobalAudioPlayer/>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App(){
  return(
    <AivoraProvider>
      <GlobalAudioProvider>
        <AuthGate>
          <AppContent/>
        </AuthGate>
      </GlobalAudioProvider>
    </AivoraProvider>
  );
}
