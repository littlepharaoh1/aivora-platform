/**
 * projectGraph.ts — Enterprise Project Graph
 * Aivora Platform — Phase 15.1
 *
 * Pre-code safety check:
 * ✅ deterministic: topoSort reused from datasetPipeline.ts
 * ✅ bounded: MAX_NODES=500, MAX_EDGES=2000
 * ✅ no hidden state: pure graph functions
 * ✅ no GPU/worker dependencies
 * ✅ replay safe: same graph → same topoSort always
 * ✅ no mutable singletons
 *
 * WHY: No unified view of project→dataset→pipeline→review→model
 * EXTENDS: datasetPipeline.ts topoSort pattern (Tier 7)
 * FAILURE MODES: circular deps → caught by cycle detection
 */

import { supabase } from "../supabase";
import { emitEvent } from "../telemetry/emitter";

export const PROJECT_GRAPH_VERSION = "15.1.0";

// ── Hard Limits ───────────────────────────────────────────────────────────────

export const GRAPH_LIMITS = {
  MAX_NODES: 500,
  MAX_EDGES: 2000,
  MAX_DEPTH: 20,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProjectNodeType =
  | "project"
  | "dataset_version"
  | "pipeline_run"
  | "quality_gate"
  | "export"
  | "model"
  | "review_batch";

export interface ProjectNode {
  id:         string;
  type:       ProjectNodeType;
  label:      string;
  status:     string;
  created_at: string;
  metadata?:  Record<string, unknown>;
}

export interface ProjectEdge {
  from_id:    string;
  to_id:      string;
  edge_type:  "produces" | "consumes" | "validates" | "exports";
}

export interface ProjectGraph {
  nodes:      ProjectNode[];
  edges:      ProjectEdge[];
  topo_order: string[];       // deterministic execution order
  has_cycles: boolean;
  version:    string;
  project_id: string;
  built_at:   string;
}

// ── Deterministic Topological Sort ────────────────────────────────────────────
// Reuses same pattern as datasetPipeline.ts topoSort
// Same graph → same order always

export function topoSortGraph(
  nodes: ProjectNode[],
  edges: ProjectEdge[],
): { order: string[]; has_cycles: boolean } {
  const visited    = new Set<string>();
  const inProgress = new Set<string>();
  const result:    string[] = [];
  const adjList    = new Map<string, string[]>();

  // Build adjacency list
  for(const node of nodes) adjList.set(node.id, []);
  for(const edge of edges) {
    const list = adjList.get(edge.from_id);
    if(list) list.push(edge.to_id);
  }

  let hasCycles = false;

  function visit(id: string, depth = 0): void {
    if(depth > GRAPH_LIMITS.MAX_DEPTH) { hasCycles = true; return; }
    if(visited.has(id)) return;
    if(inProgress.has(id)) { hasCycles = true; return; }

    inProgress.add(id);
    const neighbors = adjList.get(id) ?? [];
    // Sort for determinism
    [...neighbors].sort().forEach(n => visit(n, depth + 1));
    inProgress.delete(id);
    visited.add(id);
    result.push(id);
  }

  // Process in stable alphabetical order
  [...nodes].sort((a,b) => a.id.localeCompare(b.id))
    .forEach(n => visit(n.id));

  return { order: result, has_cycles: hasCycles };
}

// ── Project Graph Builder ─────────────────────────────────────────────────────

export async function buildProjectGraph(
  projectId:     string,
  correlationId: string,
): Promise<ProjectGraph | null> {
  try {
    // Fetch project assets in parallel — bounded queries
    const [versions, pipelines, gates, exports_] = await Promise.all([
      supabase.from("dataset_versions")
        .select("id,version_number,status,created_at")
        .eq("project_name", projectId).limit(100),
      supabase.from("pipeline_runs")
        .select("id,pipeline_name,status,created_at,version_id")
        .eq("project_name", projectId).limit(100),
      supabase.from("quality_gates")
        .select("id,gate_name,is_active,created_at")
        .eq("project_name", projectId).limit(50),
      supabase.from("dataset_exports")
        .select("id,status,created_at")
        .limit(50),
    ]);

    const nodes: ProjectNode[] = [];
    const edges: ProjectEdge[] = [];

    // Project root node
    nodes.push({
      id: projectId, type:"project",
      label: projectId, status:"active",
      created_at: new Date().toISOString(),
    });

    // Dataset version nodes
    for(const v of versions.data ?? []) {
      nodes.push({ id:v.id, type:"dataset_version",
        label:`v${v.version_number}`, status:v.status,
        created_at:v.created_at });
      edges.push({ from_id:projectId, to_id:v.id, edge_type:"produces" });
    }

    // Quality gate nodes
    for(const g of gates.data ?? []) {
      nodes.push({ id:g.id, type:"quality_gate",
        label:g.gate_name, status:g.is_active?"active":"inactive",
        created_at:g.created_at });
      edges.push({ from_id:projectId, to_id:g.id, edge_type:"validates" });
    }

    // Pipeline run nodes
    for(const p of pipelines.data ?? []) {
      nodes.push({ id:p.id, type:"pipeline_run",
        label:p.pipeline_name, status:p.status,
        created_at:p.created_at });
      if(p.version_id) {
        edges.push({ from_id:p.version_id, to_id:p.id, edge_type:"consumes" });
      } else {
        edges.push({ from_id:projectId, to_id:p.id, edge_type:"produces" });
      }
    }

    // Enforce limits
    if(nodes.length > GRAPH_LIMITS.MAX_NODES ||
       edges.length > GRAPH_LIMITS.MAX_EDGES) {
      console.warn(`[ProjectGraph] Limits exceeded — truncating`);
    }

    const boundedNodes = nodes.slice(0, GRAPH_LIMITS.MAX_NODES);
    const boundedEdges = edges.slice(0, GRAPH_LIMITS.MAX_EDGES);

    const { order, has_cycles } = topoSortGraph(boundedNodes, boundedEdges);

    const graph: ProjectGraph = {
      nodes:      boundedNodes,
      edges:      boundedEdges,
      topo_order: order,
      has_cycles,
      version:    PROJECT_GRAPH_VERSION,
      project_id: projectId,
      built_at:   new Date().toISOString(),
    };

    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:correlationId, severity:"info",
      payload:{ action:"PROJECT_GRAPH_BUILT",
        project_id:projectId, node_count:boundedNodes.length,
        edge_count:boundedEdges.length, has_cycles,
        protocol:PROJECT_GRAPH_VERSION },
    });

    return graph;

  } catch(e) {
    console.error("[ProjectGraph] Build failed:", e);
    return null;
  }
}
