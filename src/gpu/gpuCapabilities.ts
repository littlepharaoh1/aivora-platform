/**
 * gpuCapabilities.ts — GPU Capability Detection
 * Aivora Platform — Phase 6A.2
 *
 * Ownership: singleton — module scope
 * Lifecycle: detected once on first call, cached forever
 * Cleanup: no resources to release (detection only)
 * Determinism: same browser state → same result
 * Node.js guard: pre-warm skipped outside browser
 */

export type GPUTier =
  | "WEBGPU_FULL"
  | "WEBGPU_LIMITED"
  | "WEBGL2"
  | "WEBGL1"
  | "CPU_ONLY";

export interface GPUCapabilities {
  tier:                           GPUTier;
  has_webgpu:                     boolean;
  has_compute_shaders:            boolean;
  has_webgl2:                     boolean;
  has_webgl1:                     boolean;
  max_texture_size:               number;
  max_compute_workgroups_per_dim: number;
  adapter_name:                   string | null;
  adapter_vendor:                 string | null;
  is_software_rasterizer:         boolean;
  supports_f16:                   boolean;
  supports_timestamp_query:       boolean;
  detected_at:                    number;
}

// ── WebGL Detection (synchronous — runs on idle) ──────────────────────────────

function detectWebGLInfo(): {
  has_webgl2: boolean;
  has_webgl1: boolean;
  max_texture_size: number;
} {
  // NOTE: getContext() can block 50-200ms on some drivers.
  // Called only once and cached. Acceptable at startup.
  try {
    const c   = document.createElement("canvas");
    c.width   = 1;
    c.height  = 1;
    const gl2 = c.getContext("webgl2");
    if(gl2) {
      const size = gl2.getParameter(gl2.MAX_TEXTURE_SIZE) as number ?? 4096;
      // Immediately lose context to free GPU resources after detection
      const ext = gl2.getExtension("WEBGL_lose_context");
      ext?.loseContext();
      return { has_webgl2: true, has_webgl1: true, max_texture_size: size };
    }
    const gl1 = c.getContext("webgl");
    if(gl1) {
      const size = gl1.getParameter(gl1.MAX_TEXTURE_SIZE) as number ?? 2048;
      const ext  = gl1.getExtension("WEBGL_lose_context");
      ext?.loseContext();
      return { has_webgl2: false, has_webgl1: true, max_texture_size: size };
    }
    return { has_webgl2: false, has_webgl1: false, max_texture_size: 0 };
  } catch {
    return { has_webgl2: false, has_webgl1: false, max_texture_size: 0 };
  }
}

// ── WebGPU Detection (async) ──────────────────────────────────────────────────

async function detectWebGPUInfo(): Promise<{
  has_webgpu:          boolean;
  has_compute_shaders: boolean;
  adapter_name:        string | null;
  adapter_vendor:      string | null;
  is_software:         boolean;
  supports_f16:        boolean;
  supports_timestamp:  boolean;
  max_workgroups:      number;
}> {
  const NONE = {
    has_webgpu: false, has_compute_shaders: false,
    adapter_name: null, adapter_vendor: null,
    is_software: false, supports_f16: false,
    supports_timestamp: false, max_workgroups: 0,
  };

  try {
    if(typeof navigator === "undefined" || !(navigator as any).gpu) return NONE;

    const adapter = await (navigator as any).gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if(!adapter) return NONE;

    // requestAdapterInfo may not exist in all implementations
    const info = await adapter.requestAdapterInfo?.().catch(() => ({})) ?? {};
    const limits: Record<string, number> = adapter.limits ?? {};
    const features: Set<string> = adapter.features ?? new Set();

    const vendor = (info as any).vendor ?? "";
    const device = (info as any).device ?? "";
    const arch   = (info as any).architecture ?? "";
    const isSoftware =
      vendor.toLowerCase().includes("software") ||
      device.toLowerCase().includes("swiftshader") ||
      arch.toLowerCase().includes("software");

    return {
      has_webgpu:          true,
      has_compute_shaders: true, // WebGPU always supports compute shaders
      adapter_name:        (info as any).device   ?? null,
      adapter_vendor:      vendor || null,
      is_software:         isSoftware,
      supports_f16:        features.has("shader-f16"),
      supports_timestamp:  features.has("timestamp-query"),
      max_workgroups:      limits["maxComputeWorkgroupsPerDimension"] ?? 65535,
    };
  } catch {
    return NONE;
  }
}

function determineTier(
  hasWebGPU:  boolean,
  isSoftware: boolean,
  hasWebGL2:  boolean,
  hasWebGL1:  boolean,
): GPUTier {
  if(hasWebGPU && !isSoftware) return "WEBGPU_FULL";
  if(hasWebGPU && isSoftware)  return "WEBGPU_LIMITED";
  if(hasWebGL2)                return "WEBGL2";
  if(hasWebGL1)                return "WEBGL1";
  return "CPU_ONLY";
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _caps:     GPUCapabilities | null = null;
let _building  = false;
let _waiters:  Array<(c: GPUCapabilities) => void> = [];

export async function getGPUCapabilities(): Promise<GPUCapabilities> {
  if(_caps) return _caps;
  if(_building) return new Promise(r => _waiters.push(r));

  _building = true;
  const webglInfo  = detectWebGLInfo();
  const webgpuInfo = await detectWebGPUInfo();

  _caps = {
    tier:                           determineTier(
      webgpuInfo.has_webgpu,
      webgpuInfo.is_software,
      webglInfo.has_webgl2,
      webglInfo.has_webgl1,
    ),
    has_webgpu:                     webgpuInfo.has_webgpu,
    has_compute_shaders:            webgpuInfo.has_compute_shaders,
    has_webgl2:                     webglInfo.has_webgl2,
    has_webgl1:                     webglInfo.has_webgl1,
    max_texture_size:               webglInfo.max_texture_size,
    max_compute_workgroups_per_dim: webgpuInfo.max_workgroups,
    adapter_name:                   webgpuInfo.adapter_name,
    adapter_vendor:                 webgpuInfo.adapter_vendor,
    is_software_rasterizer:         webgpuInfo.is_software,
    supports_f16:                   webgpuInfo.supports_f16,
    supports_timestamp_query:       webgpuInfo.supports_timestamp,
    detected_at:                    Date.now(),
  };

  _waiters.forEach(r => r(_caps!));
  _waiters  = [];
  _building = false;
  return _caps;
}

export function getGPUCapabilitiesSync(): GPUCapabilities | null {
  return _caps;
}

// Pre-warm: browser only, non-blocking
if(typeof document !== "undefined") {
  getGPUCapabilities().catch(() => {});
}
