/**
 * benchmarkMarketplace.ts — Audio Benchmark Marketplace
 * Aivora Audio Infrastructure Platform
 */

export type BenchTaskType =
  | "speech_enhancement" | "noise_suppression" | "dereverberation"
  | "speaker_verification" | "vad" | "deepfake_detection"
  | "audio_quality" | "forensic_analysis" | "bandwidth_extension" | "declipping";

export type MetricId =
  | "snr_db" | "pesq" | "stoi" | "si_sdr" | "dnsmos"
  | "eer" | "accuracy" | "f1" | "auc" | "lufs_error"
  | "rt60_error" | "provenance_score";

export type DifficultyLevel = "easy" | "medium" | "hard" | "expert";

export interface MetricSpec {
  readonly id:           MetricId;
  readonly name:         string;
  readonly unit:         string;
  readonly higherBetter: boolean;
  readonly range:        [number, number];
  readonly threshold:    number;
}

export interface BenchTask {
  readonly id:             string;
  readonly version:        string;
  readonly type:           BenchTaskType;
  readonly name:           string;
  readonly description:    string;
  readonly difficulty:     DifficultyLevel;
  readonly metrics:        MetricSpec[];
  readonly primaryMetric:  MetricId;
  readonly sampleRate:     number;
  readonly minDurationSec: number;
  readonly maxDurationSec: number;
  readonly tags:           string[];
  readonly createdAt:      number;
  readonly author:         string;
}

export interface TaskSubmission {
  readonly taskId:      string;
  readonly submitterId: string;
  readonly modelName:   string;
  readonly results:     Record<MetricId, number>;
  readonly metadata:    Record<string, unknown>;
  readonly timestamp:   number;
}

export interface SubmissionValidation {
  readonly valid:          boolean;
  readonly score:          number;
  readonly passedMetrics:  MetricId[];
  readonly failedMetrics:  MetricId[];
  readonly errors:         string[];
}

export const METRIC_SPECS: Record<MetricId, MetricSpec> = {
  snr_db:           { id:"snr_db",           name:"SNR",        unit:"dB",   higherBetter:true,  range:[-20,60],  threshold:20   },
  pesq:             { id:"pesq",             name:"PESQ",       unit:"MOS",  higherBetter:true,  range:[1,4.5],   threshold:3.0  },
  stoi:             { id:"stoi",             name:"STOI",       unit:"",     higherBetter:true,  range:[0,1],     threshold:0.75 },
  si_sdr:           { id:"si_sdr",           name:"SI-SDR",     unit:"dB",   higherBetter:true,  range:[-30,40],  threshold:10   },
  dnsmos:           { id:"dnsmos",           name:"DNSMOS",     unit:"MOS",  higherBetter:true,  range:[1,5],     threshold:3.5  },
  eer:              { id:"eer",              name:"EER",        unit:"%",    higherBetter:false, range:[0,50],    threshold:5    },
  accuracy:         { id:"accuracy",         name:"Accuracy",   unit:"%",    higherBetter:true,  range:[0,100],   threshold:85   },
  f1:               { id:"f1",              name:"F1 Score",   unit:"",     higherBetter:true,  range:[0,1],     threshold:0.85 },
  auc:              { id:"auc",             name:"AUC-ROC",    unit:"",     higherBetter:true,  range:[0,1],     threshold:0.90 },
  lufs_error:       { id:"lufs_error",       name:"LUFS Error", unit:"dB",   higherBetter:false, range:[0,20],    threshold:1.0  },
  rt60_error:       { id:"rt60_error",       name:"RT60 Error", unit:"ms",   higherBetter:false, range:[0,500],   threshold:50   },
  provenance_score: { id:"provenance_score", name:"Provenance", unit:"/100", higherBetter:true,  range:[0,100],   threshold:80   },
};

