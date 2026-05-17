/**
 * audioWorkletManager.ts — AudioWorklet Lifecycle Manager
 * Manages realtime DSP worklet nodes with metrics streaming
 */

export interface WorkletMetrics {
  peakDbL:       number;
  peakDbR:       number;
  rmsDbL:        number;
  rmsDbR:        number;
  clipCount:     number;
  zcrRate:       number;
  gainReduction: number;
  timestamp:     number;
}

export interface WorkletOptions {
  gain?:      number;
  threshold?: number;
  bypass?:    boolean;
  onMetrics?: (m: WorkletMetrics) => void;
}

export class AudioWorkletManager {
  private ctx:       AudioContext | null = null;
  private node:      AudioWorkletNode | null = null;
  private source:    AudioBufferSourceNode | null = null;
  private gainNode:  GainNode | null = null;
  private loaded     = false;
  private onMetrics: ((m: WorkletMetrics) => void) | null = null;

  async initialize(options: WorkletOptions = {}): Promise<void> {
    if (this.loaded) return;

    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.onMetrics = options.onMetrics ?? null;

    try {
      await this.ctx.audioWorklet.addModule("/aivoraWorkletProcessor.js");
      this.loaded = true;
    } catch (err) {
      console.warn("[AudioWorklet] Failed to load processor:", err);
      throw err;
    }

    this.node = new AudioWorkletNode(this.ctx, "aivora-worklet-processor", {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {},
    });

    // Set initial params
    if (options.gain !== undefined) {
      this.node.parameters.get("gain")!.value = options.gain;
    }
    if (options.threshold !== undefined) {
      this.node.parameters.get("threshold")!.value = options.threshold;
    }
    if (options.bypass !== undefined) {
      this.node.parameters.get("bypass")!.value = options.bypass ? 1 : 0;
    }

    // Metrics callback
    this.node.port.onmessage = (e) => {
      if (e.data.type === "metrics" && this.onMetrics) {
        this.onMetrics(e.data as WorkletMetrics);
      }
    };

    // Connect to destination
    this.gainNode = this.ctx.createGain();
    this.node.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);
  }

  async playBuffer(buffer: AudioBuffer): Promise<void> {
    if (!this.ctx || !this.node) {
      await this.initialize();
    }
    this.stopPlayback();

    this.source = this.ctx!.createBufferSource();
    this.source.buffer = buffer;
    this.source.connect(this.node!);
    this.source.start();
  }

  stopPlayback(): void {
    if (this.source) {
      try { this.source.stop(); } catch {}
      this.source.disconnect();
      this.source = null;
    }
  }

  setGain(db: number): void {
    if (!this.node) return;
    const linear = Math.pow(10, db / 20);
    this.node.parameters.get("gain")!.setTargetAtTime(
      linear, this.ctx!.currentTime, 0.01
    );
  }

  setThreshold(db: number): void {
    if (!this.node) return;
    const linear = Math.pow(10, db / 20);
    this.node.parameters.get("threshold")!.value = linear;
  }

  setBypass(bypass: boolean): void {
    if (!this.node) return;
    this.node.parameters.get("bypass")!.value = bypass ? 1 : 0;
  }

  resetPeaks(): void {
    this.node?.port.postMessage({ type: "reset" });
  }

  async suspend(): Promise<void> {
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  async dispose(): Promise<void> {
    this.stopPlayback();
    this.node?.disconnect();
    this.gainNode?.disconnect();
    await this.ctx?.close();
    this.ctx   = null;
    this.node  = null;
    this.loaded = false;
  }

  get isLoaded(): boolean { return this.loaded; }
  get sampleRate(): number { return this.ctx?.sampleRate ?? 48000; }
  get currentTime(): number { return this.ctx?.currentTime ?? 0; }
}

// Singleton
export const workletManager = new AudioWorkletManager();
