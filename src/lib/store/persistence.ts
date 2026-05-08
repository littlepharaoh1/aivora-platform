// ============================================================================
// Aivora Platform - IndexedDB Persistence Layer
// ============================================================================

import type { FileRecord, BatchMetadata } from "./types";

const DB_NAME = "AivoraDB";
const DB_VERSION = 1;
const STORE_RECORDS = "records";
const STORE_BLOBS = "blobs";
const STORE_BATCH = "batch";

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const store = db.createObjectStore(STORE_RECORDS, { keyPath: "id" });
        store.createIndex("stage", "stage", { unique: false });
        store.createIndex("uploadedAt", "uploadedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "blobId" });
      }

      if (!db.objectStoreNames.contains(STORE_BATCH)) {
        db.createObjectStore(STORE_BATCH, { keyPath: "batchId" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return _dbPromise;
}

// ============================================================================
// RECORDS
// ============================================================================

export async function saveRecord(record: FileRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, "readwrite");
    const req = tx.objectStore(STORE_RECORDS).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecords(records: FileRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, "readwrite");
    const store = tx.objectStore(STORE_RECORDS);
    let remaining = records.length;
    let errored = false;

    records.forEach((r) => {
      const req = store.put(r);
      req.onsuccess = () => {
        remaining--;
        if (remaining === 0 && !errored) resolve();
      };
      req.onerror = () => {
        if (!errored) {
          errored = true;
          reject(req.error);
        }
      };
    });
  });
}

export async function loadAllRecords(): Promise<FileRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, "readonly");
    const req = tx.objectStore(STORE_RECORDS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, "readwrite");
    const req = tx.objectStore(STORE_RECORDS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllRecords(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, "readwrite");
    const req = tx.objectStore(STORE_RECORDS).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ============================================================================
// BLOBS
// ============================================================================

interface BlobEntry {
  blobId: string;
  blob: Blob;
  filename: string;
  storedAt: number;
}

export async function saveBlob(blobId: string, blob: Blob, filename: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, "readwrite");
    const entry: BlobEntry = { blobId, blob, filename, storedAt: Date.now() };
    const req = tx.objectStore(STORE_BLOBS).put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadBlob(blobId: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, "readonly");
    const req = tx.objectStore(STORE_BLOBS).get(blobId);
    req.onsuccess = () => {
      const entry = req.result as BlobEntry | undefined;
      resolve(entry ? entry.blob : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlob(blobId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, "readwrite");
    const req = tx.objectStore(STORE_BLOBS).delete(blobId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllBlobs(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, "readwrite");
    const req = tx.objectStore(STORE_BLOBS).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ============================================================================
// BATCH
// ============================================================================

export async function saveBatchMetadata(meta: BatchMetadata): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BATCH, "readwrite");
    const req = tx.objectStore(STORE_BATCH).put(meta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadCurrentBatch(): Promise<BatchMetadata | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BATCH, "readonly");
    const req = tx.objectStore(STORE_BATCH).getAll();
    req.onsuccess = () => {
      const all = req.result as BatchMetadata[];
      if (!all || all.length === 0) {
        resolve(null);
        return;
      }
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(all[0]);
    };
    req.onerror = () => reject(req.error);
  });
}

// ============================================================================
// FULL RESET
// ============================================================================

export async function clearEverything(): Promise<void> {
  await Promise.all([clearAllRecords(), clearAllBlobs()]);
}

// ============================================================================
// STORAGE INFO
// ============================================================================

export async function getStorageInfo(): Promise<{
  recordsCount: number;
  blobsCount: number;
  estimatedUsage?: number;
  estimatedQuota?: number;
}> {
  const db = await openDb();

  const recordsCount = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, "readonly");
    const req = tx.objectStore(STORE_RECORDS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const blobsCount = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, "readonly");
    const req = tx.objectStore(STORE_BLOBS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  let estimatedUsage: number | undefined;
  let estimatedQuota: number | undefined;
  if ("storage" in navigator && "estimate" in navigator.storage) {
    try {
      const est = await navigator.storage.estimate();
      estimatedUsage = est.usage;
      estimatedQuota = est.quota;
    } catch {
      // ignore
    }
  }

  return { recordsCount, blobsCount, estimatedUsage, estimatedQuota };
}
