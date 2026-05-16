// @ts-nocheck
import React, { useState } from "react";
import { colors } from "../../lib/design/tokens";

export type AppTab =
  | "dashboard" | "qc" | "batch" | "naming"
  | "forensic_repair" | "audition" | "contributors"
  | "monitor" | "dsp_validation" | "store";

interface NavItem {
  id: AppTab; icon: string; label: string;
  group: "production"|"repair"|"manage"|"system";
}

const NAV: NavItem[] = [
  { id:"dashboard",       icon:"dashboard",    label:"Dashboard",         group:"production" },
  { id:"qc",              icon:"qc",           label:"QC Workstation",    group:"production" },
  { id:"batch",           icon:"batch",        label:"Batch Analyzer",    group:"production" },
  { id:"naming",          icon:"naming",       label:"Smart Naming",      group:"production" },
  { id:"forensic_repair", icon:"forensic",     label:"Forensic Repair",   group:"repair"     },
  { id:"audition",        icon:"audition",     label:"Audition Editor",   group:"repair"     },
  { id:"contributors",    icon:"contributors", label:"Contributors",      group:"manage"     },
  { id:"monitor",         icon:"monitor",      label:"Activity Monitor",  group:"manage"     },
  { id:"dsp_validation",  icon:"dsp",          label:"DSP Validation",    group:"system"     },
  { id:"store",           icon:"store",        label:"Store",             group:"system"     },
];

const GROUP_LABELS = {
  production:"PRODUCTION", repair:"REPAIR",
  manage:"MANAGE", system:"SYSTEM",
};

interface Props { activeTab: AppTab; onTabChange: (t: AppTab) => void; }


// ── SVG Icon Map ──────────────────────────────────────────────────────────────
const ICON_PATHS: Record<string, string> = {
  dashboard:    "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  qc:           "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3",
  batch:        "M18 20V10 M12 20V4 M6 20v-6",
  naming:       "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01",
  forensic:     "M11 4a7 7 0 1 0 0 14A7 7 0 0 0 11 4z M21 21l-4.35-4.35 M11 8v3l2 2",
  audition:     "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  contributors: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  monitor:      "M22 12h-4l-3 9L9 3l-3 9H2",
  dsp:          "M9 3H5a2 2 0 0 0-2 2v4 M9 3h10a2 2 0 0 1 2 2v4 M3 9v10a2 2 0 0 0 2 2h4 M21 9v10a2 2 0 0 1-2 2h-4 M9 21h6 M9 3v18",
  store:        "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0",
  proeditor:    "M9 18V5l12-2v13 M6 15.7a3 3 0 1 0 0-5.4 M18 13.7a3 3 0 1 0 0-5.4",
  enhancement:  "M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  pipeline:     "M22 12 A10 10 0 0 1 12 22 A10 10 0 0 1 2 12 A10 10 0 0 1 12 2 M12 8v4l3 3",
  delivery:     "M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3",
  rooms:        "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
};

function SvgIcon({name, size=16, color="currentColor"}: {name:string; size?:number; color?:string}) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.dashboard;
  const parts = d.replace(/([A-Z])/g, " $1").trim().split(/(?=M)/).filter(Boolean);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {parts.map((part,i)=>(
        <path key={i} d={part.trim()}/>
      ))}
    </svg>
  );
}

const groupColors: Record<string,string> = {
  production: "#0EA5E9",
  repair:     "#8B5CF6",
  manage:     "#10B981",
  system:     "#F59E0B",
};

export default function AppSidebar({ activeTab, onTabChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tooltip,  setTooltip]  = useState<{label:string;y:number}|null>(null);
  const W = expanded ? 200 : 56;
  const groups = ["production","repair","manage","system"] as const;

  return (
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
        <div style={{width:28,height:28,borderRadius:8,flexShrink:0,
          background:`linear-gradient(135deg,${colors.accent.sky},${colors.accent.purple})`,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:14,fontWeight:800,color:"#fff"}}>A</div>
        {expanded&&<div style={{fontSize:13,fontWeight:700,
          color:colors.text.primary,letterSpacing:2,whiteSpace:"nowrap"}}>
          AIVORA
        </div>}
      </div>

      {/* Nav */}
      <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:"6px 0"}}>
        {groups.map((group,gi)=>{
          const items=NAV.filter(i=>i.group===group);
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
                  <div key={item.id} onClick={()=>onTabChange(item.id)}
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
                      background:active?`linear-gradient(90deg,${colors.accent.skyDim},transparent)`:"transparent",
                      borderLeft:active?`2px solid ${colors.accent.sky}`:"2px solid transparent",
                      transition:"all 0.15s"}}>
                    <span style={{fontSize:16,width:20,textAlign:"center",flexShrink:0,
                      opacity:active?1:0.7}}>
                      <SvgIcon name={item.icon} size={18}
                        color={active ? groupColors[item.group] ?? "#00cc66" : "#4a6a7a"}/>
                    </span>
                    {expanded&&<span style={{fontSize:11,
                      fontWeight:active?600:400,whiteSpace:"nowrap",
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
        {expanded?"◀ collapse":"▶"}
      </div>

      {/* Tooltip */}
      {tooltip&&!expanded&&(
        <div style={{position:"fixed",left:62,top:tooltip.y-13,
          background:colors.bg.elevated,
          border:`1px solid ${colors.bg.border}`,
          borderRadius:6,padding:"4px 10px",
          fontSize:11,color:colors.text.primary,
          pointerEvents:"none",zIndex:9999,
          whiteSpace:"nowrap",boxShadow:"0 4px 12px #00000044"}}>
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
