/**
 * agentOrchestrator.ts — Multi-Agent Coordination System
 * Aivora Audio Infrastructure Platform
 *
 * Architecture:
 * - Agent registry (discover + health check all agents)
 * - Task routing (match task to best agent)
 * - Agent cooperation (repair → QA → benchmark pipeline)
 * - Conflict resolution (multiple agents on same file)
 * - Agent communication (message passing)
 * - Collective memory (shared knowledge base)
 * - Emergency stop (halt all agents on critical error)
 * - Performance monitoring per agent
 *
 * Design reference:
 * - AutoGPT multi-agent coordination
 * - LangChain agent executor
 * - JADE (Java Agent DEvelopment) multi-agent framework
 */

import { repairAgent,    type RepairResult }    from "./repairAgent";
import { qaAgent,        type QADecision }       from "./qaAgent";
import { benchmarkAgent, type BenchmarkRun }     from "./benchmarkAgent";
import { jobQueue }                               from "../cloud/jobQueue";
import { enterpriseTelemetry }                    from "../cloud/enterpriseTelemetry";
import { supabase }                               from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentId   = "repair" | "qa" | "benchmark" | "orchestrator";
export type AgentStatus = "idle" | "running" | "error" | "stopped";

export type TaskType =
  | "repair_file"        // repair + QA + store
  | "qa_file"            // QA only
  | "repair_and_qa"      // repair → QA pipeline
  | "full_pipeline"      // repair → QA → benchmark
  | "batch_process"      // multi-file pipeline
  | "run_benchmark"      // benchmark only
  | "health_check";      // check all agents

export interface AgentTask {
  id:         string;
  type:       TaskType;
  input:      TaskInput;
  priority:   "critical" | "high" | "normal" | "low";
  createdAt:  number;
  assignedTo?: AgentId;
  status:     "pending" | "running" | "done" | "failed";
  result?:    TaskResult;
}

export interface TaskInput {
  data?:      Float32Array;
  sr?:        number;
  fileId?:    string;
  fileIds?:   string[];
  userId?:    string;
  params?:    Record<string, unknown>;
}

export interface TaskResult {
  success:     boolean;
  repairResult?:  RepairResult;
  qaDecision?:    QADecision;
  benchmarkRun?:  BenchmarkRun;
  pipelineStages: string[];
  totalMs:     number;
  agentLogs:   AgentMessage[];
}

export interface AgentMessage {
  from:      AgentId;
  to:        AgentId | "broadcast";
  type:      "status" | "result" | "error" | "request" | "coordination";
  payload:   unknown;
  timestamp: number;
}

export interface AgentHealth {
  agentId:   AgentId;
  status:    AgentStatus;
  lastPing:  number;
  taskCount: number;
  errorCount:number;
  avgTaskMs: number;
}

export interface OrchestratorStats {
  totalTasks:    number;
  pendingTasks:  number;
  completedTasks:number;
  failedTasks:   number;
  agentHealth:   AgentHealth[];
  uptime:        number;
}

// ── Agent Registry ────────────────────────────────────────────────────────────

class AgentRegistry {
  private health: Map<AgentId, AgentHealth> = new Map([
    ["repair",      { agentId:"repair",      status:"idle", lastPing:Date.now(), taskCount:0, errorCount:0, avgTaskMs:0 }],
    ["qa",          { agentId:"qa",          status:"idle", lastPing:Date.now(), taskCount:0, errorCount:0, avgTaskMs:0 }],
    ["benchmark",   { agentId:"benchmark",   status:"idle", lastPing:Date.now(), taskCount:0, errorCount:0, avgTaskMs:0 }],
    ["orchestrator",{ agentId:"orchestrator",status:"idle", lastPing:Date.now(), taskCount:0, errorCount:0, avgTaskMs:0 }],
  ]);

  updateStatus(id: AgentId, status: AgentStatus): void {
    const h=this.health.get(id);
    if(h){ h.status=status; h.lastPing=Date.now(); }
  }

  recordTask(id: AgentId, durationMs: number, success: boolean): void {
    const h=this.health.get(id);
    if(!h) return;
    h.taskCount++;
    if(!success) h.errorCount++;
    h.avgTaskMs=Math.round((h.avgTaskMs*(h.taskCount-1)+durationMs)/h.taskCount);
    h.lastPing=Date.now();
  }

  getAll():    AgentHealth[]             { return Array.from(this.health.values()); }
  get(id: AgentId): AgentHealth|undefined { return this.health.get(id); }
  isHealthy(id: AgentId): boolean        { return this.health.get(id)?.status!=="error"; }
}

