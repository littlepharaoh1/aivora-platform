/**
 * repairAgent.ts — Autonomous Audio Repair Agent
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Perceive: audio integrity analysis + problem classification
 * - Plan: select optimal repair strategy (rule-based + learned)
 * - Execute: apply DSP repair pipeline
 * - Verify: validate output quality improvement
 * - Reflect: update strategy weights based on outcome
 * - Memory: persistent repair history + strategy performance
 *
 * Design reference:
 * - ReAct (Reasoning + Acting) agent loop
 * - Reflexion agent self-improvement
 * - iZotope RX autonomous repair
 */

import { runIntegrityCheck }      from "../dsp/observability/audioIntegrity";
import { autoRepairSpectral }     from "../audioEditor/spectralRepair";
import { applyAdaptiveDereverb }  from "../audioEditor/adaptiveDereverb";
import { applyMasteringLimiter }  from "../audioEditor/masteringLimiter";
import { reconstructHarmonics }   from "../audioEditor/harmonicReconstruction";
import { processTransients }      from "../audioEditor/transientProcessor";
import { jobQueue }               from "../cloud/jobQueue";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RepairProblem =
  | "clipping"      | "silence_gaps"   | "dc_offset"
  | "reverb"        | "noise"          | "harmonic_loss"
  | "phase_issue"   | "timing_drift"   | "bandwidth"
  | "nan_inf"       | "unknown";

export type RepairStrategy =
  | "spectral_repair"   | "dereverb"      | "harmonic_reconstruct"
  | "dc_removal"        | "limiter"       | "transient_restore"
  | "silence_fill"      | "passthrough";

export interface RepairPlan {
  problems:    RepairProblem[];
  strategies:  RepairStrategy[];
  confidence:  number;    // 0-1
  estimatedMs: number;
}

export interface RepairAction {
  strategy:   RepairStrategy;
  params:     Record<string, unknown>;
  startMs:    number;
  endMs?:     number;
  success?:   boolean;
  improvement?: number;  // quality delta
}

export interface AgentMemory {
  strategyWins:  Record<RepairStrategy, number>;
  strategyLosses:Record<RepairStrategy, number>;
  problemMap:    Record<RepairProblem, RepairStrategy[]>;
  totalRepairs:  number;
  successRate:   number;
}

export interface RepairResult {
  output:         Float32Array;
  plan:           RepairPlan;
  actions:        RepairAction[];
  inputQuality:   number;
  outputQuality:  number;
  improvement:    number;
  success:        boolean;
  agentReasoning: string[];
}

// ── Quality Score ─────────────────────────────────────────────────────────────

function scoreBuffer(data: Float32Array, sr: number): number {
  let ms=0, clips=0, maxAbs=0;
  for(let i=0;i<data.length;i++){
    const v=Math.abs(data[i]);
    ms+=v*v; if(v>maxAbs) maxAbs=v;
    if(v>=0.9999) clips++;
  }
  const rms=Math.sqrt(ms/data.length);
  const rmsDb=rms>0?20*Math.log10(rms):-120;
  const clipRatio=clips/data.length;
  const peakDb=maxAbs>0?20*Math.log10(maxAbs):- 120;

  let score=70;
  if(rmsDb<-40) score-=20;
  if(rmsDb>-3)  score-=10;
  if(clipRatio>0.01)  score-=20;
  if(clipRatio>0.001) score-=10;
  if(peakDb>-0.5)     score-=5;
  return Math.max(0,Math.min(100,score));
}

// ── Strategy Implementations ──────────────────────────────────────────────────

