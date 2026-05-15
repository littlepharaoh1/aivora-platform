// @ts-nocheck
/**
 * ConversationRooms.tsx — Conversation Rooms V8 Multi-Clip Builder
 * Extracted from original App.tsx
 */
import React, { useState } from "react";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  downloadBlob(blob, filename);
}

export default function ConversationRooms() {
  const [roomFileA, setRoomFileA] = useState<File | null>(null);
  const [roomFileB, setRoomFileB] = useState<File | null>(null);
  const [roomFilesA, setRoomFilesA] = useState<File[]>([]);
  const [roomFilesB, setRoomFilesB] = useState<File[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeLog, setMergeLog] = useState<string[]>([]);

  const roomReady = !!roomFileA && !!roomFileB;

  const roomStatus = roomReady
    ? `Ready — A: ${roomFilesA.length || 1} file(s), B: ${roomFilesB.length || 1} file(s)`
    : "Waiting for both speakers";

  const roomFileSummary = [
    `Speaker A Files: ${roomFilesA.length || (roomFileA ? 1 : 0)}`,
    `Speaker B Files: ${roomFilesB.length || (roomFileB ? 1 : 0)}`,
    `Status: ${roomStatus}`,
  ].join("\n");

  async function decodeFile(file: File): Promise<AudioBuffer> {
    const ctx = new AudioContext();
    const ab = await file.arrayBuffer();
    return ctx.decodeAudioData(ab);
  }

  function mixToMono(buf: AudioBuffer): Float32Array {
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < buf.length; i++) mono[i] += d[i];
    }
    if (buf.numberOfChannels > 1)
      for (let i = 0; i < mono.length; i++) mono[i] /= buf.numberOfChannels;
    return mono;
  }

  function concatFloat32(arrays: Float32Array[]): Float32Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
  }

  function encodeWav(left: Float32Array, right: Float32Array, sr: number): ArrayBuffer {
    const len = Math.max(left.length, right.length);
    const buf = new ArrayBuffer(44 + len * 4);
    const view = new DataView(buf);
    const write = (s: string, o: number) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    write("RIFF", 0); view.setUint32(4, 36 + len * 4, true); write("WAVE", 8);
    write("fmt ", 12); view.setUint32(16, 16, true); view.setUint16(20, 3, true); // IEEE float
    view.setUint16(22, 2, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * 8, true); view.setUint16(32, 8, true);
    view.setUint16(34, 32, true); write("data", 36); view.setUint32(40, len * 8, true);
    let offset = 44;
    for (let i = 0; i < len; i++) {
      view.setFloat32(offset, left[i] ?? 0, true); offset += 4;
      view.setFloat32(offset, right[i] ?? 0, true); offset += 4;
    }
    return buf;
  }

  async function mergeRoomFiles() {
    const filesA = roomFilesA.length ? roomFilesA : roomFileA ? [roomFileA] : [];
    const filesB = roomFilesB.length ? roomFilesB : roomFileB ? [roomFileB] : [];
    if (!filesA.length || !filesB.length) return;

    setMerging(true);
    setMergeLog(["Starting merge..."]);

    try {
      const log: string[] = [];
      const bufsA: Float32Array[] = [];
      const bufsB: Float32Array[] = [];
      let sr = 44100;

      for (const f of filesA) {
        const buf = await decodeFile(f);
        sr = buf.sampleRate;
        bufsA.push(mixToMono(buf));
        log.push(`A: ${f.name} (${buf.duration.toFixed(2)}s)`);
      }
      for (const f of filesB) {
        const buf = await decodeFile(f);
        bufsB.push(mixToMono(buf));
        log.push(`B: ${f.name} (${buf.duration.toFixed(2)}s)`);
      }

      const left  = concatFloat32(bufsA);
      const right = concatFloat32(bufsB);
      const wav   = encodeWav(left, right, sr);

      downloadBlob(new Blob([wav], { type: "audio/wav" }),
        "conversation_room_stereo.wav");
      log.push(`✅ Exported stereo WAV (${(wav.byteLength/1024/1024).toFixed(1)}MB)`);
      setMergeLog(log);
    } catch (e) {
      setMergeLog([`❌ Error: ${e}`]);
    }
    setMerging(false);
  }

  const s = {
    panel: {
      background: "#0D1826", border: "1px solid #1A3045",
      borderRadius: 12, padding: 16, marginBottom: 12,
    },
    label: { fontSize: 9, color: "#2A5A6A", letterSpacing: 2, marginBottom: 8 },
    btn: {
      background: "#0EA5E922", border: "1px solid #0EA5E944",
      borderRadius: 8, padding: "8px 16px", cursor: "pointer",
      color: "#0EA5E9", fontSize: 11, fontWeight: 600,
      fontFamily: "inherit",
    },
    btnPrimary: {
      background: "#10B98122", border: "1px solid #10B98144",
      borderRadius: 8, padding: "8px 20px", cursor: "pointer",
      color: "#10B981", fontSize: 12, fontWeight: 700,
      fontFamily: "inherit",
    },
    stat: { fontSize: 9, color: "#64A0B8", padding: "3px 0" },
  } as const;

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ ...s.panel, borderTop: "2px solid #0EA5E9" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#E2EEF6", marginBottom: 4 }}>
          🎙 Conversation Rooms V8
        </div>
        <div style={{ fontSize: 11, color: "#64A0B8" }}>
          Studio-grade dual speaker import, validation, and stereo merge
        </div>
      </div>

      {/* Status */}
      <div style={s.panel}>
        <div style={s.label}>ROOM STATUS</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            ["Mode",      "Two Speakers"],
            ["Speaker A", "Left Channel"],
            ["Speaker B", "Right Channel"],
            ["Target",    "WAV Stereo 32-bit"],
            ["Status",    roomStatus],
            ["Ready",     roomReady ? "✅ YES" : "⏳ NO"],
          ].map(([k,v]) => (
            <div key={k} style={{ minWidth: 140 }}>
              <div style={{ fontSize: 8, color: "#2A5A6A", marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 10, color: "#E2EEF6", fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>

        {/* Speaker A */}
        <div style={{ ...s.panel, borderTop: "2px solid #0EA5E9" }}>
          <div style={s.label}>SPEAKER A — LEFT CHANNEL</div>
          <input id="roomA" type="file" accept=".wav" multiple style={{ display: "none" }}
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              if (files.length === 1) setRoomFileA(files[0]);
              setRoomFilesA(files);
            }}/>
          <button style={s.btn} onClick={() => document.getElementById("roomA")?.click()}>
            📁 Import Speaker A
          </button>
          {roomFilesA.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {roomFilesA.map((f,i) => (
                <div key={i} style={{ fontSize: 9, color: "#10B981", marginTop: 2 }}>
                  ✓ {f.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Speaker B */}
        <div style={{ ...s.panel, borderTop: "2px solid #8B5CF6" }}>
          <div style={{ ...s.label, color: "#8B5CF633" }}>SPEAKER B — RIGHT CHANNEL</div>
          <input id="roomB" type="file" accept=".wav" multiple style={{ display: "none" }}
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              if (files.length === 1) setRoomFileB(files[0]);
              setRoomFilesB(files);
            }}/>
          <button style={{ ...s.btn, color: "#8B5CF6",
            background: "#8B5CF622", borderColor: "#8B5CF644" }}
            onClick={() => document.getElementById("roomB")?.click()}>
            📁 Import Speaker B
          </button>
          {roomFilesB.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {roomFilesB.map((f,i) => (
                <div key={i} style={{ fontSize: 9, color: "#10B981", marginTop: 2 }}>
                  ✓ {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button style={{ ...s.btnPrimary, opacity: roomReady ? 1 : 0.4 }}
          disabled={!roomReady || merging}
          onClick={mergeRoomFiles}>
          {merging ? "⟳ Merging..." : "🔀 Merge Stereo WAV"}
        </button>
        <button style={{ ...s.btn, opacity: roomReady ? 1 : 0.4 }}
          disabled={!roomReady}
          onClick={() => downloadText("room_status.txt", roomFileSummary)}>
          📄 Export Status
        </button>
      </div>

      {/* Log */}
      {mergeLog.length > 0 && (
        <div style={s.panel}>
          <div style={s.label}>MERGE LOG</div>
          {mergeLog.map((l,i) => (
            <div key={i} style={{ fontSize: 10, color: "#64A0B8",
              padding: "2px 0", fontFamily: "monospace" }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
