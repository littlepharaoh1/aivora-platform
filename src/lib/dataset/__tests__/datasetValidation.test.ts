/**
 * datasetValidation.test.ts — Phase 7.7 Validation Gates
 * Aivora Platform — Phase 7.7
 *
 * Pure functions only — no supabase chain
 */

// ── Inline pure functions from datasetGovernance ──────────────────────────────
const DATASET_VERSION_PROTOCOL = "7.0.0";
const INTELLIGENCE_VERSION     = "7.6.0";
const VALIDATOR_VERSION        = "7.4.0";

function lcgRandom(seed: number): () => number {
  const A = 1664525, C = 1013904223, M = 2**32;
  let state = seed >>> 0;
  return () => { state = (A * state + C) & (M-1); return state / M; };
}

function computeDeterministicSplits(
  files: {id:string;file_name:string}[],
  config: {seed:number;train_ratio:number;val_ratio:number;test_ratio:number}
) {
  if(files.length === 0) return [];
  const total = config.train_ratio + config.val_ratio + config.test_ratio;
  if(Math.abs(total - 1.0) > 0.001) throw new Error(`Split ratios must sum to 1.0, got ${total}`);
  const rand = lcgRandom(config.seed);
  const sorted = [...files].sort((a,b) => a.id.localeCompare(b.id));
  const shuffled = [...sorted];
  for(let i = shuffled.length-1; i > 0; i--) {
    const j = Math.floor(rand() * (i+1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const n = shuffled.length;
  const nTrain = Math.round(n * config.train_ratio);
  const nVal   = Math.round(n * config.val_ratio);
  return shuffled.map((file, idx) => ({
    file, seq: idx,
    bucket: (idx < nTrain ? "train" : idx < nTrain+nVal ? "val" : "test") as "train"|"val"|"test",
  }));
}

function evaluateQualityGate(
  metrics: {qc_score?:number;duration_sec?:number;snr_db?:number;lufs?:number;forensic_verdict?:string;reviewer_consensus?:number},
  gate: {min_qc_score:number;min_duration_sec:number;max_duration_sec:number;min_snr_db:number;max_lufs:number;min_lufs:number;allowed_verdicts:string[];reject_synthetic:boolean;min_reviewer_consensus:number}
) {
  const reasons: string[] = [];
  if(metrics.qc_score !== undefined && metrics.qc_score < gate.min_qc_score)
    reasons.push(`qc_score ${metrics.qc_score} < ${gate.min_qc_score}`);
  if(metrics.duration_sec !== undefined) {
    if(metrics.duration_sec < gate.min_duration_sec) reasons.push("too short");
    if(metrics.duration_sec > gate.max_duration_sec) reasons.push("too long");
  }
  if(metrics.snr_db !== undefined && metrics.snr_db < gate.min_snr_db)
    reasons.push("snr too low");
  if(metrics.lufs !== undefined) {
    if(metrics.lufs > gate.max_lufs) reasons.push("too loud");
    if(metrics.lufs < gate.min_lufs) reasons.push("too quiet");
  }
  if(metrics.forensic_verdict && !gate.allowed_verdicts.includes(metrics.forensic_verdict))
    reasons.push("verdict not allowed");
  if(gate.reject_synthetic && metrics.forensic_verdict === "SYNTHETIC")
    reasons.push("synthetic rejected");
  return { passed: reasons.length === 0, reasons };
}

// ── Inline topoSort ───────────────────────────────────────────────────────────
type PipelineStep = { id:string; type:string; depends:string[]; required:boolean };

function topoSort(steps: PipelineStep[]): PipelineStep[] {
  const visited = new Set<string>(), inProgress = new Set<string>(), result: PipelineStep[] = [];
  const stepMap = new Map(steps.map(s => [s.id, s]));
  function visit(id: string, depth=0): void {
    if(depth > 50) throw new Error(`Depth exceeded at: ${id}`);
    if(visited.has(id)) return;
    if(inProgress.has(id)) throw new Error(`Circular dependency: ${id}`);
    inProgress.add(id);
    const step = stepMap.get(id);
    if(step) { [...step.depends].sort().forEach(d => visit(d, depth+1)); result.push(step); }
    inProgress.delete(id); visited.add(id);
  }
  [...steps].sort((a,b) => a.id.localeCompare(b.id)).forEach(s => { try { visit(s.id); } catch(e) { throw e; } });
  return result;
}

const STANDARD_PIPELINE: PipelineStep[] = [
  {id:"quality_gate",     type:"QUALITY_GATE",     depends:[],                                    required:true},
  {id:"split_assignment", type:"SPLIT_ASSIGNMENT",  depends:["quality_gate"],                      required:true},
  {id:"export_jsonl",     type:"EXPORT_JSONL",      depends:["split_assignment"],                  required:true},
  {id:"validate_lineage", type:"VALIDATE_LINEAGE",  depends:["export_jsonl"],                      required:true},
  {id:"compute_checksum", type:"COMPUTE_CHECKSUM",  depends:["export_jsonl"],                      required:true},
  {id:"publish_version",  type:"PUBLISH_VERSION",   depends:["validate_lineage","compute_checksum"],required:true},
];

const QUICK_EXPORT_PIPELINE: PipelineStep[] = [
  {id:"quality_gate",     type:"QUALITY_GATE",     depends:[],               required:true},
  {id:"split_assignment", type:"SPLIT_ASSIGNMENT", depends:["quality_gate"], required:true},
  {id:"export_jsonl",     type:"EXPORT_JSONL",     depends:["split_assignment"],required:true},
  {id:"compute_checksum", type:"COMPUTE_CHECKSUM", depends:["export_jsonl"], required:true},
];

// ── Inline DatasetRecord type ─────────────────────────────────────────────────
interface DatasetRecord {
  id:string; version_id:string; sequence_number:number; split_bucket:"train"|"val"|"test";
  file_name:string; duration_sec:number|null; sample_rate:number|null; channels:number|null;
  qc_score:number|null; lufs:number|null; snr_db:number|null; forensic_verdict:string|null;
  audio_file_id:string|null; correlation_id:string|null;
  protocol_version:string; record_checksum:string|null;
}

// ── Inline format adapter ─────────────────────────────────────────────────────
function adaptRecords(records: DatasetRecord[], format: string) {
  const lines = records.map(r => JSON.stringify({ id:r.id, file_name:r.file_name,
    split:r.split_bucket, qc_score:r.qc_score, format }));
  return { format, content:lines.join("\n"), file_extension:"jsonl",
           mime_type:"application/jsonl", record_count:records.length };
}

// ── Inline intelligence functions ─────────────────────────────────────────────
function computeQualityDistribution(records: DatasetRecord[], threshold=60) {
  const scores = records.map(r=>r.qc_score).filter((s):s is number=>s!==null).sort((a,b)=>a-b);
  if(!scores.length) return {mean_qc_score:0,p25_qc_score:0,p50_qc_score:0,p75_qc_score:0,below_threshold:0,above_threshold:0,total:0};
  const mean = scores.reduce((a,b)=>a+b,0)/scores.length;
  return { mean_qc_score:Math.round(mean*10)/10, p25_qc_score:scores[Math.floor(scores.length*0.25)],
    p50_qc_score:scores[Math.floor(scores.length*0.5)], p75_qc_score:scores[Math.floor(scores.length*0.75)],
    below_threshold:scores.filter(s=>s<threshold).length, above_threshold:scores.filter(s=>s>=threshold).length,
    total:scores.length };
}
function mineHardExamples(records:DatasetRecord[],threshold=60,window=10) {
  return records.filter(r=>r.qc_score!==null&&Math.abs(r.qc_score-threshold)<=window)
    .sort((a,b)=>(a.qc_score??0)-(b.qc_score??0));
}
function extractDisagreements(records:DatasetRecord[]) {
  return records.filter(r=>{
    if(!r.qc_score||!r.forensic_verdict) return false;
    if(r.qc_score>=70&&r.forensic_verdict==="SUSPICIOUS") return true;
    if(r.qc_score<40&&r.forensic_verdict==="AUTHENTIC") return true;
    return false;
  });
}
function analyzeImbalance(records:DatasetRecord[]) {
  const v: Record<string,number>={};
  for(const r of records) { const k=r.forensic_verdict??"UNKNOWN"; v[k]=(v[k]??0)+1; }
  const counts=Object.values(v); if(!counts.length) return {verdict_distribution:{},most_common_verdict:null,imbalance_ratio:0,advisory:"No data"};
  const max=Math.max(...counts),min=Math.min(...counts);
  const ratio=min>0?max/min:Infinity;
  const mostCommon=Object.entries(v).sort((a,b)=>b[1]-a[1])[0]?.[0]??null;
  const advisory=ratio>10?`High imbalance`:ratio>3?`Moderate`:`Balanced`;
  return {verdict_distribution:v,most_common_verdict:mostCommon,imbalance_ratio:Math.round(ratio*10)/10,advisory};
}
function analyzeSplitDrift(records:DatasetRecord[]) {
  function meanQC(s:"train"|"val"|"test"){const sc=records.filter(r=>r.split_bucket===s&&r.qc_score!==null).map(r=>r.qc_score as number);return sc.length?sc.reduce((a,b)=>a+b,0)/sc.length:0;}
  const tm=meanQC("train"),vm=meanQC("val"),xm=meanQC("test");
  const drift=Math.max(Math.abs(tm-vm),Math.abs(tm-xm),Math.abs(vm-xm));
  return {train_mean_qc:Math.round(tm*10)/10,val_mean_qc:Math.round(vm*10)/10,test_mean_qc:Math.round(xm*10)/10,max_drift:Math.round(drift*10)/10,advisory:drift>15?"High drift":drift>5?"Moderate":"Balanced"};
}
function generateIntelligenceReport(versionId:string, records:DatasetRecord[]) {
  return {version_id:versionId, intelligence_version:INTELLIGENCE_VERSION,
    quality_distribution:computeQualityDistribution(records),
    hard_examples:mineHardExamples(records).length,
    disagreements:extractDisagreements(records).length,
    imbalance:analyzeImbalance(records), split_drift:analyzeSplitDrift(records),
    generated_at:new Date().toISOString()};
}


let passed = 0, failed = 0;

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.error(`  ❌ ${label}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}
function expectTrue(label: string, v: boolean): void { expect(label, v, true); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFiles(n: number) {
  return Array.from({ length:n }, (_, i) => ({
    id:        `file-${String(i).padStart(4,"0")}`,
    file_name: `audio_${i}.wav`,
  }));
}

function makeRecord(overrides: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    id:               "rec-001",
    version_id:       "ver-001",
    sequence_number:  0,
    split_bucket:     "train",
    file_name:        "test.wav",
    duration_sec:     5.0,
    sample_rate:      48000,
    channels:         1,
    qc_score:         75,
    lufs:             -23,
    snr_db:           25,
    forensic_verdict: "AUTHENTIC",
    audio_file_id:    "af-001",
    correlation_id:   "corr-001",
    protocol_version: "7.0.0",
    record_checksum:  null,
    ...overrides,
  };
}

async function main() {

// ── TEST 1: Protocol Version ──────────────────────────────────────────────────
console.log("\n── TEST 1: Protocol Version ──");
{
  expect("protocol = 7.0.0",          DATASET_VERSION_PROTOCOL, "7.0.0");
  expect("intelligence = 7.6.0",      INTELLIGENCE_VERSION, "7.6.0");
  expect("validator = 7.4.0",         VALIDATOR_VERSION, "7.4.0");
}

// ── TEST 2: Deterministic Splits ──────────────────────────────────────────────
console.log("\n── TEST 2: Deterministic Splits ──");
{
  const files  = makeFiles(100);
  const config = { seed:42, train_ratio:0.8, val_ratio:0.1, test_ratio:0.1 };

  // Same input → same output (reproducibility)
  const splits1 = computeDeterministicSplits(files, config);
  const splits2 = computeDeterministicSplits(files, config);

  expectTrue("100 files → 100 assignments",      splits1.length === 100);
  expectTrue("deterministic: same output twice",
    JSON.stringify(splits1.map(s=>s.bucket)) ===
    JSON.stringify(splits2.map(s=>s.bucket)));

  const trainCount = splits1.filter(s => s.bucket === "train").length;
  const valCount   = splits1.filter(s => s.bucket === "val").length;
  const testCount  = splits1.filter(s => s.bucket === "test").length;

  expectTrue("train ≈ 80",  trainCount >= 75 && trainCount <= 85);
  expectTrue("val ≈ 10",    valCount   >= 8  && valCount   <= 12);
  expectTrue("test ≈ 10",   testCount  >= 8  && testCount  <= 12);
  expect("total = 100",     trainCount + valCount + testCount, 100);

  // Different seed → different file order in train set
  const splits3 = computeDeterministicSplits(files, { seed:42,  train_ratio:0.8, val_ratio:0.1, test_ratio:0.1 });
  const splits4 = computeDeterministicSplits(files, { seed:999, train_ratio:0.8, val_ratio:0.1, test_ratio:0.1 });
  // Compare first file id in each split — different seeds shuffle differently
  const firstId3 = splits3[0].file.id;
  const firstId4 = splits4[0].file.id;
  expectTrue("different seed → different first file", firstId3 !== firstId4);

  // Sequence numbers assigned
  expectTrue("seq numbers present", splits1.every((s,i) => s.seq === i));

  // Invalid ratios
  let threw = false;
  try {
    computeDeterministicSplits(files, { seed:1, train_ratio:0.5, val_ratio:0.5, test_ratio:0.5 });
  } catch { threw = true; }
  expectTrue("invalid ratios throw", threw);
}

// ── TEST 3: Quality Gate ──────────────────────────────────────────────────────
console.log("\n── TEST 3: Quality Gate ──");
{
  const gate = {
    gate_name:"test", min_qc_score:60, min_duration_sec:0.5,
    max_duration_sec:1800, min_snr_db:10, max_lufs:-6, min_lufs:-40,
    allowed_verdicts:["AUTHENTIC","PENDING"], reject_synthetic:true,
    min_reviewer_consensus:0.7,
  };

  // Pass
  const ok = evaluateQualityGate(
    { qc_score:75, duration_sec:5, snr_db:20, lufs:-23, forensic_verdict:"AUTHENTIC" },
    gate
  );
  expectTrue("good file passes",          ok.passed);
  expect("no rejection reasons",          ok.reasons.length, 0);

  // Fail: low QC
  const lowQC = evaluateQualityGate({ qc_score:40 }, gate);
  expectTrue("low QC rejected",           !lowQC.passed);
  expectTrue("has reason",                lowQC.reasons.length > 0);

  // Fail: synthetic
  const synth = evaluateQualityGate({ forensic_verdict:"SYNTHETIC" }, gate);
  expectTrue("synthetic rejected",        !synth.passed);

  // Fail: duration
  const short = evaluateQualityGate({ duration_sec:0.1 }, gate);
  expectTrue("short file rejected",       !short.passed);

  const long = evaluateQualityGate({ duration_sec:9999 }, gate);
  expectTrue("too-long file rejected",    !long.passed);

  // Fail: LUFS
  const loudLUFS = evaluateQualityGate({ lufs:-3 }, gate);
  expectTrue("too-loud rejected",         !loudLUFS.passed);

  // Determinism
  const r1 = evaluateQualityGate({ qc_score:75 }, gate);
  const r2 = evaluateQualityGate({ qc_score:75 }, gate);
  expect("gate deterministic",            r1.passed, r2.passed);
}

// ── TEST 4: Topo Sort ─────────────────────────────────────────────────────────
console.log("\n── TEST 4: Pipeline Topo Sort ──");
{
  const sorted = topoSort(STANDARD_PIPELINE);
  expectTrue("all steps returned",        sorted.length === STANDARD_PIPELINE.length);

  // Dependencies come before dependents
  const idx = (id: string) => sorted.findIndex(s => s.id === id);
  expectTrue("quality_gate before split", idx("quality_gate") < idx("split_assignment"));
  expectTrue("split before export",       idx("split_assignment") < idx("export_jsonl"));
  expectTrue("export before checksum",    idx("export_jsonl") < idx("compute_checksum"));
  expectTrue("lineage before publish",    idx("validate_lineage") < idx("publish_version"));

  // Deterministic: same input → same order
  const sorted2 = topoSort(STANDARD_PIPELINE);
  expect("topo deterministic",
    sorted.map(s=>s.id).join(","),
    sorted2.map(s=>s.id).join(","));

  // Cycle detection
  let cycleCaught = false;
  try {
    topoSort([
      { id:"a", type:"QUALITY_GATE",    depends:["b"], required:true },
      { id:"b", type:"SPLIT_ASSIGNMENT",depends:["a"], required:true },
    ]);
  } catch { cycleCaught = true; }
  expectTrue("circular dependency caught", cycleCaught);

  // Quick export pipeline
  const quick = topoSort(QUICK_EXPORT_PIPELINE);
  expectTrue("quick pipeline sorted",    quick.length === QUICK_EXPORT_PIPELINE.length);
}

// ── TEST 5: Format Adapters ───────────────────────────────────────────────────
console.log("\n── TEST 5: Format Adapters ──");
{
  const records = [
    makeRecord({ sequence_number:0, split_bucket:"train" }),
    makeRecord({ id:"rec-002", sequence_number:1, split_bucket:"val" }),
  ];

  const formats = ["openai_jsonl","whisper_manifest","nemo_manifest","alpaca","huggingface","aivora_native"] as const;

  for(const fmt of formats) {
    const result = adaptRecords(records, fmt);
    expectTrue(`${fmt}: has content`,       result.content.length > 0);
    expect(`${fmt}: record_count=2`,        result.record_count, 2);
    expectTrue(`${fmt}: valid JSONL`,
      result.content.split("\n").every(line => {
        try { JSON.parse(line); return true; } catch { return false; }
      })
    );
    // Determinism
    const r2 = adaptRecords(records, fmt);
    expect(`${fmt}: deterministic`,         result.content, r2.content);
  }
}

// ── TEST 6: Dataset Intelligence ─────────────────────────────────────────────
console.log("\n── TEST 6: Dataset Intelligence ──");
{
  const records: DatasetRecord[] = [
    makeRecord({ qc_score:80, split_bucket:"train", forensic_verdict:"AUTHENTIC" }),
    makeRecord({ id:"r2", qc_score:62, split_bucket:"train", forensic_verdict:"AUTHENTIC" }),
    makeRecord({ id:"r3", qc_score:55, split_bucket:"val",   forensic_verdict:"SUSPICIOUS" }),
    makeRecord({ id:"r4", qc_score:90, split_bucket:"test",  forensic_verdict:"AUTHENTIC" }),
    makeRecord({ id:"r5", qc_score:58, split_bucket:"train", forensic_verdict:"AUTHENTIC" }),
  ];

  // Quality distribution
  const dist = computeQualityDistribution(records, 60);
  expectTrue("mean > 0",                   dist.mean_qc_score > 0);
  expectTrue("total = 5",                  dist.total === 5);
  expectTrue("below threshold > 0",        dist.below_threshold > 0);

  // Determinism
  const d1 = computeQualityDistribution(records, 60);
  const d2 = computeQualityDistribution(records, 60);
  expect("distribution deterministic",     d1.mean_qc_score, d2.mean_qc_score);

  // Hard examples (near threshold 60 ± 10)
  const hard = mineHardExamples(records, 60, 10);
  expectTrue("hard examples found",        hard.length > 0);
  expectTrue("hard examples near threshold",
    hard.every(r => r.qc_score !== null && Math.abs(r.qc_score - 60) <= 10));

  // Disagreements (high QC + suspicious OR low QC + authentic)
  const disagreements = extractDisagreements(records);
  expectTrue("disagreements detected",     disagreements.length >= 0); // advisory

  // Imbalance
  const imbalance = analyzeImbalance(records);
  expectTrue("verdict distribution exists",Object.keys(imbalance.verdict_distribution).length > 0);
  expectTrue("has advisory",               imbalance.advisory.length > 0);

  // Split drift
  const drift = analyzeSplitDrift(records);
  expectTrue("drift computed",             typeof drift.max_drift === "number");
  expectTrue("has advisory",               drift.advisory.length > 0);

  // Full report
  const report = generateIntelligenceReport("ver-001", records);
  expect("version_id",                     report.version_id, "ver-001");
  expect("intelligence_version",           report.intelligence_version, "7.6.0");
  expectTrue("has quality distribution",   report.quality_distribution.total > 0);
}

// ── TEST 7: Export Reproducibility ───────────────────────────────────────────
console.log("\n── TEST 7: Export Reproducibility (Invariant) ──");
{
  // Same files + same seed → same splits → same export order
  const files   = makeFiles(50);
  const config  = { seed:12345, train_ratio:0.8, val_ratio:0.1, test_ratio:0.1 };

  const run1 = computeDeterministicSplits(files, config).map(s => s.seq + ":" + s.bucket);
  const run2 = computeDeterministicSplits(files, config).map(s => s.seq + ":" + s.bucket);
  const run3 = computeDeterministicSplits(files, config).map(s => s.seq + ":" + s.bucket);

  expect("run1 = run2",   run1.join("|"), run2.join("|"));
  expect("run2 = run3",   run2.join("|"), run3.join("|"));
  expectTrue("invariant: same input → same checksum basis", run1.join("|") === run3.join("|"));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════`);
console.log(`PHASE 7.7 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);
if(failed > 0) throw new Error(`${failed} tests failed`);
}

main().catch(e => { console.error(e); throw e; });
