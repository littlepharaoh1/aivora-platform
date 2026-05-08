// ============================================================================
// Aivora Store Panel - Test/Debug panel for the central store
// ============================================================================
// This is a temporary diagnostic panel to verify that the AivoraStore is
// working before we wire up the real tabs. It shows:
//   • How many files are in the store
//   • Storage usage
//   • Upload button (bulk)
//   • Clear all button
// ============================================================================

import { useRef, useState } from "react";
import { useAivora } from "../lib/store/AivoraContext";

export default function StorePanel() {
  const {
    records,
    stats,
    storageInfo,
    isHydrating,
    addFiles,
    clearAll,
    refreshStorageInfo,
    analyzeAll,
    analysisProgress,
  } = useAivora();

  const [profile, setProfile] = useState("asr_studio");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    try {
      // Add in one bulk call (chunked internally at 25 per batch)
      await addFiles(files);
      setProgress({ done: files.length, total: files.length });
      await refreshStorageInfo();
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed: " + (err as Error).message);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleClear() {
    if (!confirm("Clear ALL files from the central store? This cannot be undone.")) {
      return;
    }
    await clearAll();
    await refreshStorageInfo();
  }

  const fmtBytes = (b?: number) => {
    if (!b) return "—";
    const mb = b / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  if (isHydrating) {
    return (
      <div style={panelStyle}>
        <h2 style={titleStyle}>AIVORA CENTRAL STORE</h2>
        <p style={mutedStyle}>Loading from IndexedDB...</p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={titleStyle}>AIVORA CENTRAL STORE</h2>
          <p style={mutedStyle}>
            Diagnostic panel · Bulk upload + persistent storage
          </p>
        </div>
        <span style={badgeStyle}>{records.length} files</span>
      </div>

      {/* Stats Grid */}
      <div style={gridStyle}>
        <Card label="TOTAL" value={stats.total} color="#7dd3fc" />
        <Card label="READY" value={stats.ready} color="#10b981" />
        <Card label="REVIEW" value={stats.review} color="#f59e0b" />
        <Card label="REJECTED" value={stats.rejected} color="#ef4444" />
      </div>

      {/* Storage Info */}
      <div style={infoBoxStyle}>
        <strong style={{ color: "#7dd3fc" }}>STORAGE</strong>
        <div style={{ marginTop: 8, fontSize: 13, color: "#94a3b8" }}>
          <div>Records in DB: {storageInfo.recordsCount}</div>
          <div>Blobs in DB: {storageInfo.blobsCount}</div>
          <div>
            Used: {fmtBytes(storageInfo.estimatedUsage)} /{" "}
            {fmtBytes(storageInfo.estimatedQuota)}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <button
          style={btnPrimary}
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          {busy
            ? `Uploading ${progress.done}/${progress.total}...`
            : "📁 Bulk Upload Audio Files"}
        </button>
        <button style={btnDanger} onClick={handleClear} disabled={busy}>
          🗑️ Clear All
        </button>

        <button
          onClick={() => analyzeAll(profile)}
          style={{
            background: "#10b98122",
            border: "1px solid #10b981",
            color: "#10b981",
            padding: "10px 16px",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: "monospace",
            fontWeight: 700,
            marginRight: 12,
          }}
        >
          🧠 Analyze All
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.flac"
          multiple
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </div>

      {/* File List */}
      {records.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <strong style={{ color: "#7dd3fc" }}>
            FILES IN STORE ({records.length})
          </strong>
          <div style={listStyle}>
            {records.slice(0, 50).map((r) => (
              <div key={r.id} style={listItemStyle}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.filename}
                </span>
                <span style={stageBadge(r.stage)}>{r.stage}</span>
              </div>
            ))}
            {records.length > 50 && (
              <div style={mutedStyle}>...and {records.length - 50} more</div>
            )}
          </div>
        </div>
      )}

      {records.length === 0 && (
        <div style={{ marginTop: 24, textAlign: "center", padding: 32 }}>
          <p style={mutedStyle}>
            No files in store. Click "Bulk Upload" to add files.
          </p>
          <p style={{ ...mutedStyle, fontSize: 12, marginTop: 8 }}>
            Files persist across page reloads (IndexedDB).
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component ───
function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={cardStyle(color)}>
      <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ─── Styles ───
const panelStyle: React.CSSProperties = {
  padding: 24,
  background: "#0b1220",
  border: "1px solid #1e293b",
  borderRadius: 12,
  color: "#e2e8f0",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  letterSpacing: 1,
  color: "#7dd3fc",
};

const mutedStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 13,
  margin: "4px 0",
};

const badgeStyle: React.CSSProperties = {
  background: "#1e293b",
  color: "#7dd3fc",
  padding: "4px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "monospace",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 12,
  marginTop: 20,
};

const cardStyle = (color: string): React.CSSProperties => ({
  background: "#0f172a",
  border: `1px solid ${color}33`,
  borderTop: `2px solid ${color}`,
  borderRadius: 8,
  padding: 16,
});

const infoBoxStyle: React.CSSProperties = {
  marginTop: 20,
  padding: 16,
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
};

const btnPrimary: React.CSSProperties = {
  background: "#0ea5e9",
  color: "#fff",
  border: "none",
  padding: "10px 20px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};

const btnAnalyze: React.CSSProperties = {
  background: "#10b981",
  color: "#fff",
  border: "none",
  padding: "10px 20px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
};

const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: "#10b981",
  border: "1px solid #10b981",
  padding: "10px 20px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
};

const listStyle: React.CSSProperties = {
  marginTop: 12,
  maxHeight: 300,
  overflow: "auto",
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  padding: 8,
};

const listItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "6px 8px",
  fontSize: 12,
  fontFamily: "monospace",
  borderBottom: "1px solid #1e293b",
};

const stageBadge = (stage: string): React.CSSProperties => {
  const colors: Record<string, string> = {
    uploaded: "#7dd3fc",
    analyzed: "#10b981",
    enhanced: "#a78bfa",
    rejected: "#ef4444",
  };
  return {
    background: `${colors[stage] || "#64748b"}22`,
    color: colors[stage] || "#94a3b8",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 10,
    letterSpacing: 1,
  };
};
