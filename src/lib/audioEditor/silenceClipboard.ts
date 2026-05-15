/**
 * silenceClipboard.ts — Clean Silence Clipboard
 * Store and retrieve clean silence for manual paste operations
 * Aivora Platform — Audition Workstation
 */

import { buildReferenceSilenceProfile } from "../audioForensics/referenceSilenceProfile";
import type { ReferenceSilenceProfile } from "../audioForensics/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClipboardEntry {
  id:          string;
  label:       string;
  profile:     ReferenceSilenceProfile;
  buffer:      AudioBuffer;
  startSample: number;
  endSample:   number;
  durationMs:  number;
  rmsDb:       number;
  noiseFloorDb: number;
  purityScore: number;
  createdAt:   string;
}

export interface ClipboardStats {
  count:        number;
  bestPurity:   number;
  bestEntry:    ClipboardEntry | null;
}

// ── Clipboard Store ───────────────────────────────────────────────────────────

class SilenceClipboardStore {
  private entries: ClipboardEntry[] = [];
  private counter = 0;
  readonly MAX_ENTRIES = 8;

  // ── Save clean silence from selection ─────────────────────────────────────

  save(
    buffer:      AudioBuffer,
    startSample: number,
    endSample:   number,
    label?:      string
  ): ClipboardEntry {
    const sr  = buffer.sampleRate;
    const len = endSample - startSample;

    // Extract region as new buffer
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, len, sr);
    const clip = ctx.createBuffer(buffer.numberOfChannels, len, sr);
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      const src = buffer.getChannelData(ch);
      const dst = clip.getChannelData(ch);
      for(let i=0; i<len; i++) dst[i] = src[startSample+i] ?? 0;
    }

    // Build profile from clipped region
    const profile = buildReferenceSilenceProfile(clip, label ?? `clip_${++this.counter}`);

    // Compute RMS
    const mono = new Float32Array(len);
    for(let ch=0; ch<buffer.numberOfChannels; ch++){
      const d = buffer.getChannelData(ch);
      for(let i=0; i<len; i++) mono[i] += d[startSample+i] ?? 0;
    }
    if(buffer.numberOfChannels > 1)
      for(let i=0; i<mono.length; i++) mono[i] /= buffer.numberOfChannels;

    let rmsSum = 0;
    for(let i=0; i<mono.length; i++) rmsSum += mono[i]**2;
    const rmsDb = rmsSum > 0 ? 20*Math.log10(Math.sqrt(rmsSum/mono.length)) : -120;

    const entry: ClipboardEntry = {
      id:          `clip_${Date.now()}_${this.counter}`,
      label:       label ?? `Silence ${this.counter}`,
      profile,
      buffer:      clip,
      startSample,
      endSample,
      durationMs:  (len/sr)*1000,
      rmsDb,
      noiseFloorDb: profile.noiseFloorDb,
      purityScore: profile.purityScore,
      createdAt:   new Date().toISOString(),
    };

    // Evict oldest if full
    if(this.entries.length >= this.MAX_ENTRIES)
      this.entries.shift();

    this.entries.push(entry);
    return entry;
  }

  // ── Save from full reference buffer ──────────────────────────────────────

  saveFromReference(
    buffer: AudioBuffer,
    fileName: string
  ): ClipboardEntry {
    return this.save(buffer, 0, buffer.length, `REF: ${fileName}`);
  }

  // ── Get entries ───────────────────────────────────────────────────────────

  getAll(): ClipboardEntry[] {
    return [...this.entries].reverse();
  }

  getBest(): ClipboardEntry | null {
    if(this.entries.length === 0) return null;
    return this.entries.reduce((best, e) =>
      e.purityScore > best.purityScore ? e : best
    );
  }

  getById(id: string): ClipboardEntry | null {
    return this.entries.find(e => e.id === id) ?? null;
  }

  remove(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
  }

  clear(): void { this.entries = []; }

  getStats(): ClipboardStats {
    const best = this.getBest();
    return {
      count:      this.entries.length,
      bestPurity: best?.purityScore ?? 0,
      bestEntry:  best,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const silenceClipboard = new SilenceClipboardStore();

// ── Validate clipboard entry for paste ────────────────────────────────────────

export function validateForPaste(
  entry:      ClipboardEntry,
  targetSR:   number
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if(entry.profile.sampleRate !== targetSR)
    warnings.push(`Sample rate mismatch: clipboard ${entry.profile.sampleRate}Hz vs target ${targetSR}Hz`);

  if(entry.purityScore < 0.60)
    warnings.push(`Low purity (${(entry.purityScore*100).toFixed(0)}%) — silence may not be clean enough`);

  if(entry.profile.grainLibrary.length < 2)
    warnings.push("Few grains in clipboard — result may show repetition");

  if(entry.noiseFloorDb > -50)
    warnings.push(`High noise floor (${entry.noiseFloorDb.toFixed(1)} dB) — clipboard may be noisy`);

  return { valid: warnings.length === 0 || entry.purityScore >= 0.50, warnings };
}
