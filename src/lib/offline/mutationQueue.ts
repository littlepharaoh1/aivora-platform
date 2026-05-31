/**
 * mutationQueue.ts — Offline Mutation Queue
 * Aivora Platform — Phase 3.3
 *
 * Architecture:
 * - IndexedDB (not localStorage — async + Safari quota safe)
 * - idempotency_key: UUID primary key (no duplicate execution)
 * - correlation_id: links to processing_jobs lifecycle
 * - schema_version: replay safety gate
 * - sequence_number: monotonic insertion order (deterministic replay)
 * - Payload: deep-frozen before enqueue (immutable)
 * - Size: Blob.size estimation (accurate, not string length)
 * - Replay: strictly sequential (one at a time)
 * - Corruption: isolated to "corrupted" status (never crashes)
 * - Transport buffer only — NOT a persistent client database
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME         = "aivora_offline_v1";
const DB_VERSION      = 1;
const STORE_NAME      = "mutation_queue";
const SCHEMA_VERSION  = "3.3.0";
const MAX_ENTRY_BYTES = 32 * 1024;   // 32KB per entry
const MAX_QUEUE_SIZE  = 100;         // max entries in queue
const EXPIRY_DAYS     = 7;           // auto-expire after 7 days
const MAX_RETRIES     = 3;           // max replay attempts

// ── Types ─────────────────────────────────────────────────────────────────────

export type MutationType =
  | "processing_job_insert"
  | "qc_review_update"
  | "activity_log_insert"
  | "consensus_log_insert"
  | "dataset_version_insert"
  | "pipeline_run_insert"
  | "image_evidence_insert"
  | "video_evidence_insert"
  | "ocr_evidence_insert"
  | "speech_transcript_insert"
  | "project_insert"
  | "project_update"
  | "member_insert";

export type MutationStatus =
  | "pending"     // waiting for sync
  | "replaying"   // currently being replayed
  | "acked"       // successfully synced
  | "failed"      // max retries reached
  | "expired"     // older than EXPIRY_DAYS
  | "corrupted";  // invalid entry — isolated, never replayed

export interface QueuedMutation {
  idempotency_key:  string;                    // UUID — IDB primary key
  correlation_id:   string;                    // UUID — links to processing_jobs
  mutation_type:    MutationType;
  schema_version:   string;                    // replay safety gate
  payload:          Readonly<Record<string, unknown>>; // immutable
  created_at:       string;                    // ISO-8601
  updated_at:       string;                    // ISO-8601 — updated on status change
  expires_at:       string;                    // ISO-8601 — created_at + 7 days
  sequence_number:  number;                    // monotonic — deterministic replay order
  retry_count:      number;
  status:           MutationStatus;
  size_bytes:       number;                    // Blob.size accurate estimation
  ack_at?:          string;                    // ISO-8601 — set on successful sync
  error?:           string;                    // last error message
}

// ── Sequence counter (monotonic, session-scoped) ──────────────────────────────

let _sequenceCounter = Date.now();
function nextSequence(): number {
  return ++_sequenceCounter;
}

// ── Payload helpers ───────────────────────────────────────────────────────────

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.getOwnPropertyNames(obj).forEach(name => {
    const val = (obj as Record<string, unknown>)[name];
    if(val && typeof val === "object") deepFreeze(val as object);
  });
  return Object.freeze(obj);
}

function estimateBytes(payload: unknown): number {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return MAX_ENTRY_BYTES + 1; // fail-safe: reject
  }
}

// ── IndexedDB connection ──────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase> {
  if(_db) return _db;

  return new Promise((resolve, reject) => {
    if(typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if(!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "idempotency_key",
        });
        // Indexes for efficient queries
        store.createIndex("by_sequence",   "sequence_number", { unique:true  });
        store.createIndex("by_status",     "status",          { unique:false });
        store.createIndex("by_expires_at", "expires_at",      { unique:false });
        store.createIndex("by_correlation","correlation_id",  { unique:false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;

      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };

      resolve(_db);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

// ── Core operations ───────────────────────────────────────────────────────────

/**
 * Enqueue a mutation for offline sync.
 * Payload is deep-frozen before storage (immutable).
 * Accurate size via Blob.size.
 * Rejects if: oversized, queue full, duplicate idempotency_key.
 */