async function executeStrategy(
  data:     Float32Array,
  sr:       number,
  strategy: RepairStrategy,
  params:   Record<string, unknown>
): Promise<Float32Array> {
  switch(strategy){
    case "spectral_repair": {
      const r=autoRepairSpectral(data, sr, { method:"hybrid", contextMs:100 });
      return r.output;
    }
    case "dereverb": {
      const r=applyAdaptiveDereverb(data, sr, {
        method:   "hybrid",
        dryWet:   (params.dryWet as number)??0.8,
        strength: (params.strength as number)??0.7,
      });
      return r.output;
    }
    case "harmonic_reconstruct": {
      const r=reconstructHarmonics(data, sr, { strength:0.5 });
      return r.output;
    }
    case "dc_removal": {
      let mean=0; for(let i=0;i<data.length;i++) mean+=data[i];
      mean/=data.length;
      const out=new Float32Array(data.length);
      for(let i=0;i<data.length;i++) out[i]=data[i]-mean;
      return out;
    }
    case "limiter": {
      const r=applyMasteringLimiter(data, sr, {
        thresholdDb:(params.thresholdDb as number)??-1,
        adaptiveRelease:true,
      });
      return r.output;
    }
    case "transient_restore": {
      const r=processTransients(data, sr, { transientGainDb:3, sensitivity:0.5 });
      return r.output;
    }
    case "silence_fill": {
      // Linear interpolation for digital silence gaps
      const out=new Float32Array(data);
      const minGap=Math.floor(0.005*sr);
      let gapStart=-1;
      for(let i=0;i<data.length;i++){
        if(Math.abs(data[i])<1e-7){
          if(gapStart<0) gapStart=i;
        } else {
          if(gapStart>=0&&i-gapStart>=minGap&&gapStart>0){
            const gapLen=i-gapStart;
            const v0=data[gapStart-1], v1=data[i];
            for(let j=0;j<gapLen;j++)
              out[gapStart+j]=v0*(1-j/gapLen)+v1*(j/gapLen);
          }
          gapStart=-1;
        }
      }
      return out;
    }
    case "passthrough":
    default:
      return data;
  }
}

// ── Problem → Strategy Mapping ────────────────────────────────────────────────

const DEFAULT_STRATEGY_MAP: Record<RepairProblem, RepairStrategy[]> = {
  clipping:       ["spectral_repair", "limiter"],
  silence_gaps:   ["silence_fill", "spectral_repair"],
  dc_offset:      ["dc_removal"],
  reverb:         ["dereverb"],
  noise:          ["spectral_repair"],
  harmonic_loss:  ["harmonic_reconstruct", "spectral_repair"],
  phase_issue:    ["spectral_repair"],
  timing_drift:   ["passthrough"],
  bandwidth:      ["harmonic_reconstruct"],
  nan_inf:        ["silence_fill"],
  unknown:        ["spectral_repair", "limiter"],
};

// ── Repair Agent ──────────────────────────────────────────────────────────────

export class RepairAgent {
  private memory: AgentMemory = {
    strategyWins:  {} as Record<RepairStrategy, number>,
    strategyLosses:{} as Record<RepairStrategy, number>,
    problemMap:    { ...DEFAULT_STRATEGY_MAP },
    totalRepairs:  0,
    successRate:   0,
  };

  // ── Perceive ─────────────────────────────────────────────────────────────

  private perceive(data: Float32Array, sr: number): RepairProblem[] {
    const mockBuf = {
      getChannelData: ()=>data, numberOfChannels:1,
      length:data.length, sampleRate:sr, duration:data.length/sr,
    } as unknown as AudioBuffer;

    const integrity = runIntegrityCheck(mockBuf);
    const problems: RepairProblem[] = [];

    if(integrity.nanInf.hasNaN || integrity.nanInf.hasInf) problems.push("nan_inf");
    if(integrity.clipping.clipRatio > 0.001)               problems.push("clipping");
    if(integrity.silence.isDigitalMute)                    problems.push("silence_gaps");
    if(integrity.dcOffset.significant)                     problems.push("dc_offset");
    if(integrity.timing.significant)                       problems.push("timing_drift");
    if(integrity.spectral.seamRisk > 0.5)                  problems.push("phase_issue");
    if(problems.length===0)                                problems.push("unknown");

    return problems;
  }

  // ── Plan ──────────────────────────────────────────────────────────────────

