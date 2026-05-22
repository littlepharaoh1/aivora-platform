/**
 * qaAgent.ts — Autonomous Quality Assurance Agent
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Multi-dimensional quality evaluation (ITU-R + EBU + forensic)
 * - Adaptive threshold calibration per content type
 * - Confidence-weighted verdict generation
 * - Automated pass/fail/review decision
 * - Evidence-based rejection with specific reasons
 * - Learning from human reviewer corrections
 * - Batch QA with statistical sampling
 * - SLA tracking (throughput + accuracy)
 *
 * Design reference:
 * - Appen/Scale AI QA pipeline model
 * - iZotope RX autonomous quality check
 * - Broadcast QA automation (EBU R128 compliance)
 */

import { runIntegrityCheck }       from "../dsp/observability/audioIntegrity";
import { detectSyntheticSpeech }   from "../audioForensics/syntheticSpeechDetector";
import { detectAIArtifacts }       from "../ai/aiArtifactDetector";
import { measureLUFS }             from "../audioEditor/masteringLimiter";
import { vadEngine }               from "../ai/vadEngine";
import { supabase }                from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type QAVerdict    = "pass" | "review" | "reject";
export type ContentType  = "speech" | "music" | "sfx" | "mixed" | "unknown";
export type QADimension  = "loudness" | "integrity" | "authenticity" | "speech_quality" | "technical";

export interface QACriteria {
  minLufs:        number;
  maxLufs:        number;
  maxTruePeakDb:  number;
  maxClipRatio:   number;
  minSpeechRatio: number;
  maxSyntheticConf: number;
  minDuration:    number;
  maxDuration:    number;
  requireNatural: boolean;
}

export interface QADimensionScore {
  dimension:  QADimension;
  score:      number;       // 0-100
  weight:     number;       // importance weight
  passed:     boolean;
  details:    string;
}

export interface QADecision {
  fileId:      string;
  verdict:     QAVerdict;
  confidence:  number;
  totalScore:  number;
  dimensions:  QADimensionScore[];
  reasons:     string[];
  suggestions: string[];
  processingMs: number;
  agentVersion: string;
}

export interface HumanCorrection {
  fileId:      string;
  agentVerdict:  QAVerdict;
  humanVerdict:  QAVerdict;
  reason:        string;
  timestamp:     number;
}

export interface QAAgentMemory {
  corrections:    HumanCorrection[];
  thresholdAdj:   Partial<QACriteria>;
  totalDecisions: number;
  agreementRate:  number;
  corrections7d:  number;
}

// ── Default Criteria per Content Type ─────────────────────────────────────────

const DEFAULT_CRITERIA: Record<ContentType, QACriteria> = {
  speech: {
    minLufs:-28, maxLufs:-14, maxTruePeakDb:-1.0,
    maxClipRatio:0.0001, minSpeechRatio:0.5,
    maxSyntheticConf:0.7, minDuration:0.5, maxDuration:300,
    requireNatural:true,
  },
  music: {
    minLufs:-18, maxLufs:-8, maxTruePeakDb:-0.5,
    maxClipRatio:0.0005, minSpeechRatio:0,
    maxSyntheticConf:1.0, minDuration:5, maxDuration:600,
    requireNatural:false,
  },
  sfx: {
    minLufs:-40, maxLufs:-6, maxTruePeakDb:-1.0,
    maxClipRatio:0.001, minSpeechRatio:0,
    maxSyntheticConf:1.0, minDuration:0.1, maxDuration:30,
    requireNatural:false,
  },
  mixed: {
    minLufs:-30, maxLufs:-10, maxTruePeakDb:-1.0,
    maxClipRatio:0.001, minSpeechRatio:0.2,
    maxSyntheticConf:0.8, minDuration:1, maxDuration:600,
    requireNatural:false,
  },
  unknown: {
    minLufs:-40, maxLufs:-6, maxTruePeakDb:-0.5,
    maxClipRatio:0.001, minSpeechRatio:0,
    maxSyntheticConf:0.9, minDuration:0.1, maxDuration:600,
    requireNatural:false,
  },
};

// ── Content Type Classifier ───────────────────────────────────────────────────