export async function enqueueMutation(params: {
  mutation_type:  MutationType;
  payload:        Record<string, unknown>;
  correlation_id: string;
  idempotency_key?: string;
}): Promise<QueuedMutation | null> {
  try {
    const db = await openDB();

    // Size check — accurate Blob estimation
    const size = estimateBytes(params.payload);
    if(size > MAX_ENTRY_BYTES) {
      console.warn(`[MutationQueue] Payload too large (${size}B > ${MAX_ENTRY_BYTES}B). Rejected.`);
      return null;
    }

    // Queue size check
    const count = await countByStatus("pending") + await countByStatus("replaying");
    if(count >= MAX_QUEUE_SIZE) {
      console.warn(`[MutationQueue] Queue full (${count}/${MAX_QUEUE_SIZE}). Rejected.`);
      return null;
    }

    const now        = new Date();
    const expiresAt  = new Date(now.getTime() + EXPIRY_DAYS * 86400 * 1000);

    const mutation: QueuedMutation = {
      idempotency_key: params.idempotency_key ?? crypto.randomUUID(),
      correlation_id:  params.correlation_id,
      mutation_type:   params.mutation_type,
      schema_version:  SCHEMA_VERSION,
      payload:         deepFreeze({ ...params.payload }), // deep clone + freeze
      created_at:      now.toISOString(),
      updated_at:      now.toISOString(),
      expires_at:      expiresAt.toISOString(),
      sequence_number: nextSequence(),
      retry_count:     0,
      status:          "pending",
      size_bytes:      size,
    };

    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req   = store.add(mutation);
      req.onsuccess  = () => resolve();
      req.onerror    = () => reject(req.error);
    });

    return mutation;
  } catch(err) {
    // Never crash caller — queue is best-effort transport
    console.warn("[MutationQueue] enqueue failed:", err);
    return null;
  }
}

/**
 * Get all pending mutations in deterministic insertion order.
 * Expired entries are transitioned before returning.
 */
export async function getPendingMutations(): Promise<QueuedMutation[]> {
  try {
    const db = await openDB();
    await expireStaleEntries(db);

    return await new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE_NAME, "readonly");
      const store   = tx.objectStore(STORE_NAME);
      const index   = store.index("by_sequence");
      const results: QueuedMutation[] = [];

      const req = index.openCursor();
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if(!cursor) { resolve(results); return; }
        const m = cursor.value as QueuedMutation;
        if(m.status === "pending") results.push(m);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch(err) {
    console.warn("[MutationQueue] getPending failed:", err);
    return [];
  }
}

/**
 * Update mutation status.
 * Always sets updated_at.
 * Corrupted entries may not transition to any other status.
 */