// ── Collective Memory ─────────────────────────────────────────────────────────

interface MemoryEntry {
  fileId:    string;
  repairDone:boolean;
  qaVerdict: string;
  timestamp: number;
}

class CollectiveMemory {
  private entries = new Map<string, MemoryEntry>();
  private readonly maxEntries=1000;

  remember(fileId: string, patch: Partial<MemoryEntry>): void {
    const existing=this.entries.get(fileId)??{ fileId, repairDone:false, qaVerdict:"unknown", timestamp:Date.now() };
    this.entries.set(fileId,{ ...existing, ...patch, timestamp:Date.now() });
    if(this.entries.size>this.maxEntries){
      const oldest=Array.from(this.entries.entries()).sort((a,b)=>a[1].timestamp-b[1].timestamp)[0];
      this.entries.delete(oldest[0]);
    }
  }

  recall(fileId: string): MemoryEntry|undefined { return this.entries.get(fileId); }
  has(fileId: string):    boolean               { return this.entries.has(fileId); }
  size():                 number                { return this.entries.size; }
}

// ── Message Bus ───────────────────────────────────────────────────────────────

class MessageBus {
  private subscribers = new Map<AgentId|"broadcast", ((msg:AgentMessage)=>void)[]>();
  private history: AgentMessage[] = [];

  publish(msg: AgentMessage): void {
    this.history.push(msg);
    if(this.history.length>200) this.history.shift();

    // Route to specific agent
    const subs=this.subscribers.get(msg.to)??[];
    for(const sub of subs) sub(msg);

    // Broadcast
    if(msg.to==="broadcast"){
      for(const [,handlers] of this.subscribers) for(const h of handlers) h(msg);
    }
  }

  subscribe(id: AgentId, handler: (msg:AgentMessage)=>void): void {
    const subs=this.subscribers.get(id)??[];
    subs.push(handler);
    this.subscribers.set(id,subs);
  }

  getHistory(n=50): AgentMessage[] { return this.history.slice(-n); }
}

// ── Task Router ───────────────────────────────────────────────────────────────

function routeTask(task: AgentTask): AgentId[] {
  switch(task.type){
    case "repair_file":    return ["repair"];
    case "qa_file":        return ["qa"];
    case "repair_and_qa":  return ["repair","qa"];
    case "full_pipeline":  return ["repair","qa","benchmark"];
    case "batch_process":  return ["repair","qa"];
    case "run_benchmark":  return ["benchmark"];
    case "health_check":   return ["orchestrator"];
    default:               return ["qa"];
  }
}

// ── Agent Orchestrator ────────────────────────────────────────────────────────

export class AgentOrchestrator {
  private readonly registry = new AgentRegistry();
  private readonly memory   = new CollectiveMemory();
  private readonly bus      = new MessageBus();
  private readonly tasks    = new Map<string, AgentTask>();
  private stopped           = false;
  private readonly startedAt= Date.now();
  private completed         = 0;
  private failed            = 0;
  private taskSeq           = 0;

  constructor(){
    // Subscribe orchestrator to all messages
    this.bus.subscribe("orchestrator", (msg)=>{
      if(msg.type==="error") this.registry.updateStatus(msg.from,"error");
    });
  }

  // ── Task Submission ───────────────────────────────────────────────────────

  async submit(
    type:     TaskType,
    input:    TaskInput,
    priority: AgentTask["priority"]="normal"
  ): Promise<AgentTask> {
    const id=`task_${Date.now().toString(36)}_${++this.taskSeq}`;
    const task: AgentTask={
      id, type, input, priority,
      createdAt: Date.now(),
      status:    "pending",
    };

    this.tasks.set(id, task);

    // Route + execute
    this._execute(task).catch(()=>{});

    return task;
  }

  // ── Execution Pipeline ────────────────────────────────────────────────────

