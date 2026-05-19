/**
 * leaderboard.ts — Benchmark Scoring & Leaderboard Infrastructure
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Per-task leaderboard with ELO-style ranking
 * - Cross-task aggregate scoring (Elo + normalized)
 * - Submission history + version tracking
 * - Anti-gaming: only oracle-verified submissions count
 * - Percentile ranking + statistical significance
 * - Supabase persistence integration
 */

import type { VerifierResult } from "./oracleValidator";
import type { BenchTaskType }  from "./benchmarkMarketplace";
import { supabase }            from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  readonly rank:         number;
  readonly modelName:    string;
  readonly submitterId:  string;
  readonly taskId:       string;
  readonly score:        number;
  readonly primaryMetric: number;
  readonly verified:     boolean;
  readonly submittedAt:  number;
  readonly delta?:       number;   // rank change since last submission
}

export interface TaskLeaderboard {
  readonly taskId:    string;
  readonly taskType:  BenchTaskType;
  readonly entries:   LeaderboardEntry[];
  readonly updatedAt: number;
  readonly totalSubmissions: number;
}

export interface GlobalLeaderboard {
  readonly entries:   GlobalEntry[];
  readonly updatedAt: number;
  readonly taskCount: number;
}

export interface GlobalEntry {
  readonly rank:       number;
  readonly modelName:  string;
  readonly submitter:  string;
  readonly avgScore:   number;
  readonly taskCount:  number;
  readonly totalScore: number;
  readonly verified:   boolean;
  readonly badges:     Badge[];
}

export type BadgeType =
  | "top_performer"    // #1 on any task
  | "all_rounder"      // top 10 on 3+ tasks
  | "verified_only"    // all submissions oracle-verified
  | "consistent"       // low variance across tasks
  | "speed_demon";     // fast inference time

export interface Badge {
  type:        BadgeType;
  label:       string;
  earnedAt:    number;
}

// ── ELO-Style Scoring ─────────────────────────────────────────────────────────

const ELO_K       = 32;
const ELO_BASE    = 1000;
const ELO_SCALE   = 400;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB-ratingA)/ELO_SCALE));
}

function updateElo(rating: number, expected: number, actual: number): number {
  return Math.round(rating + ELO_K*(actual-expected));
}

// ── Badge Computation ─────────────────────────────────────────────────────────

function computeBadges(
  modelName:   string,
  allEntries:  LeaderboardEntry[]
): Badge[] {
  const badges: Badge[] = [];
  const myEntries = allEntries.filter(e=>e.modelName===modelName);

  if(myEntries.some(e=>e.rank===1))
    badges.push({ type:"top_performer", label:"Top Performer", earnedAt:Date.now() });

  const topTen = myEntries.filter(e=>e.rank<=10);
  if(topTen.length>=3)
    badges.push({ type:"all_rounder", label:"All-Rounder", earnedAt:Date.now() });

  if(myEntries.length>0 && myEntries.every(e=>e.verified))
    badges.push({ type:"verified_only", label:"Oracle Verified", earnedAt:Date.now() });

  if(myEntries.length>=3){
    const scores = myEntries.map(e=>e.score);
    const mean   = scores.reduce((a,b)=>a+b)/scores.length;
    const std    = Math.sqrt(scores.reduce((s,v)=>s+(v-mean)**2,0)/scores.length);
    if(std<10) badges.push({ type:"consistent", label:"Consistent", earnedAt:Date.now() });
  }

  return badges;
}

// ── Percentile Computation ────────────────────────────────────────────────────

function computePercentile(score: number, allScores: number[]): number {
  const below = allScores.filter(s=>s<score).length;
  return Math.round(below/allScores.length*100);
}

// ── Leaderboard Manager ───────────────────────────────────────────────────────

export class LeaderboardManager {
  private readonly submissions = new Map<string, VerifierResult[]>();
  private eloRatings           = new Map<string, number>();

  // ── Submission ────────────────────────────────────────────────────────────

  addResult(result: VerifierResult): void {
    if(!result.verified) return; // only oracle-verified

    const key = result.taskId;
    const arr = this.submissions.get(key) ?? [];
    arr.push(result);
    this.submissions.set(key, arr);

    // Update ELO
    const modelKey = `${result.submissionId}:${result.taskId}`;
    if(!this.eloRatings.has(modelKey)) this.eloRatings.set(modelKey, ELO_BASE);

    // Compare against all other submissions for this task
    for(const other of arr.filter(r=>r.submissionId!==result.submissionId)){
      const otherKey  = `${other.submissionId}:${result.taskId}`;
      const rA        = this.eloRatings.get(modelKey)  ?? ELO_BASE;
      const rB        = this.eloRatings.get(otherKey)  ?? ELO_BASE;
      const exp       = expectedScore(rA, rB);
      const actual    = result.score>other.score?1:result.score===other.score?0.5:0;
      this.eloRatings.set(modelKey,  updateElo(rA, exp, actual));
      this.eloRatings.set(otherKey,  updateElo(rB, 1-exp, 1-actual));
    }
  }

