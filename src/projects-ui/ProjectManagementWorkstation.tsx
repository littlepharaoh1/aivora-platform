/**
 * ProjectManagementWorkstation.tsx
 * Aivora Platform — Enterprise Project Management Layer
 *
 * Projects · Members · Tasks · Queues · Assignments · Workload · Audit
 * RBAC-guarded. Offline-safe. Immutable audit on every action.
 */

import React, { useState } from "react";
import { useProjectManagement } from "../lib/projects/useProjectManagement";
import { ROLE_COLORS } from "../lib/projects/projectTypes";

type PM = ReturnType<typeof useProjectManagement>;

// ── Projects View ─────────────────────────────────────────────────────────────

function ProjectsView({ pm }: { pm: PM }) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName]       = useState("");
  const [desc, setDesc]       = useState("");
  const [deadline, setDeadline] = useState("");

  const submit = async () => {
    if(!name.trim()) return;
    await pm.actNewProject(name.trim(), desc.trim(), deadline || null);
    setName(""); setDesc(""); setDeadline(""); setShowNew(false);
  };

  return (
    <div style={{padding:16}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:14}}>
        <span style={{fontSize:11,letterSpacing:2,color:"#374151"}}>PROJECTS</span>
        {pm.can("manage_project") && (
          <button onClick={()=>setShowNew(v=>!v)} style={{marginLeft:"auto",
            padding:"4px 12px",borderRadius:6,fontSize:10,cursor:"pointer",
            border:"1px solid #22d3ee",background:"#22d3ee18",color:"#22d3ee",
            fontFamily:"inherit"}}>+ New Project</button>
        )}
      </div>

      {showNew && (
        <div style={{background:"#0a0f1a",border:"1px solid #1f2937",borderRadius:10,
          padding:14,marginBottom:14,display:"flex",flexDirection:"column",gap:8}}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Project name"
            style={inputStyle}/>
          <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Description"
            style={inputStyle}/>
          <input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}
            style={inputStyle}/>
          <div style={{display:"flex",gap:6}}>
            <button onClick={submit} style={primaryBtn}>Create</button>
            <button onClick={()=>setShowNew(false)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {pm.projects.length === 0 ? (
        <div style={{fontSize:11,color:"#374151",padding:"20px 0",textAlign:"center"}}>
          No projects yet.{pm.can("manage_project")?" Create one above.":""}
        </div>
      ) : (
        <div style={{display:"grid",gap:8}}>
          {pm.projects.map(proj=>(
            <div key={proj.id} onClick={()=>pm.openProject(proj.id)}
              style={{background:"#0a0f1a",
                border:`1px solid ${pm.activeId===proj.id?"#22d3ee":"#1f2937"}`,
                borderRadius:10,padding:"10px 14px",cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,fontWeight:700,color:"#e5e7eb"}}>{proj.name}</span>
                <span style={{fontSize:8,padding:"1px 7px",borderRadius:8,
                  background:proj.status==="active"?"#22c55e18":"#37415118",
                  color:proj.status==="active"?"#22c55e":"#6b7280"}}>
                  {proj.status}
                </span>
                {proj.deadline && (
                  <span style={{fontSize:9,color:"#f59e0b",marginLeft:"auto"}}>
                    ⏱ {new Date(proj.deadline).toLocaleDateString()}
                  </span>
                )}
              </div>
              {proj.description && (
                <div style={{fontSize:10,color:"#6b7280",marginTop:4}}>{proj.description}</div>
              )}
              <div style={{fontSize:9,color:"#374151",marginTop:6}}>
                {proj.completed_count}/{proj.task_count} tasks complete
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Board View (tasks/queues) ─────────────────────────────────────────────────

function BoardView({ pm }: { pm: PM }) {
  if(!pm.activeProject) return <EmptyHint text="Select a project to view its task board." />;

  const COLUMNS: { key: string; label: string }[] = [
    { key:"pending",     label:"Pending" },
    { key:"assigned",    label:"Assigned" },
    { key:"in_progress", label:"In Progress" },
    { key:"in_review",   label:"In Review" },
    { key:"completed",   label:"Completed" },
  ];

  return (
    <div style={{padding:16}}>
      <div style={{fontSize:11,letterSpacing:2,color:"#374151",marginBottom:12}}>
        TASK BOARD · {pm.activeProject.name}
      </div>
      <div style={{display:"flex",gap:10,overflowX:"auto"}}>
        {COLUMNS.map(col=>{
          const colTasks = pm.tasks.filter(t=>t.status===col.key);
          return (
            <div key={col.key} style={{minWidth:160,flex:1}}>
              <div style={{fontSize:9,color:"#6b7280",marginBottom:6,
                display:"flex",justifyContent:"space-between"}}>
                <span>{col.label}</span><span>{colTasks.length}</span>
              </div>
              <div style={{display:"grid",gap:6}}>
                {colTasks.map(t=>(
                  <div key={t.id} style={{background:"#0a0f1a",border:"1px solid #1f2937",
                    borderRadius:8,padding:"7px 9px",fontSize:10}}>
                    <div style={{color:"#e5e7eb"}}>{t.title}</div>
                    <div style={{fontSize:8,color:"#374151",marginTop:3}}>
                      {t.assignee_email||"unassigned"} · {t.priority}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Team View (members + workload) ────────────────────────────────────────────

function TeamView({ pm }: { pm: PM }) {
  if(!pm.activeProject) return <EmptyHint text="Select a project to view its team." />;

  return (
    <div style={{padding:16}}>
      <div style={{fontSize:11,letterSpacing:2,color:"#374151",marginBottom:12}}>
        TEAM & WORKLOAD · {pm.activeProject.name}
      </div>
      {pm.workloads.length === 0 ? (
        <EmptyHint text="No members yet." />
      ) : (
        <div style={{display:"grid",gap:8}}>
          {pm.workloads.map(w=>(
            <div key={w.user_id} style={{background:"#0a0f1a",border:"1px solid #1f2937",
              borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
              <span style={{width:8,height:8,borderRadius:2,
                background:ROLE_COLORS[w.role],flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:"#e5e7eb"}}>{w.email}</div>
                <div style={{fontSize:9,color:ROLE_COLORS[w.role]}}>{w.role}</div>
              </div>
              <div style={{display:"flex",gap:10,fontSize:9}}>
                <span style={{color:"#f59e0b"}}>active {w.total_active}</span>
                <span style={{color:"#22c55e"}}>done {w.completed}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audit View ────────────────────────────────────────────────────────────────

function AuditView({ pm }: { pm: PM }) {
  if(!pm.activeProject) return <EmptyHint text="Select a project to view its audit trail." />;

  return (
    <div style={{padding:16}}>
      <div style={{fontSize:11,letterSpacing:2,color:"#374151",marginBottom:12}}>
        AUDIT TRAIL · {pm.activeProject.name} · {pm.audit.length} events
      </div>
      {pm.audit.length === 0 ? (
        <EmptyHint text="No audit events yet." />
      ) : (
        <div style={{display:"grid",gap:4}}>
          {pm.audit.map(ev=>(
            <div key={ev.id} style={{background:"#0a0f1a",border:"1px solid #111",
              borderRadius:6,padding:"6px 10px",fontSize:9,display:"flex",
              alignItems:"center",gap:8}}>
              <span style={{color:"#22d3ee",fontWeight:700,minWidth:140}}>{ev.action}</span>
              <span style={{color:"#6b7280"}}>{ev.actor_email}</span>
              <span style={{color:"#374151",marginLeft:"auto"}}>
                {new Date(ev.created_at).toLocaleString()}
              </span>
              <span style={{color:"#1f2937",fontSize:8}} title={ev.checksum}>
                ⛓ {ev.checksum.slice(0,8)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{padding:"40px 16px",textAlign:"center",fontSize:11,color:"#374151"}}>
      {text}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background:"#111",color:"#e5e7eb",border:"1px solid #1f2937",
  borderRadius:6,padding:"6px 10px",fontSize:10,outline:"none",fontFamily:"inherit",
};
const primaryBtn: React.CSSProperties = {
  padding:"6px 14px",borderRadius:6,fontSize:10,cursor:"pointer",
  border:"1px solid #22d3ee",background:"#22d3ee18",color:"#22d3ee",fontFamily:"inherit",
};
const ghostBtn: React.CSSProperties = {
  padding:"6px 14px",borderRadius:6,fontSize:10,cursor:"pointer",
  border:"1px solid #1f2937",background:"transparent",color:"#6b7280",fontFamily:"inherit",
};

export interface ProjectManagementWorkstationProps {
  onClose?: () => void;
}

export default function ProjectManagementWorkstation(
  { onClose }: ProjectManagementWorkstationProps,
) {
  const pm = useProjectManagement();
  const [view, setView] = useState<"projects"|"board"|"team"|"audit">("projects");

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",
      background:"#080c14",color:"#e5e7eb",
      fontFamily:"'JetBrains Mono',monospace",overflow:"hidden"}}>

      {/* TOP BAR */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",
        borderBottom:"1px solid #1f2937",background:"#0a0f1a",flexShrink:0}}>
        <span style={{fontSize:12,fontWeight:700,color:"#22d3ee",letterSpacing:0.5}}>
          PROJECT MANAGEMENT
        </span>
        <span style={{fontSize:9,padding:"2px 8px",borderRadius:10,
          background:`${ROLE_COLORS[pm.myRole]}18`,color:ROLE_COLORS[pm.myRole]}}>
          {pm.myRole.toUpperCase()}
        </span>
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          {(["projects","board","team","audit"] as const).map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{
              padding:"4px 12px",borderRadius:6,fontSize:10,cursor:"pointer",
              border:`1px solid ${view===v?"#22d3ee":"#1f2937"}`,
              background:view===v?"#22d3ee18":"transparent",
              color:view===v?"#22d3ee":"#6b7280",fontFamily:"inherit"}}>
              {v.toUpperCase()}
            </button>
          ))}
          {onClose && (
            <button onClick={onClose} style={{padding:"4px 10px",borderRadius:6,
              fontSize:10,cursor:"pointer",border:"1px solid #ef444433",
              background:"transparent",color:"#ef4444",fontFamily:"inherit"}}>✕</button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div style={{flex:1,overflow:"auto"}}>
        {view==="projects" && <ProjectsView pm={pm} />}
        {view==="board"    && <BoardView pm={pm} />}
        {view==="team"     && <TeamView pm={pm} />}
        {view==="audit"    && <AuditView pm={pm} />}
      </div>

      {/* STATUS BAR */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 14px",
        borderTop:"1px solid #1f2937",background:"#0a0f1a",
        fontSize:9,color:"#374151",flexShrink:0}}>
        <span>AIVORA PROJECT MANAGEMENT</span>
        <span>·</span>
        <span>Role: {pm.myRole}</span>
        <span>·</span>
        <span>Projects: {pm.projects.length}</span>
        {pm.activeProject && <><span>·</span><span>Active: {pm.activeProject.name}</span></>}
      </div>
    </div>
  );
}
