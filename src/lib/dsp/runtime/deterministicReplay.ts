/**
 * deterministicReplay.ts — Deterministic DSP Replay & Regression Engine
 * Aivora Audio Infrastructure Platform
 *
 * Full implementation:
 * - SHA-256 fingerprinting via SubtleCrypto (async, zero-copy)
 * - FNV-1a fallback for non-secure contexts
 * - Full corpus storage with indexed lookup
 * - Replay: re-runs DSP function, compares output hash bit-exact
 * - Regression detection: flags any non-deterministic output
 * - Statistical analysis: mean/std latency per operation
 * - JSONL export for CI regression suites
 * - Corruption injection for robustness testing
 */

export type DSPOperationType =
  | "wiener_filter" | "lr4_crossover" | "lookahead_limiter"
  | "lufs_normalize" | "fft_compute" | "noise_fingerprint"
  | "rt60_estimate" | "silence_repair" | "export_validate"
  | "harmonic_reconstruct" | "spectral_repair" | "transient_process";

export interface DSPRecord {
  readonly id:           string;
  readonly operation:    DSPOperationType;
  readonly inputHash:    string;
  readonly outputHash:   string;
  readonly params:       Record<string, unknown>;
  readonly sampleRate:   number;
  readonly inputLength:  number;
  readonly outputLength: number;
  readonly durationMs:   number;
  readonly timestamp:    number;
  readonly passed:       boolean;
  readonly replayCount:  number;
  readonly failCount:    number;
}

export interface ReplayResult {
  readonly id:           string;
  readonly operation:    DSPOperationType;
  readonly passed:       boolean;
  readonly inputMatch:   boolean;
  readonly outputMatch:  boolean;
  readonly durationMs:   number;
  readonly originalHash: string;
  readonly replayHash:   string;
  readonly attempt:      number;
}

export interface RegressionStats {
  readonly total:       number;
  readonly passed:      number;
  readonly failed:      number;
  readonly passRate:    number;
  readonly meanMs:      number;
  readonly stdMs:       number;
  readonly p95Ms:       number;
  readonly worstOp:     DSPOperationType | null;
}

// ── SHA-256 Fingerprinting ────────────────────────────────────────────────────

async function hashFloat32(data: Float32Array): Promise<string> {
  try {
    const bytes  = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(b=>b.toString(16).padStart(2,"0")).join("");
  } catch {
    // FNV-1a 64-bit (JS approximation via two 32-bit halves)
    let lo=0x811c9dc5, hi=0;
    const stride=Math.max(1,Math.floor(data.length/2048));
    for(let i=0;i<data.length;i+=stride){
      const bytes=new Uint8Array(Float32Array.of(data[i]).buffer);
      for(const b of bytes){
        lo^=b; hi^=0;
        // FNV prime 0x00000100000001B3
        const newLo=(lo*0x01000193)>>>0;
        const newHi=(hi*0x01000193+lo*0x00000100)>>>0;
        lo=newLo; hi=newHi;
      }
    }
    return `fnv64:${hi.toString(16).padStart(8,"0")}${lo.toString(16).padStart(8,"0")}`;
  }
}

// ── Corpus Entry ──────────────────────────────────────────────────────────────

let recordCounter=0;
function nextId(): string {
  return `rec_${String(++recordCounter).padStart(6,"0")}_${(performance.now()*1000|0).toString(36)}`;
}

// ── Deterministic Replay Engine ───────────────────────────────────────────────

export class DeterministicReplayEngine {
  private readonly corpus     = new Map<string, DSPRecord>();
  private readonly opIndex    = new Map<DSPOperationType, string[]>();
  private readonly latencies  = new Map<DSPOperationType, number[]>();
  private enabled:            boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  // ── Record ────────────────────────────────────────────────────────────────

  async record(
    operation:   DSPOperationType,
    input:       Float32Array,
    output:      Float32Array,
    params:      Record<string, unknown>,
    sampleRate:  number,
    durationMs:  number
  ): Promise<DSPRecord> {
    const id = nextId();
    const [inputHash, outputHash] = await Promise.all([
      hashFloat32(input),
      hashFloat32(output),
    ]);

    const record: DSPRecord = {
      id, operation, inputHash, outputHash, params,
      sampleRate,
      inputLength:  input.length,
      outputLength: output.length,
      durationMs:   Math.round(durationMs*100)/100,
      timestamp:    Date.now(),
      passed:       true,
      replayCount:  0,
      failCount:    0,
    };

    if(this.enabled){
      this.corpus.set(id, record);
      const ops = this.opIndex.get(operation) ?? [];
      ops.push(id); this.opIndex.set(operation, ops);

      const lats = this.latencies.get(operation) ?? [];
      lats.push(durationMs);
      if(lats.length>128) lats.shift();
      this.latencies.set(operation, lats);
    }

    return record;
  }

  // ── Replay ────────────────────────────────────────────────────────────────

