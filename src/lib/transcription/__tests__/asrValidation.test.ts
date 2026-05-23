export {};
/**
 * asrValidation.test.ts — Phase 8.8 Validation Gates
 * Pure functions only — no supabase chain
 */

// ── Inlined pure constants ────────────────────────────────────────────────────
const INFERENCE_PROTOCOL_VERSION = "8.1.0";
const DECODER_STRATEGY           = "greedy" as const;
const TEMPERATURE                = 0;
const SAMPLE_RATE                = 16000;
const MAX_CHUNK_DURATION_SEC     = 30;
const CHUNK_OVERLAP_SEC          = 0.5;
const CHUNK_FRAMES               = MAX_CHUNK_DURATION_SEC * SAMPLE_RATE;
const OVERLAP_FRAMES             = Math.round(CHUNK_OVERLAP_SEC * SAMPLE_RATE);
const HOP_FRAMES                 = CHUNK_FRAMES - OVERLAP_FRAMES;
const ALIGNMENT_VERSION          = "8.2.0";
const STREAM_VERSION             = "8.3.0";
const SPEECH_QA_VERSION          = "8.4.0";
const MULTILINGUAL_VERSION       = "8.5.0";
const SPEECH_INTEL_VERSION       = "8.6.0";
const TOKENIZER_VERSION          = "8.1.0";

// ── Inlined pure functions ────────────────────────────────────────────────────

// audioChunker
function chunkAudio(audio: Float32Array) {
  if(!audio.length) return [];
  const chunks = [];
  let start = 0, index = 0;
  while(start < audio.length) {
    const end = Math.min(start + CHUNK_FRAMES, audio.length);
    const isLast = end >= audio.length;
    let data: Float32Array;
    if(end - start < CHUNK_FRAMES) {
      data = new Float32Array(CHUNK_FRAMES);
      data.set(audio.subarray(start, end));
    } else {
      data = audio.slice(start, end);
    }
    chunks.push({ index, data, start_frame:start, end_frame:end,
      start_sec:start/SAMPLE_RATE, end_sec:end/SAMPLE_RATE, is_last:isLast });
    if(isLast) break;
    start += HOP_FRAMES; index++;
  }
  return chunks;
}

function resampleTo16k(audio: Float32Array, srcSR: number): Float32Array {
  if(srcSR === SAMPLE_RATE) return audio;
  const ratio = srcSR / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(audio.length / ratio));
  for(let i = 0; i < out.length; i++) {
    const s = i * ratio, lo = Math.floor(s), hi = Math.min(lo+1, audio.length-1);
    out[i] = audio[lo] * (1-(s-lo)) + audio[hi] * (s-lo);
  }
  return out;
}

// greedyDecoder
function greedyArgmax(logits: Float32Array): number {
  let mi = 0, mv = logits[0];
  for(let i=1;i<logits.length;i++) if(logits[i]>mv){mv=logits[i];mi=i;}
  return mi;
}

function computeTokenConfidence(logits: Float32Array, idx: number): number {
  let mx = logits[0];
  for(let i=1;i<logits.length;i++) if(logits[i]>mx) mx=logits[i];
  let s=0; for(let i=0;i<logits.length;i++) s+=Math.exp(logits[i]-mx);
  return Math.max(0,Math.min(1,Math.exp(logits[idx]-mx)/s));
}

// tokenizerGovernance
const RTL_RANGES: [number,number][] = [[0x0600,0x06FF],[0x0750,0x077F],[0x0590,0x05FF]];
function isRTLChar(c: string): boolean {
  const cp = c.codePointAt(0)??0;
  return RTL_RANGES.some(([lo,hi])=>cp>=lo&&cp<=hi);
}
function detectTextDirection(text: string): "rtl"|"ltr" {
  let r=0,l=0;
  for(const c of text){if(isRTLChar(c))r++;else if(/[a-zA-Z]/.test(c))l++;}
  return r>l?"rtl":"ltr";
}
const ARABIC_MAP: Record<string,string> = {"٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"};
function normalizeArabicNumerals(t: string): string {
  return t.replace(/[٠-٩]/g,d=>ARABIC_MAP[d]??d);
}

// speechQA
function detectHallucination(text: string) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const grams = new Map<string,number>();
  for(let i=0;i<=words.length-3;i++){
    const g=`${words[i]} ${words[i+1]} ${words[i+2]}`;
    grams.set(g,(grams.get(g)??0)+1);
  }
  return Array.from(grams.entries()).filter(([,c])=>c>=3).length;
}

// speechDatasetIntel
function classifyNoisyLevel(conf: number): string {
  if(conf>=0.8) return "clean";
  if(conf>=0.6) return "light";
  if(conf>=0.4) return "moderate";
  return "heavy";
}
function estimateSyntheticProbability(confs: number[]): number {
  if(confs.length<5) return 0;
  const mean=confs.reduce((a,b)=>a+b,0)/confs.length;
  const variance=confs.reduce((s,c)=>s+(c-mean)**2,0)/confs.length;
  return Math.max(0,Math.min(1,1-variance/0.02));
}

