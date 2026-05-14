/**
 * deliveryIntelligence.ts — AI-Assisted Delivery Intelligence
 * Rejection probability + Auto-fix recommendations + Duplicate detection
 * Aivora Platform — Phase 13
 */

import { fmt } from "../metricGuards";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliveryMetrics {
  // Core
  lufs:           number;
  truePeak:       number;
  snrDb:          number;
  speechRatio:    number;
  duration:       number;
  sampleRate:     number;
  // Advanced
  rt60Ms?:        number;
  c50?:           number;
  noiseFloorDb?:  number;
  humDetected?:   boolean;
  humFreq?:       number;
  environment?:   string;
  hasDigitalGaps?: boolean;
  digitalGapCount?: number;
  leadingSilenceSec?: number;
  trailingSilenceSec?: number;
  // Profile
  profile:        "wakeword"|"asr"|"tts"|"conversation";
  fileName:       string;
}

export type ProbabilityLevel = "very_high"|"high"|"medium"|"low"|"very_low";

export interface ProbabilityScore {
  value:  number;          // 0.0 – 1.0
  level:  ProbabilityLevel;
  label:  string;
}

export interface AutoFixPlan {
  priority:    "critical"|"high"|"medium"|"low";
  action:      string;
  tool:        string;
  expectedGain: string;
  canAutoFix:  boolean;
}

export interface DuplicateSignal {
  fileA:      string;
  fileB:      string;
  similarity: number;
  type:       "exact"|"near_duplicate"|"suspicious";
}

export interface IntelligenceReport {
  fileName:         string;
  readyProbability: ProbabilityScore;
  reviewProbability: ProbabilityScore;
  rejectProbability: ProbabilityScore;
  verdict:          "DELIVER"|"REVIEW"|"REJECT";
  confidence:       number;
  criticalIssues:   string[];
  warnings:         string[];
  autoFixPlan:      AutoFixPlan[];
  reRecordFlag:     boolean;
  reRecordReason?:  string;
  deliveryScore:    number;
  processingMs:     number;
}

// ── Profile Requirements ──────────────────────────────────────────────────────

const PROFILE_REQS = {
  wakeword: {
    lufsMin:-26, lufsMax:-14,
    snrMin:30, speechMin:0.25, speechMax:0.95,
    durMin:0.35, durMax:1.45,
    maxRt60:400, maxLeading:0.5, maxTrailing:0.5,
  },
  asr: {
    lufsMin:-28, lufsMax:-14,
    snrMin:20, speechMin:0.20, speechMax:0.95,
    durMin:0.5, durMax:30.0,
    maxRt60:500, maxLeading:1.0, maxTrailing:1.0,
  },
  tts: {
    lufsMin:-24, lufsMax:-16,
    snrMin:35, speechMin:0.40, speechMax:0.98,
    durMin:0.3, durMax:15.0,
    maxRt60:200, maxLeading:0.3, maxTrailing:0.3,
  },
  conversation: {
    lufsMin:-30, lufsMax:-14,
    snrMin:15, speechMin:0.10, speechMax:0.95,
    durMin:1.0, durMax:60.0,
    maxRt60:600, maxLeading:2.0, maxTrailing:2.0,
  },
};

// ── Probability Level ─────────────────────────────────────────────────────────

function toLevel(v: number): ProbabilityLevel {
  if(v>=0.85) return "very_high";
  if(v>=0.65) return "high";
  if(v>=0.40) return "medium";
  if(v>=0.20) return "low";
  return "very_low";
}

function toLabel(level: ProbabilityLevel): string {
  return {
    very_high:"Very High",high:"High",
    medium:"Medium",low:"Low",very_low:"Very Low",
  }[level];
}

function makeProbScore(v: number): ProbabilityScore {
  const clamped=Math.max(0,Math.min(1,v));
  const level=toLevel(clamped);
  return { value:clamped, level, label:toLabel(level) };
}

// ── Issue Scorer ──────────────────────────────────────────────────────────────

interface Issue {
  severity: "critical"|"high"|"medium"|"low";
  message:  string;
  rejectWeight: number;   // How much does this push toward reject (0-1)
  fix?:     AutoFixPlan;
}

