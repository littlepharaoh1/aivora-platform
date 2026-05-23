/**
 * zeroCopyFabric.ts — Zero-Copy Worker Communication
 * Aivora Platform — Phase 6A.7
 *
 * Slot lifecycle (strict state machine):
 *   MAIN:   acquire() → WRITING → markReady() → READY
 *   WORKER: markReady() → READING → markDone() → DONE
 *   MAIN:   release() on DONE → IDLE
 *
 * P0.2: Atomics state machine enforced
 * P0.3: slot_byte_offset correct per slot
 * P1.1: protocol_version = "6A.7"
 */

import { sharedMemoryPool } from "./sharedMemoryPool";
import type { MemoryLease } from "./sharedMemoryPool";

export const ZERO_COPY_PROTOCOL_VERSION = "6A.7";

export interface ZeroCopyMessage {
  type:             "ZERO_COPY_DSP";
  protocol_version: string;
  sab:              SharedArrayBuffer | null;
  sab_control:      SharedArrayBuffer | null;
  slot_index:       number;
  slot_byte_offset: number;
  float_count:      number;
  sample_rate:      number;
  correlation_id:   string;
  buffer_fallback:  ArrayBuffer | null;
}

export interface ZeroCopyPayload {
  lease:         MemoryLease;
  transferList:  Transferable[];
  workerMessage: ZeroCopyMessage;
}

export function prepareZeroCopyPayload(
  samples:       Float32Array,
  sampleRate:    number,
  correlationId: string,
): ZeroCopyPayload {
  const lease = sharedMemoryPool.acquire(samples.length);

  if(!lease) {
    const copy = samples.buffer.slice(0) as ArrayBuffer;
    return {
      lease: {
        slot_index: -1, slot_byte_offset: 0,
        view: new Float32Array(copy), sab: null,
        float_count: samples.length, release: () => {},
      },
      transferList: [copy],
      workerMessage: {
        type: "ZERO_COPY_DSP", protocol_version: ZERO_COPY_PROTOCOL_VERSION,
        sab: null, sab_control: null, slot_index: -1, slot_byte_offset: 0,
        float_count: samples.length, sample_rate: sampleRate,
        correlation_id: correlationId, buffer_fallback: copy,
      },
    };
  }

  if(lease.sab) {
    const cfg        = sharedMemoryPool.getConfig();
    const byteOffset = lease.slot_index * cfg.slot_floats * Float32Array.BYTES_PER_ELEMENT;
    const count      = Math.min(samples.length, lease.float_count);
    lease.view.set(samples.subarray(0, count));
    sharedMemoryPool.markReady(lease.slot_index);

    return {
      lease,
      transferList: [],
      workerMessage: {
        type: "ZERO_COPY_DSP", protocol_version: ZERO_COPY_PROTOCOL_VERSION,
        sab: lease.sab, sab_control: sharedMemoryPool.getControlSAB(),
        slot_index: lease.slot_index, slot_byte_offset: byteOffset,
        float_count: count, sample_rate: sampleRate,
        correlation_id: correlationId, buffer_fallback: null,
      },
    };
  }

  // ArrayBuffer fallback
  const count = Math.min(samples.length, lease.float_count);
  lease.view.set(samples.subarray(0, count));
  const copy = lease.view.buffer.slice(0) as ArrayBuffer;
  lease.release();

  return {
    lease: {
      slot_index: -1, slot_byte_offset: 0,
      view: new Float32Array(copy), sab: null,
      float_count: count, release: () => {},
    },
    transferList: [copy],
    workerMessage: {
      type: "ZERO_COPY_DSP", protocol_version: ZERO_COPY_PROTOCOL_VERSION,
      sab: null, sab_control: null, slot_index: -1, slot_byte_offset: 0,
      float_count: count, sample_rate: sampleRate,
      correlation_id: correlationId, buffer_fallback: copy,
    },
  };
}

export function readZeroCopyMessage(msg: ZeroCopyMessage): Float32Array {
  if(msg.protocol_version !== ZERO_COPY_PROTOCOL_VERSION) {
    console.warn(`[ZeroCopy] Protocol mismatch: ${msg.protocol_version}`);
    return new Float32Array(0);
  }
  if(msg.sab && msg.slot_index >= 0) {
    return new Float32Array(msg.sab, msg.slot_byte_offset, msg.float_count);
  }
  if(msg.buffer_fallback) {
    return new Float32Array(msg.buffer_fallback);
  }
  return new Float32Array(0);
}
