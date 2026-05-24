import React, { useState, useEffect } from "react";
import { useDatasetVersions, fetchSplitStats }
  from "../hooks/useDatasetFactory";
import { computeDeterministicSplits }
  from "../../lib/dataset/datasetGovernance";
import type { SplitStats } from "../hooks/useDatasetFactory";

function SplitBar({ stats }: { stats: SplitStats }) {
  if(!stats.total) return null;
  const trainPct = stats.train / stats.total * 100;
  const valPct   = stats.val   / stats.total * 100;
  const testPct  = stats.test  / stats.total * 100;

  return (
    <div>
      <div style={{ display:"flex", height:20, borderRadius:4, overflow:"hidden",
        marginBottom:6 }}>
        <div style={{ width:`${trainPct}%`, background:"#22d3ee",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:9, color:"#0a0f1a", fontWeight:700 }}>
          {trainPct > 10 ? `${Math.round(trainPct)}%` : ""}
        </div>
        <div style={{ width:`${valPct}%`, background:"#3b82f6",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:9, color:"#fff", fontWeight:700 }}>
          {valPct > 5 ? `${Math.round(valPct)}%` : ""}
        </div>
        <div style={{ width:`${testPct}%`, background:"#8b5cf6",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:9, color:"#fff", fontWeight:700 }}>
          {testPct > 5 ? `${Math.round(testPct)}%` : ""}
        </div>
      </div>
      <div style={{ display:"flex", gap:12, fontSize:10 }}>
        <span><span style={{ color:"#22d3ee" }}>■</span> Train: {stats.train}</span>
        <span><span style={{ color:"#3b82f6" }}>■</span> Val: {stats.val}</span>
        <span><span style={{ color:"#8b5cf6" }}>■</span> Test: {stats.test}</span>
        <span style={{ color:"#6b7280" }}>Total: {stats.total}</span>
      </div>
    </div>
  );
}

export default function SplitVisualizer() {
  const { versions, loading } = useDatasetVersions();
  const [selected, setSelected]   = useState<string | null>(null);
  const [stats,    setStats]       = useState<SplitStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Preview: simulate split with LCG for selected version
  const selectedVersion = versions.find(v => v.id === selected);

  useEffect(() => {
    if(!selected) return;
    setLoadingStats(true);
    fetchSplitStats(selected)
      .then(s => setStats(s))
      .finally(() => setLoadingStats(false));
  }, [selected]);

  // Determinism preview: same seed → same split
  const previewSplit = selectedVersion
    ? computeDeterministicSplits(
        Array.from({ length: Math.min(20, selectedVersion.total_files) },
          (_, i) => ({ id:`file-${i}`, file_name:`audio_${i}.wav` })),
        {
          seed:        selectedVersion.split_seed,
          train_ratio: selectedVersion.split_train_ratio,
          val_ratio:   selectedVersion.split_val_ratio,
          test_ratio:  selectedVersion.split_test_ratio,
        }
      )
    : [];

  return (
    <div>
      {/* Version selector */}
      <div style={{ background:"#0d1117", border:"1px solid #1f2937",
        borderRadius:8, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:11, color:"#6b7280", marginBottom:8,
          textTransform:"uppercase", letterSpacing:1 }}>
          Select Dataset Version
        </div>
        <select value={selected ?? ""}
          onChange={e => { setSelected(e.target.value); setStats(null); }}
          style={{ width:"100%", background:"#111827", color:"#e5e7eb",
            border:"1px solid #1f2937", borderRadius:4, padding:"6px 8px",
            fontSize:12 }}>
          <option value="">— Select version —</option>
          {versions.map(v => (
            <option key={v.id} value={v.id}>
              v{v.version_number} · {v.project_name} · {v.total_files} files
            </option>
          ))}
        </select>
      </div>

      {selectedVersion && (
        <>
          {/* Split metadata */}
          <div style={{ background:"#0d1117", border:"1px solid #1f2937",
            borderRadius:8, padding:14, marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
              textTransform:"uppercase", letterSpacing:1 }}>
              Split Configuration
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
              gap:8, marginBottom:12 }}>
              {[
                { label:"Seed (LCG)", value:selectedVersion.split_seed, color:"#f59e0b" },
                { label:"Train",value:`${Math.round(selectedVersion.split_train_ratio*100)}%`,color:"#22d3ee" },
                { label:"Val",  value:`${Math.round(selectedVersion.split_val_ratio*100)}%`,  color:"#3b82f6" },
                { label:"Test", value:`${Math.round(selectedVersion.split_test_ratio*100)}%`, color:"#8b5cf6" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background:"#111827", borderRadius:6,
                  padding:"10px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:18, fontWeight:700, color }}>{value}</div>
                  <div style={{ fontSize:9, color:"#6b7280", marginTop:2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:10, color:"#374151", marginTop:4 }}>
              Same seed ({selectedVersion.split_seed}) + same files →
              same split always (LCG Fisher-Yates)
            </div>
          </div>

          {/* Actual split stats from DB */}
          {(stats || loadingStats) && (
            <div style={{ background:"#0d1117", border:"1px solid #1f2937",
              borderRadius:8, padding:14, marginBottom:12 }}>
              <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
                textTransform:"uppercase", letterSpacing:1 }}>
                Actual Split Distribution (from DB)
              </div>
              {loadingStats ? (
                <div style={{ color:"#4b5563", fontSize:11 }}>Loading split data...</div>
              ) : stats && (
                <SplitBar stats={stats} />
              )}
            </div>
          )}

          {/* Preview (LCG simulation) */}
          {previewSplit.length > 0 && (
            <div style={{ background:"#0d1117", border:"1px solid #1f2937",
              borderRadius:8, padding:14 }}>
              <div style={{ fontSize:11, color:"#6b7280", marginBottom:10,
                textTransform:"uppercase", letterSpacing:1 }}>
                Determinism Preview (first {previewSplit.length} files)
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                {previewSplit.map((s, i) => (
                  <div key={i} style={{ padding:"2px 6px", borderRadius:3,
                    fontSize:9,
                    background: s.bucket==="train"?"#22d3ee22":
                                s.bucket==="val"  ?"#3b82f622":"#8b5cf622",
                    color:      s.bucket==="train"?"#22d3ee":
                                s.bucket==="val"  ?"#3b82f6":"#8b5cf6",
                    border:`1px solid ${s.bucket==="train"?"#22d3ee44":
                                        s.bucket==="val"  ?"#3b82f644":"#8b5cf644"}`,
                  }}>
                    {s.bucket}
                  </div>
                ))}
              </div>
              <div style={{ fontSize:9, color:"#374151", marginTop:8 }}>
                Run again with same seed → identical sequence
              </div>
            </div>
          )}
        </>
      )}

      {!selected && !loading && (
        <div style={{ color:"#4b5563", fontSize:12, textAlign:"center", padding:32,
          border:"1px dashed #1f2937", borderRadius:8 }}>
          Select a dataset version to visualize splits
        </div>
      )}
    </div>
  );
}