function scoreMetrics(m: DeliveryMetrics): Issue[] {
  const issues: Issue[] = [];
  const req=PROFILE_REQS[m.profile];

  // ── LUFS ──────────────────────────────────────────────────────────────────
  if(m.lufs < req.lufsMin-6){
    issues.push({
      severity:"critical", rejectWeight:0.85,
      message:`Loudness critically low: ${fmt.lufs(m.lufs)} (min ${req.lufsMin} LUFS)`,
      fix:{ priority:"critical", action:"Normalize loudness to target LUFS",
        tool:"Repair Suite → Normalize Loudness", expectedGain:`+${(req.lufsMin-m.lufs-3).toFixed(0)} dB`,
        canAutoFix:true },
    });
  } else if(m.lufs < req.lufsMin){
    issues.push({
      severity:"high", rejectWeight:0.55,
      message:`Loudness low: ${fmt.lufs(m.lufs)} (min ${req.lufsMin} LUFS)`,
      fix:{ priority:"high", action:"Normalize loudness",
        tool:"Repair Suite → Normalize Loudness", expectedGain:`+${(req.lufsMin-m.lufs).toFixed(0)} dB`,
        canAutoFix:true },
    });
  } else if(m.lufs > req.lufsMax){
    issues.push({
      severity:"high", rejectWeight:0.50,
      message:`Loudness too high: ${fmt.lufs(m.lufs)} (max ${req.lufsMax} LUFS)`,
      fix:{ priority:"high", action:"Reduce gain and re-normalize",
        tool:"Repair Suite → Normalize Loudness", expectedGain:`${(req.lufsMax-m.lufs).toFixed(0)} dB`,
        canAutoFix:true },
    });
  }

  // ── True Peak ──────────────────────────────────────────────────────────────
  if(m.truePeak > 0){
    issues.push({
      severity:"critical", rejectWeight:0.90,
      message:`Clipping detected: True Peak = ${fmt.truePeak(m.truePeak)}`,
      fix:{ priority:"critical", action:"Reduce gain to prevent clipping",
        tool:"Repair Suite → Normalize Loudness", expectedGain:"-2 dBTP headroom",
        canAutoFix:true },
    });
  } else if(m.truePeak > -1){
    issues.push({
      severity:"high", rejectWeight:0.60,
      message:`True peak too high: ${fmt.truePeak(m.truePeak)} (limit -1 dBTP)`,
      fix:{ priority:"high", action:"Apply limiting",
        tool:"Repair Suite → Normalize Loudness", expectedGain:"-1 dBTP safe",
        canAutoFix:true },
    });
  }

  // ── SNR ───────────────────────────────────────────────────────────────────
  if(m.snrDb < req.snrMin-10){
    issues.push({
      severity:"critical", rejectWeight:0.80,
      message:`SNR critically low: ${fmt.snr(m.snrDb)} (min ${req.snrMin} dB) — re-record required`,
      fix:{ priority:"critical", action:"Re-record in quieter environment",
        tool:"Re-record", expectedGain:`+${req.snrMin-m.snrDb} dB SNR`,
        canAutoFix:false },
    });
  } else if(m.snrDb < req.snrMin){
    issues.push({
      severity:"high", rejectWeight:0.55,
      message:`SNR below minimum: ${fmt.snr(m.snrDb)} (min ${req.snrMin} dB)`,
      fix:{ priority:"high", action:"Apply noise reduction",
        tool:"Repair Suite → Noise Reduction", expectedGain:"+5-10 dB SNR",
        canAutoFix:true },
    });
  }

  // ── Speech Ratio ──────────────────────────────────────────────────────────
  if(m.speechRatio < req.speechMin){
    const pct=(m.speechRatio*100).toFixed(1);
    const minPct=(req.speechMin*100).toFixed(0);
    issues.push({
      severity:"high", rejectWeight:0.60,
      message:`Speech ratio too low: ${pct}% (min ${minPct}%)`,
      fix:{ priority:"high", action:"Trim leading/trailing silence",
        tool:"Repair Suite → Trim Silence", expectedGain:`+${(req.speechMin-m.speechRatio)*100}% speech`,
        canAutoFix:true },
    });
  }

  // ── Duration ──────────────────────────────────────────────────────────────
  if(m.duration < req.durMin){
    issues.push({
      severity:"critical", rejectWeight:0.95,
      message:`Too short: ${m.duration.toFixed(2)}s (min ${req.durMin}s)`,
      fix:{ priority:"critical", action:"Re-record at correct speech speed",
        tool:"Re-record", expectedGain:"Correct duration",
        canAutoFix:false },
    });
  } else if(m.duration > req.durMax){
    issues.push({
      severity:"high", rejectWeight:0.65,
      message:`Too long: ${m.duration.toFixed(2)}s (max ${req.durMax}s)`,
      fix:{ priority:"high", action:"Trim or re-record",
        tool:"Waveform Workstation → Trim", expectedGain:"Correct duration",
        canAutoFix:false },
    });
  }

  // ── Sample Rate ───────────────────────────────────────────────────────────
  if(![16000,44100,48000].includes(m.sampleRate)){
    issues.push({
      severity:"critical", rejectWeight:0.85,
      message:`Invalid sample rate: ${m.sampleRate}Hz`,
      fix:{ priority:"critical", action:"Resample to 48000Hz",
        tool:"External tool (ffmpeg/Audacity)", expectedGain:"Valid sample rate",
        canAutoFix:false },
    });
  }

  // ── Digital Gaps ──────────────────────────────────────────────────────────
  if(m.hasDigitalGaps){
    issues.push({
      severity:"critical", rejectWeight:0.90,
      message:`Digital silence gaps: ${m.digitalGapCount} gap(s) detected`,
      fix:{ priority:"critical", action:"Apply Natural Silence Restoration",
        tool:"Quality Analyzer → Run Restoration", expectedGain:"Remove digital silence",
        canAutoFix:true },
    });
  }

  // ── Hum ───────────────────────────────────────────────────────────────────
  if(m.humDetected){
    issues.push({
      severity:"medium", rejectWeight:0.40,
      message:`Electrical hum detected: ${m.humFreq}Hz`,
      fix:{ priority:"medium", action:"Apply hum removal filter",
        tool:"Repair Suite → Remove Hum", expectedGain:"Remove electrical interference",
        canAutoFix:true },
    });
  }

  // ── Environment ───────────────────────────────────────────────────────────
  if(m.environment==="bathroom"){
    issues.push({
      severity:"high", rejectWeight:0.70,
      message:"Bathroom/high-reverb environment detected",
      fix:{ priority:"high", action:"Re-record in treated space",
        tool:"Re-record", expectedGain:"RT60 < 200ms",
        canAutoFix:false },
    });
  } else if(m.rt60Ms && m.rt60Ms > req.maxRt60){
    issues.push({
      severity:"medium", rejectWeight:0.35,
      message:`High reverb: RT60 = ${fmt.rt60(m.rt60Ms)}`,
      fix:{ priority:"medium", action:"Record in treated room",
        tool:"Re-record", expectedGain:`RT60 < ${req.maxRt60}ms`,
        canAutoFix:false },
    });
  }

  // ── Silence Edges ─────────────────────────────────────────────────────────
  if(m.leadingSilenceSec && m.leadingSilenceSec > req.maxLeading){
    issues.push({
      severity:"medium", rejectWeight:0.30,
      message:`Leading silence: ${(m.leadingSilenceSec*1000).toFixed(0)}ms (max ${req.maxLeading*1000}ms)`,
      fix:{ priority:"medium", action:"Trim leading silence",
        tool:"Repair Suite → Trim Silence", expectedGain:"Remove leading silence",
        canAutoFix:true },
    });
  }
  if(m.trailingSilenceSec && m.trailingSilenceSec > req.maxTrailing){
    issues.push({
      severity:"medium", rejectWeight:0.30,
      message:`Trailing silence: ${(m.trailingSilenceSec*1000).toFixed(0)}ms (max ${req.maxTrailing*1000}ms)`,
      fix:{ priority:"medium", action:"Trim trailing silence",
        tool:"Repair Suite → Trim Silence", expectedGain:"Remove trailing silence",
        canAutoFix:true },
    });
  }

  return issues;
}

