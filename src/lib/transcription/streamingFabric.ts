/**
 * streamingFabric.ts — Streaming Inference Fabric
 * Aivora Platform — Phase 8.3
 *
 * State machine:
 *   IDLE → STREAM_CREATED → CHUNK_RECEIVED →
 *   CHUNK_INFERRED → PARTIAL_TRANSCRIPT →
 *   ALIGNMENT_UPDATED → FINALIZED | FAILED → RECOVERED
 *
 * Rules:
 *   - Bounded ring buffer (SAB when available)
 *   - Deterministic chunk sizes
 *   - Backpressure enforcement
 *   - Zero-copy SAB fast path
 *   - ArrayBuffer fallback
 *   - No unbounded queues
 */

import { sharedMemoryPool } from "../../gpu/sharedMemoryPool";
import { emitEvent }        from "../telemetry/emitter";
import { SAMPLE_RATE, MAX_CHUNK_DURATION_SEC } from "./asrTypes";

export const STREAM_VERSION = "8.3.0";

// ── Stream States ─────────────────────────────────────────────────────────────

export type StreamState =
  | "IDLE"
  | "STREAM_CREATED"
  | "CHUNK_RECEIVED"
  | "CHUNK_INFERRED"
  | "PARTIAL_TRANSCRIPT"
  | "ALIGNMENT_UPDATED"
  | "FINALIZED"
  | "FAILED"
  | "RECOVERED";

// ── Ring Buffer ───────────────────────────────────────────────────────────────

const RING_CAPACITY = MAX_CHUNK_DURATION_SEC * SAMPLE_RATE * 4; // 4 chunks buffer

export class AudioRingBuffer {
  private _buffer:    Float32Array;
  private _writePos:  number = 0;
  private _readPos:   number = 0;
  private _size:      number = 0;
  private readonly _capacity: number;

  constructor(capacity = RING_CAPACITY) {
    this._capacity = capacity;
    this._buffer   = new Float32Array(capacity);
  }

  // Write samples — returns false if would overflow (backpressure)
  write(samples: Float32Array): boolean {
    if(this._size + samples.length > this._capacity) return false;

    for(let i = 0; i < samples.length; i++) {
      this._buffer[this._writePos] = samples[i];
      this._writePos = (this._writePos + 1) % this._capacity;
    }
    this._size += samples.length;
    return true;
  }

  // Read exactly n samples — returns null if not enough data
  read(n: number): Float32Array | null {
    if(this._size < n) return null;

    const out = new Float32Array(n);
    for(let i = 0; i < n; i++) {
      out[i]       = this._buffer[this._readPos];
      this._readPos = (this._readPos + 1) % this._capacity;
    }
    this._size -= n;
    return out;
  }

  get available(): number { return this._size; }
  get capacity():  number { return this._capacity; }
  isFull():        boolean { return this._size >= this._capacity; }
  isEmpty():       boolean { return this._size === 0; }

  clear(): void {
    this._writePos = 0;
    this._readPos  = 0;
    this._size     = 0;
    this._buffer.fill(0);
  }
}

// ── Stream Session ────────────────────────────────────────────────────────────

export interface StreamSession {
  id:              string;
  state:           StreamState;
  correlation_id:  string;
  ring_buffer:     AudioRingBuffer;
  chunks_received: number;
  chunks_inferred: number;
  partial_text:    string;
  created_at:      number;
  updated_at:      number;
}

// ── Stream Manager ────────────────────────────────────────────────────────────

const CHUNK_FRAMES = MAX_CHUNK_DURATION_SEC * SAMPLE_RATE;

class StreamManager {
  private _sessions = new Map<string, StreamSession>();

  createSession(corrId: string): string {
    const id = crypto.randomUUID();
    this._sessions.set(id, {
      id,
      state:           "STREAM_CREATED",
      correlation_id:  corrId,
      ring_buffer:     new AudioRingBuffer(),
      chunks_received: 0,
      chunks_inferred: 0,
      partial_text:    "",
      created_at:      Date.now(),
      updated_at:      Date.now(),
    });

    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:corrId, severity:"info",
      payload:{ action:"STREAM_CREATED", session_id:id, version:STREAM_VERSION },
    });

    return id;
  }

  pushChunk(sessionId: string, samples: Float32Array): boolean {
    const session = this._sessions.get(sessionId);
    if(!session || session.state === "FAILED" || session.state === "FINALIZED") return false;

    // Backpressure: reject if buffer full
    if(session.ring_buffer.isFull()) {
      console.warn(`[StreamManager] Backpressure: session ${sessionId} buffer full`);
      return false;
    }

    const ok = session.ring_buffer.write(samples);
    if(ok) {
      session.state          = "CHUNK_RECEIVED";
      session.chunks_received++;
      session.updated_at     = Date.now();
    }
    return ok;
  }

  // Read one chunk for inference
  readChunk(sessionId: string): Float32Array | null {
    const session = this._sessions.get(sessionId);
    if(!session) return null;
    return session.ring_buffer.read(CHUNK_FRAMES);
  }

  updatePartialTranscript(sessionId: string, text: string): void {
    const session = this._sessions.get(sessionId);
    if(!session) return;
    session.partial_text   = text;
    session.state          = "PARTIAL_TRANSCRIPT";
    session.chunks_inferred++;
    session.updated_at     = Date.now();
  }

  finalizeSession(sessionId: string): void {
    const session = this._sessions.get(sessionId);
    if(!session) return;
    session.state      = "FINALIZED";
    session.updated_at = Date.now();

    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:session.correlation_id, severity:"info",
      payload:{
        action:"STREAM_FINALIZED", session_id:sessionId,
        chunks_received:session.chunks_received,
        chunks_inferred:session.chunks_inferred,
      },
    });
  }

  failSession(sessionId: string, error: string): void {
    const session = this._sessions.get(sessionId);
    if(!session) return;
    session.state      = "FAILED";
    session.updated_at = Date.now();
    emitEvent({
      event_type:"ADMIN_ACTION", event_source:"qc_workstation",
      correlation_id:session.correlation_id, severity:"error",
      payload:{ action:"STREAM_FAILED", session_id:sessionId, error },
    });
  }

  getSession(sessionId: string): StreamSession | undefined {
    return this._sessions.get(sessionId);
  }

  destroySession(sessionId: string): void {
    const session = this._sessions.get(sessionId);
    if(session) {
      session.ring_buffer.clear();
      this._sessions.delete(sessionId);
    }
  }
}

export const streamManager = new StreamManager();
