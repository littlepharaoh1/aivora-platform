// @ts-nocheck
/**
 * App.tsx — Aivora Platform v2.0
 * Unified — GPT components + Custom components + New Design System
 */
import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import "./styles.css";

// Layout
import AppSidebar from "./components/layout/AppSidebar";
import AppTopBar   from "./components/layout/AppTopBar";
import { colors }  from "./lib/design/tokens";

// Auth
import AuthGate        from "./components/AuthGate";
import LandingPage     from "./components/LandingPage";
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
import DeliveryReadinessScore from "./components/DeliveryReadinessScore";

// Components — Repair
import ForensicSilenceRepair      from "./components/ForensicSilenceRepair";
import AivoraAuditionWorkstation  from "./components/AivoraAuditionWorkstation";
import ProfessionalAudioEditor     from "./components/ProfessionalAudioEditor";

// Components — Manage
import ActivityMonitor      from "./components/ActivityMonitor";
import DspValidationDashboard from "./components/DspValidationDashboard";
import StorePanel           from "./components/StorePanel";
import ConversationRooms    from "./components/ConversationRooms";

// ── Tab Type ──────────────────────────────────────────────────────────────────

type Tab =
  | "dashboard"
  | "qc"
  | "batch"
  | "naming"
  | "enhancement"
  | "pipeline"
  | "readiness"
  | "forensic_repair"
  | "audition"
  | "contributors"
  | "monitor"
  | "dsp_validation"
  | "store"
  | "rooms"
  | "proeditor";

// ── Tab Meta ──────────────────────────────────────────────────────────────────

const TAB_META: Record<Tab,{title:string;subtitle:string}> = {
  dashboard:      { title:"Dashboard",               subtitle:"AIVORA PLATFORM OVERVIEW" },
  qc:             { title:"QC Workstation",           subtitle:"AUDIO QUALITY CONTROL" },
  batch:          { title:"Batch Analyzer",           subtitle:"MULTI-FILE QC PROCESSING" },
  naming:         { title:"Smart Naming",             subtitle:"GERMAN APPEN SEQUENCER S0001–S0200" },
  enhancement:    { title:"Enhancement Lab",          subtitle:"AUDIO REPAIR & ENHANCEMENT" },
  pipeline:       { title:"Audio Pipeline",           subtitle:"END-TO-END PROCESSING" },
  readiness:      { title:"Delivery Readiness",       subtitle:"QC SCORE & COMPLIANCE" },
  forensic_repair:{ title:"Forensic Silence Repair",  subtitle:"ADOBE-STYLE QA SIMULATION" },
  audition:       { title:"Audition Workstation",     subtitle:"PROFESSIONAL AUDIO EDITOR" },
  contributors:   { title:"Contributors",             subtitle:"TEAM MANAGEMENT" },
  monitor:        { title:"Activity Monitor",         subtitle:"REAL-TIME TRACKING" },
  dsp_validation: { title:"DSP Validation",           subtitle:"ACCURACY TESTING SUITE" },
  store:          { title:"Aivora Store",             subtitle:"RESOURCES & TOOLS" },
  proeditor:      { title:"Professional Editor",       subtitle:"ADOBE-STYLE FULL SCREEN EDITOR" },
  rooms:          { title:"Conversation Rooms",       subtitle:"DUAL SPEAKER STEREO MERGE V8" },
};

// ── Sidebar Nav Items ─────────────────────────────────────────────────────────

const NAV_ITEMS = [
  // Production
  { id:"dashboard",       icon:"dashboard",    label:"Dashboard",          group:"production" },
  { id:"qc",              icon:"qc",           label:"QC Workstation",      group:"production" },
  { id:"batch",           icon:"batch",        label:"Batch Analyzer",      group:"production" },
  { id:"naming",          icon:"naming",       label:"Smart Naming",        group:"production" },
  { id:"enhancement",     icon:"enhancement",  label:"Enhancement Lab",     group:"production" },
  { id:"pipeline",        icon:"pipeline",     label:"Audio Pipeline",      group:"production" },
  { id:"readiness",       icon:"delivery",     label:"Delivery Readiness",  group:"production" },
  // Repair
  { id:"forensic_repair", icon:"forensic",     label:"Forensic Repair",    group:"repair"     },
  { id:"audition",        icon:"audition",     label:"Audition Editor",    group:"repair"     },
  // Manage
  { id:"contributors",    icon:"contributors", label:"Contributors",       group:"manage"     },
  { id:"monitor",         icon:"monitor",      label:"Activity Monitor",   group:"manage"     },
  // System
  { id:"dsp_validation",  icon:"dsp",          label:"DSP Validation",    group:"system"     },
  { id:"store",           icon:"store",        label:"Store",              group:"system"     },
  { id:"proeditor",       icon:"proeditor",    label:"Pro Editor",         group:"repair"     },
  { id:"rooms",           icon:"rooms",        label:"Conversation Rooms", group:"production" },
];

const GROUP_LABELS = {
  production:"PRODUCTION", repair:"REPAIR",
  manage:"MANAGE", system:"SYSTEM",
};

