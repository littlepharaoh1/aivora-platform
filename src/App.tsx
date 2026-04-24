import React, { useMemo, useState } from "react";
import "./styles.css";

type Tab =
  | "dashboard"
  | "upload"
  | "qc"
  | "contributors"
  | "naming"
  | "export";

type RecordStatus = "Pending" | "Approved" | "Review" | "Rejected";

type Contributor = {
  id: string;
  name: string;
  language: string;
  country: string;
  status: string;
};

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [speaker, setSpeaker] = useState("D0001");
  const [speed, setSpeed] = useState("normal");
  const [uploadedFile, setUploadedFile] = useState("");
  const [decision, setDecision] = useState<RecordStatus>("Pending");

  const contributors: Contributor[] = [
    { id: "C001", name: "Ahmed Ali", language: "German", country: "Egypt", status: "Active" },
    { id: "C002", name: "Sara Omar", language: "German", country: "Germany", status: "Active" },
    { id: "C003", name: "John M", language: "German", country: "Netherlands", status: "Pending" },
  ];

  const names = useMemo(() => {
    return Array.from({ length: 200 }, (_, i) => {
      const n = String(i + 1).padStart(4, "0");
      let task = "dkws";
      if (i >= 120 && i < 160) task = "oneshot200";
      if (i >= 160) task = "query";
      return `DE-DE_${speaker}_S${n}_${task}_${speed}.wav`;
    });
  }, [speaker, speed]);

  function exportCsv() {
    const rows = [
      ["file", "decision"],
      [uploadedFile || "sample.wav", decision]
    ]
      .map((r) => r.join(","))
      .join("\n");

    const blob = new Blob([rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "qc_report.csv";
    a.click();
  }

  function downloadNames() {
    const blob = new Blob([names.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "german_naming_1_200.txt";
    a.click();
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <h1>Aivora AI</h1>
        <p>AI · DATA · VISION</p>

        <button onClick={() => setTab("dashboard")}>Dashboard</button>
        <button onClick={() => setTab("upload")}>Upload Center</button>
        <button onClick={() => setTab("qc")}>QC Analyzer</button>
        <button onClick={() => setTab("contributors")}>Contributors</button>
        <button onClick={() => setTab("naming")}>German Naming</button>
        <button onClick={() => setTab("export")}>Export</button>
      </aside>

      <main className="content">
        {tab === "dashboard" && (
          <section>
            <h2>Operations Dashboard</h2>
            <div className="grid">
              <div className="card"><h3>Total Files</h3><strong>1,280</strong></div>
              <div className="card"><h3>Approved</h3><strong>1,102</strong></div>
              <div className="card"><h3>Review</h3><strong>91</strong></div>
              <div className="card"><h3>Rejected</h3><strong>87</strong></div>
            </div>
          </section>
        )}

        {tab === "upload" && (
          <section>
            <h2>Upload Center</h2>
            <input
              type="file"
              onChange={(e) =>
                setUploadedFile(e.target.files?.[0]?.name || "")
              }
            />
            <p>{uploadedFile || "No file selected"}</p>
          </section>
        )}

        {tab === "qc" && (
          <section>
            <h2>QC Audio Analyzer</h2>
            <div className="grid">
              <div className="card"><h3>Waveform</h3><p>Visual Ready</p></div>
              <div className="card"><h3>Noise Meter</h3><p>-86 dBFS</p></div>
              <div className="card"><h3>Decision</h3><p>{decision}</p></div>
            </div>

            <div className="actions">
              <button onClick={() => setDecision("Approved")}>Approve</button>
              <button onClick={() => setDecision("Review")}>Review</button>
              <button onClick={() => setDecision("Rejected")}>Reject</button>
            </div>
          </section>
        )}

        {tab === "contributors" && (
          <section>
            <h2>Contributor Management</h2>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Language</th>
                  <th>Country</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    <td>{c.language}</td>
                    <td>{c.country}</td>
                    <td>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === "naming" && (
          <section>
            <h2>German Naming 1–200</h2>

            <div className="actions">
              <input
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value.toUpperCase())}
              />
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
              >
                <option value="slow">slow</option>
                <option value="normal">normal</option>
                <option value="fast">fast</option>
              </select>

              <button onClick={downloadNames}>Download Names</button>
            </div>

            <div className="nameBox">
              {names.slice(0, 40).map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
          </section>
        )}

        {tab === "export" && (
          <section>
            <h2>Export Center</h2>
            <div className="actions">
              <button onClick={exportCsv}>Export CSV</button>
              <button onClick={downloadNames}>Export Naming Sheet</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
