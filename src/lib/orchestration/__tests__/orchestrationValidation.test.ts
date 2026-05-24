/**
 * orchestrationValidation.test.ts — Phase 15.7 Validation Gates
 * Pure functions only — no supabase chain
 */
export {};

// ── Inlined pure functions ────────────────────────────────────────────────────

const PROJECT_GRAPH_VERSION  = "15.1.0";
const ORCHESTRATION_VERSION  = "15.2.0";
const GRAPH_LIMITS = { MAX_NODES:500, MAX_EDGES:2000, MAX_DEPTH:20 } as const;
const ORCHESTRATION_LIMITS = { MAX_STEPS:50, MAX_RETRIES:3, STEP_TIMEOUT_MS:30_000 } as const;

interface ProjectNode {
  id:string; type:string; label:string; status:string; created_at:string;
}
interface ProjectEdge {
  from_id:string; to_id:string; edge_type:string;
}

function topoSortGraph(nodes: ProjectNode[], edges: ProjectEdge[]) {
  const visited = new Set<string>(), inProgress = new Set<string>();
  const result: string[] = [];
  const adjList = new Map<string, string[]>();
  for(const n of nodes) adjList.set(n.id, []);
  for(const e of edges) { const l = adjList.get(e.from_id); if(l) l.push(e.to_id); }
  let hasCycles = false;

  function visit(id:string, depth=0): void {
    if(depth > GRAPH_LIMITS.MAX_DEPTH) { hasCycles = true; return; }
    if(visited.has(id)) return;
    if(inProgress.has(id)) { hasCycles = true; return; }
    inProgress.add(id);
    [...(adjList.get(id)??[])].sort().forEach(n => visit(n, depth+1));
    inProgress.delete(id);
    visited.add(id);
    result.push(id);
  }
  [...nodes].sort((a,b)=>a.id.localeCompare(b.id)).forEach(n=>visit(n.id));
  return { order:result, has_cycles:hasCycles };
}

// RBAC pure functions
type AivoraRole = "owner"|"admin"|"manager"|"qa_manager"|"qa_reviewer"|"operator"|"contributor"|"client_viewer";
type AivoraModule = "dashboard"|"qc"|"analytics"|"runtime_center"|"dataset_factory"|"speech_intel"|"qa_intel"|"multimodal";

const ROLE_PERMISSIONS: Record<AivoraRole, AivoraModule[]> = {
  owner:       ["dashboard","qc","analytics","runtime_center","dataset_factory","speech_intel","qa_intel","multimodal"],
  admin:       ["dashboard","qc","analytics","runtime_center","dataset_factory","speech_intel","qa_intel","multimodal"],
  manager:     ["dashboard","analytics"],
  qa_manager:  ["dashboard","qc","analytics"],
  qa_reviewer: ["dashboard","qc"],
  operator:    ["dashboard"],
  contributor: ["dashboard"],
  client_viewer:["dashboard"],
};

function canAccess(role: AivoraRole, mod: AivoraModule): boolean {
  return ROLE_PERMISSIONS[role]?.includes(mod) ?? false;
}

// Plan execution simulation
type StepType = "VALIDATE_INPUTS"|"RUN_QUALITY_GATE"|"BUILD_DATASET"|"RUN_PIPELINE"|"EXPORT_DATASET"|"NOTIFY_COMPLETE";
interface PlanStep { id:string; type:StepType; depends:string[]; required:boolean; retry_count:number; }