async function classifyContent(
  data: Float32Array,
  sr:   number
): Promise<ContentType> {
  const vad=await vadEngine.analyze(data, sr, { useNeural:false });

  if(vad.speechRatio>0.6) return "speech";
  if(vad.speechRatio>0.3) return "mixed";

  // Music detection via spectral regularity
  const frameLen=Math.floor(0.1*sr);
  let periodic=0, frames=0;
  for(let s=0;s+frameLen<=data.length;s+=frameLen){
    let e=0,r0=0;
    for(let i=0;i<frameLen;i++) e+=data[s+i]**2;
    const tau=Math.floor(sr/440);
    if(tau<frameLen)
      for(let i=0;i<frameLen-tau;i++) r0+=data[s+i]*data[s+i+tau];
    if(e>0&&r0/(e+1e-15)>0.3) periodic++;
    frames++;
  }
  const periodicRatio=frames>0?periodic/frames:0;
  if(periodicRatio>0.5) return "music";

  // Duration-based guess for SFX
  if(data.length/sr<10) return "sfx";
  return "unknown";
}

// ── Dimension Evaluators ──────────────────────────────────────────────────────

function evalLoudness(
  data:     Float32Array,
  sr:       number,
  criteria: QACriteria
): QADimensionScore {
  const lufs      = measureLUFS(data, sr);
  let   truePeak  = 0;
  for(let i=0;i<data.length;i++) if(Math.abs(data[i])>truePeak) truePeak=Math.abs(data[i]);
  const tpDb      = truePeak>0?20*Math.log10(truePeak):-120;

  const lufsOk    = lufs>=criteria.minLufs&&lufs<=criteria.maxLufs;
  const tpOk      = tpDb<=criteria.maxTruePeakDb;
  const passed    = lufsOk&&tpOk;

  const lufsScore = lufsOk ? 100 : Math.max(0,100-Math.abs(lufs-
    (lufs<criteria.minLufs?criteria.minLufs:criteria.maxLufs))*10);
  const tpScore   = tpOk ? 100 : Math.max(0,100+(criteria.maxTruePeakDb-tpDb)*20);
  const score     = (lufsScore+tpScore)/2;

  return {
    dimension: "loudness",
    score:     Math.round(score),
    weight:    0.25,
    passed,
    details:   `LUFS: ${lufs.toFixed(1)} (${criteria.minLufs}~${criteria.maxLufs}), TP: ${tpDb.toFixed(2)}dB`,
  };
}

function evalIntegrity(
  data:     Float32Array,
  sr:       number,
  criteria: QACriteria
): QADimensionScore {
  const mockBuf={
    getChannelData:()=>data, numberOfChannels:1,
    length:data.length, sampleRate:sr, duration:data.length/sr,
  } as unknown as AudioBuffer;

  const integrity=runIntegrityCheck(mockBuf);
  const issues: string[]=[];

  if(integrity.nanInf.hasNaN||integrity.nanInf.hasInf) issues.push("NaN/Inf samples");
  if(integrity.clipping.clipRatio>criteria.maxClipRatio)
    issues.push(`Clipping: ${(integrity.clipping.clipRatio*100).toFixed(3)}%`);
  if(integrity.dcOffset.significant) issues.push(`DC offset: ${integrity.dcOffset.offsetDb.toFixed(1)}dB`);
  if(integrity.silence.isDigitalMute) issues.push("Digital silence");

  const durationSec=data.length/sr;
  if(durationSec<criteria.minDuration) issues.push(`Too short: ${durationSec.toFixed(2)}s`);
  if(durationSec>criteria.maxDuration) issues.push(`Too long: ${durationSec.toFixed(1)}s`);

  const passed=issues.length===0;
  const score=Math.max(0,100-issues.length*25);

  return {
    dimension:"integrity", score, weight:0.30,
    passed,
    details:passed?"Clean":issues.join("; "),
  };
}

