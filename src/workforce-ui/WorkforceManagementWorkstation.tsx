/**
 * WorkforceManagementWorkstation.tsx
 * Aivora Platform — Workforce Management OS
 *
 * Workers · Skill Matrix · Performance · Capacity · Fraud · Analytics
 * Reuses existing reviewer/assignment data. Advisory only (no auto-actions).
 */

import React, { useState } from "react";
import { useWorkforceManagement } from "../lib/workforce/useWorkforceManagement";
import { SKILL_TYPES, SKILL_LABELS } from "../lib/workforce/workforceTypes";
import type { SkillType } from "../lib/workforce/workforceTypes";

type WF = ReturnType<typeof useWorkforceManagement>;

const RISK_COLOR: Record<string,string> = {
  none:"#22c55e", low:"#84cc16", medium:"#f59e0b", high:"#f97316", critical:"#ef4444",
};

function pct(n:number){ return `${(n*100).toFixed(0)}%`; }
function secs(n:number){ return n>=3600 ? `${(n/3600).toFixed(1)}h` : `${(n/60).toFixed(0)}m`; }

// ── Workers View ──────────────────────────────────────────────────────────────

function WorkersView({ wf }: { wf: WF }) {
  if(wf.loading) return <Hint text="Loading workforce…" />;
  if(wf.workers.length === 0) return <Hint text="No workers in system." />;
  return (
    <div style={{padding:16}}>
      <SectionTitle text={`WORKERS · ${wf.workers.length}`} />
      <div style={{display:"grid",gap:6}}>
        {wf.workers.map(w=>{
          const cov = w.skills.filter(s=>s.proficiency>0).length;
          return (
            <div key={w.identity.id} style={card}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:8,height:8,borderRadius:2,flexShrink:0,
                  background:w.identity.is_active?"#22c55e":"#374151"}}/>
                <span style={{fontSize:11,color:"#e5e7eb",flex:1}}>{w.identity.name}</span>
                <span style={{fontSize:9,color:"#6b7280"}}>{w.identity.role??"—"}</span>
              </div>
              <div style={{fontSize:9,color:"#374151",marginTop:4,display:"flex",gap:10,flexWrap:"wrap"}}>
                <span>{w.identity.total_reviews} reviews</span>
                <span>acc {w.identity.accuracy_score!=null?pct(w.identity.accuracy_score):"—"}</span>
                <span>{cov}/6 skills</span>
                <span>{w.capabilities?.availability??"unknown"}</span>
                {(w.capabilities?.languages.length??0)>0 &&
                  <span style={{color:"#22d3ee"}}>{w.capabilities!.languages.join(", ")}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Skills View (matrix) ──────────────────────────────────────────────────────

function SkillsView({ wf }: { wf: WF }) {
  if(wf.workers.length === 0) return <Hint text="No workers to show skills for." />;
  return (
    <div style={{padding:16,overflowX:"auto"}}>
      <SectionTitle text="SKILL MATRIX" />
      <table style={{borderCollapse:"collapse",fontSize:9,width:"100%"}}>
        <thead>
          <tr>
            <th style={th}>Worker</th>
            {SKILL_TYPES.map(t=><th key={t} style={th}>{SKILL_LABELS[t]}</th>)}
          </tr>
        </thead>
        <tbody>
          {wf.workers.map(w=>{
            const cov = {} as Record<SkillType,number>;
            for(const t of SKILL_TYPES) cov[t]=0;
            for(const s of w.skills) cov[s.skill_type]=s.proficiency;
            return (
              <tr key={w.identity.id}>
                <td style={{...td,color:"#e5e7eb"}}>{w.identity.name}</td>
                {SKILL_TYPES.map(t=>{
                  const v = cov[t];
                  return (
                    <td key={t} style={{...td,textAlign:"center",
                      color:v>=0.7?"#22c55e":v>0?"#f59e0b":"#374151"}}>
                      {v>0?pct(v):"·"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Performance View ──────────────────────────────────────────────────────────

function PerformanceView({ wf }: { wf: WF }) {
  if(wf.performance.length === 0) return <Hint text="No performance data." />;
  const sorted = [...wf.performance].sort((a,b)=>b.throughput-a.throughput);
  return (
    <div style={{padding:16,overflowX:"auto"}}>
      <SectionTitle text="PERFORMANCE METRICS" />
      <table style={{borderCollapse:"collapse",fontSize:9,width:"100%"}}>
        <thead><tr>
          {["Worker","Throughput","Acceptance","QA","Rework","Disagree","Turnaround"].map(h=>
            <th key={h} style={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {sorted.map(m=>{
            const w = wf.workers.find(x=>x.identity.id===m.reviewer_id);
            return (
              <tr key={m.reviewer_id}>
                <td style={{...td,color:"#e5e7eb"}}>{w?.identity.name??m.reviewer_id}</td>
                <td style={{...td,textAlign:"right"}}>{m.throughput}</td>
                <td style={{...td,textAlign:"right"}}>{pct(m.acceptance_rate)}</td>
                <td style={{...td,textAlign:"right",color:m.qa_score>=0.8?"#22c55e":"#f59e0b"}}>{pct(m.qa_score)}</td>
                <td style={{...td,textAlign:"right",color:m.rework_rate>0.3?"#f59e0b":"#6b7280"}}>{pct(m.rework_rate)}</td>
                <td style={{...td,textAlign:"right"}}>{pct(m.disagreement_rate)}</td>
                <td style={{...td,textAlign:"right"}}>{m.avg_turnaround_sec>0?secs(m.avg_turnaround_sec):"—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Capacity View ─────────────────────────────────────────────────────────────

function CapacityView({ wf }: { wf: WF }) {
  if(wf.capacity.length === 0) return <Hint text="No capacity data." />;
  const t = wf.teamCapacity;
  return (
    <div style={{padding:16}}>
      <SectionTitle text="CAPACITY PLANNER" />
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <Stat label="Team capacity" value={`${t.total_capacity_hours}h`} />
        <Stat label="Projected" value={`${t.total_projected_hours}h`} />
        <Stat label="Utilization" value={pct(t.team_utilization)} />
        <Stat label="Overloaded" value={String(t.overloaded_count)} color={t.overloaded_count>0?"#f59e0b":"#22c55e"} />
      </div>
      {wf.capacitySuggestion && (
        <div style={{...card,marginBottom:12,borderColor:"#22d3ee33"}}>
          <span style={{fontSize:10,color:"#22d3ee"}}>
            ◎ Suggested for next assignment: {wf.workers.find(w=>w.identity.id===wf.capacitySuggestion!.reviewer_id)?.identity.name}
            {" "}({pct(wf.capacitySuggestion.utilization)} utilized)
          </span>
        </div>
      )}
      <div style={{display:"grid",gap:6}}>
        {[...wf.capacity].sort((a,b)=>b.utilization-a.utilization).map(c=>{
          const w = wf.workers.find(x=>x.identity.id===c.reviewer_id);
          return (
            <div key={c.reviewer_id} style={card}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,color:"#e5e7eb",flex:1}}>{w?.identity.name??c.reviewer_id}</span>
                <span style={{fontSize:9,padding:"1px 7px",borderRadius:8,
                  background:`${RISK_COLOR[c.overload_risk]}22`,color:RISK_COLOR[c.overload_risk]}}>
                  {c.overload_risk}
                </span>
              </div>
              <div style={{marginTop:5,height:4,background:"#1f2937",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:4,width:`${Math.min(100,c.utilization*100)}%`,
                  background:RISK_COLOR[c.overload_risk]}}/>
              </div>
              <div style={{fontSize:9,color:"#374151",marginTop:4,display:"flex",gap:10}}>
                <span>{c.active_assignments} active</span>
                <span>{c.projected_hours}h / {c.weekly_capacity_hours}h</span>
                <span>{pct(c.utilization)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fraud View ────────────────────────────────────────────────────────────────

function FraudView({ wf }: { wf: WF }) {
  const flagged = wf.fraud.filter(f=>f.flagged);
  const withSignals = wf.fraud.filter(f=>f.signals.length>0);
  return (
    <div style={{padding:16}}>
      <SectionTitle text={`FRAUD SIGNALS · ${flagged.length} flagged (advisory)`} />
      {withSignals.length === 0 ? (
        <Hint text="No fraud signals detected." />
      ) : (
        <div style={{display:"grid",gap:6}}>
          {[...withSignals].sort((a,b)=>b.risk_score-a.risk_score).map(f=>{
            const w = wf.workers.find(x=>x.identity.id===f.reviewer_id);
            return (
              <div key={f.reviewer_id} style={{...card,
                borderColor:f.flagged?"#ef444444":"#1f2937"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:11,color:"#e5e7eb",flex:1}}>{w?.identity.name??f.reviewer_id}</span>
                  <span style={{fontSize:9,color:f.flagged?"#ef4444":"#f59e0b"}}>
                    risk {pct(f.risk_score)}
                  </span>
                </div>
                <div style={{marginTop:5,display:"flex",flexDirection:"column",gap:3}}>
                  {f.signals.map((s,i)=>(
                    <div key={i} style={{fontSize:9,color:"#9ca3af"}}>
                      <span style={{color:"#f59e0b"}}>⚑ {s.signal}</span> — {s.detail}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Analytics View ────────────────────────────────────────────────────────────

function AnalyticsView({ wf }: { wf: WF }) {
  const t = wf.trends;
  return (
    <div style={{padding:16}}>
      <SectionTitle text="WORKFORCE ANALYTICS" />
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <Stat label="Mean QA" value={pct(t.mean_qa_score)} />
        <Stat label="Mean throughput" value={t.mean_throughput.toFixed(1)} />
        <Stat label="Active" value={String(t.total_active)} />
        <Stat label="Flagged" value={String(t.flagged_count)} color={t.flagged_count>0?"#f59e0b":"#22c55e"} />
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <RankingList title="Worker Ranking" entries={t.worker_ranking} />
        <RankingList title="Reviewer Ranking" entries={t.reviewer_ranking} />
      </div>
    </div>
  );
}

function RankingList({ title, entries }: { title:string; entries:{reviewer_id:string;name:string;score:number;rank:number}[] }) {
  return (
    <div>
      <div style={{fontSize:9,letterSpacing:2,color:"#374151",marginBottom:8}}>{title}</div>
      <div style={{display:"grid",gap:3}}>
        {entries.slice(0,15).map(e=>(
          <div key={e.reviewer_id} style={{display:"flex",alignItems:"center",gap:8,
            padding:"5px 9px",background:"#0a0f1a",border:"1px solid #111",borderRadius:6,fontSize:9}}>
            <span style={{color:"#6b7280",minWidth:20}}>#{e.rank}</span>
            <span style={{color:"#e5e7eb",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</span>
            <span style={{color:e.score>=0.7?"#22c55e":"#f59e0b"}}>{e.score.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function Hint({ text }: { text:string }) {
  return <div style={{padding:"40px 16px",textAlign:"center",fontSize:11,color:"#374151"}}>{text}</div>;
}
function SectionTitle({ text }: { text:string }) {
  return <div style={{fontSize:11,letterSpacing:2,color:"#374151",marginBottom:12}}>{text}</div>;
}
function Stat({ label, value, color }: { label:string; value:string; color?:string }) {
  return (
    <div style={{background:"#0a0f1a",border:"1px solid #1f2937",borderRadius:10,
      padding:"8px 14px",minWidth:90}}>
      <div style={{fontSize:8,color:"#374151",letterSpacing:1}}>{label.toUpperCase()}</div>
      <div style={{fontSize:15,fontWeight:700,color:color??"#22d3ee",marginTop:2}}>{value}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  background:"#0a0f1a", border:"1px solid #1f2937", borderRadius:10, padding:"9px 13px",
};
const th: React.CSSProperties = {
  textAlign:"left", padding:"6px 8px", color:"#374151", borderBottom:"1px solid #1f2937",
  fontWeight:400, whiteSpace:"nowrap",
};
const td: React.CSSProperties = {
  padding:"5px 8px", borderBottom:"1px solid #111", color:"#6b7280", whiteSpace:"nowrap",
};

export interface WorkforceManagementWorkstationProps {
  onClose?: () => void;
}

export default function WorkforceManagementWorkstation(
  { onClose }: WorkforceManagementWorkstationProps,
) {
  const wf = useWorkforceManagement();
  const [view, setView] = useState<"workers"|"skills"|"performance"|"capacity"|"fraud"|"analytics">("workers");

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",
      background:"#080c14",color:"#e5e7eb",
      fontFamily:"'JetBrains Mono',monospace",overflow:"hidden"}}>

      {/* TOP BAR */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",
        borderBottom:"1px solid #1f2937",background:"#0a0f1a",flexShrink:0,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:700,color:"#22d3ee",letterSpacing:0.5}}>
          WORKFORCE OS
        </span>
        <span style={{fontSize:9,color:"#374151"}}>
          {wf.workers.length} workers · advisory scoring · no automatic actions
        </span>
        <div style={{marginLeft:"auto",display:"flex",gap:4,flexWrap:"wrap"}}>
          {(["workers","skills","performance","capacity","fraud","analytics"] as const).map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{
              padding:"4px 10px",borderRadius:6,fontSize:9,cursor:"pointer",
              border:`1px solid ${view===v?"#22d3ee":"#1f2937"}`,
              background:view===v?"#22d3ee18":"transparent",
              color:view===v?"#22d3ee":"#6b7280",fontFamily:"inherit"}}>
              {v.toUpperCase()}
            </button>
          ))}
          {onClose && (
            <button onClick={onClose} style={{padding:"4px 10px",borderRadius:6,
              fontSize:9,cursor:"pointer",border:"1px solid #ef444433",
              background:"transparent",color:"#ef4444",fontFamily:"inherit"}}>✕</button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div style={{flex:1,overflow:"auto"}}>
        {view==="workers"     && <WorkersView wf={wf} />}
        {view==="skills"      && <SkillsView wf={wf} />}
        {view==="performance" && <PerformanceView wf={wf} />}
        {view==="capacity"    && <CapacityView wf={wf} />}
        {view==="fraud"       && <FraudView wf={wf} />}
        {view==="analytics"   && <AnalyticsView wf={wf} />}
      </div>

      {/* STATUS BAR */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 14px",
        borderTop:"1px solid #1f2937",background:"#0a0f1a",
        fontSize:9,color:"#374151",flexShrink:0}}>
        <span>AIVORA WORKFORCE OS</span>
        <span>·</span>
        <span>Workers: {wf.workers.length}</span>
        <span>·</span>
        <span>Team util: {(wf.teamCapacity.team_utilization*100).toFixed(0)}%</span>
        <span>·</span>
        <span style={{color:wf.trends.flagged_count>0?"#f59e0b":"#22c55e"}}>
          Flagged: {wf.trends.flagged_count}
        </span>
      </div>
    </div>
  );
}
