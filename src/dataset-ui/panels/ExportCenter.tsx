import React, { useState } from "react";
import { useDatasetVersions } from "../hooks/useDatasetFactory";
import { exportDatasetVersion, downloadDatasetJSONL, downloadManifest }
  from "../../lib/dataset/datasetRuntime";
import { adaptRecords, downloadAdaptedExport }
  from "../../lib/dataset/formatAdapters";
import type { ExportFormat } from "../../lib/dataset/formatAdapters";
import type { DatasetRecord } from "../../lib/dataset/datasetRuntime";

const FORMATS: { value:ExportFormat; label:string; desc:string }[] = [
  { value:"openai_jsonl",     label:"OpenAI JSONL",    desc:"Fine-tuning format" },
  { value:"chatml",           label:"ChatML",           desc:"Multi-turn chat" },
  { value:"sharegpt",         label:"ShareGPT",         desc:"ShareGPT format" },
  { value:"alpaca",           label:"Alpaca",           desc:"Instruction format" },
  { value:"whisper_manifest", label:"Whisper Manifest", desc:"ASR training" },
  { value:"nemo_manifest",    label:"NeMo Manifest",    desc:"NVIDIA NeMo ASR" },
  { value:"huggingface",      label:"HuggingFace",      desc:"HF datasets" },
  { value:"aivora_native",    label:"Aivora Native",    desc:"Internal format" },
];

export default function ExportCenter() {
  const { versions, loading } = useDatasetVersions();
  const [selected,   setSelected]   = useState<string | null>(null);
  const [format,     setFormat]     = useState<ExportFormat>("openai_jsonl");
  const [exporting,  setExporting]  = useState(false);
  const [lastExport, setLastExport] = useState<{
    checksum:string; records:number; format:string; at:string
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedVersion = versions.find(v => v.id === selected);

  const handleExport = async () => {
    if(!selected) return;
    setExporting(true);
    setError(null);

    try {
      const corrId = crypto.randomUUID();
      const result = await exportDatasetVersion(selected, corrId);
      if(!result) { setError("Export failed — check pipeline logs"); return; }

      // Parse JSONL → DatasetRecord[] for format adapter
      const records: DatasetRecord[] = result.jsonl
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line) as DatasetRecord);

      // Apply format adapter
      const adapted = adaptRecords(records, format);
      downloadAdaptedExport(adapted, selectedVersion?.version_number ?? "x");

      // Also download manifest
      downloadManifest(result.manifest);

      setLastExport({
        checksum: result.checksum.slice(0,16) + "…",
        records:  result.record_count,
        format:   format,
        at:       new Date().toISOString().slice(0,19),
      });
    } catch(e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally { setExporting(false); }
  };

  return (
    <div>
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:12,
          textTransform:"uppercase", letterSpacing:1 }}>
          Export Configuration
        </div>

        {/* Version selector */}
        <div style={{ marginBottom:10 }}>
          <label style={{ fontSize:10, color:"#6b7280", display:"block",
            marginBottom:4 }}>DATASET VERSION</label>
          <select value={selected ?? ""}
            onChange={e => setSelected(e.target.value)}
            disabled={exporting}
            style={{ width:"100%", background:"#111827", color:"#e5e7eb",
              border:"1px solid #1f2937", borderRadius:4,
              padding:"6px 8px", fontSize:12 }}>
            <option value="">— Select version —</option>
            {versions.map(v => (
              <option key={v.id} value={v.id}
                disabled={v.status === "failed"}>
                v{v.version_number} · {v.project_name}
                {v.status !== "validated" && v.status !== "published"
                  ? ` [${v.status}]` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Format selector */}
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:10, color:"#6b7280", display:"block",
            marginBottom:4 }}>EXPORT FORMAT</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {FORMATS.map(f => (
              <div key={f.value}
                onClick={() => setFormat(f.value)}
                style={{ padding:"8px 10px", borderRadius:4, cursor:"pointer",
                  background: format===f.value ? "#0891b222":"#111827",
                  border:`1px solid ${format===f.value?"#0891b2":"#1f2937"}`,
                  transition:"all 0.15s" }}>
                <div style={{ fontSize:11, color:format===f.value?"#22d3ee":"#e5e7eb",
                  fontWeight:600 }}>{f.label}</div>
                <div style={{ fontSize:9, color:"#6b7280" }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Export button */}
        <button onClick={handleExport}
          disabled={!selected || exporting}
          style={{ width:"100%", padding:"12px 0", borderRadius:6,
            border:"none", fontSize:13, fontWeight:700, letterSpacing:1,
            cursor:(!selected||exporting)?"not-allowed":"pointer",
            background:(!selected||exporting)?"#1f2937":"#0891b2",
            color:(!selected||exporting)?"#4b5563":"#fff",
            transition:"all 0.2s" }}>
          {exporting ? "⏳ EXPORTING..." : `📤 EXPORT AS ${format.toUpperCase()}`}
        </button>

        {error && (
          <div style={{ fontSize:11, color:"#ef4444", marginTop:8 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Last export result */}
      {lastExport && (
        <div style={{ background:"#052e16", border:"1px solid #166534",
          borderRadius:8, padding:14 }}>
          <div style={{ fontSize:11, color:"#22c55e", fontWeight:700,
            marginBottom:8 }}>✅ Export Complete</div>
          <div style={{ fontSize:11, color:"#9ca3af" }}>
            Format: <span style={{ color:"#22d3ee" }}>{lastExport.format}</span>
          </div>
          <div style={{ fontSize:11, color:"#9ca3af" }}>
            Records: <span style={{ color:"#22d3ee" }}>
              {lastExport.records.toLocaleString()}</span>
          </div>
          <div style={{ fontSize:11, color:"#9ca3af" }}>
            Checksum: <span style={{ color:"#22d3ee" }}>{lastExport.checksum}</span>
          </div>
          <div style={{ fontSize:11, color:"#9ca3af" }}>
            At: <span style={{ color:"#22d3ee" }}>{lastExport.at}</span>
          </div>
          <div style={{ fontSize:9, color:"#374151", marginTop:6 }}>
            Manifest downloaded separately · Evidence chain updated
          </div>
        </div>
      )}

      {/* Governance note */}
      <div style={{ marginTop:12, padding:10, background:"#0f172a",
        borderRadius:6, border:"1px solid #1e293b", fontSize:10,
        color:"#4b5563" }}>
        Export rules: immutable snapshot · sequential ordering ·
        per-record SHA256 · manifest checksum · replay-safe
      </div>
    </div>
  );
}