  // ── Task Leaderboard ──────────────────────────────────────────────────────

  getTaskLeaderboard(taskId: string): TaskLeaderboard {
    const results = this.submissions.get(taskId) ?? [];

    // Best submission per model
    const best = new Map<string, VerifierResult>();
    for(const r of results){
      const ex = best.get(r.submissionId);
      if(!ex || r.score > ex.score) best.set(r.submissionId, r);
    }

    const sorted = Array.from(best.values()).sort((a,b)=>b.score-a.score);
    const allScores = sorted.map(r=>r.score);

    const entries: LeaderboardEntry[] = sorted.map((r,i)=>({
      rank:          i+1,
      modelName:     r.submissionId,
      submitterId:   r.submissionId,
      taskId:        r.taskId,
      score:         r.score,
      primaryMetric: r.metrics[Object.keys(r.metrics)[0] as keyof typeof r.metrics]??0,
      verified:      r.verified,
      submittedAt:   r.timestamp,
    }));

    return {
      taskId,
      taskType:         "speech_enhancement",
      entries,
      updatedAt:        Date.now(),
      totalSubmissions: results.length,
    };
  }

  // ── Global Leaderboard ────────────────────────────────────────────────────

  getGlobalLeaderboard(): GlobalLeaderboard {
    const allResults: VerifierResult[] = [];
    for(const results of this.submissions.values()) allResults.push(...results);

    // Aggregate per model
    const modelMap = new Map<string, { scores:number[]; tasks:Set<string>; verified:boolean }>();
    for(const r of allResults){
      const m = modelMap.get(r.submissionId) ?? { scores:[], tasks:new Set(), verified:true };
      m.scores.push(r.score);
      m.tasks.add(r.taskId);
      if(!r.verified) m.verified=false;
      modelMap.set(r.submissionId, m);
    }

    const allTaskEntries: LeaderboardEntry[] = [];
    for(const [taskId] of this.submissions){
      allTaskEntries.push(...this.getTaskLeaderboard(taskId).entries);
    }

    const entries: GlobalEntry[] = Array.from(modelMap.entries()).map(([model,data])=>{
      const avg   = data.scores.reduce((a,b)=>a+b,0)/data.scores.length;
      const total = data.scores.reduce((a,b)=>a+b,0);
      return {
        rank:       0,
        modelName:  model,
        submitter:  model,
        avgScore:   Math.round(avg*10)/10,
        taskCount:  data.tasks.size,
        totalScore: Math.round(total),
        verified:   data.verified,
        badges:     computeBadges(model, allTaskEntries),
      };
    });

    // Sort + assign ranks
    entries.sort((a,b)=>b.avgScore-a.avgScore||b.taskCount-a.taskCount);
    entries.forEach((e,i)=>{ (e as {rank:number}).rank=i+1; });

    return { entries, updatedAt:Date.now(), taskCount:this.submissions.size };
  }

  // ── Supabase Persistence ──────────────────────────────────────────────────

  async persistResult(result: VerifierResult): Promise<void> {
    try {
      await supabase.from("bench_results").upsert({
        submission_id: result.submissionId,
        task_id:       result.taskId,
        score:         result.score,
        passed:        result.passed,
        verified:      result.verified,
        metrics:       result.metrics,
        input_hash:    result.inputHash,
        created_at:    new Date(result.timestamp).toISOString(),
      });
    } catch { /* non-blocking */ }
  }

  async loadFromSupabase(taskId?: string): Promise<void> {
    try {
      let query = supabase.from("bench_results").select("*").eq("verified",true);
      if(taskId) query = query.eq("task_id",taskId);
      const { data } = await query.order("score",{ascending:false}).limit(500);
      if(!data) return;

      for(const row of data){
        this.addResult({
          submissionId: row.submission_id,
          taskId:       row.task_id,
          metrics:      row.metrics??{},
          score:        row.score,
          passed:       row.passed,
          verified:     row.verified,
          confidence:   0.95,
          timestamp:    new Date(row.created_at).getTime(),
          inputHash:    row.input_hash??"",
        });
      }
    } catch { /* non-blocking */ }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): {
    totalTasks:       number;
    totalSubmissions: number;
    totalModels:      number;
    topScore:         number;
  } {
    let total=0, topScore=0;
    const models=new Set<string>();
    for(const results of this.submissions.values()){
      total+=results.length;
      for(const r of results){
        models.add(r.submissionId);
        if(r.score>topScore) topScore=r.score;
      }
    }
    return { totalTasks:this.submissions.size, totalSubmissions:total, totalModels:models.size, topScore };
  }
}

export const leaderboard = new LeaderboardManager();
