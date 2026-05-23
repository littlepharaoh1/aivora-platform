/**
 * frontendSurfaceAudit.ts — Frontend Surface Audit
 * Aivora Platform — PRE-PROMPT-9
 *
 * Documents the gap between:
 * "what exists architecturally" vs "what is visible to users"
 */

export interface FrontendFeatureSurface {
  feature_name:           string;
  tier:                   string;
  backend_exists:         boolean;
  frontend_visible:       boolean;
  partially_connected:    boolean;
  user_accessible:        boolean;
  observability_visible:  boolean;
  workflow_complete:      boolean;
  missing_components:     string[];
}

// ── Audit Results ─────────────────────────────────────────────────────────────

export const FRONTEND_SURFACE_AUDIT: FrontendFeatureSurface[] = [

  // ── Tier 0-1: Core + QC ──────────────────────────────────────────────────
  {
    feature_name:          "QC Workstation V2",
    tier:                  "Tier 0-1",
    backend_exists:        true,
    frontend_visible:      true,
    partially_connected:   false,
    user_accessible:       true,
    observability_visible: false,
    workflow_complete:     true,
    missing_components:    ["Runtime pressure indicator", "GPU backend display"],
  },
  {
    feature_name:          "Batch Analyzer",
    tier:                  "Tier 0-1",
    backend_exists:        true,
    frontend_visible:      true,
    partially_connected:   true,
    user_accessible:       true,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Quality gate integration", "Export to dataset pipeline"],
  },
  {
    feature_name:          "Human QA Consensus Infrastructure",
    tier:                  "Tier 1",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Reviewer assignment UI", "Consensus workflow UI", "Escalation UI"],
  },
  {
    feature_name:          "Task Assignments + Reviewer Leaderboard",
    tier:                  "Tier 1",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Assignment dashboard", "Reviewer score UI"],
  },

  // ── Tier 2: DSP ────────────────────────────────────────────────────────────
  {
    feature_name:          "DSP Management Dashboard",
    tier:                  "Tier 2",
    backend_exists:        true,
    frontend_visible:      true,
    partially_connected:   true,
    user_accessible:       true,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["DSP phase status", "Worker pool visualizer"],
  },
  {
    feature_name:          "DSP Validation Dashboard",
    tier:                  "Tier 2",
    backend_exists:        true,
    frontend_visible:      true,
    partially_connected:   true,
    user_accessible:       true,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Golden reference comparator", "Benchmark corpus UI"],
  },
  {
    feature_name:          "Forensic Silence Repair",
    tier:                  "Tier 2",
    backend_exists:        true,
    frontend_visible:      true,
    partially_connected:   true,
    user_accessible:       true,
    observability_visible: false,
    workflow_complete:     true,
    missing_components:    ["Repair lineage viewer"],
  },

  // ── Tier 3: Routing + Offline ──────────────────────────────────────────────
  {
    feature_name:          "Active Learning Router",
    tier:                  "Tier 3",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Routing decision viewer", "Route override UI"],
  },
  {
    feature_name:          "Offline Mutation Queue",
    tier:                  "Tier 3",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Offline queue status indicator", "Sync progress UI"],
  },

  // ── Tier 4: Observability ──────────────────────────────────────────────────
  {
    feature_name:          "Observability Dashboard",
    tier:                  "Tier 4",
    backend_exists:        true,
    frontend_visible:      true,
    partially_connected:   true,
    user_accessible:       true,
    observability_visible: true,
    workflow_complete:     false,
    missing_components:    [
      "GPU telemetry panel",
      "Inference telemetry",
      "Worker timing breakdown",
      "Correlation tracer",
      "Evidence chain inspector",
      "Crash log explorer",
    ],
  },
  {
    feature_name:          "Analytics Engine (6 materialized views)",
    tier:                  "Tier 4",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    [
      "Reviewer throughput chart",
      "Forensic verdict distribution chart",
      "Routing decision chart",
      "DSP timing chart",
      "Fraud heatmap",
      "Queue retry analytics",
    ],
  },
  {
    feature_name:          "Forensic Evidence Chain",
    tier:                  "Tier 4",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Evidence chain timeline UI", "Lineage inspector"],
  },
  {
    feature_name:          "Cross-File Intelligence",
    tier:                  "Tier 4",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Similarity matrix visualization", "Cluster viewer"],
  },

  // ── Tier 5: Runtime Control Plane ─────────────────────────────────────────
  {
    feature_name:          "Runtime Scheduler",
    tier:                  "Tier 5",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Runtime status panel", "Queue depth indicator", "Pressure gauge"],
  },
  {
    feature_name:          "Session Survivability Engine",
    tier:                  "Tier 5",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Session health score display", "Recovery action log"],
  },
  {
    feature_name:          "Execution Policies (4 modes)",
    tier:                  "Tier 5",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Policy mode indicator", "Manual override UI"],
  },

  // ── Tier 6A: GPU ───────────────────────────────────────────────────────────
  {
    feature_name:          "GPU Runtime (WebGPU/WebGL2)",
    tier:                  "Tier 6A",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["GPU tier badge", "Active backend indicator", "Fallback chain status"],
  },
  {
    feature_name:          "Shared Memory Pool (SAB)",
    tier:                  "Tier 6A",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["SAB enabled badge", "Active slots indicator"],
  },

  // ── Tier 6B: AI Model Execution ────────────────────────────────────────────
  {
    feature_name:          "ONNX Runtime + Model Registry",
    tier:                  "Tier 6B",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Model selector UI", "Inference backend indicator", "Model version display"],
  },
  {
    feature_name:          "VAD Engine",
    tier:                  "Tier 6B",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["VAD visualization", "Speech segment highlighter"],
  },
  {
    feature_name:          "Inference Scheduler + Safety Constraints",
    tier:                  "Tier 6B",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Inference queue UI", "Safety constraint status"],
  },

  // ── Tier 7: Dataset Factory ────────────────────────────────────────────────
  {
    feature_name:          "Dataset Versions + Quality Gates",
    tier:                  "Tier 7",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Dataset version creator UI", "Quality gate configurator"],
  },
  {
    feature_name:          "Dataset Pipeline Orchestration",
    tier:                  "Tier 7",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Pipeline runner UI", "Step progress visualization", "Pipeline history"],
  },
  {
    feature_name:          "Format Adapters (OpenAI/Whisper/NeMo/HF)",
    tier:                  "Tier 7",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Format selector UI", "Export trigger button", "Manifest download"],
  },
  {
    feature_name:          "Dataset Intelligence (quality dist, drift)",
    tier:                  "Tier 7",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Intelligence report UI", "Split drift chart", "Hard example list"],
  },

  // ── Tier 8: Speech Intelligence ────────────────────────────────────────────
  {
    feature_name:          "ASR Runtime (Whisper/greedy)",
    tier:                  "Tier 8",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Transcription trigger UI", "Transcript viewer", "Model selector"],
  },
  {
    feature_name:          "Token Alignment + Timestamps",
    tier:                  "Tier 8",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Aligned transcript viewer", "Token timestamp display"],
  },
  {
    feature_name:          "Multilingual RTL + Arabic",
    tier:                  "Tier 8",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["RTL transcript renderer", "Bidi segment display", "Arabic numeral support"],
  },
  {
    feature_name:          "Speech QA + Hallucination Detection",
    tier:                  "Tier 8",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["QA report panel", "Hallucination warning display"],
  },
  {
    feature_name:          "Streaming Inference Fabric",
    tier:                  "Tier 8",
    backend_exists:        true,
    frontend_visible:      false,
    partially_connected:   false,
    user_accessible:       false,
    observability_visible: false,
    workflow_complete:     false,
    missing_components:    ["Streaming session UI", "Partial transcript display", "Stream state indicator"],
  },
];

// ── Summary Statistics ────────────────────────────────────────────────────────

export function computeAuditSummary(audit: FrontendFeatureSurface[]) {
  const total           = audit.length;
  const fullySurfaced   = audit.filter(f => f.frontend_visible && f.workflow_complete).length;
  const partiallySurf   = audit.filter(f => f.partially_connected && !f.workflow_complete).length;
  const backendOnly     = audit.filter(f => !f.frontend_visible && !f.partially_connected).length;
  const withObserv      = audit.filter(f => f.observability_visible).length;

  return {
    total,
    fully_surfaced:   fullySurfaced,
    partially_surfaced:partiallySurf,
    backend_only:     backendOnly,
    with_observability:withObserv,
    surface_coverage: Math.round((fullySurfaced / total) * 100),
  };
}
