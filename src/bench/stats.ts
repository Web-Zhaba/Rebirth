// Frame-time summary shared by both benchmark runners.

export interface FrameStats {
  frames: number;
  median: number; // ms
  p95: number;
  max: number;
  mean: number;
}

export function summarize(samples: readonly number[]): FrameStats {
  if (samples.length === 0) return { frames: 0, median: 0, p95: 0, max: 0, mean: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { frames: s.length, median: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}

export interface BenchResult {
  engine: "maplibre" | "next";
  scene: string;
  variant: string; // e.g. "full", "base"
  canvas: [number, number]; // drawing-buffer pixels
  gpu: FrameStats | null; // null when the timer is unavailable
  cpu: FrameStats; // main-thread time spent producing each frame
  interval: FrameStats; // rAF-to-rAF, capped by vsync
}
