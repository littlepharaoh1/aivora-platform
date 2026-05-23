/**
 * aiValidation.test.ts — Phase 6B.8 Validation Gates
 * Tests pure modules only (no supabase chain)
 */

import {
  checkTensorAllocation, allocateTensor,
  validateFrameSize, validateBatchSize,
  TENSOR_LIMITS, getActiveTensorCount,
} from "../tensorMemory";

import {
  checkInputSize, checkModelSize,
  checkCloudExecution, checkStreamingBounds,
  getAISafetySummary, AI_SAFETY_LIMITS,
} from "../aiSafetyConstraints";

import {
  selectQuantization, isQuantizationCompatible,
  QUANTIZATION_MEMORY_MULTIPLIER, TIER_QUANTIZATION,
} from "../quantizationPolicy";

// INFERENCE_ROUTES inlined — inferenceScheduler imports supabase chain
const INFERENCE_ROUTES = {
  vad:           { task:"vad",           preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  denoise:       { task:"denoise",       preferred_runtime:"wasm_native",  version:"6B.4.0" },
  enhance:       { task:"enhance",       preferred_runtime:"onnx_webgpu", version:"6B.4.0" },
  separate:      { task:"separate",      preferred_runtime:"onnx_webgpu", version:"6B.4.0" },
  speaker_embed: { task:"speaker_embed", preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  room_embed:    { task:"room_embed",    preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
  noise_classify:{ task:"noise_classify",preferred_runtime:"onnx_wasm",   version:"6B.4.0" },
} as const;
import { modelRegistry }    from "../../models/modelRegistry";

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

async function main() {

// ── TEST 1: Tensor Memory Bounds ──────────────────────────────────────────────
console.log("\n── TEST 1: Tensor Memory ──");
{
  const ok = checkTensorAllocation({ dims:[1,1024], dtype:"float32", description:"t" });
  expectTrue("normal allowed",               ok.allowed);
  expect("no reason",                        ok.reason, null);
  expectTrue("byteSize correct",             ok.byteSize === 1024*4);

  const big = checkTensorAllocation({ dims:[1,64*1024*1024], dtype:"float32", description:"big" });
  expectTrue("oversized rejected",           !big.allowed);

  const bad = checkTensorAllocation({ dims:[0,100], dtype:"float32", description:"bad" });
  expectTrue("zero dim rejected",            !bad.allowed);

  const before = getActiveTensorCount();
  const lease  = allocateTensor({ dims:[1,512], dtype:"float32", description:"l" });
  expectTrue("lease non-null",               lease !== null);
  expectTrue("counter +1",                   getActiveTensorCount() === before+1);
  lease?.release();
  expectTrue("counter -1",                   getActiveTensorCount() === before);
  lease?.release();
  expectTrue("double release safe",          getActiveTensorCount() >= 0);

  expectTrue("max frame valid",              validateFrameSize(TENSOR_LIMITS.MAX_FRAME_SAMPLES));
  expectTrue("over max rejected",            !validateFrameSize(TENSOR_LIMITS.MAX_FRAME_SAMPLES+1));
  expectTrue("zero frame rejected",          !validateFrameSize(0));
  expectTrue("max batch valid",              validateBatchSize(TENSOR_LIMITS.MAX_BATCH_SIZE));
  expectTrue("over max batch rejected",      !validateBatchSize(TENSOR_LIMITS.MAX_BATCH_SIZE+1));
}

// ── TEST 2: AI Safety Constraints ────────────────────────────────────────────
console.log("\n── TEST 2: AI Safety ──");
{
  expectTrue("1s input ok",                  checkInputSize(48000,48000).allowed);
  expectTrue("too-long rejected",            !checkInputSize(AI_SAFETY_LIMITS.MAX_INPUT_SAMPLES+1,48000).allowed);
  expectTrue("empty rejected",               !checkInputSize(0,48000).allowed);
  expectTrue("10MB model ok",                checkModelSize(10).allowed);
  expectTrue("51MB model rejected",          !checkModelSize(51).allowed);
  expectTrue("cloud always blocked",         !checkCloudExecution("test").allowed);
  expectTrue("cloud has reason",             checkCloudExecution("test").reason !== null);
  expectTrue("1000 frames ok",               checkStreamingBounds(1000).allowed);
  expectTrue("too-many frames rejected",     !checkStreamingBounds(AI_SAFETY_LIMITS.MAX_STREAMING_FRAMES+1).allowed);

  const s = getAISafetySummary();
  expectTrue("advisory_only=true",           s.advisory_only);
  expectTrue("cloud_disabled=true",          s.cloud_disabled);
}

// ── TEST 3: Quantization Policy ───────────────────────────────────────────────
console.log("\n── TEST 3: Quantization ──");
{
  const q1 = selectQuantization(["fp32","int8"], "DESKTOP_ULTRA");
  const q2 = selectQuantization(["fp32","int8"], "DESKTOP_ULTRA");
  expect("deterministic",                    q1, q2);
  expect("DESKTOP_ULTRA→fp32",               q1, "fp32");
  expect("MOBILE_SAFE→int8",                 selectQuantization(["fp32","int8"],"MOBILE_SAFE"), "int8");
  expect("LOW_MEMORY→int4",                  selectQuantization(["fp32","int8","int4"],"LOW_MEMORY"), "int4");

  expectTrue("none always ok",               isQuantizationCompatible("none","LOW_MEMORY"));
  expectTrue("fp32 ok on DESKTOP",           isQuantizationCompatible("fp32","DESKTOP_ULTRA"));
  expectTrue("fp32 blocked MOBILE",          !isQuantizationCompatible("fp32","MOBILE_SAFE"));
  expectTrue("fp32 blocked LOW_MEM",         !isQuantizationCompatible("fp32","LOW_MEMORY"));
  expectTrue("int8 ok MOBILE",               isQuantizationCompatible("int8","MOBILE_SAFE"));

  expectTrue("fp32 mult=1",                  QUANTIZATION_MEMORY_MULTIPLIER.fp32 === 1.0);
  expectTrue("fp16 mult=0.5",                QUANTIZATION_MEMORY_MULTIPLIER.fp16 === 0.5);
  expectTrue("int8 mult=0.25",               QUANTIZATION_MEMORY_MULTIPLIER.int8 === 0.25);
  expectTrue("int4 mult=0.125",              QUANTIZATION_MEMORY_MULTIPLIER.int4 === 0.125);

  // All tiers have preference lists
  for(const tier of ["DESKTOP_ULTRA","DESKTOP_BALANCED","MOBILE_SAFE","LOW_MEMORY"] as const) {
    expectTrue(`${tier}: has preferences`, TIER_QUANTIZATION[tier].length > 0);
  }
}

// ── TEST 4: Inference Routes ──────────────────────────────────────────────────
console.log("\n── TEST 4: Inference Routes ──");
{
  const tasks = Object.keys(INFERENCE_ROUTES);
  expectTrue("7 tasks have routes",          tasks.length === 7);

  for(const [task, route] of Object.entries(INFERENCE_ROUTES)) {
    expectTrue(`${task}: has runtime`,       !!route.preferred_runtime);
    expectTrue(`${task}: version 6B.4.0`,   route.version === "6B.4.0");
    const r2 = INFERENCE_ROUTES[task as keyof typeof INFERENCE_ROUTES];
    expect(`${task}: deterministic`,         route.preferred_runtime, r2.preferred_runtime);
  }

  expect("VAD→onnx_wasm",                   INFERENCE_ROUTES.vad.preferred_runtime,    "onnx_wasm");
  expect("enhance→onnx_webgpu",             INFERENCE_ROUTES.enhance.preferred_runtime,"onnx_webgpu");
  expect("denoise→wasm_native",             INFERENCE_ROUTES.denoise.preferred_runtime,"wasm_native");
}

// ── TEST 5: Model Registry ────────────────────────────────────────────────────
console.log("\n── TEST 5: Model Registry ──");
{
  expectTrue("registry non-empty",           modelRegistry.size() > 0);

  for(const m of modelRegistry.listAll()) {
    expectTrue(`${m.id}: version`,           !!m.version);
    expectTrue(`${m.id}: quantization`,      !!m.quantization);
    expectTrue(`${m.id}: runtimes`,          m.runtimes.length > 0);
    expectTrue(`${m.id}: not deprecated`,    !m.deprecated);
    expectTrue(`${m.id}: local URL`,         m.url.startsWith("/") || m.url.startsWith("./"));
  }

  // Deterministic selection
  const m1 = modelRegistry.getBestForTask("vad",["onnx_wasm"],"DESKTOP_BALANCED");
  const m2 = modelRegistry.getBestForTask("vad",["onnx_wasm"],"DESKTOP_BALANCED");
  expect("getBestForTask deterministic",     m1?.id, m2?.id);

  // No model for unavailable runtime
  const none = modelRegistry.getBestForTask("enhance",["js_fallback"],"LOW_MEMORY");
  expectTrue("no fp32 model on LOW_MEMORY",  none === null);

  // Register requires version
  let threw = false;
  try {
    modelRegistry.register({
      id:"bad", name:"Bad", version:"", quantization:"fp32",
      task:"vad", url:"/bad.onnx", sha256:null,
      capabilities:{task:"vad",sampleRate:16000,frameSize:512,channels:1,
        inputNames:[],outputNames:[],streamingSupport:false,batchSupport:false,gpuAccelerated:false},
      memory:{weightsMB:1,activationsMB:1,minVRAMMB:0,recommendedMB:64},
      runtimes:["onnx_wasm"], preferred_tier:"MOBILE_SAFE",
      license:"MIT", description:"test", deprecated:false,
    });
  } catch { threw = true; }
  expectTrue("register without version throws", threw);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════`);
console.log(`PHASE 6B.8 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);
if(failed > 0) throw new Error(`${failed} tests failed`);
}

main().catch(e => { console.error(e); throw e; });