// ── Sidebar ───────────────────────────────────────────────────────────────────


// ── SVG Icons ─────────────────────────────────────────────────────────────────
const ICON_PATHS: Record<string,string> = {
  dashboard:    "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  qc:           "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3",
  batch:        "M18 20V10 M12 20V4 M6 20v-6",
  naming:       "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01",
  forensic:     "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-4.35-4.35 M11 8v3l2 2",
  audition:     "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  contributors: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  monitor:      "M22 12h-4l-3 9L9 3l-3 9H2",
  dsp:          "M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18",
  store:        "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0",
  proeditor:    "M9 18V5l12-2v13 M6 15.7a3 3 0 1 0 0-5.4 M18 13.7a3 3 0 1 0 0-5.4",
  enhancement:  "M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  pipeline:     "M5 12h14 M12 5l7 7-7 7",
  delivery:     "M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3",
  rooms:        "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
};

const CARD_ICONS: Record<string,string> = {
  qc:           "🎙",
  batch:        "📊",
  naming:       "🏷",
  enhancement:  "🔧",
  pipeline:     "⚡",
  delivery:     "✅",
  forensic:     "🔬",
  audition:     "🎛",
  contributors: "👥",
  monitor:      "📈",
  dsp:          "⚗",
  store:        "🛍",
  proeditor:    "🎚",
  dashboard:    "⬡",
  rooms:        "🎙",
};

const GROUP_ICON_COLORS: Record<string,string> = {
  production:"#0EA5E9", repair:"#8B5CF6",
  manage:"#10B981",     system:"#F59E0B",
};

function NavIcon({name, active, group, size=18}: {name:string; active:boolean; group:string; size?:number}) {
  const d = ICON_PATHS[name] ?? "M12 12h.01";
  const color = active ? (GROUP_ICON_COLORS[group] ?? "#0EA5E9") : "#4a6a7a";
  // Split on capital M that starts new subpath
  const parts = d.replace(/([A-Z])/g, ' $1').trim().split(/(?=M)/).filter(Boolean);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {parts.map((part,i)=>(
        <path key={i} d={part.trim()}/>
      ))}
    </svg>
  );
}

