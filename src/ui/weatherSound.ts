import { effect, signal, type ReadonlySignal } from "@preact/signals";
import type { WeatherState } from "../sim/weather";
import { soundVolume } from "./sound";

// Ambient weather (rain, wind, snow hush), synthesized with the Web Audio API. Off by default, separate from UI
// clicks: it shares the volume slider but ignores `soundEnabled`. Nothing here ever throws.
const KEY = "rebirth.weatherSound";
const MASTER_SCALE = 0.35; // ambience sits under the UI sounds
const RAMP = 0.25; // setTargetAtTime time constant, about 0.6 s to settle
const THROTTLE_MS = 500;
const RAIN_TRIM = 0.5;
const WIND_TRIM = 0.6;
const HUSH_TRIM = 0.3;

export interface Ambience {
  rain: number; // 0..1
  wind: number; // 0..1
  hush: number; // 0..1
}

const ZERO: Ambience = { rain: 0, wind: 0, hush: 0 };

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function loadOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const weatherSoundOn = signal<boolean>(loadOn());

function save(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Pure mapping from the weather snapshot to the three ambience levels; independent of the day/night cycle.
export function ambienceLevels(ws: WeatherState | null | undefined): Ambience {
  if (!ws || !ws.site || !ws.now) return ZERO;
  const w = ws.now;
  const rain = w.snow ? 0 : smoothstep(0.05, 2.5, w.precip);
  const hush = w.snow ? smoothstep(0.05, 1.5, w.precip) * 0.6 : 0;
  const wind = clamp01(smoothstep(2, 16, w.wind) + 0.1 * smoothstep(0.7, 1, w.cloud));
  return { rain, wind, hush };
}

let noiseData: Float32Array | null = null;

// White noise generated once and reused by every rebuilt graph.
function noise(): Float32Array {
  if (!noiseData) {
    noiseData = new Float32Array(44100 * 2);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  }
  return noiseData;
}

interface AmbienceGraph {
  ctx: AudioContext;
  master: GainNode;
  rain: { gain: GainNode; filter: BiquadFilterNode };
  wind: { gain: GainNode; filter: BiquadFilterNode; lfo: GainNode };
  hush: { gain: GainNode; filter: BiquadFilterNode };
  stop: () => void;
}

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const C =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = C ? new C() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

function buildGraph(): AmbienceGraph | null {
  const c = context();
  if (!c) return null;
  try {
    const data = noise();
    const buffer = c.createBuffer(1, data.length, 44100);
    buffer.getChannelData(0).set(data);

    const shared = c.createBufferSource();
    shared.buffer = buffer;
    shared.loop = true;

    const master = c.createGain();
    master.gain.value = soundVolume.peek() * MASTER_SCALE;
    master.connect(c.destination);

    const rainFilter = c.createBiquadFilter();
    rainFilter.type = "lowpass";
    rainFilter.frequency.value = 900;
    rainFilter.Q.value = 0.5;
    const rainGain = c.createGain();
    rainGain.gain.value = 0;
    shared.connect(rainFilter).connect(rainGain).connect(master);

    const windFilter = c.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 250;
    windFilter.Q.value = 0.8;
    const windGain = c.createGain();
    windGain.gain.value = 0;
    shared.connect(windFilter).connect(windGain).connect(master);

    const lfo = c.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.08;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain).connect(windGain.gain);
    lfo.start();

    const hushSrc = c.createBufferSource();
    hushSrc.buffer = buffer;
    hushSrc.loop = true;
    const hushFilter = c.createBiquadFilter();
    hushFilter.type = "highpass";
    hushFilter.frequency.value = 2000;
    hushFilter.Q.value = 0.7;
    const hushGain = c.createGain();
    hushGain.gain.value = 0;
    hushSrc.connect(hushFilter).connect(hushGain).connect(master);

    shared.start();
    hushSrc.start();

    const stop = () => {
      try {
        shared.stop();
        hushSrc.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
      try {
        void c.close().catch(() => {});
      } catch {
        /* ignore */
      }
    };

    return {
      ctx: c,
      master,
      rain: { gain: rainGain, filter: rainFilter },
      wind: { gain: windGain, filter: windFilter, lfo: lfoGain },
      hush: { gain: hushGain, filter: hushFilter },
      stop,
    };
  } catch {
    return null;
  }
}

let graph: AmbienceGraph | null = null;
const current: Ambience = { rain: 0, wind: 0, hush: 0 };
let hidden = false;

function ensureGraph(): AmbienceGraph | null {
  if (graph) return graph;
  graph = buildGraph();
  if (graph && graph.ctx.state === "suspended") void graph.ctx.resume().catch(() => {});
  return graph;
}

function stopGraph(): void {
  const g = graph;
  graph = null;
  if (!g) return;
  try {
    g.stop();
  } catch {
    /* ignore */
  }
  // `stop()` closes the context; forget it so the next enable builds a fresh one.
  if (ctx === g.ctx) ctx = null;
}

function apply(): void {
  const g = graph;
  if (!g) return;
  try {
    const t = g.ctx.currentTime;
    const live = weatherSoundOn.peek() && !hidden;
    const rain = live ? current.rain : 0;
    const wind = live ? current.wind : 0;
    const hush = live ? current.hush : 0;
    g.master.gain.setTargetAtTime(soundVolume.peek() * MASTER_SCALE, t, RAMP);
    g.rain.gain.gain.setTargetAtTime(rain * RAIN_TRIM, t, RAMP);
    g.wind.gain.gain.setTargetAtTime(wind * WIND_TRIM, t, RAMP);
    g.wind.lfo.gain.setTargetAtTime(wind * WIND_TRIM * 0.35, t, RAMP);
    g.hush.gain.gain.setTargetAtTime(hush * HUSH_TRIM, t, RAMP);
    g.rain.filter.frequency.setTargetAtTime(900 + rain * 2300, t, RAMP);
    g.wind.filter.frequency.setTargetAtTime(250 + wind * 450, t, RAMP);
  } catch {
    /* audio is never worth a crash */
  }
}

// Called from the settings checkbox, so the first enable is a user gesture and may start the context.
export function setWeatherSound(on: boolean): void {
  weatherSoundOn.value = on;
  save(on);
  if (!on) {
    stopGraph();
    return;
  }
  if (ensureGraph()) apply();
}

export function attachWeatherSound(weather: ReadonlySignal<WeatherState | null>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Ambience = ZERO;
  let last = "";
  hidden = typeof document !== "undefined" && document.visibilityState === "hidden";

  const commit = () => {
    timer = null;
    current.rain = pending.rain;
    current.wind = pending.wind;
    current.hush = pending.hush;
    const key = `${Math.round(pending.rain * 100)}:${Math.round(pending.wind * 100)}:${Math.round(pending.hush * 100)}`;
    if (key === last) return;
    last = key;
    apply();
  };

  const schedule = () => {
    if (timer === null) timer = setTimeout(commit, THROTTLE_MS);
  };

  const stopWeather = effect(() => {
    const ws = weather.value;
    if (!weatherSoundOn.value) {
      pending = ZERO;
      return;
    }
    ensureGraph();
    pending = ambienceLevels(ws);
    schedule();
  });

  const stopControl = effect(() => {
    const on = weatherSoundOn.value;
    void soundVolume.value;
    if (!on) {
      stopGraph();
      return;
    }
    ensureGraph();
    apply();
  });

  const onVisibility = () => {
    hidden = document.visibilityState === "hidden";
    apply();
  };
  // A context created before any gesture starts suspended; the first interaction wakes a switch left on in storage.
  const wake = () => {
    if (!weatherSoundOn.peek()) return;
    ensureGraph();
    apply();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", wake);
    document.addEventListener("keydown", wake);
  }

  return () => {
    stopWeather();
    stopControl();
    if (timer !== null) clearTimeout(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
    }
    stopGraph();
  };
}