export async function updateMutationStatus(
  idempotency_key: string,
  status:          MutationStatus,
  extras?:         Partial<Pick<QueuedMutation, "error" | "ack_at" | "retry_count">>
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req   = store.get(idempotency_key);

      req.onsuccess = () => {
        const m = req.result as QueuedMutation | undefined;
        if(!m) { resolve(); return; }

        // Corrupted entries stay corrupted — no transition allowed
        if(m.status === "corrupted" && status !== "corrupted") {
          resolve(); return;
        }

        const updated: QueuedMutation = {
          ...m,
          status,
          updated_at: new Date().toISOString(),
          ...extras,
        };

        const putReq   = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror   = () => reject(putReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  } catch(err) {
    console.warn("[MutationQueue] updateStatus failed:", err);
  }
}

/**
 * Acknowledge successful sync — purge immediately.
 * Successful sync = immediate removal (not a database).
 */
export async function acknowledgeMutation(idempotency_key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req   = store.delete(idempotency_key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch(err) {
    console.warn("[MutationQueue] ack failed:", err);
  }
}

// ── Replay Engine ─────────────────────────────────────────────────────────────

let _replayLock = false; // strictly sequential — one at a time

/**
 * Replay pending mutations sequentially.
 * Only one replay may run at a time.
 * Schema mismatch → corrupted (isolated, not crashed).
 * Corrupted entry → never replayed, never crashes engine.
 */
export async function replayPendingMutations(
  executor: (mutation: QueuedMutation) => Promise<void>
): Promise<void> {
  if(_replayLock) {
    console.warn("[MutationQueue] Replay already in progress. Skipped.");
    return;
  }

  _replayLock = true;

  try {
    const pending = await getPendingMutations();
    // Deterministic order guaranteed by sequence_number index

    for(const mutation of pending) {
      // Schema version gate — stop replay on mismatch
      if(mutation.schema_version !== SCHEMA_VERSION) {
        console.warn(
          `[MutationQueue] Schema mismatch: expected ${SCHEMA_VERSION}, got ${mutation.schema_version}. Isolating.`
        );
        await updateMutationStatus(mutation.idempotency_key, "corrupted", {
          error: `Schema mismatch: ${mutation.schema_version}`,
        });
        continue; // skip — do not crash
      }

      // Mark as replaying
      await updateMutationStatus(mutation.idempotency_key, "replaying");

      try {
        await executor(mutation);
        // Success → purge immediately
        await acknowledgeMutation(mutation.idempotency_key);

      } catch(err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        const newRetryCount = mutation.retry_count + 1;

        if(newRetryCount >= MAX_RETRIES) {
          await updateMutationStatus(mutation.idempotency_key, "failed", {
            error:       errMsg,
            retry_count: newRetryCount,
          });
        } else {
          // Back to pending for next replay cycle
          await updateMutationStatus(mutation.idempotency_key, "pending", {
            error:       errMsg,
            retry_count: newRetryCount,
          });
        }
      }
    }
  } catch(err) {
    console.warn("[MutationQueue] replay engine error:", err);
  } finally {
    _replayLock = false;
  }
}

// ── Maintenance ───────────────────────────────────────────────────────────────

async function expireStaleEntries(db: IDBDatabase): Promise<void> {
  const now = new Date().toISOString();
  await new Promise<void>((resolve) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("by_expires_at");
    const range = IDBKeyRange.upperBound(now);
    const req   = index.openCursor(range);

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if(!cursor) { resolve(); return; }
      const m = cursor.value as QueuedMutation;
      if(m.status === "pending" || m.status === "failed") {
        cursor.update({ ...m, status:"expired", updated_at: now });
      }
      cursor.continue();
    };
    req.onerror = () => resolve(); // non-fatal
  });
}

async function countByStatus(status: MutationStatus): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by_status");
      const req   = index.count(IDBKeyRange.only(status));
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

/**
 * Clear all acked, expired, failed entries.
 * Safe eviction — never touches pending/replaying.
 */
export async function evictStaleEntries(): Promise<number> {
  let evicted = 0;
  try {
    const db  = await openDB();
    const now = new Date().toISOString();

    await new Promise<void>((resolve) => {
      const tx    = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by_status");

      const evictStatuses: MutationStatus[] = ["acked", "expired", "failed", "corrupted"];
      let pending = evictStatuses.length;

      evictStatuses.forEach(status => {
        const req = index.openCursor(IDBKeyRange.only(status));
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if(!cursor) {
            if(--pending === 0) resolve();
            return;
          }
          cursor.delete();
          evicted++;
          cursor.continue();
        };
        req.onerror = () => { if(--pending === 0) resolve(); };
      });

      void now;
    });
  } catch(err) {
    console.warn("[MutationQueue] evict failed:", err);
  }
  return evicted;
}

/**
 * Get queue diagnostics (lightweight — counts only).
 */
export async function getQueueDiagnostics(): Promise<{
  pending:   number;
  replaying: number;
  failed:    number;
  corrupted: number;
  expired:   number;
}> {
  const [pending, replaying, failed, corrupted, expired] = await Promise.all([
    countByStatus("pending"),
    countByStatus("replaying"),
    countByStatus("failed"),
    countByStatus("corrupted"),
    countByStatus("expired"),
  ]);
  return { pending, replaying, failed, corrupted, expired };
}

/**
 * Network reconnect handler.
 * Call this on: navigator.onLine, visibilitychange, focus.
 */
export async function onReconnect(
  executor: (mutation: QueuedMutation) => Promise<void>
): Promise<void> {
  if(!navigator.onLine) return;
  await evictStaleEntries();
  await replayPendingMutations(executor);
}
