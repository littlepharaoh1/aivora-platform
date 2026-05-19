/**
 * dspValidationSuite.ts — Automated DSP Correctness Test Suite
 * Aivora Audio Infrastructure Platform
 */

import { generateReferenceSignal, compareSignals } from "./goldenReference";

export type TestStatus = "pass" | "fail" | "skip" | "error";

export interface TestResult {
  readonly name:       string;
  readonly group:      string;
  readonly status:     TestStatus;
  readonly durationMs: number;
  readonly message:    string;
}

export interface TestGroupResult {
  readonly group:      string;
  readonly results:    TestResult[];
  readonly passed:     number;
  readonly failed:     number;
  readonly skipped:    number;
  readonly durationMs: number;
}

export interface ValidationSuiteResult {
  readonly timestamp:  number;
  readonly groups:     TestGroupResult[];
  readonly totalPass:  number;
  readonly totalFail:  number;
  readonly totalSkip:  number;
  readonly passRate:   number;
  readonly durationMs: number;
}

function assertNear(a: number, e: number, tol: number, lbl: string): void {
  if(Math.abs(a-e) > tol) throw new Error(`assert: ${lbl}: got ${a}, expected ${e} ±${tol}`);
}
function assertGreater(a: number, min: number, lbl: string): void {
  if(a <= min) throw new Error(`assert: ${lbl}: ${a} not > ${min}`);
}
function assertLess(a: number, max: number, lbl: string): void {
  if(a >= max) throw new Error(`assert: ${lbl}: ${a} not < ${max}`);
}
function assertNoNaN(d: Float32Array, lbl: string): void {
  for(let i=0;i<d.length;i++) if(!isFinite(d[i])) throw new Error(`assert: ${lbl}: NaN at ${i}`);
}

type TestFn = () => void | Promise<void>;

class TestGroup {
  private cases: { name: string; fn: TestFn; skip?: boolean }[] = [];
  constructor(readonly name: string) {}
  test(name: string, fn: TestFn)  { this.cases.push({ name, fn }); }
  xtest(name: string, fn: TestFn) { this.cases.push({ name, fn, skip:true }); }

  async run(): Promise<TestGroupResult> {
    const results: TestResult[] = [];
    const t0 = performance.now();
    for(const tc of this.cases) {
      if(tc.skip) { results.push({name:tc.name,group:this.name,status:"skip",durationMs:0,message:"Skipped"}); continue; }
      const ts = performance.now();
      let status: TestStatus = "pass", message = "OK";
      try { await tc.fn(); }
      catch(e) { status = e instanceof Error && e.message.startsWith("assert") ? "fail" : "error"; message = e instanceof Error ? e.message : String(e); }
      results.push({name:tc.name,group:this.name,status,durationMs:Math.round((performance.now()-ts)*100)/100,message});
    }
    return {
      group: this.name, results,
      passed:  results.filter(r=>r.status==="pass").length,
      failed:  results.filter(r=>r.status==="fail"||r.status==="error").length,
      skipped: results.filter(r=>r.status==="skip").length,
      durationMs: Math.round((performance.now()-t0)*100)/100,
    };
  }
}

function buildSignalIntegrity(): TestGroup {
  const g = new TestGroup("Signal Integrity"); const SR = 48000;
  g.test("Silence is zero", () => {
    const s = generateReferenceSignal({type:"silence",durationSec:0.1,sampleRate:SR});
    assertNear(s.reduce((a,b)=>a+Math.abs(b),0), 0, 1e-10, "silence energy");
  });
  g.test("Sine amplitude correct", () => {
    const s = generateReferenceSignal({type:"sine",durationSec:0.1,sampleRate:SR,amplitude:0.5});
    assertNear(s.reduce((m,v)=>Math.max(m,Math.abs(v)),0), 0.5, 0.001, "sine peak");
  });
  g.test("White noise no NaN", () => {
    const s = generateReferenceSignal({type:"white_noise",durationSec:0.5,sampleRate:SR,amplitude:0.5});
    assertNoNaN(s, "white noise");
  });
  g.test("Impulse unit at sample 0", () => {
    const s = generateReferenceSignal({type:"impulse",durationSec:0.01,sampleRate:SR,amplitude:1.0});
    assertNear(Math.abs(s[0]), 1.0, 0.001, "impulse[0]");
    assertNear(s.slice(1).reduce((a,b)=>a+Math.abs(b),0), 0, 1e-10, "impulse tail");
  });
  g.test("DC correct mean", () => {
    const s = generateReferenceSignal({type:"dc",durationSec:0.01,sampleRate:SR,amplitude:0.3});
    assertNear(s.reduce((a,b)=>a+b,0)/s.length, 0.3, 0.001, "dc mean");
  });
  g.test("Same seed = same output", () => {
    const a = generateReferenceSignal({type:"white_noise",durationSec:0.1,sampleRate:SR,seed:42});
    const b = generateReferenceSignal({type:"white_noise",durationSec:0.1,sampleRate:SR,seed:42});
    for(let i=0;i<a.length;i++) if(a[i]!==b[i]) throw new Error(`assert: non-deterministic at ${i}`);
  });
  g.test("Different seeds = different output", () => {
    const a = generateReferenceSignal({type:"white_noise",durationSec:0.1,sampleRate:SR,seed:42});
    const b = generateReferenceSignal({type:"white_noise",durationSec:0.1,sampleRate:SR,seed:99});
    let diff = 0; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) diff++;
    assertGreater(diff, a.length*0.9, "seed diversity");
  });
  return g;
}

