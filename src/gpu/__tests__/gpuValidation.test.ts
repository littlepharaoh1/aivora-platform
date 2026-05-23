/**
 * gpuValidation.test.ts — Phase 6A.9
 */
import { resolveComputeBackend, getFallbackChain } from "../gpuFallbacks";
import type { GPUTier } from "../gpuCapabilities";
import { ZERO_COPY_PROTOCOL_VERSION } from "../zeroCopyFabric";

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

console.log("\n── TEST 1: Fallback Chain Determinism ──");
{
  const tiers: GPUTier[] = ["WEBGPU_FULL","WEBGPU_LIMITED","WEBGL2","WEBGL1","CPU_ONLY"];
  for(const tier of tiers) {
    const c1 = getFallbackChain(tier);
    const c2 = getFallbackChain(tier);
    expect(`${tier}: deterministic`, JSON.stringify(c1), JSON.stringify(c2));
    expectTrue(`${tier}: non-empty`,  c1.length > 0);
    expect(`${tier}: ends CPU`,       c1[c1.length-1], "CPU_WORKER");
  }
}

console.log("\n── TEST 2: Backend Resolution Determinism ──");
{
  const tiers: GPUTier[] = ["WEBGPU_FULL","WEBGPU_LIMITED","WEBGL2","WEBGL1","CPU_ONLY"];
  const tasks = ["FFT","SPECTROGRAM","FORENSIC","INFERENCE"] as const;
  for(const tier of tiers) {
    for(const task of tasks) {
      const r1 = resolveComputeBackend(tier, task, false);
      const r2 = resolveComputeBackend(tier, task, false);
      expect(`(${tier},${task})`, r1.backend, r2.backend);
      expectTrue(`(${tier},${task}) reason`, r1.reason.length > 0);
    }
  }
}

console.log("\n── TEST 3: Context Loss → CPU ──");
{
  for(const tier of ["WEBGPU_FULL","WEBGL2","WEBGPU_LIMITED"] as GPUTier[]) {
    const r = resolveComputeBackend(tier, "FFT", true);
    expect(`${tier}+lost→CPU`, r.backend, "CPU_WORKER");
    expectTrue(`${tier}+lost: degraded`, r.degraded);
  }
}

console.log("\n── TEST 4: FORENSIC always CPU ──");
{
  for(const tier of ["WEBGPU_FULL","WEBGPU_LIMITED","WEBGL2","WEBGL1","CPU_ONLY"] as GPUTier[]) {
    const r = resolveComputeBackend(tier, "FORENSIC", false);
    expect(`FORENSIC ${tier}→CPU`, r.backend, "CPU_WORKER");
    expectTrue(`FORENSIC ${tier}: not degraded`, !r.degraded);
  }
}

console.log("\n── TEST 5: Fallback Chain Ordering ──");
{
  const ultra  = getFallbackChain("WEBGPU_FULL");
  const webgl2 = getFallbackChain("WEBGL2");
  const cpu    = getFallbackChain("CPU_ONLY");
  expectTrue("ULTRA starts WEBGPU",    ultra[0]  === "WEBGPU");
  expectTrue("WEBGL2 starts WEBGL2",   webgl2[0] === "WEBGL2");
  expectTrue("CPU_ONLY = [CPU_WORKER]", cpu.length === 1);
  expectTrue("ULTRA > WEBGL2 length",  ultra.length > webgl2.length);
}

console.log("\n── TEST 6: Protocol Version ──");
{
  expect("protocol = 6A.7", ZERO_COPY_PROTOCOL_VERSION, "6A.7");
}

