// WebGPU device and canvas (docs/PLAN-engine.md section 3.1: WebGPU only). Optional features are requested only when the
// adapter has them; callers check `features` instead of assuming.

export interface Gpu {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  timestamps: boolean;
  info: string;
}

export const DEPTH_FORMAT: GPUTextureFormat = "depth32float";
export const SAMPLE_COUNT = 4; // MSAA: tree/impostor edges use alpha-to-coverage later, and terrain silhouettes need it now

// What every pipeline of the main pass must agree on.
export interface RenderTarget {
  format: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  sampleCount: number;
}

export class WebGpuUnavailable extends Error {}

export async function initGpu(canvas: HTMLCanvasElement, wantLayers = 512): Promise<Gpu> {
  if (!navigator.gpu) throw new WebGpuUnavailable("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new WebGpuUnavailable("No WebGPU adapter");
  const timestamps = adapter.features.has("timestamp-query");
  const requiredFeatures: GPUFeatureName[] = timestamps ? ["timestamp-query"] : [];
  const device = await adapter.requestDevice({
    label: "engine",
    requiredFeatures,
    requiredLimits: {
      // Height page pool: more layers mean fewer evictions on wide views. 256 is the guaranteed minimum.
      maxTextureArrayLayers: Math.min(wantLayers, adapter.limits.maxTextureArrayLayers),
      maxStorageBufferBindingSize: Math.min(256 * 1024 * 1024, adapter.limits.maxStorageBufferBindingSize),
      maxBufferSize: Math.min(256 * 1024 * 1024, adapter.limits.maxBufferSize),
    },
  });
  device.addEventListener("uncapturederror", (e) => {
    console.error("[engine] WebGPU error:", (e as GPUUncapturedErrorEvent).error.message);
  });
  void device.lost.then((l) => console.error("[engine] device lost:", l.reason, l.message));
  const context = canvas.getContext("webgpu");
  if (!context) throw new WebGpuUnavailable("Canvas has no webgpu context");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const i = adapter.info;
  return { adapter, device, context, format, timestamps, info: [i.vendor, i.architecture, i.description].filter(Boolean).join(" ") };
}

// Keep the drawing buffer at CSS size x devicePixelRatio. Returns true when it changed.
export function fitCanvas(canvas: HTMLCanvasElement): boolean {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