function buildComparison(): TestGroup {
  const g = new TestGroup("Signal Comparison"); const SR = 48000;
  g.test("Identical signals pass", () => {
    const s = generateReferenceSignal({type:"sine",durationSec:0.1,sampleRate:SR});
    const r = compareSignals(s, s, {minSnrDb:100});
    if(!r.passed) throw new Error(`assert: ${r.reason}`);
  });
  g.test("Noisy signal SNR in range", () => {
    const ref   = generateReferenceSignal({type:"sine",durationSec:0.5,sampleRate:SR,amplitude:0.5});
    const noise = generateReferenceSignal({type:"white_noise",durationSec:0.5,sampleRate:SR,amplitude:0.005});
    const noisy = new Float32Array(ref.length);
    for(let i=0;i<ref.length;i++) noisy[i]=ref[i]+noise[i];
    const r = compareSignals(ref, noisy, {});
    assertGreater(r.snrDb, 30, "noisy SNR > 30dB");
    assertLess(r.snrDb, 50, "noisy SNR < 50dB");
  });
  g.test("RMS error reflects magnitude", () => {
    const ref = generateReferenceSignal({type:"sine",durationSec:0.1,sampleRate:SR});
    const err = new Float32Array(ref.length);
    for(let i=0;i<ref.length;i++) err[i]=ref[i]+0.01;
    const r = compareSignals(ref, err, {});
    assertNear(r.rmsError, 0.01, 0.001, "RMS error");
  });
  return g;
}

function buildInvariants(): TestGroup {
  const g = new TestGroup("DSP Invariants"); const SR = 48000;
  g.test("Silence RMS < 0.001", () => {
    const s = generateReferenceSignal({type:"silence",durationSec:1,sampleRate:SR});
    assertLess(Math.sqrt(s.reduce((a,b)=>a+b*b,0)/s.length), 0.001, "silence RMS");
  });
  g.test("Sine peak <= 1.0", () => {
    const s = generateReferenceSignal({type:"sine",durationSec:1,sampleRate:SR,amplitude:1.0});
    assertLess(s.reduce((m,v)=>Math.max(m,Math.abs(v)),0), 1.0001, "sine peak");
  });
  g.test("Clipped sine <= clip level", () => {
    const s = generateReferenceSignal({type:"clipped_sine",durationSec:0.1,sampleRate:SR});
    assertLess(s.reduce((m,v)=>Math.max(m,Math.abs(v)),0), 0.31, "clip level");
  });
  g.test("Speech-like no NaN", () => {
    const s = generateReferenceSignal({type:"speech_like",durationSec:1,sampleRate:SR});
    assertNoNaN(s, "speech NaN");
  });
  g.test("Swept sine has energy", () => {
    const s = generateReferenceSignal({type:"swept_sine",durationSec:2,sampleRate:SR});
    assertNoNaN(s, "swept NaN");
    assertGreater(s.reduce((m,v)=>Math.max(m,Math.abs(v)),0), 0.1, "swept energy");
  });
  return g;
}

export class DSPValidationSuite {
  private groups = [buildSignalIntegrity(), buildComparison(), buildInvariants()];

  async run(): Promise<ValidationSuiteResult> {
    const t0 = performance.now();
    const groups = await Promise.all(this.groups.map(g => g.run()));
    const totalPass = groups.reduce((s,g)=>s+g.passed,  0);
    const totalFail = groups.reduce((s,g)=>s+g.failed,  0);
    const totalSkip = groups.reduce((s,g)=>s+g.skipped, 0);
    return {
      timestamp:  Date.now(), groups,
      totalPass, totalFail, totalSkip,
      passRate:   (totalPass+totalFail)>0 ? totalPass/(totalPass+totalFail) : 0,
      durationMs: Math.round((performance.now()-t0)*100)/100,
    };
  }

  exportReport(r: ValidationSuiteResult): string {
    const lines = [
      `AIVORA DSP VALIDATION SUITE`,
      `${new Date(r.timestamp).toISOString()}`,
      `Pass: ${r.totalPass}/${r.totalPass+r.totalFail} (${(r.passRate*100).toFixed(1)}%) — ${r.durationMs}ms`,
      "",
    ];
    for(const g of r.groups) {
      lines.push(`[${g.group}] ${g.passed}/${g.passed+g.failed} (${g.durationMs}ms)`);
      for(const t of g.results) {
        const ic = t.status==="pass"?"✓":t.status==="skip"?"○":"✗";
        lines.push(`  ${ic} ${t.name}${t.status!=="pass"?` — ${t.message}`:""}`);
      }
      lines.push("");
    }
    return lines.join("
");
  }
}

export const validationSuite = new DSPValidationSuite();
