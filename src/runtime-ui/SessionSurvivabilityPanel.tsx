import React, { useState, useEffect } from "react";
import type { RuntimeSnapshot } from "./hooks/useRuntimeState";
import { sessionSurvivability } from "../runtime/sessionSurvivability";
import type { SessionHealthScore } from "../runtime/sessionSurvivability";

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

function HealthBar({ label, value }: { label:string; value:number }) {
  const color = value > 0.7 ? "#22c55e" : value > 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
        <span style={{ fontSize:11, color:"#9ca3af" }}>{label}</span>
        <span style={{ fontSize:11, color, fontWeight:700 }}>
          {Math.round(value*100)}%
        </span>
      </div>
      <div style={{ height:6, background:"#1f2937", borderRadius:3 }}>
        <div style={{ width:`${value*100}%`, height:"100%",
          background:color, borderRadius:3, transition:"width 0.8s" }} />
      </div>
    </div>
  );
}

export default function SessionSurvivabilityPanel({ snap }: { snap: RuntimeSnapshot }) {
  const [health, setHealth] = useState<SessionHealthScore | null>(
    sessionSurvivability.getLastScore()
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setHealth(sessionSurvivability.getLastScore());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const score = health ?? {
    memory_health:1, worker_health:1, gpu_health:1,
    sync_health:1, forensic_health:1, overall:1,
    degraded:false, sampled_at:Date.now(),
  };

  const overallColor = score.overall > 0.7 ? "#22c55e"
                     : score.overall > 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <Card title="Session Health Score">
        <div style={{ textAlign:"center", padding:"16px 0" }}>
          <div style={{ fontSize:48, fontWeight:900, color:overallColor }}>
            {Math.round(score.overall * 100)}
          </div>
          <div style={{ fontSize:11, color:"#6b7280", marginTop:4 }}>
            {score.degraded ? "⚠️ DEGRADED" : "✅ HEALTHY"}
          </div>
        </div>
        <HealthBar label="Memory Health"   value={score.memory_health} />
        <HealthBar label="Worker Health"   value={score.worker_health} />
        <HealthBar label="GPU Health"      value={score.gpu_health} />
        <HealthBar label="Sync Health"     value={score.sync_health} />
        <HealthBar label="Forensic Health" value={score.forensic_health} />
      </Card>

      <Card title="Current Pressure">
        <HealthBar label="Overall"         value={1 - snap.overall_pressure} />
        <HealthBar label="Memory"          value={1 - snap.memory_pressure} />
        <HealthBar label="Workers"         value={1 - snap.worker_pressure} />
        <HealthBar label="GPU"             value={1 - snap.gpu_pressure} />
        <div style={{ marginTop:12, fontSize:10, color:"#4b5563" }}>
          Recovery actions trigger at 50% health.
          Eviction at hard memory pressure (85%+).
        </div>
      </Card>
    </div>
  );
}