async function evalAuthenticity(
  data:     Float32Array,
  sr:       number,
  criteria: QACriteria
): Promise<QADimensionScore> {
  const synthetic=detectSyntheticSpeech(data,sr);
  const aiArt    =detectAIArtifacts(data,sr);

  const synthOk=!synthetic.isSynthetic||synthetic.confidence<criteria.maxSyntheticConf;
  const artOk  =aiArt.overallScore>=60;
  const passed =synthOk&&artOk;

  const score=Math.round((synthetic.overallScore+aiArt.overallScore)/2);

  return {
    dimension:"authenticity", score, weight:0.25,
    passed,
    details:[
      `Synthetic: ${synthetic.isSynthetic?`YES (${(synthetic.confidence*100).toFixed(0)}%)`:"NO"}`,
      `AI artifacts: ${aiArt.overallScore}/100`,
    ].join(", "),
  };
}

async function evalSpeechQuality(
  data:     Float32Array,
  sr:       number,
  criteria: QACriteria
): Promise<QADimensionScore> {
  if(criteria.minSpeechRatio===0) return {
    dimension:"speech_quality", score:100, weight:0.10, passed:true,
    details:"Not applicable",
  };

  const vad=await vadEngine.analyze(data,sr,{useNeural:false});
  const speechOk=vad.speechRatio>=criteria.minSpeechRatio;
  const score=Math.round(Math.min(100,vad.speechRatio/criteria.minSpeechRatio*100));

  return {
    dimension:"speech_quality", score, weight:0.10,
    passed:speechOk,
    details:`Speech ratio: ${(vad.speechRatio*100).toFixed(1)}% (min: ${(criteria.minSpeechRatio*100).toFixed(0)}%)`,
  };
}

function evalTechnical(
  data:     Float32Array,
  sr:       number
): QADimensionScore {
  // Sample rate check, mono/stereo, bit depth proxy
  const expectedSRs=[8000,16000,22050,24000,44100,48000,96000];
  const srOk=expectedSRs.includes(sr);
  const hasContent=data.some(v=>Math.abs(v)>1e-6);

  // Dynamic range (crest factor)
  let peak=0,ms=0;
  for(let i=0;i<data.length;i++){
    const v=Math.abs(data[i]);
    if(v>peak) peak=v;
    ms+=v*v;
  }
  const rms=Math.sqrt(ms/data.length);
  const crestFactor=rms>0?20*Math.log10(peak/rms):0;
  const dynamicOk=crestFactor>3&&crestFactor<30;

  const issues: string[]=[];
  if(!srOk) issues.push(`Unusual SR: ${sr}Hz`);
  if(!hasContent) issues.push("No audio content");
  if(!dynamicOk) issues.push(`Unusual crest factor: ${crestFactor.toFixed(1)}dB`);

  return {
    dimension:"technical", score:Math.max(0,100-issues.length*30),
    weight:0.10, passed:issues.length===0,
    details:issues.length>0?issues.join("; "):`SR:${sr}Hz, CF:${crestFactor.toFixed(1)}dB`,
  };
}

// ── QA Agent ──────────────────────────────────────────────────────────────────

export class QAAgent {
  private memory: QAAgentMemory = {
    corrections:    [],
    thresholdAdj:   {},
    totalDecisions: 0,
    agreementRate:  1.0,
    corrections7d:  0,
  };