// ── Re-record Detection ───────────────────────────────────────────────────────

function shouldReRecord(issues: Issue[]): { flag:boolean; reason?:string } {
  const criticalNoFix=issues.filter(i=>i.severity==="critical"&&!i.fix?.canAutoFix);
  if(criticalNoFix.length>0)
    return { flag:true, reason:criticalNoFix[0].message };

  const totalRejectWeight=issues.reduce((s,i)=>s+i.rejectWeight,0);
  if(totalRejectWeight>2.5)
    return { flag:true, reason:"Multiple compounding issues — re-recording recommended" };

  if(issues.some(i=>i.message.includes("bathroom")))
    return { flag:true, reason:"Bathroom acoustics cannot be repaired digitally" };

  return { flag:false };
}

// ── Delivery Score ────────────────────────────────────────────────────────────

function computeDeliveryScore(issues: Issue[]): number {
  const totalPenalty=issues.reduce((s,i)=>{
    const w={critical:25,high:15,medium:8,low:3}[i.severity];
    return s+w;
  },0);
  return Math.max(0,Math.min(100,100-totalPenalty));
}

// ── Main Intelligence Engine ──────────────────────────────────────────────────

export function analyzeDelivery(metrics: DeliveryMetrics): IntelligenceReport {
  const startMs=Date.now();
  const issues=scoreMetrics(metrics);

  // Compute reject probability
  let rejectProb=0;
  for(const issue of issues){
    rejectProb=1-(1-rejectProb)*(1-issue.rejectWeight*0.6);
  }
  rejectProb=Math.min(0.99,rejectProb);

  // Review probability (issues exist but not catastrophic)
  const reviewProb=Math.min(0.99,Math.max(0,
    issues.filter(i=>i.severity!=="critical").length*0.15
  ))*(1-rejectProb*0.8);

  // Ready probability
  const readyProb=Math.max(0,1-rejectProb-reviewProb*0.5);

  // Verdict
  const verdict: IntelligenceReport["verdict"] =
    rejectProb>0.60 ? "REJECT" :
    reviewProb>0.30 || issues.length>0 ? "REVIEW" : "DELIVER";

  // Confidence
  const maxProb=Math.max(readyProb,reviewProb,rejectProb);
  const confidence=Math.min(1,(maxProb-0.33)*3);

  // Auto-fix plan (sorted by priority)
  const priorityOrder={critical:0,high:1,medium:2,low:3};
  const autoFixPlan=issues
    .filter(i=>i.fix)
    .map(i=>i.fix!)
    .sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority])
    .slice(0,5);

  const reRecord=shouldReRecord(issues);
  const deliveryScore=computeDeliveryScore(issues);

  return {
    fileName:         metrics.fileName,
    readyProbability: makeProbScore(readyProb),
    reviewProbability: makeProbScore(reviewProb),
    rejectProbability: makeProbScore(rejectProb),
    verdict,
    confidence,
    criticalIssues:   issues.filter(i=>i.severity==="critical").map(i=>i.message),
    warnings:         issues.filter(i=>i.severity!=="critical").map(i=>i.message),
    autoFixPlan,
    reRecordFlag:     reRecord.flag,
    reRecordReason:   reRecord.reason,
    deliveryScore,
    processingMs:     Date.now()-startMs,
  };
}

