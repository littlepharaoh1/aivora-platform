import React from "react";
import type { RuntimeSnapshot } from "./hooks/useRuntimeState";
import { workerRegistry } from "../runtime/workerRegistry";
import { useRuntimeState } from "./hooks/useRuntimeState";

function Card({ title, children }: { title:string; children:React.ReactNode }) {
  return (
    <div style={{ background:"#0d1117", border:"1px solid #1f2937",
      borderRadius:8, padding:14, marginBottom:12 }}>
      <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
        letterSpacing:1, textTransform:"uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

export default function WorkerPoolInspector({ snap }: { snap: RuntimeSnapshot }) {
  const workers = workerRegistry.getAll();
  const occupancy = snap.max_workers > 0
    ? snap.active_workers / snap.max_workers : 0;
  const barColor = occupancy > 0.85 ? "#ef4444"
                 : occupancy > 0.65 ? "#f59e0b" : "#22c55e";

  return (
    <div>
      <Card title="Worker Pool Status">
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontSize:11, color:"#9ca3af" }}>Pool Occupancy</span>
            <span style={{ fontSize:12, color:barColor, fontWeight:700 }}>
              {snap.active_workers} / {snap.max_workers}
            </span>
          </div>
          <div style={{ height:8, background:"#1f2937", borderRadius:4 }}>
            <div style={{ width:`${occupancy*100}%`, height:"100%",
              background:barColor, borderRadius:4, transition:"width 0.5s" }} />
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {[
            { label:"Active",  value:snap.active_workers, color:"#22c55e" },
            { label:"Available",value:snap.max_workers - snap.active_workers, color:"#3b82f6" },
            { label:"Queued",  value:snap.queue_depth,    color:"#f59e0b" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:"#111827", borderRadius:6,
              padding:"10px 12px", textAlign:"center" }}>
              <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
              <div style={{ fontSize:10, color:"#6b7280", marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Active Workers">
        {workers.filter(w => w.status === "ACTIVE").length === 0 ? (
          <div style={{ fontSize:12, color:"#4b5563", textAlign:"center", padding:16 }}>
            No active workers
          </div>
        ) : (
          workers.filter(w => w.status === "ACTIVE").map(w => (
            <div key={w.id} style={{ display:"flex", justifyContent:"space-between",
              padding:"6px 0", borderBottom:"1px solid #111827", fontSize:11 }}>
              <span style={{ color:"#9ca3af" }}>{w.task_type}</span>
              <span style={{ color:"#22d3ee" }}>
                {Math.round((Date.now() - w.allocated_at) / 1000)}s
              </span>
            </div>
          ))
        )}
      </Card>

      <Card title="Execution Policy">
        <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
          <span style={{ fontSize:11, color:"#9ca3af" }}>Mode</span>
          <span style={{ fontSize:12, color:"#22d3ee", fontWeight:700 }}>
            {snap.execution_mode}
          </span>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
          <span style={{ fontSize:11, color:"#9ca3af" }}>Target FPS</span>
          <span style={{ fontSize:12, color:"#e5e7eb" }}>{snap.target_fps}</span>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
          <span style={{ fontSize:11, color:"#9ca3af" }}>Worker Pressure</span>
          <span style={{ fontSize:12,
            color:snap.worker_pressure>0.85?"#ef4444":snap.worker_pressure>0.65?"#f59e0b":"#22c55e" }}>
            {Math.round(snap.worker_pressure*100)}%
          </span>
        </div>
      </Card>
    </div>
  );
}