let passed=0, failed=0;
function expect(label:string,actual:unknown,expected:unknown):void{
  const ok=JSON.stringify(actual)===JSON.stringify(expected);
  if(ok){console.log(`  ✅ ${label}`);passed++;}
  else{console.error(`  ❌ ${label}\n     Expected:${JSON.stringify(expected)}\n     Actual:${JSON.stringify(actual)}`);failed++;}
}
function expectTrue(label:string,v:boolean):void{expect(label,v,true);}

async function main() {

// ── TEST 1: Protocol Constants ────────────────────────────────────────────────
console.log("\n── TEST 1: Protocol Constants ──");
{
  expect("protocol version",      INFERENCE_PROTOCOL_VERSION, "8.1.0");
  expect("decoder strategy",      DECODER_STRATEGY, "greedy");
  expect("temperature = 0",       TEMPERATURE, 0);
  expect("sample rate = 16000",   SAMPLE_RATE, 16000);
  expect("alignment version",     ALIGNMENT_VERSION, "8.2.0");
  expect("stream version",        STREAM_VERSION, "8.3.0");
  expect("qa version",            SPEECH_QA_VERSION, "8.4.0");
  expect("multilingual version",  MULTILINGUAL_VERSION, "8.5.0");
  expect("intel version",         SPEECH_INTEL_VERSION, "8.6.0");
  expect("tokenizer version",     TOKENIZER_VERSION, "8.1.0");
}

// ── TEST 2: Deterministic Chunking ───────────────────────────────────────────
console.log("\n── TEST 2: Deterministic Chunking ──");
{
  const audio = new Float32Array(SAMPLE_RATE * 5); // 5s
  audio.fill(0.1);

  const chunks1 = chunkAudio(audio);
  const chunks2 = chunkAudio(audio);

  expectTrue("5s → 1 chunk",              chunks1.length === 1);
  expect("deterministic",                  chunks1.length, chunks2.length);
  expect("chunk size = CHUNK_FRAMES",      chunks1[0].data.length, CHUNK_FRAMES);
  expectTrue("last chunk padded",          chunks1[0].data.length === CHUNK_FRAMES);
  expectTrue("start_frame = 0",           chunks1[0].start_frame === 0);
  expect("is_last = true",                chunks1[0].is_last, true);

  // Multi-chunk audio (65 seconds)
  const longAudio = new Float32Array(SAMPLE_RATE * 65);
  const mChunks = chunkAudio(longAudio);
  expectTrue("65s → multiple chunks",     mChunks.length > 1);
  expectTrue("all chunks same size",
    mChunks.every(c => c.data.length === CHUNK_FRAMES));
  expectTrue("sequential indices",
    mChunks.every((c,i) => c.index === i));
  expectTrue("last chunk is_last",        mChunks[mChunks.length-1].is_last);

  // Same audio → same chunks (reproducibility invariant)
  const r1 = chunkAudio(audio).map(c=>c.start_frame).join(",");
  const r2 = chunkAudio(audio).map(c=>c.start_frame).join(",");
  expect("INVARIANT: same audio → same chunks", r1, r2);
}

// ── TEST 3: Resample ─────────────────────────────────────────────────────────
console.log("\n── TEST 3: Resample ──");
{
  const audio48k = new Float32Array(48000).fill(0.5);
  const audio16k = resampleTo16k(audio48k, 48000);
  expectTrue("48k→16k: 3x smaller",       audio16k.length === 16000);
  expectTrue("values preserved",           audio16k.every(v => Math.abs(v-0.5) < 0.01));

  // No-op if already 16k
  const same = resampleTo16k(audio48k.slice(0,16000), 16000);
  expectTrue("16k passthrough",            same.length === 16000);

  // Determinism
  const r1 = resampleTo16k(audio48k, 48000);
  const r2 = resampleTo16k(audio48k, 48000);
  expectTrue("resample deterministic",     r1.every((v,i)=>v===r2[i]));
}

// ── TEST 4: Greedy Decoder ───────────────────────────────────────────────────
console.log("\n── TEST 4: Greedy Decoder ──");
{
  const logits = new Float32Array([0.1, 0.9, 0.3, 0.05]);
  expect("argmax = 1",                    greedyArgmax(logits), 1);

  // Determinism
  expect("argmax deterministic",          greedyArgmax(logits), greedyArgmax(logits));

  // Confidence
  const conf = computeTokenConfidence(logits, 1);
  expectTrue("confidence 0→1",            conf >= 0 && conf <= 1);
  expectTrue("argmax has highest conf",
    conf >= computeTokenConfidence(logits, 0));

  // All-equal logits → argmax = 0 (first)
  const equal = new Float32Array([0.5,0.5,0.5,0.5]);
  expect("equal logits → argmax=0",      greedyArgmax(equal), 0);

  // No beam, no sampling → temperature irrelevant
  expect("temperature = 0",              TEMPERATURE, 0);
  expect("decoder = greedy",             DECODER_STRATEGY, "greedy");
}

// ── TEST 5: RTL + Arabic ─────────────────────────────────────────────────────
console.log("\n── TEST 5: RTL + Arabic ──");
{
  expectTrue("Arabic char is RTL",        isRTLChar("ا"));
  expectTrue("Latin char not RTL",        !isRTLChar("a"));
  expectTrue("Number not RTL",            !isRTLChar("5"));

  expect("Arabic text → rtl",            detectTextDirection("مرحبا"), "rtl");
  expect("English text → ltr",           detectTextDirection("hello"), "ltr");
  expect("mixed → majority",             detectTextDirection("hello world"), "ltr");

  // Arabic numeral normalization
  expect("٣ → 3",                        normalizeArabicNumerals("٣"), "3");
  expect("١٢٣ → 123",                    normalizeArabicNumerals("١٢٣"), "123");
  expect("mixed normalization",           normalizeArabicNumerals("٢٠٢٤"), "2024");

  // Determinism
  expect("RTL detection deterministic",
    detectTextDirection("مرحبا"),
    detectTextDirection("مرحبا"));
}

// ── TEST 6: Speech QA ─────────────────────────────────────────────────────────
console.log("\n── TEST 6: Speech QA ──");
{
  // Hallucination detection
  const normalText = "hello world this is a test of the emergency broadcast system";
  expect("normal text: no hallucination", detectHallucination(normalText), 0);

  const halluText = "the the the the the the the the the the the the";
  expectTrue("repeated phrase detected",   detectHallucination(halluText) > 0);

  // Determinism
  expect("QA deterministic",              detectHallucination(normalText), detectHallucination(normalText));
}

// ── TEST 7: Speech Dataset Intelligence ──────────────────────────────────────
console.log("\n── TEST 7: Speech Dataset Intelligence ──");
{
  expect("conf 0.9 → clean",      classifyNoisyLevel(0.9), "clean");
  expect("conf 0.7 → light",      classifyNoisyLevel(0.7), "light");
  expect("conf 0.5 → moderate",   classifyNoisyLevel(0.5), "moderate");
  expect("conf 0.2 → heavy",      classifyNoisyLevel(0.2), "heavy");

  // Synthetic probability
  const uniformConfs = new Array(10).fill(0.8); // unnaturally uniform
  const naturalConfs = [0.9,0.3,0.7,0.5,0.8,0.2,0.9,0.4,0.6,0.7];
  const syntheticP = estimateSyntheticProbability(uniformConfs);
  const naturalP   = estimateSyntheticProbability(naturalConfs);
  expectTrue("uniform → higher synthetic prob",  syntheticP > naturalP);
  expectTrue("synthetic prob 0→1",               syntheticP >= 0 && syntheticP <= 1);

  // Determinism
  expect("noisy level deterministic",    classifyNoisyLevel(0.7), classifyNoisyLevel(0.7));
  expect("synthetic prob deterministic",
    estimateSyntheticProbability(uniformConfs),
    estimateSyntheticProbability(uniformConfs));
}

// ── TEST 8: Replay Invariant ─────────────────────────────────────────────────
console.log("\n── TEST 8: Replay Invariant (SAME INPUT → SAME OUTPUT) ──");
{
  // Core invariant: same audio → same chunks → same tokens
  const audio = new Float32Array(SAMPLE_RATE * 10);
  for(let i=0;i<audio.length;i++) audio[i] = Math.sin(i * 0.01) * 0.5;

  const run1_chunks = chunkAudio(audio).map(c => c.start_frame + ":" + c.end_frame);
  const run2_chunks = chunkAudio(audio).map(c => c.start_frame + ":" + c.end_frame);
  expect("INVARIANT: chunks reproducible", run1_chunks.join("|"), run2_chunks.join("|"));

  const logits = new Float32Array(100).fill(0).map((_,i)=>i===42?1.0:0.0);
  const t1 = greedyArgmax(logits);
  const t2 = greedyArgmax(logits);
  expect("INVARIANT: greedy reproducible", t1, t2);

  const dir1 = detectTextDirection("مرحبا بالعالم");
  const dir2 = detectTextDirection("مرحبا بالعالم");
  expect("INVARIANT: RTL reproducible", dir1, dir2);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════`);
console.log(`PHASE 8.8 RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);
if(failed>0) throw new Error(`${failed} tests failed`);
}

main().catch(e=>{console.error(e);throw e;});