// ── Batch Intelligence ────────────────────────────────────────────────────────

export interface BatchIntelligenceReport {
  totalFiles:      number;
  deliverCount:    number;
  reviewCount:     number;
  rejectCount:     number;
  avgDeliveryScore: number;
  reRecordFiles:   string[];
  topIssues:       { message:string; count:number }[];
  packageReady:    boolean;
  packageWarning?: string;
  reports:         IntelligenceReport[];
}

export function analyzeBatchDelivery(
  metricsArray: DeliveryMetrics[]
): BatchIntelligenceReport {
  const reports=metricsArray.map(analyzeDelivery);

  const deliverCount=reports.filter(r=>r.verdict==="DELIVER").length;
  const reviewCount =reports.filter(r=>r.verdict==="REVIEW").length;
  const rejectCount =reports.filter(r=>r.verdict==="REJECT").length;
  const avgScore    =reports.length>0
    ? reports.reduce((s,r)=>s+r.deliveryScore,0)/reports.length : 0;
  const reRecordFiles=reports.filter(r=>r.reRecordFlag).map(r=>r.fileName);

  // Top issues across batch
  const issueCounts=new Map<string,number>();
  for(const r of reports){
    for(const issue of [...r.criticalIssues,...r.warnings]){
      const key=issue.split(":")[0].trim();
      issueCounts.set(key,(issueCounts.get(key)??0)+1);
    }
  }
  const topIssues=[...issueCounts.entries()]
    .sort((a,b)=>b[1]-a[1])
    .slice(0,5)
    .map(([message,count])=>({message,count}));

  // Package ready?
  const rejectRate=rejectCount/Math.max(1,reports.length);
  const packageReady=rejectRate<0.1&&avgScore>=60;
  const packageWarning=!packageReady
    ? rejectRate>=0.1
      ? `${rejectCount} files will be rejected — package not ready`
      : `Average delivery score too low: ${avgScore.toFixed(0)}/100`
    : undefined;

  return {
    totalFiles:metricsArray.length,
    deliverCount,reviewCount,rejectCount,
    avgDeliveryScore:avgScore,
    reRecordFiles,topIssues,
    packageReady,packageWarning,reports,
  };
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

export function detectDuplicates(
  embeddings: { fileName:string; mfcc:Float32Array }[]
): DuplicateSignal[] {
  const duplicates: DuplicateSignal[]=[];

  for(let i=0;i<embeddings.length;i++){
    for(let j=i+1;j<embeddings.length;j++){
      const a=embeddings[i], b=embeddings[j];
      if(a.mfcc.length===0||b.mfcc.length===0) continue;

      let dot=0,magA=0,magB=0;
      for(let k=0;k<a.mfcc.length;k++){
        dot+=a.mfcc[k]*b.mfcc[k];
        magA+=a.mfcc[k]**2;
        magB+=b.mfcc[k]**2;
      }
      const sim=(dot/(Math.sqrt(magA)*Math.sqrt(magB)+1e-10)+1)/2;

      if(sim>0.98) duplicates.push({
        fileA:a.fileName,fileB:b.fileName,similarity:sim,type:"exact",
      });
      else if(sim>0.95) duplicates.push({
        fileA:a.fileName,fileB:b.fileName,similarity:sim,type:"near_duplicate",
      });
      else if(sim>0.90) duplicates.push({
        fileA:a.fileName,fileB:b.fileName,similarity:sim,type:"suspicious",
      });
    }
  }
  return duplicates;
}
