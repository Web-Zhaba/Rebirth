// Release inertia, MapLibre-like (handler_inertia.ts): the last ~160 ms of motion gives a velocity, scaled by a
// linearity factor and capped; it then decays at a constant deceleration.

export interface InertiaSpec {
  linearity: number;
  maxSpeed: number;
  deceleration: number; // units/s^2
}

export const PAN_INERTIA: InertiaSpec = { linearity: 0.3, maxSpeed: 1400, deceleration: 2500 }; // px/s, px/s^2
export const ROTATE_INERTIA: InertiaSpec = { linearity: 0.25, maxSpeed: 180, deceleration: 720 }; // deg/s, deg/s^2

const WINDOW_MS = 160;

// Keeps (time, position) samples of N channels and reports the average velocity over the last window.
export class VelocityTracker {
  private samples: { t: number; v: number[] }[] = [];

  push(t: number, ...v: number[]): void {
    this.samples.push({ t, v });
    while (this.samples.length > 1 && t - this.samples[0].t > WINDOW_MS) this.samples.shift();
  }

  // units per second; zeros when the pointer has been still for the whole window
  velocity(now: number, channels: number): number[] {
    const out = new Array<number>(channels).fill(0);
    const s = this.samples;
    if (s.length < 2 || now - s[s.length - 1].t > WINDOW_MS) return out;
    const dt = (s[s.length - 1].t - s[0].t) / 1000;
    if (dt <= 0) return out;
    for (let i = 0; i < channels; i++) out[i] = (s[s.length - 1].v[i] - s[0].v[i]) / dt;
    return out;
  }

  reset(): void {
    this.samples.length = 0;
  }
}

// Velocity vector (per second) -> initial inertia velocity, or null when too slow to bother.
export function inertiaStart(v: number[], spec: InertiaSpec, minSpeed = 1): number[] | null {
  const raw = Math.hypot(...v);
  const speed = raw * spec.linearity;
  if (speed < minSpeed) return null;
  const k = Math.min(speed, spec.maxSpeed) / raw;
  return v.map((x) => x * k);
}

// One step of constant deceleration for a vector velocity. Returns the displacement over dtMs and the new velocity;
// `done` when it came to rest within the step.
export function inertiaStep(v: number[], dtMs: number, deceleration: number): { delta: number[]; v: number[]; done: boolean } {
  const speed = Math.hypot(...v);
  if (speed === 0) return { delta: v.map(() => 0), v, done: true };
  const dt = dtMs / 1000;
  const tStop = speed / deceleration;
  const t = Math.min(dt, tStop);
  const dist = speed * t - 0.5 * deceleration * t * t;
  const newSpeed = speed - deceleration * t;
  const k = 1 / speed;
  return { delta: v.map((x) => x * k * dist), v: v.map((x) => x * k * newSpeed), done: t >= tStop };
}