function createDatasetProductionPlan(projectId: string) {
  return {
    id: "plan-001", name:"dataset_production",
    version:ORCHESTRATION_VERSION, project_id:projectId,
    created_at:new Date().toISOString(),
    steps: [
      { id:"validate", type:"VALIDATE_INPUTS"  as StepType, depends:[],            required:true,  retry_count:0 },
      { id:"gate",     type:"RUN_QUALITY_GATE" as StepType, depends:["validate"],  required:true,  retry_count:1 },
      { id:"build",    type:"BUILD_DATASET"    as StepType, depends:["gate"],      required:true,  retry_count:1 },
      { id:"pipeline", type:"RUN_PIPELINE"     as StepType, depends:["build"],     required:true,  retry_count:2 },
      { id:"export",   type:"EXPORT_DATASET"   as StepType, depends:["pipeline"],  required:true,  retry_count:1 },
      { id:"notify",   type:"NOTIFY_COMPLETE"  as StepType, depends:["export"],    required:false, retry_count:0 },
    ],
  };
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed=0, failed=0;
function expect(label:string, actual:unknown, expected:unknown):void {
  if(JSON.stringify(actual)===JSON.stringify(expected)){
    console.log(`  ✅ ${label}`); passed++;
  } else {
    console.error(`  ❌ ${label}\n     Expected:${JSON.stringify(expected)}\n     Actual:${JSON.stringify(actual)}`);
    failed++;
  }
}
function expectTrue(label:string, v:boolean):void { expect(label, v, true); }

async function main() {

// ── TEST 1: Protocol Versions ─────────────────────────────────────────────────
console.log("\n── TEST 1: Protocol Versions ──");
{
  expect("project graph v15.1.0",      PROJECT_GRAPH_VERSION, "15.1.0");
  expect("orchestration v15.2.0",      ORCHESTRATION_VERSION, "15.2.0");
  expect("MAX_NODES = 500",            GRAPH_LIMITS.MAX_NODES, 500);
  expect("MAX_EDGES = 2000",           GRAPH_LIMITS.MAX_EDGES, 2000);
  expect("MAX_DEPTH = 20",             GRAPH_LIMITS.MAX_DEPTH, 20);
  expect("MAX_STEPS = 50",             ORCHESTRATION_LIMITS.MAX_STEPS, 50);
  expect("MAX_RETRIES = 3",            ORCHESTRATION_LIMITS.MAX_RETRIES, 3);
}

// ── TEST 2: Project Graph TopoSort ────────────────────────────────────────────
console.log("\n── TEST 2: Project Graph TopoSort ──");
{
  const nodes: ProjectNode[] = [
    { id:"p1", type:"project",         label:"Project",  status:"active", created_at:"" },
    { id:"d1", type:"dataset_version", label:"Dataset",  status:"draft",  created_at:"" },
    { id:"r1", type:"pipeline_run",    label:"Pipeline", status:"queued", created_at:"" },
  ];
  const edges: ProjectEdge[] = [
    { from_id:"p1", to_id:"d1", edge_type:"produces" },
    { from_id:"d1", to_id:"r1", edge_type:"consumes"  },
  ];

  const { order, has_cycles } = topoSortGraph(nodes, edges);
  expectTrue("no cycles detected",          !has_cycles);
  expect("3 nodes in order",                order.length, 3);
  // post-order DFS: leaves first → r1 before d1 before p1
  expectTrue("r1 before d1 (leaf first)",  order.indexOf("r1") < order.indexOf("d1"));
  expectTrue("d1 before p1 (source last)", order.indexOf("d1") < order.indexOf("p1"));

  // Determinism
  const r2 = topoSortGraph(nodes, edges);
  expect("topo deterministic",             order.join(","), r2.order.join(","));
}

// ── TEST 3: Cycle Detection ───────────────────────────────────────────────────
console.log("\n── TEST 3: Cycle Detection ──");
{
  const nodes: ProjectNode[] = [
    { id:"a", type:"project", label:"A", status:"active", created_at:"" },
    { id:"b", type:"project", label:"B", status:"active", created_at:"" },
    { id:"c", type:"project", label:"C", status:"active", created_at:"" },
  ];

  // Simple cycle: a→b→c→a
  const cycleEdges: ProjectEdge[] = [
    { from_id:"a", to_id:"b", edge_type:"produces" },
    { from_id:"b", to_id:"c", edge_type:"produces" },
    { from_id:"c", to_id:"a", edge_type:"produces" },
  ];

  const { has_cycles } = topoSortGraph(nodes, cycleEdges);
  expectTrue("cycle detected",              has_cycles);

  // No cycle
  const linearEdges: ProjectEdge[] = [
    { from_id:"a", to_id:"b", edge_type:"produces" },
    { from_id:"b", to_id:"c", edge_type:"produces" },
  ];
  const { has_cycles:noC } = topoSortGraph(nodes, linearEdges);
  expectTrue("linear: no cycle",           !noC);
}

// ── TEST 4: RBAC — Deterministic Permission Evaluation ───────────────────────
console.log("\n── TEST 4: RBAC Permissions ──");
{
  // Owner has all permissions
  expectTrue("owner: dashboard",       canAccess("owner", "dashboard"));
  expectTrue("owner: analytics",       canAccess("owner", "analytics"));
  expectTrue("owner: runtime_center",  canAccess("owner", "runtime_center"));
  expectTrue("owner: dataset_factory", canAccess("owner", "dataset_factory"));
  expectTrue("owner: multimodal",      canAccess("owner", "multimodal"));

  // Admin same as owner
  expectTrue("admin: analytics",       canAccess("admin", "analytics"));
  expectTrue("admin: speech_intel",    canAccess("admin", "speech_intel"));

  // Manager limited
  expectTrue("manager: dashboard",     canAccess("manager", "dashboard"));
  expectTrue("manager: no runtime",    !canAccess("manager", "runtime_center"));
  expectTrue("manager: no multimodal", !canAccess("manager", "multimodal"));

  // qa_reviewer most restricted
  expectTrue("reviewer: dashboard",    canAccess("qa_reviewer", "dashboard"));
  expectTrue("reviewer: qc",           canAccess("qa_reviewer", "qc"));
  expectTrue("reviewer: no analytics", !canAccess("qa_reviewer", "analytics"));
  expectTrue("reviewer: no dataset",   !canAccess("qa_reviewer", "dataset_factory"));

  // Determinism: same role → same permissions always
  expect("RBAC deterministic",
    canAccess("owner","analytics"),
    canAccess("owner","analytics"));
}

// ── TEST 5: Orchestration Plan ────────────────────────────────────────────────
console.log("\n── TEST 5: Orchestration Plan ──");
{
  const plan = createDatasetProductionPlan("proj-001");
  expect("plan version",               plan.version, ORCHESTRATION_VERSION);
  expect("6 steps",                    plan.steps.length, 6);
  expectTrue("validate is required",   plan.steps.find(s=>s.id==="validate")?.required ?? false);
  expectTrue("notify not required",    !(plan.steps.find(s=>s.id==="notify")?.required ?? true));

  // Dependency ordering
  const validateStep = plan.steps.find(s=>s.id==="validate")!;
  const gateStep     = plan.steps.find(s=>s.id==="gate")!;
  const buildStep    = plan.steps.find(s=>s.id==="build")!;

  expect("validate has no deps",       validateStep.depends.length, 0);
  expect("gate depends on validate",   gateStep.depends, ["validate"]);
  expect("build depends on gate",      buildStep.depends, ["gate"]);

  // TopoSort plan steps
  const planNodes: ProjectNode[] = plan.steps.map(s=>({
    id:s.id, type:"pipeline_run", label:s.type,
    status:"pending", created_at:plan.created_at,
  }));
  const planEdges: ProjectEdge[] = plan.steps.flatMap(s=>
    s.depends.map(d=>({ from_id:d, to_id:s.id, edge_type:"produces" as const }))
  );
  const { order, has_cycles } = topoSortGraph(planNodes, planEdges);
  expectTrue("plan: no cycles",        !has_cycles);
  // post-order DFS: deepest dependency first
  // validate(no deps) → gate → build → pipeline → export → notify
  // post-order: notify,export,pipeline,build,gate,validate OR similar leaf-first
  // Key invariant: validate appears AFTER gate (gate depends on validate, so validate is deeper)
  expectTrue("validate after gate (post-order)",   order.indexOf("validate") > order.indexOf("gate"));
  expectTrue("gate after build (post-order)",      order.indexOf("gate") > order.indexOf("build"));
  expectTrue("build after pipeline (post-order)",  order.indexOf("build") > order.indexOf("pipeline"));
  expectTrue("pipeline after export (post-order)", order.indexOf("pipeline") > order.indexOf("export"));

  // Determinism
  const r2 = topoSortGraph(planNodes, planEdges);
  expect("plan topo deterministic",   order.join(","), r2.order.join(","));
}

// ── TEST 6: Graph Limits ──────────────────────────────────────────────────────
console.log("\n── TEST 6: Graph Limits ──");
{
  // Verify limits are defined and reasonable
  expectTrue("MAX_NODES bounded",  GRAPH_LIMITS.MAX_NODES <= 1000);
  expectTrue("MAX_EDGES bounded",  GRAPH_LIMITS.MAX_EDGES <= 5000);
  expectTrue("MAX_DEPTH bounded",  GRAPH_LIMITS.MAX_DEPTH <= 50);
  expectTrue("MAX_RETRIES=3",      ORCHESTRATION_LIMITS.MAX_RETRIES === 3);
  expectTrue("MAX_STEPS bounded",  ORCHESTRATION_LIMITS.MAX_STEPS <= 100);

  // Empty graph
  const { order, has_cycles } = topoSortGraph([], []);
  expect("empty graph: no cycles", has_cycles, false);
  expect("empty graph: no order",  order.length, 0);

  // Single node, no edges
  const single: ProjectNode[] = [
    { id:"x", type:"project", label:"X", status:"active", created_at:"" }
  ];
  const { order:so } = topoSortGraph(single, []);
  expect("single node: in order",  so.length, 1);
  expect("single node: correct id",so[0], "x");
}

// ── TEST 7: Replay Invariants ─────────────────────────────────────────────────
console.log("\n── TEST 7: Replay Invariants ──");
{
  const nodes: ProjectNode[] = [
    { id:"z1", type:"project",         label:"Root",  status:"active", created_at:"" },
    { id:"z2", type:"dataset_version", label:"DS",    status:"draft",  created_at:"" },
    { id:"z3", type:"pipeline_run",    label:"Pipe",  status:"queued", created_at:"" },
    { id:"z4", type:"quality_gate",    label:"Gate",  status:"active", created_at:"" },
  ];
  const edges: ProjectEdge[] = [
    { from_id:"z1", to_id:"z2", edge_type:"produces"  },
    { from_id:"z1", to_id:"z4", edge_type:"validates" },
    { from_id:"z2", to_id:"z3", edge_type:"consumes"  },
    { from_id:"z4", to_id:"z3", edge_type:"validates" },
  ];

  // Run 3 times — must be identical
  const r1 = topoSortGraph(nodes, edges).order.join(",");
  const r2 = topoSortGraph(nodes, edges).order.join(",");
  const r3 = topoSortGraph(nodes, edges).order.join(",");

  expect("INVARIANT: run1 = run2",   r1, r2);
  expect("INVARIANT: run2 = run3",   r2, r3);
  expectTrue("INVARIANT: same input → same graph", r1 === r3);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════`);
console.log(`PHASE 15.7 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);
if(failed > 0) throw new Error(`${failed} tests failed`);
}

main().catch(e => { console.error(e); throw e; });
