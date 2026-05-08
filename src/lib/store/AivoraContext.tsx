// ============================================================================
// Aivora Platform - Central Context Provider
// ============================================================================

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";

import {
  type FileRecord,
  type BatchMetadata,
  type BatchStats,
  type PipelineStage,
  computeBatchStats,
  newBlobId,
  newFileId,
  newBatchId,
} from "./types";

import {
  loadAllRecords,
  saveRecord,
  saveRecords,
  deleteRecord as dbDeleteRecord,
  clearEverything,
  saveBlob,
  loadBlob,
  deleteBlob,
  saveBatchMetadata,
  loadCurrentBatch,
  getStorageInfo,
} from "./persistence";

import { analyzeAudioBuffer } from "../audio/AdvancedAudioAnalyzer";
import {
  validateStudioCompliance,
  STUDIO_PROFILES,
} from "../audio/StudioSpecCompliance";

// ============================================================================
// CONTEXT SHAPE
// ============================================================================

export interface AivoraContextValue {
  records: FileRecord[];
  selectedFileId: string | null;
  batch: BatchMetadata | null;
  stats: BatchStats;
  isHydrating: boolean;

  selectFile: (id: string | null) => void;
  selectedFile: FileRecord | null;

  getRecord: (id: string) => FileRecord | undefined;
  getRecordsByStage: (stage: PipelineStage) => FileRecord[];
  getRecordsByVerdict: (verdict: "READY" | "REVIEW" | "REJECT") => FileRecord[];

  addFile: (file: File) => Promise<FileRecord>;
  addFiles: (files: File[]) => Promise<FileRecord[]>;
  updateRecord: (id: string, patch: Partial<FileRecord>) => Promise<void>;
  updateRecords: (updater: (records: FileRecord[]) => FileRecord[]) => Promise<void>;
  removeRecord: (id: string) => Promise<void>;

  setStage: (id: string, stage: PipelineStage) => Promise<void>;

  getBlob: (blobId: string) => Promise<Blob | null>;
  storeBlob: (blob: Blob, filename: string) => Promise<string>;

  setBatchInfo: (info: Partial<BatchMetadata>) => Promise<void>;

  clearAll: () => Promise<void>;

  refreshStorageInfo: () => Promise<void>;
  storageInfo: {
    recordsCount: number;
    blobsCount: number;
    estimatedUsage?: number;
    estimatedQuota?: number;
  };

  // ─── Analysis ───
  analyzeFile: (id: string, profile?: string) => Promise<void>;
  analyzeAll: (profile?: string) => Promise<void>;
  analysisProgress: { done: number; total: number; running: boolean };
}

const AivoraCtx = createContext<AivoraContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

export function AivoraProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<FileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchMetadata | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [stats, setStats] = useState<BatchStats>(() => computeBatchStats([]));
  const [storageInfo, setStorageInfo] = useState({
    recordsCount: 0,
    blobsCount: 0,
  });
