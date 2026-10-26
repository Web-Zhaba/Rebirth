import { signal } from "@preact/signals";

// Player choices for the clouds (PLAN-clouds.md section 7), kept in localStorage. No three.js here: the layer bar and
// the settings dialog import this from the main chunk.

export type CloudQuality = "low" | "medium" | "high";
export const CLOUD_QUALITIES: CloudQuality[] = ["low", "medium", "high"];

const SHOW_KEY = "rebirth.clouds";
const QUALITY_KEY = "rebirth.cloudQuality";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// Low on phones, medium elsewhere.
export function defaultQuality(): CloudQuality {
  try {
    return matchMedia("(pointer: coarse) and (max-width: 640px)").matches ? "low" : "medium";
  } catch {
    return "medium";
  }
}

const readQuality = (): CloudQuality => {
  const v = read(QUALITY_KEY);
  return CLOUD_QUALITIES.includes(v as CloudQuality) ? (v as CloudQuality) : defaultQuality();
};

// One switch for clouds, their ground shadows, precipitation shafts and lightning.
export const cloudsOn = signal(read(SHOW_KEY) !== "0");
export const cloudQuality = signal<CloudQuality>(readQuality());

export function toggleClouds(): void {
  cloudsOn.value = !cloudsOn.value;
  write(SHOW_KEY, cloudsOn.value ? "1" : "0");
}

export function setCloudQuality(q: CloudQuality): void {
  cloudQuality.value = q;
  write(QUALITY_KEY, q);
}

// Whether this device can draw the "high" preset (RGBA16F render targets). The dialog opens before three.js is loaded,
// so this probes a throwaway WebGL2 context once; the layer re-checks with its own context and steps down to medium
// if the probe was too optimistic (cloudQuality.ts effectiveQuality).
let highProbe: boolean | null = null;
export function highQualityAvailable(): boolean {
  if (highProbe !== null) return highProbe;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    highProbe = !!gl && !!gl.getExtension("EXT_color_buffer_float");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    highProbe = false;
  }
  return highProbe;
}

// The weather site the clouds are drawn for (seed and phase from the snapshot); null before founding.
export interface CloudSite {
  seed: number;
  phase: number;
}