  async replay(
    recordId:  string,
    input:     Float32Array,
    processor: (data: Float32Array, sr: number, params: Record<string,unknown>) => Float32Array
  ): Promise<ReplayResult> {
    const original = this.corpus.get(recordId);
    if(!original) return {
      id:recordId, operation:"fft_compute", passed:false,
      inputMatch:false, outputMatch:false, durationMs:0,
      originalHash:"", replayHash:"", attempt:0,
    };

    const startMs   = performance.now();
    const inputHash = await hashFloat32(input);
    const inputMatch= inputHash === original.inputHash;

    let replayHash  = "";
    let outputMatch = false;

    if(inputMatch){
      try {
        const out  = processor(input, original.sampleRate, original.params);
        replayHash = await hashFloat32(out);
        outputMatch= replayHash === original.outputHash;
      } catch { /* processor error */ }
    }

    const durationMs = performance.now()-startMs;
    const passed     = inputMatch && outputMatch;

    // Update record
    const updated: DSPRecord = {
      ...original,
      passed:      passed,
      replayCount: original.replayCount+1,
      failCount:   original.failCount+(passed?0:1),
    };
    this.corpus.set(recordId, updated);

    return {
      id:           recordId,
      operation:    original.operation,
      passed,
      inputMatch,
      outputMatch,
      durationMs:   Math.round(durationMs*100)/100,
      originalHash: original.outputHash,
      replayHash,
      attempt:      updated.replayCount,
    };
  }

  // ── Regression Suite ──────────────────────────────────────────────────────

  async runRegressionSuite(
    inputs:     Map<string, Float32Array>,
    processors: Map<DSPOperationType, (
      data:   Float32Array,
      sr:     number,
      params: Record<string,unknown>
    ) => Float32Array>,
    onProgress?: (pct: number, id: string) => void
  ): Promise<ReplayResult[]> {
    const results: ReplayResult[] = [];
    const ids = Array.from(this.corpus.keys());

    for(let i=0;i<ids.length;i++){
      const id        = ids[i];
      const record    = this.corpus.get(id)!;
      const input     = inputs.get(id);
      const processor = processors.get(record.operation);
      if(!input||!processor) continue;

      const result = await this.replay(id, input, processor);
      results.push(result);
      onProgress?.(Math.round((i+1)/ids.length*100), id);

      // Yield event loop
      if(i%10===0) await new Promise<void>(r=>setTimeout(r,0));
    }

    return results;
  }

  // ── Corruption Injection (robustness testing) ──────────────────────────────

  injectCorruption(
    data:   Float32Array,
    type:   "nan" | "inf" | "clip" | "zero" | "noise",
    ratio = 0.001
  ): Float32Array {
    const out    = new Float32Array(data);
    const stride = Math.max(1, Math.floor(1/ratio));

    for(let i=0;i<out.length;i+=stride){
      switch(type){
        case "nan":   out[i]=NaN;  break;
        case "inf":   out[i]=i%2===0?Infinity:-Infinity; break;
        case "clip":  out[i]=i%2===0?1.0:-1.0; break;
        case "zero":  out[i]=0; break;
        case "noise": out[i]+=((Math.random()*2-1)*0.1); break;
      }
    }
    return out;
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  getStats(): RegressionStats {
    const records  = Array.from(this.corpus.values());
    const passed   = records.filter(r=>r.passed).length;
    const failed   = records.length-passed;

    // Overall latency stats
    const allLats: number[]=[];
    for(const lats of this.latencies.values()) allLats.push(...lats);
    const mean = allLats.length>0 ? allLats.reduce((a,b)=>a+b)/allLats.length : 0;
    const std  = allLats.length>1
      ? Math.sqrt(allLats.reduce((s,v)=>s+(v-mean)**2,0)/allLats.length) : 0;
    const sorted = [...allLats].sort((a,b)=>a-b);
    const p95  = sorted.length>0 ? sorted[Math.floor(0.95*(sorted.length-1))] : 0;

    // Worst operation (most failures)
    let worstOp: DSPOperationType|null=null, worstFails=0;
    for(const [op,ids] of this.opIndex){
      const fails=ids.map(id=>this.corpus.get(id)!).filter(r=>!r.passed).length;
      if(fails>worstFails){ worstFails=fails; worstOp=op; }
    }

    return {
      total:   records.length,
      passed,
      failed,
      passRate: records.length>0?Math.round(passed/records.length*1000)/1000:0,
      meanMs:  Math.round(mean*100)/100,
      stdMs:   Math.round(std*100)/100,
      p95Ms:   Math.round(p95*100)/100,
      worstOp,
    };
  }

  getRecord(id: string):               DSPRecord|undefined  { return this.corpus.get(id); }
  getByOperation(op: DSPOperationType): DSPRecord[]         { return (this.opIndex.get(op)??[]).map(id=>this.corpus.get(id)!); }
  getAllRecords():                       DSPRecord[]         { return Array.from(this.corpus.values()); }
  get size():                           number              { return this.corpus.size; }

  // ── Export ────────────────────────────────────────────────────────────────

  exportJSONL(): string {
    return this.getAllRecords().map(r=>JSON.stringify(r)).join("\n");
  }

  downloadCorpus(filename="aivora_dsp_corpus.jsonl"): void {
    const blob=new Blob([this.exportJSONL()],{type:"application/jsonl"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=filename; a.click();
  }

  clear(): void {
    this.corpus.clear(); this.opIndex.clear(); this.latencies.clear();
  }
}

export const replayEngine = new DeterministicReplayEngine({ enabled:true });