export const TASK_REGISTRY: BenchTask[] = [
  {
    id:"AIVORA-SE-001", version:"1.0.0", type:"speech_enhancement",
    name:"Broadband Speech Enhancement",
    description:"Enhance noisy speech recordings to broadcast quality",
    difficulty:"medium",
    metrics:[METRIC_SPECS.snr_db, METRIC_SPECS.dnsmos, METRIC_SPECS.stoi],
    primaryMetric:"dnsmos", sampleRate:48000, minDurationSec:1, maxDurationSec:30,
    tags:["speech","enhancement","broadband"], createdAt:Date.now(), author:"Aivora",
  },
  {
    id:"AIVORA-VD-001", version:"1.0.0", type:"vad",
    name:"Voice Activity Detection",
    description:"Detect speech segments in challenging real-world audio",
    difficulty:"hard",
    metrics:[METRIC_SPECS.f1, METRIC_SPECS.accuracy],
    primaryMetric:"f1", sampleRate:16000, minDurationSec:5, maxDurationSec:120,
    tags:["vad","speech","detection"], createdAt:Date.now(), author:"Aivora",
  },
  {
    id:"AIVORA-DF-001", version:"1.0.0", type:"deepfake_detection",
    name:"Audio Deepfake Detection",
    description:"Classify authentic vs synthetic speech with forensic evidence",
    difficulty:"expert",
    metrics:[METRIC_SPECS.auc, METRIC_SPECS.eer, METRIC_SPECS.accuracy],
    primaryMetric:"auc", sampleRate:48000, minDurationSec:1, maxDurationSec:30,
    tags:["forensic","deepfake","classification"], createdAt:Date.now(), author:"Aivora",
  },
  {
    id:"AIVORA-DR-001", version:"1.0.0", type:"dereverberation",
    name:"Room Dereverberation",
    description:"Remove room reverberation from speech recordings",
    difficulty:"hard",
    metrics:[METRIC_SPECS.rt60_error, METRIC_SPECS.si_sdr, METRIC_SPECS.stoi],
    primaryMetric:"si_sdr", sampleRate:48000, minDurationSec:2, maxDurationSec:30,
    tags:["reverb","room","speech"], createdAt:Date.now(), author:"Aivora",
  },
  {
    id:"AIVORA-QA-001", version:"1.0.0", type:"audio_quality",
    name:"Broadcast Quality Assessment",
    description:"Predict MOS/DNSMOS quality scores for audio files",
    difficulty:"medium",
    metrics:[METRIC_SPECS.dnsmos, METRIC_SPECS.lufs_error],
    primaryMetric:"dnsmos", sampleRate:48000, minDurationSec:1, maxDurationSec:60,
    tags:["quality","mos","broadcast"], createdAt:Date.now(), author:"Aivora",
  },
  {
    id:"AIVORA-DC-001", version:"1.0.0", type:"declipping",
    name:"Audio Declipping & Restoration",
    description:"Restore clipped audio to original dynamic range",
    difficulty:"hard",
    metrics:[METRIC_SPECS.snr_db, METRIC_SPECS.si_sdr],
    primaryMetric:"si_sdr", sampleRate:48000, minDurationSec:1, maxDurationSec:30,
    tags:["clipping","restoration","dynamics"], createdAt:Date.now(), author:"Aivora",
  },
];

export function validateSubmission(
  submission: TaskSubmission,
  task:       BenchTask
): SubmissionValidation {
  const errors: string[] = [];
  const passed: MetricId[] = [];
  const failed: MetricId[] = [];

  for(const spec of task.metrics){
    const v = submission.results[spec.id];
    if(v === undefined){ errors.push(`Missing: ${spec.id}`); failed.push(spec.id); continue; }
    const [mn,mx]=spec.range;
    if(v<mn||v>mx){ errors.push(`${spec.id}=${v} out of [${mn},${mx}]`); failed.push(spec.id); continue; }
    const ok=spec.higherBetter?v>=spec.threshold:v<=spec.threshold;
    (ok?passed:failed).push(spec.id);
  }

  let score=0;
  for(const spec of task.metrics){
    const v=submission.results[spec.id]; if(v===undefined) continue;
    const [mn,mx]=spec.range;
    const n=spec.higherBetter?(v-mn)/(mx-mn):1-(v-mn)/(mx-mn);
    score+=Math.max(0,Math.min(1,n))*(100/task.metrics.length);
  }

  return { valid:errors.length===0, score:Math.round(score), passedMetrics:passed, failedMetrics:failed, errors };
}

export function getTask(id: string):                      BenchTask|undefined  { return TASK_REGISTRY.find(t=>t.id===id); }
export function getTasksByType(type: BenchTaskType):      BenchTask[]          { return TASK_REGISTRY.filter(t=>t.type===type); }
export function getTasksByDifficulty(d: DifficultyLevel): BenchTask[]          { return TASK_REGISTRY.filter(t=>t.difficulty===d); }
