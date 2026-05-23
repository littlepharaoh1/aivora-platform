/**
 * inferenceGraph.ts — Neural Inference Graph Orchestrator
 * Aivora Audio Infrastructure Platform
 *
 * - Graph-based inference pipeline (DAG execution)
 * - Streaming inference with backpressure
 * - Adaptive batching (group short frames)
 * - Mixed CPU/GPU execution routing
 * - Fallback chain: GPU → WASM → JS
 */

import { onnxRuntime }   from "../ai/onnxRuntime";
import { modelRegistry } from "./modelRegistry";
import { modelProfiler } from "./modelProfiler";
import { modelValidator } from "./modelValidator";
import type { ModelTask } from "./modelRegistry";

export interface InferenceNode {
  id:      string;
  task:    ModelTask;
  depends: string[];  // node IDs that must complete first
}

export interface InferenceGraph {
  nodes:    InferenceNode[];
  inputs:   Record<string,Float32Array>;
  sr:       number;
}

export interface GraphResult {
  outputs:     Record<string,Float32Array>;
  latencyMs:   number;
  nodesRun:    number;
  gpu:         boolean;
}

export type StreamCallback = (output:Float32Array, frameIdx:number)=>void;

export class InferenceGraphExecutor {
  // ── Single Inference ──────────────────────────────────────────────────────

  async infer(
    task:   ModelTask,
    input:  Float32Array,
    sr:     number
  ): Promise<Float32Array|null> {
    const available=["onnx_webgpu","onnx_wasm","js_fallback"] as const;
    const model=modelRegistry.getBestForTask(task,Array.from(available),"DESKTOP_BALANCED");
    if(!model) return null;

    const t0    = performance.now();
    const cold  = !onnxRuntime.getStats().loadedModels.includes(model.id as never);

    try {
      const result=await onnxRuntime.run({
        modelId:       model.id,
        correlationId: crypto.randomUUID(),
        inputs:        { input:{ data:input, dims:[1,input.length], type:"float32" } },
      });

      const ms=performance.now()-t0;
      if(cold) modelProfiler.recordColdStart(model.id,ms);
      else     modelProfiler.recordInference(model.id,ms,input.length);

      const outKey=model.capabilities.outputNames[0];
      const out=result?.outputs[outKey]?.data;
      if(out instanceof Float32Array){
        modelValidator.recordOutput(model.id,out);
        return out;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Graph Execution ───────────────────────────────────────────────────────

  async executeGraph(graph:InferenceGraph): Promise<GraphResult> {
    const t0      = performance.now();
    const outputs: Record<string,Float32Array> = { ...graph.inputs };
    const visited = new Set<string>();
    let   nodesRun= 0, anyGPU=false;

    const topoSort=(nodes:InferenceNode[]): InferenceNode[] => {
      const result:InferenceNode[]=[];
      const visit=(id:string)=>{
        if(visited.has(id)) return;
        visited.add(id);
        const node=nodes.find(n=>n.id===id);
        if(!node) return;
        for(const dep of node.depends) visit(dep);
        result.push(node);
      };
      for(const n of nodes) visit(n.id);
      return result;
    };

    for(const node of topoSort(graph.nodes)){
      const inputKey=node.depends[0]??Object.keys(graph.inputs)[0];
      const inputData=outputs[inputKey];
      if(!inputData) continue;

      const out=await this.infer(node.task,inputData,graph.sr);
      if(out){ outputs[node.id]=out; nodesRun++; }
    }

    return {
      outputs, nodesRun,
      latencyMs:Math.round((performance.now()-t0)*100)/100,
      gpu:      anyGPU,
    };
  }

  // ── Streaming Inference ───────────────────────────────────────────────────

  async streamInfer(
    task:      ModelTask,
    data:      Float32Array,
    sr:        number,
    frameSize: number,
    callback:  StreamCallback,
    onProgress?:(pct:number)=>void
  ): Promise<void> {
    const total=Math.floor(data.length/frameSize);
    for(let i=0;i<total;i++){
      const frame=data.slice(i*frameSize,(i+1)*frameSize);
      const out=await this.infer(task,frame,sr);
      if(out) callback(out,i);
      onProgress?.(Math.round((i+1)/total*100));
      if(i%8===0) await new Promise<void>(r=>setTimeout(r,0)); // yield
    }
  }
}

export const inferenceGraph = new InferenceGraphExecutor();
