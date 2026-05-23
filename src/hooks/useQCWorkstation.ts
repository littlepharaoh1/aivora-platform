/**
 * useQCWorkstation.ts — Shared State Hook
 * Single source of truth for QC Workstation
 *
 * Architecture:
 * - audioBuffer in useRef (no re-render on buffer change)
 * - audioCtx in useRef (persistent — no GC on buffer)
 * - All analysis results in useState (trigger re-render when ready)
 * - Playback state in useRef + throttled setState
 * - Forensic workers auto-triggered on file load
 * - All 4 tabs share same buffer — decoded once only
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { analyzeAudioQuality }    from "../lib/audioQc/audioAnalyzerCore";
import { computeSpectrogramPro }  from "../lib/audioQc/spectrogramPro";
import spectrogramWorkerSrc     from "../lib/workers/spectrogramWorker?worker&inline";

// ── Spectrogram Worker Helper ──────────────────────────────────────────────────
let _specGeneration = 0;

function computeSpectrogramOffThread(
  buf: AudioBuffer,
  opts: { fftSize:number; minDb:number; maxDb:number }
): Promise<import("../lib/audioQc/spectrogramPro").SpectrogramProData> {
  return new Promise((resolve, reject) => {
    const id  = ++_specGeneration;
    const w   = new spectrogramWorkerSrc();

    // Timeout 20s
    const timeout = setTimeout(() => {
      w.terminate();
      reject(new Error("Spectrogram worker timeout"));
    }, 20000);

    w.onmessage = (e: MessageEvent) => {
      if(e.data.id !== id) return;
      if(e.data.type === "progress") return; // ignore progress for now
      if(e.data.type === "complete") {
        clearTimeout(timeout);
        w.terminate();
        const { nFrames, nBins, sampleRate, fftSize, flatTex } = e.data;
        const arr = new Float32Array(flatTex);
        // Reconstruct frames array for SpectrogramProData compatibility
        const frames: Float32Array[] = [];
        for(let f = 0; f < nFrames; f++) {
          frames.push(arr.subarray(f * nBins, (f+1) * nBins));
        }
        resolve({
          frames,
          numFrames:  nFrames,
          numBins:    nBins,
          sampleRate,
          fftSize,
          minDb:      opts.minDb,
          maxDb:      opts.maxDb,
          durationSec:buf.duration,
          windowFn:   "hann",
          overlap:    0.875,
        });
      }
    };
    w.onerror = (err) => {
      clearTimeout(timeout);
      w.terminate();
      reject(err);
    };

    // Mix to mono + transfer
    const mono = new Float32Array(buf.length);
    for(let ch=0;ch<buf.numberOfChannels;ch++){
      const d = buf.getChannelData(ch);
      for(let i=0;i<buf.length;i++) mono[i]+=d[i]/buf.numberOfChannels;
    }
    const copy = mono.buffer.slice(0);
    w.postMessage({
      id, samples: copy, sr: buf.sampleRate,
      fftSize: opts.fftSize, overlap: 0.875,
      minDb: opts.minDb, maxDb: opts.maxDb,
    }, [copy]);
  });
}
import { detectDigitalGaps }      from "../lib/audioQc/silenceRestorer";
import { analyzeAdvancedVAD }     from "../lib/audioQc/advancedVAD";
import { detectReverb }           from "../lib/audioQc/reverbDetector";
import { computeAppenScore }      from "../lib/audioQc/appenScore";
import { analyzeForensicSilence } from "../lib/audioEditor/forensicSilenceMode";
import { supabase } from "../lib/supabase";
import { telemetry, startSpan } from "../lib/telemetry/emitter";
import {
  SYNTHETIC_WORKER_SRC,
  MIC_WORKER_SRC,
  ROOM_WORKER_SRC,
  ARTIFACT_WORKER_SRC,
  makeWorker,
} from "../lib/forensics/workers";
import type { AgentResult, Verdict } from "../lib/forensics/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QCSharedFile {
  buffer:     AudioBuffer;
  name:       string;
  sampleRate: number;
  duration:   number;
  channels:   number;
}

export interface QCAnalysisResults {
  rep:            any;
  appenResult:    any;
  spectrogramData:any;
  digitalGaps:    any[];
  vadResult:      any;
  reverbResult:   any;
  silenceReport:  any;
}

export interface QCPlaybackState {
  isPlaying:   boolean;
  playheadSec: number;
  activeBuffer: AudioBuffer | null; // original or repaired
}

export interface QCForensicResults {
  agentResult: AgentResult;
  verdict:     Verdict;
  progress:    number;
  analyzing:   boolean;
}

export interface QCWorkstationState {
  // File
  file:           QCSharedFile | null;
  loading:        boolean;
  error:          string;

  // Analysis
  analysis:       QCAnalysisResults | null;
  analysisLoading:boolean;

  // Forensic
  forensic:       QCForensicResults;

  // Playback
  playback:       QCPlaybackState;

  // Repair
  repairedBuffer: AudioBuffer | null;

  // Profile
  profile:        string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useQCWorkstation() {
  const mountedRef     = useRef(true);
  const fileRef        = useRef<string>("");
  const bufRef         = useRef<AudioBuffer|null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const sourceRef      = useRef<AudioBufferSourceNode | null>(null);
  const rafRef         = useRef(0);
  const playStartRef   = useRef(0);
  const offsetRef      = useRef(0);
  const lastUIUpdate   = useRef(0);
  const forensicWorkers= useRef<Worker[]>([]);

  // ── State ───────────────────────────────────────────────────────────────────
  const [file,            setFile]            = useState<QCSharedFile | null>(null);
  const [allFiles,        setAllFiles]        = useState<QCSharedFile[]>([]);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState("");
  const [analysis,        setAnalysis]        = useState<QCAnalysisResults | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [repairedBuffer,  setRepairedBuffer]  = useState<AudioBuffer | null>(null);
  const [profile,         setProfile]         = useState("wakeword");

  // Playback
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);

  // Forensic
  const [agentResult, setAgentResult] = useState<AgentResult>({});
  const [forensicProgress, setForensicProgress] = useState(0);
  const [forensicAnalyzing, setForensicAnalyzing] = useState(false);

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    // AudioContext recovery on mobile
    function handleVisibility() {
      if(document.visibilityState === "visible" && audioCtxRef.current) {
        if(audioCtxRef.current.state === "suspended") {
          audioCtxRef.current.resume().catch(() => {});
        }
      }
    }
    function handleFocus() {
      if(audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafRef.current);
      try { sourceRef.current?.stop(); } catch {}
      audioCtxRef.current?.close();
      forensicWorkers.current.forEach(w => w.terminate());
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { sourceRef.current?.stop(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback((buf: AudioBuffer, offsetSec = 0) => {
    stopPlayback();
    if(!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext({ sampleRate: buf.sampleRate });
    }
    const ctx = audioCtxRef.current;
    if(ctx.state === "suspended") ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0, offsetSec);
    sourceRef.current  = src;
    offsetRef.current  = offsetSec;
    playStartRef.current = ctx.currentTime;
    setIsPlaying(true);

    src.onended = () => {
      if(!mountedRef.current) return;
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      offsetRef.current = 0;
      setPlayheadSec(0);
    };

    // RAF throttled to 10fps setState
    function tick() {
      const elapsed = ctx.currentTime - playStartRef.current + offsetRef.current;
      const clamped = Math.min(elapsed, buf.duration);
      if(clamped < buf.duration) {
        const now = performance.now();
        if(now - lastUIUpdate.current >= 100) {
          lastUIUpdate.current = now;
          if(mountedRef.current) setPlayheadSec(clamped);
        }
        rafRef.current = requestAnimationFrame(tick);
      } else {
        if(mountedRef.current) {
          setIsPlaying(false);
          setPlayheadSec(0);
          offsetRef.current = 0;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stopPlayback]);

  const togglePlayback = useCallback(() => {
    const buf = repairedBuffer ?? file?.buffer ?? null;
    if(!buf) return;
    if(isPlaying) {
      offsetRef.current = playheadSec;
      stopPlayback();
    } else {
      startPlayback(buf, offsetRef.current);
    }
  }, [isPlaying, file, repairedBuffer, playheadSec, stopPlayback, startPlayback]);

  const seekTo = useCallback((norm: number) => {
    const buf = repairedBuffer ?? file?.buffer ?? null;
    if(!buf) return;
    const sec = norm * buf.duration;
    offsetRef.current = sec;
    setPlayheadSec(sec);
    if(isPlaying) startPlayback(buf, sec);
  }, [file, repairedBuffer, isPlaying, startPlayback]);

  // ── Forensic Workers ──────────────────────────────────────────────────────
  const runForensicAnalysis = useCallback((buf: AudioBuffer) => {
    if(!mountedRef.current) return;

    // Terminate previous workers
    forensicWorkers.current.forEach(w => w.terminate());
    forensicWorkers.current = [];

    setForensicAnalyzing(true);
    setForensicProgress(0);
    setAgentResult({});

    const sr      = buf.sampleRate;
    const mono    = new Float32Array(buf.length);
    for(let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for(let i = 0; i < buf.length; i++)
        mono[i] += data[i] / buf.numberOfChannels;
    }

    const id      = Date.now();
    let   done    = 0;
    const total   = 4;
    const partial: AgentResult = {};

    const srcs = [
      SYNTHETIC_WORKER_SRC,
      MIC_WORKER_SRC,
      ROOM_WORKER_SRC,
      ARTIFACT_WORKER_SRC,
    ];

    srcs.forEach(src => {
      const w = makeWorker(src);
      forensicWorkers.current.push(w);

      const timeout = setTimeout(() => {
        if(!mountedRef.current) return;
        w.terminate();
        done++;
        telemetry.workerTimeout(fileRef.current || "unknown", src as any);
        if(mountedRef.current) {
          setForensicProgress(Math.round(done / total * 100));
          if(done === total) setForensicAnalyzing(false);
        }
      }, 15000);

      const workerStart = Date.now();
      w.onmessage = (e: MessageEvent) => {
        clearTimeout(timeout);
        if(!mountedRef.current) return;
        const { type, result } = e.data;
        (partial as Record<string, unknown>)[type] = result;
        done++;
        setForensicProgress(Math.round(done / total * 100));
        setAgentResult({ ...partial });
        telemetry.workerCompleted(
          fileRef.current || "unknown",
          type as any,
          Date.now() - workerStart
        );
        if(done === total) {
          setForensicAnalyzing(false);
          // Update persistence with forensic results
          if(mountedRef.current) {
            const currentFile = fileRef.current;
            const currentBuf  = bufRef.current;
            if(currentFile && currentBuf) {
              persistDSPMetadata(currentBuf, currentFile, null, null, partial);
            }
          }
        }
      };

      w.onerror = () => {
        clearTimeout(timeout);
        if(!mountedRef.current) return;
        done++;
        setForensicProgress(Math.round(done / total * 100));
        if(done === total) setForensicAnalyzing(false);
      };

      const copy = new ArrayBuffer(mono.byteLength);
      new Float32Array(copy).set(mono);
      w.postMessage({ samples: copy, sr, id }, [copy]);
    });
  }, []);

  // ── Persist DSP Metadata ─────────────────────────────────────────────────
  const persistDSPMetadata = useCallback(async (
    buf:      AudioBuffer,
    name:     string,
    rep:      any,
    appen:    any,
    agents:   any,
  ) => {
    try {
      // Build lightweight summary — NO embeddings, NO spectral matrices
      const summary = {
        schema_version: "1.0.0",
        generated_at:   new Date().toISOString(),
        audio: {
          duration_sec: buf.duration,
          sample_rate:  buf.sampleRate,
          channels:     buf.numberOfChannels,
          bit_depth:    32,
          format:       "wav",
        },
        qc: {
          score:          rep?.score ?? 0,
          delivery_risk:  rep?.deliveryRisk ?? "UNKNOWN",
          appen_score:    appen?.score ?? 0,
          appen_verdict:  appen?.verdict ?? "UNKNOWN",
          metrics: {
            lufs:         rep?.metrics?.lufs ?? 0,
            true_peak:    rep?.metrics?.truePeak ?? 0,
            lra:          rep?.metrics?.lra ?? 0,
            snr_db:       rep?.metrics?.snrDb ?? 0,
            noise_class:  rep?.metrics?.noiseClass ?? "",
            environment:  rep?.metrics?.environment ?? "",
            speech_ratio: rep?.metrics?.speechRatio ?? 0,
          },
          problem_count: rep?.problems?.length ?? 0,
        },
        forensic: agents?.synthetic ? {
          verdict:              agents.synthetic.isSynthetic ? "SYNTHETIC" : "AUTHENTIC",
          confidence:           agents.synthetic.confidence,
          synthetic_probability:agents.synthetic.isSynthetic ? agents.synthetic.confidence : 1 - agents.synthetic.confidence,
          room_category:        agents.room?.roomCategory ?? null,
          rt60_overall:         agents.room?.rt60Overall ?? null,
          noise_floor_db:       agents.mic?.noiseFloorDb ?? null,
          artifact_clean:       agents.artifact?.clean ?? null,
        } : null,
      };

      // Persist to processing_jobs
      const correlationId = crypto.randomUUID();
      await supabase.from("processing_jobs").insert({
        file_name:      name,
        status:         "done",
        job_type:       "audio_qc",
        score:          rep?.score ?? 0,
        lufs:           rep?.metrics?.lufs ?? 0,
        snr_db:         rep?.metrics?.snrDb ?? 0,
        completed_at:   new Date().toISOString(),
        correlation_id: correlationId,
        dsp_version:    "1.0.0",
        metadata:       summary,
      });

    } catch(err) {
      // Non-blocking — persistence failure must not break UI
      console.warn("DSP metadata persistence failed:", err);
    }
  }, []);

  // ── Load File ─────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (rawFile: File) => {
    if(!rawFile.name.toLowerCase().endsWith(".wav")) {
      setError("Please upload a WAV file"); return;
    }
    const MAX_BYTES = 200 * 1024 * 1024;
    if(rawFile.size > MAX_BYTES) {
      setError(`File too large (${(rawFile.size/1024/1024).toFixed(0)}MB). Max: 200MB`);
      return;
    }

    setError("");
    setLoading(true);
    setAnalysis(null);
    setRepairedBuffer(null);
    setAgentResult({});
    setForensicProgress(0);
    stopPlayback();
    offsetRef.current = 0;
    setPlayheadSec(0);

    const corrId = crypto.randomUUID();
    const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
    telemetry.fileLoadStarted(corrId, userId, rawFile.name);

    try {
      const ab = await rawFile.arrayBuffer();

      // Reuse or create AudioContext — keep alive for buffer
      if(!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const buf = await audioCtxRef.current.decodeAudioData(ab);

      const MAX_DURATION = 30 * 60;
      if(buf.duration > MAX_DURATION) {
        setError(`File too long (${(buf.duration/60).toFixed(1)} min). Max: 30 min`);
        setLoading(false); return;
      }

      const sharedFile: QCSharedFile = {
        buffer:     buf,
        name:       rawFile.name,
        sampleRate: buf.sampleRate,
        duration:   buf.duration,
        channels:   buf.numberOfChannels,
      };
      setFile(sharedFile);
      fileRef.current = rawFile.name;
      bufRef.current  = buf;
      telemetry.fileLoadCompleted(corrId, userId, {
        fileName:    rawFile.name,
        durationSec: buf.duration,
        sampleRate:  buf.sampleRate,
        channels:    buf.numberOfChannels,
        fileSizeKb:  Math.round(rawFile.size / 1024),
      });
      setAllFiles(prev => {
        const filtered = prev.filter(f => f.name !== rawFile.name);
        return [...filtered, sharedFile].slice(-5); // max 5 files
      });

      // ── Run QC Analysis ──────────────────────────────────────────────────
      setAnalysisLoading(true);
      setLoading(false); // show UI before analysis starts

      // Mix to mono in chunks to avoid blocking main thread
      const mono = new Float32Array(buf.length);
      const CHUNK = 65536;
      for(let start = 0; start < buf.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, buf.length);
        for(let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for(let i = start; i < end; i++) mono[i] += d[i] / buf.numberOfChannels;
        }
        // Yield to browser every chunk to prevent freezing
        if(start % (CHUNK * 8) === 0) await new Promise(r => setTimeout(r, 0));
      }

      // Promise.all wrapped in try/catch — failure must not crash React tree
      let rep: any = null, spec: any = null, gaps: any = null;
      let vad: any = null, reverb: any = null, silence: any = null;
      try {
        [rep, spec, gaps, vad, reverb, silence] = await Promise.all([
          analyzeAudioQuality(mono, buf.sampleRate, profile as any).catch(() => null),
          computeSpectrogramOffThread(buf, {
            fftSize:4096, minDb:-90, maxDb:-10,
          }).catch(() => {
            try {
              return computeSpectrogramPro(buf, {
                fftSize:4096, minDb:-90, maxDb:-10, gain:1.3, colorMap:"aivora"
              });
            } catch { return null; }
          }),
          Promise.resolve(detectDigitalGaps(buf)).catch(() => null),
          Promise.resolve(analyzeAdvancedVAD(buf, profile as any)).catch(() => null),
          Promise.resolve(detectReverb(buf)).catch(() => null),
          Promise.resolve(analyzeForensicSilence(mono, buf.sampleRate)).catch(() => null),
        ]);
      } catch(analysisErr) {
        console.warn("[useQCWorkstation] Analysis partial failure:", analysisErr);
        // Continue with nulls — UI shows partial results
      }

      let appenResult = null;
      if(rep) {
        const gaps2 = (rep.problems ?? []).filter(
          (p: any) => p.type==="DIGITAL_SILENCE"||p.type==="SILENCE_GAP"
        ).length;
        appenResult = computeAppenScore({
          fileName:        rawFile.name,
          profile:         profile as any,
          sampleRate:      buf.sampleRate,
          duration:        buf.duration,
          lufs:            {integrated:rep.metrics?.lufs??-23,truePeak:rep.metrics?.truePeak??-1,lra:rep.metrics?.lra??0,problems:[]},
          fft:             {centroid:0,rolloff:0,flatness:0,noiseClass:(rep.metrics?.noiseClass??"clean") as any,environment:(rep.metrics?.environment??"studio") as any,bandEnergies:{sub:0,low:0,lowMid:0,mid:0,highMid:0,high:0},problems:[]},
          vad:             vad as any,
          snr:             {snrDb:rep.metrics?.snrDb??30,noiseFloorDb:-60,signalDb:0,segmentalSnr:0,fakeStudio:false,quality:(rep.metrics?.quality??"good") as any,problems:[]},
          hasDigitalGaps:  gaps2>0,
          digitalGapCount: gaps2,
          peakDb:          rep.metrics?.truePeak??-1,
          silenceRatio:    0,
        });
      }

      if(mountedRef.current) {
        setAnalysis({ rep, appenResult, spectrogramData:spec, digitalGaps:gaps, vadResult:vad, reverbResult:reverb, silenceReport:silence });
        setAnalysisLoading(false);
        telemetry.qcAnalysisCompleted(corrId, userId, {
          qc_score:     rep?.score ?? 0,
          appen_score:  appenResult?.score ?? 0,
          duration_ms:  0,
          problem_count:rep?.problems?.length ?? 0,
        });
      }

      // ── Persist DSP metadata (non-blocking) ──────────────────────────────
      persistDSPMetadata(buf, rawFile.name, rep, appenResult, {});

      // ── Auto-trigger Forensic Analysis ───────────────────────────────────
      runForensicAnalysis(buf);

    } catch(err) {
      if(!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "";
      if(msg.includes("Unable to decode")) setError("Corrupted or unsupported audio");
      else if(msg.includes("memory"))       setError("Not enough memory — try shorter file");
      else                                  setError("Failed to load WAV file");
      setLoading(false);
      setAnalysisLoading(false);
    }
  }, [profile, stopPlayback, runForensicAnalysis]);

  // ── Verdict ───────────────────────────────────────────────────────────────
  const verdict: Verdict = (() => {
    if(!agentResult.synthetic) return { label:"PENDING", confidence:0 };
    const synthRisk = agentResult.synthetic.isSynthetic ? agentResult.synthetic.confidence : 0;
    const artRisk   = agentResult.artifact?.artifactScore ?? 0;
    const risk      = synthRisk * 0.65 + artRisk * 0.35;
    if(risk > 0.65) return { label:"SYNTHETIC",  confidence:risk };
    if(risk > 0.45) return { label:"SUSPICIOUS",  confidence:risk };
    return               { label:"AUTHENTIC",  confidence: 1-risk };
  })();

  // Switch to another loaded file
  const switchFile = useCallback((name: string) => {
    const f = allFiles.find(x => x.name === name);
    if(!f) return;
    stopPlayback();
    offsetRef.current = 0;
    setPlayheadSec(0);
    setRepairedBuffer(null);
    setFile(f);
    // Re-run analysis for this file
    setAnalysisLoading(true);
    const mono = new Float32Array(f.buffer.length);
    for(let ch=0;ch<f.buffer.numberOfChannels;ch++){
      const d=f.buffer.getChannelData(ch);
      for(let i=0;i<f.buffer.length;i++) mono[i]+=d[i]/f.buffer.numberOfChannels;
    }
    analyzeAudioQuality(mono, f.buffer.sampleRate, profile as any).then(async rep => {
      if(!mountedRef.current) return;
      const spec = await computeSpectrogramOffThread(f.buffer, {fftSize:4096,minDb:-90,maxDb:-10}).catch(
        () => computeSpectrogramPro(f.buffer, {fftSize:4096,minDb:-90,maxDb:-10,gain:1.3,colorMap:"aivora"})
      );
      const gaps = detectDigitalGaps(f.buffer);
      setAnalysis(prev => ({ ...prev!, rep, spectrogramData:spec, digitalGaps:gaps }));
      setAnalysisLoading(false);
    }).catch(() => setAnalysisLoading(false));
    runForensicAnalysis(f.buffer);
  }, [allFiles, profile, stopPlayback, runForensicAnalysis]);

  return {
    // File
    file, allFiles, loading, error, loadFile, switchFile,
    // Analysis
    analysis, analysisLoading,
    // Profile
    profile, setProfile,
    // Playback
    isPlaying, playheadSec, togglePlayback, seekTo,
    activeBuffer: repairedBuffer ?? file?.buffer ?? null,
    // Repair
    repairedBuffer, setRepairedBuffer,
    // Forensic
    agentResult, forensicProgress, forensicAnalyzing, verdict,
  };
}
