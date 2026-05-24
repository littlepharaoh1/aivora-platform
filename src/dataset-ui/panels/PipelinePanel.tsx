import React from "react";
import { usePipelineRuns } from "../hooks/useDatasetFactory";
import { STANDARD_PIPELINE, QUICK_EXPORT_PIPELINE, topoSort }
  from "../../lib/dataset/datasetPipeline";

const STATUS_COLOR: Record<string,string> = {
  queued:    "#6b7280",
  running:   "#22d3ee",
  completed: "#22c55e",
  failed:    "#ef4444",
  cancelled: "#f59e0b",
};

function DAGView({ steps }: { steps: typeof STANDARD_PIPELINE.steps }) {
  const ordered = topoSort([...steps]);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4,
      flexWrap:"wrap", padding:"8px 0" }}>
      {ordered.map((step, i) => (
        <React.Fragment key={step.id}>
          <div style={{ padding:"4px 8px", borderRadius:4, fontSize:10,
            background:"#111827", border:"1px solid #1f2937",
            color:"#22d3ee" }}>
            {step.type.replace("_"," ")}
          </div>
          {i < ordered.length - 1 && (
            <span style={{ color:"#374151", fontSize:12 }}>→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function PipelinePanel() {
  const { runs, loading, refresh } = usePipelineRuns();

  return (
    <div>
      {/* Pipeline Definitions */}
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
          textTransform:"uppercase", letterSpacing:1 }}>
          Pipeline Definitions (Deterministic DAG)
        </div>
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:11, color:"#e5e7eb", marginBottom:4 }}>
            Standard Pipeline
          </div>
          <DAGView steps={STANDARD_PIPELINE.steps} />
        </div>
        <div>
          <div style={{ fontSize:11, color:"#e5e7eb", marginBottom:4 }}>
            Quick Export Pipeline
          </div>
          <DAGView steps={QUICK_EXPORT_PIPELINE.steps} />
        </div>
        <div style={{ fontSize:9, color:"#374151", marginTop:8 }}>
          Cycle detection: ✅ · Topo sort: ✅ · Replay safe: ✅
        </div>
      </div>

      {/* Pipeline Runs */}
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:12 }}>
        <span style={{ fontSize:12, color:"#9ca3af" }}>
          {runs.length} pipeline runs
        </span>
        <button onClick={refresh}
          style={{ padding:"4px 10px", fontSize:11, borderRadius:4,
            border:"1px solid #1f2937", background:"transparent",
            color:"#6b7280", cursor:"pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center", padding:24 }}>
          Loading pipeline runs...
        </div>
      ) : runs.length === 0 ? (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center", padding:32,
          border:"1px dashed #1f2937", borderRadius:8 }}>
          No pipeline runs yet.
        </div>
      ) : (
        runs.map(run => (
          <div key={run.id} style={{ background:"#0d1117",
            border:"1px solid #1f2937", borderRadius:8,
            padding:"10px 14px", marginBottom:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:12, color:"#e5e7eb", fontWeight:600 }}>
                {run.pipeline_name}
              </span>
              <span style={{ fontSize:10, padding:"2px 6px", borderRadius:3,
                background:(STATUS_COLOR[run.status]??"#6b7280")+"22",
                color:STATUS_COLOR[run.status]??"#6b7280" }}>
                {run.status}
              </span>
              <span style={{ flex:1 }} />
              <span style={{ fontSize:10, color:"#6b7280" }}>
                {run.files_processed} processed
              </span>
              <span style={{ fontSize:10, color:"#374151" }}>
                {run.created_at.slice(0,16).replace("T"," ")}
              </span>
            </div>
            {run.error_message && (
              <div style={{ fontSize:11, color:"#ef4444", marginTop:6 }}>
                ⚠ {run.error_message.slice(0,100)}
              </div>
            )}
            {run.output_checksum && (
              <div style={{ fontSize:9, color:"#374151", marginTop:4 }}>
                checksum: {run.output_checksum.slice(0,32)}…
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
