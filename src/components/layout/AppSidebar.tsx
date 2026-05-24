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
  { id:"dashboard",       icon:"⬡",  label:"Dashboard",         group:"production" },
  { id:"qc",              icon:"🎙", label:"QC Workstation",    group:"production" },
  { id:"batch",           icon:"📊", label:"Batch Analyzer",    group:"production" },
  { id:"naming",          icon:"🏷", label:"Smart Naming",      group:"production" },
  { id:"forensic_repair", icon:"🔬", label:"Forensic Repair",   group:"repair"     },
  { id:"audition",        icon:"🎛", label:"Audition Editor",   group:"repair"     },
  { id:"contributors",    icon:"👥", label:"Contributors",      group:"manage"     },
  { id:"monitor",         icon:"📈", label:"Activity Monitor",  group:"manage"     },
  { id:"dsp_validation",  icon:"⚗",  label:"DSP Validation",   group:"system"     },
  { id:"store",           icon:"🛍", label:"Store",             group:"system"     },
];

const GROUP_LABELS = {
  production:"PRODUCTION", repair:"REPAIR",
  manage:"MANAGE", system:"SYSTEM",
};

interface Props { activeTab: AppTab; onTabChange: (t: AppTab) => void; }

export default function AppSidebar({ activeTab, onTabChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tooltip,  setTooltip]  = useState<{label:string;y:number}|null>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const W = isMobile ? 44 : expanded ? 200 : 56;
  const groups = ["production","repair","manage","system","enterprise"] as const;

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
                      opacity:active?1:0.7}}>{item.icon}</span>
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
