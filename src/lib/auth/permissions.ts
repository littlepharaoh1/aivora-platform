/**
 * permissions.ts — Role-based access control
 * Aivora Platform Enterprise
 */

export type AivoraRole =
  | "owner"
  | "admin"
  | "manager"
  | "qa_manager"
  | "qa_reviewer"
  | "operator"
  | "contributor"
  | "client_viewer";

export type AivoraModule =
  | "dashboard"
  | "upload"
  | "qc"
  | "contributors"
  | "naming"
  | "control"
  | "export"
  | "rooms"
  | "enhancement"
  | "readiness"
  | "analyzer"
  | "batch"
  | "pipeline"
  | "store"
  | "sequencer"
  | "monitor"
  // Phase 15.3 — New platform modules
  | "runtime_center"
  | "analytics"
  | "speech_intel"
  | "dataset_factory"
  | "qa_intel"
  | "multimodal"
  | "observability"
  | "dsp_management"
  | "dsp_validation"
  | "audiobench"
  | "proeditor"
  | "documentation";

export const ROLE_PERMISSIONS: Record<AivoraRole, AivoraModule[]> = {
  owner: [
    "dashboard","upload","qc","contributors","naming","control",
    "export","rooms","enhancement","readiness","analyzer","batch",
    "pipeline","store","sequencer","monitor",
    // Phase 15.3
    "runtime_center","analytics","speech_intel","dataset_factory",
    "qa_intel","multimodal","observability","dsp_management",
    "dsp_validation","audiobench","proeditor","documentation"
  ],
  admin: [
    "dashboard","upload","qc","contributors","naming","control",
    "export","rooms","enhancement","readiness","analyzer","batch",
    "pipeline","store","sequencer","monitor",
    // Phase 15.3
    "runtime_center","analytics","speech_intel","dataset_factory",
    "qa_intel","multimodal","observability","dsp_management",
    "dsp_validation","audiobench","proeditor","documentation"
  ],
  manager: [
    "dashboard","batch","analyzer","naming","export","readiness","contributors"
  ],
  qa_manager: [
    "dashboard","analyzer","batch","enhancement","readiness","export","qc"
  ],
  qa_reviewer: [
    "dashboard","analyzer","qc","readiness","export"
  ],
  operator: [
    "dashboard","upload","naming","batch","export","sequencer"
  ],
  contributor: [
    "upload"
  ],
  client_viewer: [
    "dashboard","upload","qc","contributors","naming","control",
    "export","rooms","enhancement","readiness","analyzer","batch",
    "pipeline","store","sequencer"
  ],
};

export function canAccess(role: AivoraRole, module: AivoraModule): boolean {
  return ROLE_PERMISSIONS[role]?.includes(module) ?? false;
}

export function getAllowedTabs(role: AivoraRole): AivoraModule[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export const MODULE_LABELS: Record<AivoraModule, string> = {
  dashboard:       "Dashboard",
  upload:          "Upload Center",
  qc:              "QC Workstation",
  contributors:    "Contributors",
  naming:          "German Naming",
  control:         "Control Center",
  export:          "Export Package",
  rooms:           "Conversation Rooms",
  enhancement:     "Enhancement Lab",
  readiness:       "Readiness Score",
  analyzer:        "Quality Analyzer",
  batch:           "Batch Analyzer",
  pipeline:        "Audio Pipeline",
  store:           "Aivora Store",
  sequencer:       "Smart Naming",
  monitor:         "Activity Monitor",
  runtime_center:  "Runtime Center",
  analytics:       "Analytics",
  speech_intel:    "Speech Intel",
  dataset_factory: "Dataset Factory",
  qa_intel:        "QA Intelligence",
  multimodal:      "Multimodal Intel",
  observability:   "Observability",
  dsp_management:  "DSP Management",
  dsp_validation:  "DSP Validation",
  audiobench:      "Audio Bench",
  proeditor:       "Pro Editor",
  documentation:   "Documentation",
};

export const ROLE_COLORS: Record<AivoraRole, string> = {
  owner:        "#f59e0b",
  admin:        "#22d3ee",
  manager:      "#10b981",
  qa_manager:   "#8b5cf6",
  qa_reviewer:  "#6366f1",
  operator:     "#a0c4cc",
  contributor:  "#64748b",
  client_viewer:"#4a8a9a",
};

export const ROLE_DISPLAY: Record<AivoraRole, string> = {
  owner:        "Owner",
  admin:        "Admin",
  manager:      "Manager",
  qa_manager:   "QA Manager",
  qa_reviewer:  "QA Reviewer",
  operator:     "Operator",
  contributor:  "Contributor",
  client_viewer:"Client Viewer",
};
