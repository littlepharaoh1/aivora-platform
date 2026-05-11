/**
 * pdfReporter.ts — HTML-based QC Report Generator
 * Aivora Audio QC Engine — Batch 11
 */

export interface ReportData {
  fileName:    string;
  profile:     string;
  score:       number;
  grade:       string;
  verdict:     string;
  analyzedAt:  string;
  metrics: {
    duration:    string;
    sampleRate:  string;
    peak:        string;
    rms:         string;
    lufs:        string;
    truePeak:    string;
    lra:         string;
    snr:         string;
    noiseClass:  string;
    environment: string;
    speechRatio: string;
    qcScore:     string;
  };
  problems: {
    severity: string;
    message:  string;
    action?:  string;
  }[];
  silenceEdges: {
    leading:  string;
    trailing: string;
    ratio:    string;
  };
  repairs?: { operation: string }[];
  digitalGaps?: number;
}

function severityColor(s: string): string {
  switch (s) {
    case "critical": return "#ef4444";
    case "warning":  return "#f59e0b";
    case "medium":   return "#f97316";
    default:         return "#6b7280";
  }
}

function verdictColor(v: string): string {
  return v === "READY" ? "#10b981" : v === "REVIEW" ? "#f59e0b" : "#ef4444";
}

function scoreColor(s: number): string {
  return s >= 90 ? "#22d3ee" : s >= 75 ? "#10b981" : s >= 60 ? "#f59e0b" : s >= 40 ? "#f97316" : "#ef4444";
}

export function generateQCReportHTML(data: ReportData): string {
  const vc = verdictColor(data.verdict);
  const sc = scoreColor(data.score);

  const problemsRows = data.problems.map(p => `
    <tr>
      <td style="padding:6px 10px;">
        <span style="background:${severityColor(p.severity)}22;color:${severityColor(p.severity)};
          padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">
          ${p.severity.toUpperCase()}
        </span>
      </td>
      <td style="padding:6px 10px;font-size:11px;color:#334155;">${p.message}</td>
      <td style="padding:6px 10px;font-size:10px;color:#64748b;">${p.action ?? ""}</td>
    </tr>`).join("");

  const repairsHTML = data.repairs && data.repairs.length > 0
    ? data.repairs.map(r => `
        <div style="display:flex;gap:8px;margin-bottom:4px;">
          <span style="color:#10b981;font-weight:700;">✓</span>
          <span style="font-size:11px;color:#334155;">${r.operation}</span>
        </div>`).join("")
    : `<div style="font-size:11px;color:#94a3b8;">No repairs applied.</div>`;

  const metricsRows = Object.entries({
    "Duration":     data.metrics.duration,
    "Sample Rate":  data.metrics.sampleRate,
    "Peak Level":   data.metrics.peak,
    "RMS":          data.metrics.rms,
    "LUFS":         data.metrics.lufs,
    "True Peak":    data.metrics.truePeak,
    "LRA":          data.metrics.lra,
    "SNR":          data.metrics.snr,
    "Noise Class":  data.metrics.noiseClass,
    "Environment":  data.metrics.environment,
    "Speech Ratio": data.metrics.speechRatio,
    "QC Score":     data.metrics.qcScore,
  }).map(([k,v]) => `
    <div style="display:flex;justify-content:space-between;padding:5px 0;
      border-bottom:1px solid #f1f5f9;">
      <span style="font-size:11px;color:#64748b;">${k}</span>
      <span style="font-size:11px;font-weight:700;color:#1e293b;">${v}</span>
    </div>`).join("");

  const silenceRows = [
    ["Leading",  data.silenceEdges.leading],
    ["Trailing", data.silenceEdges.trailing],
    ["Ratio",    data.silenceEdges.ratio],
  ].map(([k,v]) => `
    <div style="display:flex;justify-content:space-between;padding:5px 0;
      border-bottom:1px solid #f1f5f9;">
      <span style="font-size:11px;color:#64748b;">${k}</span>
      <span style="font-size:11px;font-weight:700;color:#1e293b;">${v}</span>
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Aivora QC Report — ${data.fileName}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;}
  @media print{body{background:white;}.no-print{display:none;}.page{box-shadow:none;margin:0;}}
</style>
</head>
<body>
<div class="page" style="max-width:800px;margin:20px auto;background:white;
  border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a,#0c2340);padding:24px 32px;
    display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:18px;font-weight:800;color:white;letter-spacing:1px;">AIVORA QC REPORT</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px;letter-spacing:2px;">
        AUDIO QUALITY CONTROL · ${data.analyzedAt}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:36px;font-weight:900;color:${sc};font-family:monospace;">${data.score}</div>
      <div style="font-size:14px;font-weight:700;color:${sc};font-family:monospace;">Grade ${data.grade}</div>
    </div>
  </div>

  <!-- File + Verdict -->
  <div style="padding:20px 32px;background:#f8fafc;border-bottom:1px solid #e2e8f0;
    display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
    <div>
      <div style="font-size:13px;font-weight:700;color:#1e293b;">${data.fileName}</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px;">
        Profile: ${data.profile.toUpperCase()}
        ${data.digitalGaps ? ` · ⚠ ${data.digitalGaps} digital gap(s)` : ""}
      </div>
    </div>
    <div style="padding:6px 20px;border-radius:20px;background:${vc}22;
      border:1px solid ${vc}44;color:${vc};font-size:12px;font-weight:800;letter-spacing:2px;">
      ${data.verdict}
    </div>
  </div>

  <!-- Metrics + Silence/Repairs -->
  <div style="display:grid;grid-template-columns:1fr 1fr;">
    <div style="padding:20px 32px;border-right:1px solid #e2e8f0;">
      <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;margin-bottom:12px;">
        TECHNICAL METRICS
      </div>
      ${metricsRows}
    </div>
    <div style="padding:20px 32px;">
      <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;margin-bottom:12px;">
        SILENCE EDGES
      </div>
      ${silenceRows}
      <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;
        margin-top:20px;margin-bottom:12px;">REPAIRS APPLIED</div>
      ${repairsHTML}
    </div>
  </div>

  <!-- Problems -->
  <div style="padding:20px 32px;border-top:1px solid #e2e8f0;">
    <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;margin-bottom:12px;">
      QC PROBLEMS (${data.problems.length})
    </div>
    ${data.problems.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:8px 10px;font-size:10px;color:#64748b;text-align:left;width:90px;">SEVERITY</th>
          <th style="padding:8px 10px;font-size:10px;color:#64748b;text-align:left;">PROBLEM</th>
          <th style="padding:8px 10px;font-size:10px;color:#64748b;text-align:left;">ACTION</th>
        </tr>
      </thead>
      <tbody>${problemsRows}</tbody>
    </table>`
    : `<div style="font-size:11px;color:#10b981;font-weight:700;">✓ No problems detected</div>`}
  </div>

  <!-- Footer -->
  <div style="padding:14px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;
    display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:9px;color:#94a3b8;">
      Aivora Platform · DSP Engine V4 · EBU R128 + FFT + VAD + SNR
    </div>
    <button class="no-print" onclick="window.print()"
      style="background:#0f172a;color:white;border:none;padding:6px 16px;
      border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;">
      🖨 Print / Save PDF
    </button>
  </div>

</div>
</body>
</html>`;
}

export function openQCReport(data: ReportData): void {
  const html = generateQCReportHTML(data);
  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