  async evaluate(
    data:    Float32Array,
    sr:      number,
    fileId:  string,
    contentTypeHint?: ContentType
  ): Promise<QADecision> {
    const startMs   = performance.now();
    const contentType= contentTypeHint ?? await classifyContent(data,sr);
    const criteria   = { ...DEFAULT_CRITERIA[contentType], ...this.memory.thresholdAdj };

    // Run all dimensions in parallel
    const [auth, speech] = await Promise.all([
      evalAuthenticity(data,sr,criteria),
      evalSpeechQuality(data,sr,criteria),
    ]);

    const dimensions: QADimensionScore[] = [
      evalLoudness(data,sr,criteria),
      evalIntegrity(data,sr,criteria),
      auth,
      speech,
      evalTechnical(data,sr),
    ];

    // Weighted total score
    const totalScore=Math.round(
      dimensions.reduce((s,d)=>s+d.score*d.weight,0)/
      dimensions.reduce((s,d)=>s+d.weight,0)
    );

    // Verdict logic
    const hardFails=dimensions.filter(d=>!d.passed&&d.weight>=0.25);
    const softFails=dimensions.filter(d=>!d.passed&&d.weight<0.25);

    let verdict: QAVerdict;
    let confidence: number;

    if(hardFails.length>0){ verdict="reject"; confidence=0.9; }
    else if(softFails.length>0||totalScore<70){ verdict="review"; confidence=0.7; }
    else { verdict="pass"; confidence=Math.min(1,totalScore/100); }

    // Evidence
    const reasons: string[]=[];
    const suggestions: string[]=[];
    for(const d of dimensions.filter(dd=>!dd.passed)){
      reasons.push(`[${d.dimension}] ${d.details}`);
      if(d.dimension==="loudness") suggestions.push("Normalize to target LUFS");
      if(d.dimension==="integrity") suggestions.push("Run audio repair pipeline");
      if(d.dimension==="authenticity") suggestions.push("Verify recording is genuine");
    }
    if(verdict==="pass") reasons.push("All quality dimensions passed");

    this.memory.totalDecisions++;
    await this._persistDecision(fileId, verdict, totalScore);

    return {
      fileId, verdict, confidence, totalScore, dimensions,
      reasons, suggestions,
      processingMs: Math.round(performance.now()-startMs),
      agentVersion: "QAAgent-v1.0",
    };
  }

  // ── Human Correction ──────────────────────────────────────────────────────

  learnFromCorrection(correction: HumanCorrection): void {
    this.memory.corrections.push(correction);
    if(this.memory.corrections.length>500) this.memory.corrections.shift();

    const recent=this.memory.corrections.filter(c=>
      Date.now()-c.timestamp<7*24*60*60*1000
    );
    this.memory.corrections7d=recent.length;

    const agreements=this.memory.corrections.filter(c=>c.agentVerdict===c.humanVerdict).length;
    this.memory.agreementRate=agreements/this.memory.corrections.length;

    // Adaptive threshold adjustment
    if(recent.filter(c=>c.agentVerdict==="reject"&&c.humanVerdict==="pass").length>3){
      // Agent too strict — relax criteria
      this.memory.thresholdAdj.maxClipRatio=(this.memory.thresholdAdj.maxClipRatio??0.001)*1.2;
    }
  }

  // ── Batch QA ──────────────────────────────────────────────────────────────

  async evaluateBatch(
    files:   { id:string; data:Float32Array; sr:number; type?:ContentType }[],
    sampleRate = 1.0,     // 1.0 = check all, 0.1 = 10% sample
    onProgress?: (pct:number)=>void
  ): Promise<QADecision[]> {
    const sampled=sampleRate>=1.0?files:files.filter(()=>Math.random()<sampleRate);
    const results: QADecision[]=[];

    for(let i=0;i<sampled.length;i++){
      const f=sampled[i];
      const r=await this.evaluate(f.data,f.sr,f.id,f.type);
      results.push(r);
      onProgress?.(Math.round((i+1)/sampled.length*100));
      await new Promise<void>(r=>setTimeout(r,0));
    }

    return results;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async _persistDecision(fileId: string, verdict: QAVerdict, score: number): Promise<void> {
    try {
      await supabase.from("processing_jobs").insert({
        id:           `qa_${fileId}_${Date.now()}`,
        user_id:      "qa_agent",
        file_name:    fileId,
        status:       verdict==="pass"?"done":verdict==="reject"?"failed":"pending",
        score,
        job_type:     "qa",
        metadata:     { verdict, agentVersion:"QAAgent-v1.0" },
        completed_at: new Date().toISOString(),
      });
    } catch {}
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): QAAgentMemory { return { ...this.memory }; }

  getSummaryStats(decisions: QADecision[]): {
    pass: number; review: number; reject: number;
    avgScore: number; avgMs: number;
  } {
    return {
      pass:     decisions.filter(d=>d.verdict==="pass").length,
      review:   decisions.filter(d=>d.verdict==="review").length,
      reject:   decisions.filter(d=>d.verdict==="reject").length,
      avgScore: Math.round(decisions.reduce((s,d)=>s+d.totalScore,0)/decisions.length),
      avgMs:    Math.round(decisions.reduce((s,d)=>s+d.processingMs,0)/decisions.length),
    };
  }
}

export const qaAgent = new QAAgent();