const [analysisProgress, setAnalysisProgress] = useState({
    done: 0,
    total: 0,
    running: false,
  });

  const memBlobs = useRef<Map<string, Blob>>(new Map());

  // ─── INITIAL HYDRATION ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loadedRecords, loadedBatch] = await Promise.all([
          loadAllRecords(),
          loadCurrentBatch(),
        ]);

        if (cancelled) return;

        loadedRecords.sort((a, b) => b.uploadedAt - a.uploadedAt);

        setRecords(loadedRecords);
        setBatch(loadedBatch);
        setStats(computeBatchStats(loadedRecords));
      } catch (e) {
        console.error("[Aivora] Hydration failed:", e);
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── STATS RECOMPUTE ───
  useEffect(() => {
    setStats(computeBatchStats(records));
  }, [records]);

  // ─── SELECTION ───
  const selectFile = useCallback((id: string | null) => {
    setSelectedFileId(id);
  }, []);

  const selectedFile = selectedFileId
    ? records.find((r) => r.id === selectedFileId) || null
    : null;

  // ─── READERS ───
  const getRecord = useCallback(
    (id: string) => records.find((r) => r.id === id),
    [records]
  );

  const getRecordsByStage = useCallback(
    (stage: PipelineStage) => records.filter((r) => r.stage === stage),
    [records]
  );

  const getRecordsByVerdict = useCallback(
    (verdict: "READY" | "REVIEW" | "REJECT") =>
      records.filter((r) => r.compliance?.verdict === verdict),
    [records]
  );

  // ─── BLOBS ───
  const storeBlob = useCallback(
    async (blob: Blob, filename: string): Promise<string> => {
      const blobId = newBlobId();
      memBlobs.current.set(blobId, blob);
      try {
        await saveBlob(blobId, blob, filename);
      } catch (e) {
        console.warn("[Aivora] Failed to persist blob to IDB:", e);
      }
      return blobId;
    },
    []
  );

  const getBlob = useCallback(async (blobId: string): Promise<Blob | null> => {
    const mem = memBlobs.current.get(blobId);
    if (mem) return mem;
    const persisted = await loadBlob(blobId);
    if (persisted) {
      memBlobs.current.set(blobId, persisted);
    }
    return persisted;
  }, []);

  // ─── ADD FILES ───
  const addFile = useCallback(
    async (file: File): Promise<FileRecord> => {
      const blobId = await storeBlob(file, file.name);
      const now = Date.now();
      const record: FileRecord = {
        id: newFileId(),
        filename: file.name,
        size: file.size,
        uploadedAt: now,
        blobId,
        mimeType: file.type,
        stage: "uploaded",
        stageHistory: [{ stage: "uploaded", at: now }],
        enhancements: [],
        errors: [],
        warnings: [],
        tags: [],
        customMetadata: {},
      };
      await saveRecord(record);
      setRecords((prev) => [record, ...prev]);
      return record;
    },
    [storeBlob]
  );

  const addFiles = useCallback(
    async (files: File[]): Promise<FileRecord[]> => {
      const created: FileRecord[] = [];
      const CHUNK = 25;
      for (let i = 0; i < files.length; i += CHUNK) {
        const slice = files.slice(i, i + CHUNK);
        const newRecs = await Promise.all(
          slice.map(async (f) => {
            const blobId = await storeBlob(f, f.name);
            const now = Date.now() + Math.floor(Math.random() * 100);
            const r: FileRecord = {
              id: newFileId(),
              filename: f.name,
              size: f.size,
              uploadedAt: now,
              blobId,
              mimeType: f.type,
              stage: "uploaded",
              stageHistory: [{ stage: "uploaded", at: now }],
              enhancements: [],
              errors: [],
              warnings: [],
              tags: [],
              customMetadata: {},
            };
            return r;
          })
        );
        await saveRecords(newRecs);
        created.push(...newRecs);
        setRecords((prev) => [...newRecs, ...prev]);
      }
      return created;
    },
    [storeBlob]
  );

  // ─── UPDATE / REMOVE ───
  const updateRecord = useCallback(
    async (id: string, patch: Partial<FileRecord>) => {
      let updated: FileRecord | null = null;
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const merged: FileRecord = { ...r, ...patch };
          updated = merged;
          return merged;
        })
      );
      setTimeout(async () => {
        if (updated) {
          try {
            await saveRecord(updated);
          } catch (e) {
            console.warn("[Aivora] Failed to persist updated record:", e);
          }
        }
      }, 0);
    },
    []
  );

  const updateRecords = useCallback(
    async (updater: (records: FileRecord[]) => FileRecord[]) => {
      let newRecords: FileRecord[] = [];
      setRecords((prev) => {
        newRecords = updater(prev);
        return newRecords;
      });
      setTimeout(async () => {
        try {
          await saveRecords(newRecords);
        } catch (e) {
          console.warn("[Aivora] Failed to persist bulk update:", e);
        }
      }, 0);
    },
    []
  );

  const removeRecord = useCallback(
    async (id: string) => {
      const target = records.find((r) => r.id === id);
      if (target) {
        try {
          await deleteBlob(target.blobId);
          if (target.enhancedBlobId) await deleteBlob(target.enhancedBlobId);
          if (target.normalized32BitBlobId)
            await deleteBlob(target.normalized32BitBlobId);
        } catch {
          // ignore
        }
      }
      await dbDeleteRecord(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (selectedFileId === id) setSelectedFileId(null);
    },
    [records, selectedFileId]
  );

  // ─── STAGE TRANSITION ───
  const setStage = useCallback(
    async (id: string, stage: PipelineStage) => {
      const now = Date.now();
      let updated: FileRecord | null = null;
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const merged: FileRecord = {
            ...r,
            stage,
            stageHistory: [...r.stageHistory, { stage, at: now }],
          };
          updated = merged;
          return merged;
        })
      );
      setTimeout(async () => {
        if (updated) {
          try {
            await saveRecord(updated);
          } catch {
            // ignore
          }
        }
      }, 0);
    },
    []
  );

  // ─── BATCH METADATA ───
  const setBatchInfo = useCallback(
    async (info: Partial<BatchMetadata>) => {
      const now = Date.now();
      const next: BatchMetadata = {
        batchId: batch?.batchId || newBatchId(),
        batchName: info.batchName || batch?.batchName || "Untitled Batch",
        clientName: info.clientName ?? batch?.clientName,
        projectCode: info.projectCode ?? batch?.projectCode,
        studioProfile:
          info.studioProfile || batch?.studioProfile || "wakeword_studio",
        createdAt: batch?.createdAt || now,
        updatedAt: now,
      };
      setBatch(next);
      try {
        await saveBatchMetadata(next);
      } catch {
        // ignore
      }
    },
    [batch]
  );

  // ─── CLEAR ALL ───
  const clearAll = useCallback(async () => {
    try {
      await clearEverything();
    } catch {
      // ignore
    }
    memBlobs.current.clear();
    setRecords([]);
    setSelectedFileId(null);
    setBatch(null);
    setStats(computeBatchStats([]));
  }, []);

  // ─── ANALYSIS ───
  const analyzeFile = useCallback(
    async (id: string, profile: string = "asr_studio") => {
      const record = records.find((r) => r.id === id);
      if (!record) return;

      const blob = await loadBlob(record.blobId);
      if (!blob) {
        console.warn("[Aivora] No blob found for record:", id);
        return;
      }

      try {
        // Decode audio
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // Run DSP analysis
        const analysis = await analyzeAudioBuffer(audioBuffer);

        // Run compliance check
        const studioProfile = STUDIO_PROFILES[profile] || STUDIO_PROFILES["asr_studio"];
        const compliance = validateStudioCompliance(analysis as any, profile as any);

        // Update record
        const now = Date.now();
        const updated = {
          ...record,
          dspAnalysis: analysis as any,
          compliance: compliance as any,
          stage: "analyzed" as const,
          stageHistory: [
            ...record.stageHistory,
            { stage: "analyzed" as const, at: now },
          ],
        };

        setRecords((prev) =>
          prev.map((r) => (r.id === id ? updated : r))
        );

        try {
          await saveRecord(updated);
        } catch (e) {
          console.warn("[Aivora] Failed to persist analysis:", e);
        }

        try {
          audioCtx.close();
        } catch {
          // ignore
        }
      } catch (e) {
        console.error("[Aivora] Analysis failed for", record.filename, e);
      }
    },
    [records]
  );

  const analyzeAll = useCallback(
    async (profile: string = "asr_studio") => {
      const pending = records.filter((r) => !r.compliance);
      if (pending.length === 0) return;

      setAnalysisProgress({ done: 0, total: pending.length, running: true });

      for (let i = 0; i < pending.length; i++) {
        await analyzeFile(pending[i].id, profile);
        setAnalysisProgress({
          done: i + 1,
          total: pending.length,
          running: i + 1 < pending.length,
        });
      }

      setAnalysisProgress((p) => ({ ...p, running: false }));
    },
    [records, analyzeFile]
  );

  // ─── STORAGE INFO ───
  const refreshStorageInfo = useCallback(async () => {
    try {
      const info = await getStorageInfo();
      setStorageInfo(info);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshStorageInfo();
  }, [records.length, refreshStorageInfo]);

  // ─── VALUE ───
  const value: AivoraContextValue = {
    records,
    selectedFileId,
    batch,
    stats,
    isHydrating,
    selectFile,
    selectedFile,
    getRecord,
    getRecordsByStage,
    getRecordsByVerdict,
    addFile,
    addFiles,
    updateRecord,
    updateRecords,
    removeRecord,
    setStage,
    getBlob,
    storeBlob,
    setBatchInfo,
    clearAll,
    refreshStorageInfo,
    storageInfo,
    analyzeFile,
    analyzeAll,
    analysisProgress,
  };

  return <AivoraCtx.Provider value={value}>{children}</AivoraCtx.Provider>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useAivora(): AivoraContextValue {
  const ctx = useContext(AivoraCtx);
  if (!ctx) {
    throw new Error(
      "useAivora() must be called from inside <AivoraProvider>. " +
        "Wrap your <App /> with <AivoraProvider>...</AivoraProvider> in main.tsx."
    );
  }
  return ctx;
}