  private plan(problems: RepairProblem[], inputQuality: number): RepairPlan {
    const strategies = new Set<RepairStrategy>();
    const reasoning:  string[] = [];

    for(const problem of problems){
      const strats = this.memory.problemMap[problem] ?? DEFAULT_STRATEGY_MAP[problem];
      // Sort by win rate
      const sorted = [...strats].sort((a,b)=>{
        const wA=(this.memory.strategyWins[a]??0)/(this.memory.strategyLosses[a]??1+1);
        const wB=(this.memory.strategyWins[b]??0)/(this.memory.strategyLosses[b]??1+1);
        return wB-wA;
      });
      if(sorted[0]) strategies.add(sorted[0]);
      reasoning.push(`Problem: ${problem} → Strategy: ${sorted[0]}`);
    }

    // Always add limiter as final stage if quality < 70
    if(inputQuality<70&&!strategies.has("limiter")) strategies.add("limiter");

    const estimatedMs=strategies.size*500;
    const confidence=Math.min(1,problems.length>0?0.7+this.memory.successRate*0.3:0.5);

    return {
      problems,
      strategies: Array.from(strategies),
      confidence,
      estimatedMs,
    };
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  private async execute(
    data:    Float32Array,
    sr:      number,
    plan:    RepairPlan
  ): Promise<{ output:Float32Array; actions:RepairAction[] }> {
    let current = data;
    const actions: RepairAction[] = [];

    for(const strategy of plan.strategies){
      const action: RepairAction = {
        strategy,
        params:   {},
        startMs:  performance.now(),
      };

      try {
        const qBefore = scoreBuffer(current, sr);
        current       = await executeStrategy(current, sr, strategy, action.params);
        const qAfter  = scoreBuffer(current, sr);

        action.endMs      = performance.now();
        action.success    = true;
        action.improvement= qAfter-qBefore;
      } catch(e){
        action.endMs   = performance.now();
        action.success = false;
        action.improvement=0;
      }

      actions.push(action);
    }

    return { output:current, actions };
  }

  // ── Reflect ───────────────────────────────────────────────────────────────

  private reflect(actions: RepairAction[], improvement: number): void {
    for(const action of actions){
      const s=action.strategy;
      if(!this.memory.strategyWins[s])  this.memory.strategyWins[s]=0;
      if(!this.memory.strategyLosses[s])this.memory.strategyLosses[s]=0;

      if(action.success&&(action.improvement??0)>0){
        this.memory.strategyWins[s]++;
      } else {
        this.memory.strategyLosses[s]++;
      }
    }

    this.memory.totalRepairs++;
    const totalW=Object.values(this.memory.strategyWins).reduce((a,b)=>a+b,0);
    const totalL=Object.values(this.memory.strategyLosses).reduce((a,b)=>a+b,0);
    this.memory.successRate=totalW/(totalW+totalL+1e-10);
  }

  // ── Main Agent Loop ───────────────────────────────────────────────────────

  async repair(
    data: Float32Array,
    sr:   number
  ): Promise<RepairResult> {
    const reasoning: string[] = [];

    // Perceive
    const problems     = this.perceive(data, sr);
    const inputQuality = scoreBuffer(data, sr);
    reasoning.push(`Perceived ${problems.length} problems: ${problems.join(", ")}`);
    reasoning.push(`Input quality: ${inputQuality}/100`);

    // Plan
    const plan = this.plan(problems, inputQuality);
    reasoning.push(`Planned ${plan.strategies.length} strategies (confidence: ${(plan.confidence*100).toFixed(0)}%)`);

    // Execute
    const { output, actions } = await this.execute(data, sr, plan);
    const outputQuality        = scoreBuffer(output, sr);
    const improvement          = outputQuality-inputQuality;
    reasoning.push(`Output quality: ${outputQuality}/100 (${improvement>=0?"+":""}${improvement.toFixed(1)})`);

    // Reflect
    this.reflect(actions, improvement);
    reasoning.push(`Reflected: success rate now ${(this.memory.successRate*100).toFixed(1)}%`);

    const success = improvement>=-2; // allow ±2 variance

    return {
      output: success?output:data,  // rollback if degraded
      plan, actions,
      inputQuality, outputQuality,
      improvement: Math.round(improvement*10)/10,
      success,
      agentReasoning: reasoning,
    };
  }

  // ── Batch Repair ──────────────────────────────────────────────────────────

  async repairBatch(
    files:   { id:string; data:Float32Array; sr:number }[],
    onProgress?: (pct:number, id:string)=>void
  ): Promise<Map<string,RepairResult>> {
    const results=new Map<string,RepairResult>();

    for(let i=0;i<files.length;i++){
      const f=files[i];
      const r=await this.repair(f.data, f.sr);
      results.set(f.id, r);
      onProgress?.(Math.round((i+1)/files.length*100), f.id);
      await new Promise<void>(r=>setTimeout(r,0));
    }

    return results;
  }

  getMemory():      AgentMemory { return { ...this.memory }; }
  resetMemory():    void        { this.memory={ strategyWins:{} as Record<RepairStrategy,number>, strategyLosses:{} as Record<RepairStrategy,number>, problemMap:{...DEFAULT_STRATEGY_MAP}, totalRepairs:0, successRate:0 }; }
}

export const repairAgent = new RepairAgent();
