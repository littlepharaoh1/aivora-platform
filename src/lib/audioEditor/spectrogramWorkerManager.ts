/**
 * spectrogramWorkerManager.ts — OffscreenCanvas Spectrogram Worker Manager
 * Manages worker lifecycle and canvas transfer
 */

export interface SpectrogramRenderRequest {
  fftData:   number[][];
  width:     number;
  height:    number;
  colormap?: "plasma"|"inferno"|"aivora"|"forensic";
  minDb?:    number;
  maxDb?:    number;
}

export class SpectrogramWorkerManager {
  private worker:  Worker | null = null;
  private canvas:  OffscreenCanvas | null = null;
  private pending: boolean = false;

  initialize(width: number, height: number): boolean {
    try {
      if(typeof OffscreenCanvas === "undefined") return false;
      this.canvas = new OffscreenCanvas(width, height);
      this.worker = new Worker("/spectrogramWorker.js");
      return true;
    } catch {
      return false;
    }
  }

  async render(
    request: SpectrogramRenderRequest
  ): Promise<ImageBitmap | null> {
    if(!this.worker || !this.canvas || this.pending) return null;
    this.pending = true;

    return new Promise((resolve) => {
      this.worker!.onmessage = (e) => {
        this.pending = false;
        if(e.data.type === "done") resolve(e.data.bitmap);
        else resolve(null);
      };

      // Resize canvas if needed
      if(this.canvas!.width  !== request.width)  this.canvas!.width  = request.width;
      if(this.canvas!.height !== request.height) this.canvas!.height = request.height;

      // Transfer canvas to worker
      const offscreen = new OffscreenCanvas(request.width, request.height);
      this.worker!.postMessage({
        type:     "render",
        fftData:  request.fftData,
        width:    request.width,
        height:   request.height,
        colormap: request.colormap ?? "aivora",
        minDb:    request.minDb    ?? -90,
        maxDb:    request.maxDb    ?? 0,
        canvas:   offscreen,
      }, [offscreen]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.canvas = null;
  }

  get isSupported(): boolean {
    return typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
  }
}

export const spectrogramWorker = new SpectrogramWorkerManager();