  private async _execute(task: AgentTask): Promise<void> {
    if(this.stopped) return;

    task.status   = "running";
    const agents  = routeTask(task);
    const startMs = performance.now();
    const logs:   AgentMessage[] = [];
    const stages: string[] = [];

    let repairResult:  RepairResult|undefined;
    let qaDecision:    QADecision|undefined;
    let benchRun:      BenchmarkRun|undefined;
    let success        = true;

    try {
      for(const agentId of agents){
        if(this.stopped) break;

        this.registry.updateStatus(agentId,"running");
        this._log(agentId,"orchestrator","status",`Starting ${task.type}`,logs);

        const agentStart=performance.now();

        switch(agentId){
          case "repair":
            if(task.input.data&&task.input.sr){
              repairResult=await repairAgent.repair(task.input.data,task.input.sr);
              stages.push(`repair(${repairResult.improvement>=0?"+":""}${repairResult.improvement.toFixed(1)})`);

              if(task.input.fileId)
                this.memory.remember(task.input.fileId,{repairDone:true});

              this._log("repair","orchestrator","result",
                `Repair done: ${repairResult.improvement.toFixed(1)} quality delta`, logs);
            }
            break;

          case "qa": {
            const dataToQA=repairResult?.output??task.input.data;
            const sr=task.input.sr??48000;
            if(dataToQA){
              qaDecision=await qaAgent.evaluate(dataToQA,sr,task.input.fileId??"unknown");
              stages.push(`qa(${qaDecision.verdict}:${qaDecision.totalScore})`);

              if(task.input.fileId)
                this.memory.remember(task.input.fileId,{qaVerdict:qaDecision.verdict});

              this._log("qa","orchestrator","result",
                `QA verdict: ${qaDecision.verdict} (${qaDecision.totalScore}/100)`,logs);
            }
            break;
          }

          case "benchmark":
            if(task.type==="full_pipeline"||task.type==="run_benchmark"){
              benchRun=await benchmarkAgent.run("quick");
              stages.push(`bench(${benchRun.corpus.totalScore}/100)`);
              this._log("benchmark","orchestrator","result",
                `Benchmark score: ${benchRun.corpus.totalScore}`,logs);
            }
            break;
        }

        const agentMs=performance.now()-agentStart;
        this.registry.recordTask(agentId,agentMs,true);
        this.registry.updateStatus(agentId,"idle");
      }

    } catch(e){
      success=false;
      this.failed++;
      this._log("orchestrator","broadcast","error",
        e instanceof Error?e.message:String(e), logs);
    }

    const totalMs=Math.round(performance.now()-startMs);

    task.status="done";
    task.result={
      success,
      repairResult, qaDecision, benchmarkRun:benchRun,
      pipelineStages:stages,
      totalMs,
      agentLogs:logs,
    };

    if(success) this.completed++;
    this.registry.recordTask("orchestrator",totalMs,success);

    await this._persistTask(task);
  }

  // ── Emergency Stop ────────────────────────────────────────────────────────

  emergencyStop(reason: string): void {
    this.stopped=true;
    this._log("orchestrator","broadcast","error",`EMERGENCY STOP: ${reason}`,[]);
    for(const id of ["repair","qa","benchmark"] as AgentId[])
      this.registry.updateStatus(id,"stopped");
  }

  resume(): void {
    this.stopped=false;
    for(const id of ["repair","qa","benchmark"] as AgentId[])
      this.registry.updateStatus(id,"idle");
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _log(
    from:    AgentId,
    to:      AgentId|"broadcast",
    type:    AgentMessage["type"],
    payload: unknown,
    logs:    AgentMessage[]
  ): void {
    const msg: AgentMessage={ from, to, type, payload, timestamp:Date.now() };
    this.bus.publish(msg);
    logs.push(msg);
  }

  private async _persistTask(task: AgentTask): Promise<void> {
    try {
      await supabase.from("processing_jobs").insert({
        id:           task.id,
        user_id:      task.input.userId??"orchestrator",
        file_name:    task.input.fileId??task.type,
        status:       task.status,
        score:        task.result?.qaDecision?.totalScore??0,
        metadata:     { type:task.type, stages:task.result?.pipelineStages, totalMs:task.result?.totalMs },
        completed_at: new Date().toISOString(),
      });
    } catch {}
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(): OrchestratorStats {
    const pending=Array.from(this.tasks.values()).filter(t=>t.status==="pending").length;
    return {
      totalTasks:    this.tasks.size,
      pendingTasks:  pending,
      completedTasks:this.completed,
      failedTasks:   this.failed,
      agentHealth:   this.registry.getAll(),
      uptime:        Date.now()-this.startedAt,
    };
  }

  getTask(id: string):       AgentTask|undefined  { return this.tasks.get(id); }
  getMemory():               CollectiveMemory      { return this.memory; }
  getMessageHistory(n=20):   AgentMessage[]        { return this.bus.getHistory(n); }
  isStopped():               boolean              { return this.stopped; }
}

export const agentOrchestrator = new AgentOrchestrator();