function Sidebar({ activeTab, onTabChange }:{ activeTab:Tab; onTabChange:(t:Tab)=>void }){
  const [expanded,setExpanded]=useState(false);
  const [tooltip,setTooltip]=useState<{label:string;y:number}|null>(null);
  const W=expanded?200:56;
  const groups=["production","repair","manage","system"] as const;

  return(
    <div style={{width:W,minWidth:W,height:"100%",
      background:"#000000",
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
                      justifyContent:"center",flexShrink:0,opacity:active?1:0.75}}>
                      {React.createElement(CARD_ICON_MAP[item.icon] ?? Home, {
                        size:18, strokeWidth:1.5,
                        color:active?(GROUP_ICON_COLORS[item.group]??"#0EA5E9"):"#4a6a7a"
                      })}
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
      background:"#000000",
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
  const { user } = useAuth();

  const cards=[
    { icon:"🎙", label:"QC Workstation",    sub:"Analyze audio quality",     tab:"qc"             as Tab, color:colors.accent.sky    },
    { icon:"📊", label:"Batch Analyzer",    sub:"Process 200+ files",        tab:"batch"          as Tab, color:colors.accent.purple },
    { icon:"🏷", label:"Smart Naming",      sub:"German Appen S0001–S0200",  tab:"naming"         as Tab, color:colors.accent.cyan   },
    { icon:"🔧", label:"Enhancement Lab",   sub:"Audio repair & enhancement",tab:"enhancement"    as Tab, color:colors.accent.amber  },
    { icon:"⚡", label:"Audio Pipeline",    sub:"End-to-end processing",     tab:"pipeline"       as Tab, color:colors.accent.green  },
    { icon:"✅", label:"Delivery Readiness",sub:"QC score & compliance",     tab:"readiness"      as Tab, color:colors.accent.green  },
    { icon:"🔬", label:"Forensic Repair",   sub:"Silence reconstruction",    tab:"forensic_repair"as Tab, color:colors.accent.amber  },
    { icon:"🎛", label:"Audition Editor",   sub:"Professional workstation",  tab:"audition"       as Tab, color:colors.accent.sky    },
    { icon:"📈", label:"Activity Monitor",  sub:"Real-time tracking",        tab:"monitor"        as Tab, color:colors.accent.purple },
  ];

  return(
    <div style={{padding:24,animation:"fadeIn 0.3s ease"}}>

      {/* Welcome */}
      <div style={{
        background:`linear-gradient(135deg,${colors.bg.elevated},${colors.bg.surface})`,
        border:`1px solid ${colors.bg.border}`,
        borderRadius:16,padding:"20px 24px",marginBottom:24,
        display:"flex",alignItems:"center",gap:16}}>
        <img src="/aivora-logo.svg" alt="Aivora Logo"
          style={{width:52,height:52,flexShrink:0,objectFit:"contain"}}/>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:colors.text.primary}}>
            Welcome to Aivora
          </div>
          <div style={{fontSize:11,color:colors.text.secondary,marginTop:2}}>
            {user?.email} · AI Audio Data Production Platform
          </div>
        </div>
        <div style={{marginLeft:"auto",textAlign:"right"}}>
          <div style={{fontSize:9,color:colors.text.muted,letterSpacing:1}}>VERSION</div>
          <div style={{fontSize:13,color:colors.accent.sky,fontWeight:700}}>2.0</div>
        </div>
      </div>

      {/* Quick Access */}
      <div style={{fontSize:10,color:colors.text.muted,letterSpacing:2,marginBottom:12}}>
        QUICK ACCESS
      </div>
      <div style={{display:"grid",
        gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {cards.map(card=>(
          <div key={card.tab} onClick={()=>onNavigate(card.tab)}
            style={{background:"#000000",
              border:`1px solid ${colors.bg.border}`,
              borderTop:`2px solid ${card.color}`,
              borderRadius:12,padding:"14px 16px",
              cursor:"pointer",transition:"all 0.15s"}}
            onMouseEnter={e=>{
              const el=e.currentTarget as HTMLElement;
              el.style.background=colors.bg.elevated;
              el.style.transform="translateY(-2px)";
              el.style.boxShadow=`0 4px 16px ${card.color}22`;
            }}
            onMouseLeave={e=>{
              const el=e.currentTarget as HTMLElement;
              el.style.background=colors.bg.surface;
              el.style.transform="translateY(0)";
              el.style.boxShadow="none";
            }}>
            <div style={{width:44,height:44,marginBottom:12,
              display:"flex",alignItems:"center",justifyContent:"center",
              borderRadius:10,background:`${card.color}18`,
              border:`1px solid ${card.color}40`,
              color:card.color}}>
              {CARD_SVG[card.icon] ?? CARD_SVG.dashboard}
            </div>
            <div style={{fontSize:12,fontWeight:600,
              color:colors.text.primary,marginBottom:3}}>{card.label}</div>
            <div style={{fontSize:10,color:colors.text.secondary}}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{fontSize:10,color:colors.text.muted,
        letterSpacing:2,margin:"20px 0 10px"}}>PLATFORM CAPABILITIES</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {[
          ["13","DSP Phases",     colors.accent.sky],
          ["85%+","VAD Accuracy", colors.accent.green],
          ["88%","RT60 Accuracy", colors.accent.purple],
          ["200","Batch Files",   colors.accent.amber],
          ["32-bit","Float WAV",  colors.accent.cyan],
          ["6","Repair Tools",    colors.accent.green],
          ["11","Forensic Files", colors.accent.sky],
        ].map(([v,l,c])=>(
          <div key={l} style={{background:"#000000",
            border:`1px solid ${colors.bg.border}`,
            borderRadius:10,padding:"10px 14px",
            flex:1,minWidth:90,textAlign:"center"}}>
            <div style={{fontSize:16,fontWeight:700,color:c as string}}>{v}</div>
            <div style={{fontSize:8,color:colors.text.muted,marginTop:2}}>{l}</div>
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
  const [showLanding,setShowLanding]=useState(true);
  const [tab,setTab]=useState<Tab>("dashboard");
  const { records, setRecords } = useAivora();
  const meta=TAB_META[tab];

  // Track tab changes
  useEffect(()=>{
    trackEvent("tab_opened",{tab});
  },[tab]);

  // Landing page
  if(showLanding) return <LandingPage onEnter={()=>setShowLanding(false)}/>;

  // Audition = full screen
  if(tab==="audition") return <AivoraAuditionWorkstation/>;

  return(
    <div style={{display:"flex",height:"100vh",width:"100vw",
      background:colors.bg.base,overflow:"hidden",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif"}}>

      <Sidebar activeTab={tab} onTabChange={setTab}/>

      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <TopBar title={meta.title} subtitle={meta.subtitle}/>

        <div style={{flex:1,overflow:"auto",background:colors.bg.base}}>
          {tab==="dashboard"       && <Dashboard onNavigate={setTab}/>}
          {tab==="qc"              && <AudioQualityAnalyzer/>}
          {tab==="batch"           && <BatchAnalyzer/>}
          {tab==="naming"          && <SmartNamingSequencer/>}
          {tab==="enhancement"     && <AudioEnhancementLab/>}
          {tab==="pipeline"        && <AudioPipeline/>}
          {tab==="readiness"       && <DeliveryReadinessScore records={records} setRecords={setRecords}/>}
          {tab==="forensic_repair" && <ForensicSilenceRepair/>}
          {tab==="monitor"         && <ActivityMonitor/>}
          {tab==="dsp_validation"  && <DspValidationDashboard/>}
          {tab==="store"           && <StorePanel/>}
          {tab==="contributors"    && <ComingSoon title="Contributors"/>}
          {tab==="rooms"           && <ConversationRooms/>}
          {tab==="proeditor"      && <ProfessionalAudioEditor/>}
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
