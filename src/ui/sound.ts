import { signal } from "@preact/signals";

// Optional UI sounds, synthesized with the Web Audio API (no files). Off by default; the AudioContext is created lazily
// on the first play, which always comes from a user gesture or a game event after one. Nothing here ever throws.
export type SoundName = "click" | "place" | "finished" | "notify" | "error";

interface Note {
  f: number; // Hz
  at: number; // start, s
  len: number; // s
  type?: OscillatorType;
  gain?: number;
}

const NOTES: Record<SoundName, Note[]> = {
  click: [{ f: 1100, at: 0, len: 0.04, gain: 0.5 }],
  place: [
    { f: 520, at: 0, len: 0.09 },
    { f: 780, at: 0.07, len: 0.14 },
  ],
  finished: [
    { f: 523, at: 0, len: 0.12 },
    { f: 659, at: 0.1, len: 0.12 },
    { f: 784, at: 0.2, len: 0.3 },
  ],
  notify: [
    { f: 880, at: 0, len: 0.25, gain: 0.7 },
    { f: 1320, at: 0.02, len: 0.35, gain: 0.3 },
  ],
  error: [{ f: 150, at: 0, len: 0.16, type: "square", gain: 0.5 }],
};

const KEY = "rebirth.sound";
export const DEFAULT_VOLUME = 0.5;

export interface SoundSettings {
  enabled: boolean;
  volume: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME);

export function loadSettings(): SoundSettings {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (o && typeof o === "object") return { enabled: o.enabled === true, volume: clamp01(typeof o.volume === "number" ? o.volume : DEFAULT_VOLUME) };
  } catch {
    /* no storage or bad data: defaults */
  }
  return { enabled: false, volume: DEFAULT_VOLUME };
}

const initial = loadSettings();
export const soundEnabled = signal(initial.enabled);
export const soundVolume = signal(initial.volume);

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: soundEnabled.peek(), volume: soundVolume.peek() }));
  } catch {
    /* ignore */
  }
}

export function setSoundEnabled(on: boolean): void {
  soundEnabled.value = on;
  save();
}

export function setSoundVolume(v: number): void {
  soundVolume.value = clamp01(v);
  save();
}

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = C ? new C() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

// For tests: forget the cached context.
export const resetSound = (): void => {
  ctx = null;
};

export function play(name: SoundName): void {
  if (!soundEnabled.peek() || soundVolume.peek() <= 0) return;
  try {
    const c = context();
    if (!c) return;
    if (c.state === "suspended") void c.resume().catch(() => {});
    const t0 = c.currentTime;
    const master = soundVolume.peek() * 0.25;
    for (const n of NOTES[name]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = n.type ?? "sine";
      o.frequency.value = n.f;
      const peak = master * (n.gain ?? 1);
      const s = t0 + n.at;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + n.len);
      o.connect(g).connect(c.destination);
      o.start(s);
      o.stop(s + n.len + 0.02);
    }
  } catch {
    /* sound is never worth a crash */
  }
}

// One click sound for buttons in the build bar and the top bar (delegated, so every button there is covered).
export function installClickSound(): () => void {
  const on = (e: MouseEvent) => {
    const b = (e.target as Element | null)?.closest?.(".build-bar button, .topbar button");
    if (b) play("click");
  };
  document.addEventListener("click", on);
  return () => document.removeEventListener("click", on);
}