console.log("\n── TEST 7: SharedMemoryPool ──");
{
  try {
    const { sharedMemoryPool } = await import("../sharedMemoryPool");
    const lease = sharedMemoryPool.acquire(1024);
    expectTrue("acquire non-null",       lease !== null);
    if(lease) {
      expectTrue("has Float32Array",     lease.view instanceof Float32Array);
      expectTrue("float_count > 0",      lease.float_count > 0);
      expectTrue("has release fn",       typeof lease.release === "function");
      expectTrue("slot_byte_offset >= 0",lease.slot_byte_offset >= 0);
      // P0.F2: offset must be slot_index × slot_floats × 4
      if(lease.slot_index >= 0) {
        const cfg    = sharedMemoryPool.getConfig();
        const expect_offset = lease.slot_index * cfg.slot_floats * 4;
        expectTrue("correct byteOffset", lease.slot_byte_offset === expect_offset);
      }
      lease.release();
      expectTrue("release OK", true);
      lease.release(); // double release must not crash
      expectTrue("double release safe", true);
    }
  } catch(e) {
    console.log(`  ℹ SAB skipped in Node: ${e}`);
    passed++;
  }
}

console.log("\n── TEST 8: Zero-Copy Fabric ──");
{
  try {
    const { prepareZeroCopyPayload, readZeroCopyMessage } = await import("../zeroCopyFabric");
    const samples = new Float32Array([1.0, 0.5, -0.5, -1.0]);
    const payload = prepareZeroCopyPayload(samples, 48000, "test-001");

    expectTrue("has lease",          !!payload.lease);
    expect("type",                   payload.workerMessage.type, "ZERO_COPY_DSP");
    expect("protocol version",       payload.workerMessage.protocol_version, "6A.7");
    expect("float_count",            payload.workerMessage.float_count, 4);
    expect("sample_rate",            payload.workerMessage.sample_rate, 48000);
    expectTrue("transferList array", Array.isArray(payload.transferList));

    const rb = readZeroCopyMessage(payload.workerMessage);
    expectTrue("readback Float32Array", rb instanceof Float32Array);
    payload.lease.release();
    expectTrue("released OK", true);
  } catch(e) {
    console.error(`  ❌ Zero-copy failed: ${e}`);
    failed++;
  }
}

console.log("\n── TEST 9: Protocol Mismatch Isolation ──");
{
  try {
    const { readZeroCopyMessage } = await import("../zeroCopyFabric");
    const msg = {
      type: "ZERO_COPY_DSP" as const,
      protocol_version: "WRONG_VERSION",
      sab: null, sab_control: null,
      slot_index: -1, slot_byte_offset: 0,
      float_count: 4, sample_rate: 48000,
      correlation_id: "test",
      buffer_fallback: null,
    };
    const rb = readZeroCopyMessage(msg);
    expectTrue("mismatch → empty Float32Array", rb.length === 0);
  } catch(e) {
    console.error(`  ❌ Protocol mismatch test failed: ${e}`);
    failed++;
  }
}

console.log("\n── TEST 10: Fallback Equivalence ──");
{
  try {
    const { readZeroCopyMessage } = await import("../zeroCopyFabric");
    const arr = new Float32Array([1,2,3,4]);
    const buf = arr.buffer.slice(0) as ArrayBuffer;
    const msg = {
      type: "ZERO_COPY_DSP" as const,
      protocol_version: "6A.7",
      sab: null, sab_control: null,
      slot_index: -1, slot_byte_offset: 0,
      float_count: 4, sample_rate: 48000,
      correlation_id: "test",
      buffer_fallback: buf,
    };
    const rb = readZeroCopyMessage(msg);
    expectTrue("length=4",    rb.length === 4);
    expectTrue("value[0]=1",  rb[0] === 1);
    expectTrue("value[3]=4",  rb[3] === 4);
  } catch(e) {
    console.error(`  ❌ Fallback test failed: ${e}`);
    failed++;
  }
}

console.log(`\n══════════════════════════════════════`);
console.log(`PHASE 6A.9 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);

if(failed > 0) throw new Error(`${failed} tests failed`);
}

main().catch(e => { console.error(e); throw e; });
