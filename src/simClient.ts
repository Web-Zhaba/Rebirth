import { L, lang } from "./i18n";
import { batch, computed, effect, signal } from "@preact/signals";
import type { Light, Rest, Trip } from "./map/life";
import { BASE_TICK, clockAt, tickFraction, tickMs, type Speed } from "./sim/clock";
import { applyDelta } from "./sim/delta";
import type { Cmd, CmdResult, FromWorker, ToWorker } from "./sim/protocol";
import { serveSaveStorage } from "./sim/savePort";
import type { BuildingQuery, City, ClientState, ResidentQuery } from "./sim/types";
import { makeFrame, type Frame } from "./world/frame";
import { platform } from "./platform";

const LEGACY_KEY = "rebirth.save";

export const city = signal<City | null>(null);
export const state = signal<ClientState | null>(null);
export const roads = computed(() => state.value?.roads ?? null);
export const zones = computed(() => state.value?.zones ?? null);
export const buildings = computed(() => state.value?.buildings ?? null);
// Changes only when buildings appear or vanish (lots never move), not on every construction tick.
export const buildingSet = computed(() => Object.keys(state.value?.buildings ?? {}).join(","));
export const frame = signal<Frame | null>(null);
export const people = computed(() => state.value?.people ?? null);
export const stock = computed(() => state.value?.stock ?? null);
export const economy = computed(() => state.value?.economy ?? null);
// Families on their way to the town.
export const incomingCount = computed(() => state.value?.incoming.length ?? 0);
export const digs = computed(() => state.value?.digs ?? []);
export const services = computed(() => state.value?.services ?? null);
export const events = computed(() => state.value?.events ?? []);
// «Итоги дня» of the last 22:00 (see DaySummary.tsx).
export const daySummary = computed(() => state.value?.summary ?? null);
export const chronicle = computed(() => state.value?.chronicle ?? []);
export const finds = computed(() => state.value?.finds ?? null);
export const articles = computed(() => state.value?.articles ?? []);
// The save (or its absence) has come back from the worker: the game can be played from here on.
export const loaded = signal(false);
export const loadFailure = signal<Extract<FromWorker, { t: "loadFailed" }>["reason"] | null>(null);
export const foundPending = signal(false);
export const foundFailed = signal(false);
export const saveFailed = signal(false);
export const resetFailed = signal(false);
let unreadableSave: unknown;

// Visual life of the current game day (cosmetic, from the worker).
export const lifeTrips = signal<Trip[]>([]);
export const lifeRests = signal<Rest[]>([]);
export const lifeTraffic = signal<Record<number, number>>({});
export const lifeLights = signal<Light[]>([]);
// Game speed of this session (0 = paused). It stays in effect when a town first loads or is founded.
export const speed = signal<Speed>(1);
// Game minutes, interpolated between snapshots and refreshed every 2 s for the life layer.
export const gameClock = signal(0);
// The clock at the moment of a pause, partway through the tick that `at` started: held while paused, so the time
// neither rolls back to the last whole tick nor jumps ahead; the unpause goes on from it.
let frozen: { at: number; clock: number } | null = null;
const clockOf = (s: ClientState): number => (speed.peek() === 0 && frozen?.at === s.gameMinutes ? frozen.clock : clockAt(s.gameMinutes, s.realTime, Date.now(), speed.peek()));
const syncClock = () => {
  const s = state.peek();
  if (s) gameClock.value = clockOf(s);
};
effect(() => {
  void state.value;
  void speed.value;
  syncClock();
});
setInterval(syncClock, 2000);
// Game minutes per real second right now, for extrapolating between clock updates.
export const gameMinPerSec = (): number => {
  const s = state.peek();
  return s && speed.peek() > 0 ? (BASE_TICK * 1000) / tickMs(s.gameMinutes, { speed: speed.peek(), offline: false }) : 0;
};

// The game clock interpolated to this instant: smooth enough to follow a walker dot.
export const gameNow = (): number => {
  const s = state.peek();
  return s ? clockOf(s) : gameClock.peek();
};

// The worker comes up on first use, not with this module: its bundle is around 100 kB gzip and neither the first frame
// nor the engine's start-up waits for it. Nothing is sent before `load()`, so the first use is the load itself.
let worker: Worker | null = null;
function simWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module", name: lang }); // the worker reads its language from its name (i18n.ts)
  w.onmessage = onWorkerMessage;
  w.onerror = onWorkerError;
  worker = w;
  return w;
}
const send = (msg: ToWorker) => simWorker().postMessage(msg);

let nextCmdId = 1;
const pending = new Map<number, (r: CmdResult) => void>();

export function sendCmd(cmd: Cmd): Promise<CmdResult> {
  if (!loaded.peek() || loadFailure.peek()) return Promise.resolve({ ok: false, reason: L("Поселение недоступно", "Settlement unavailable") });
  return new Promise((resolve) => {
    const id = nextCmdId++;
    pending.set(id, resolve);
    send({ t: "cmd", id, cmd });
  });
}

const queries = new Map<number, (d: BuildingQuery | ResidentQuery | null) => void>();

// Who lives in / works at a building; null when it does not exist (any more).
export function queryBuilding(id: number): Promise<BuildingQuery | null> {
  return new Promise((resolve) => {
    const qid = nextCmdId++;
    queries.set(qid, (d) => resolve(d && d.kind !== "resident" ? d : null));
    send({ t: "query", id: qid, q: { type: "building", id } });
  });
}

// One resident by id, for the follow mode; null when they are gone.
export function queryResident(id: number): Promise<ResidentQuery | null> {
  return new Promise((resolve) => {
    const qid = nextCmdId++;
    queries.set(qid, (d) => resolve(d && d.kind === "resident" ? d : null));
    send({ t: "query", id: qid, q: { type: "resident", id } });
  });
}

function onWorkerMessage(e: MessageEvent<FromWorker>): void {
  const m = e.data;
  switch (m.t) {
    case "loaded": {
      const founded = foundPending.peek() && m.save !== null;
      if (m.migrated) {
        try {
          localStorage.removeItem(LEGACY_KEY); // only after the v4 copy is persisted
        } catch {
          // storage unavailable: nothing to clean up
        }
      }
      batch(() => {
        state.value = m.save?.sim ?? null;
        city.value = m.save?.city ?? null;
        frame.value = m.save ? makeFrame(m.save.city.lat, m.save.city.lng) : null;
        foundPending.value = false;
        foundFailed.value = false;
        loaded.value = true;
      });
      if (founded) platform.settlementFounded?.();
      break;
    }
    case "cityChanged":
      city.value = m.city;
      break;
    case "loadFailed":
      unreadableSave = m.reason === "invalid" ? m.raw : undefined;
      loadFailure.value = m.reason;
      break;
    case "foundFailed":
      foundPending.value = false;
      foundFailed.value = true;
      break;
    case "saveStatus":
      saveFailed.value = m.failed;
      break;
    case "resetFailed":
      resetFailed.value = true;
      break;
    case "snapshot": {
      // A snapshot carries only what changed (zones, the chronicle, finds and articles too); the rest stays as we have
      // it, the same objects, so what is drawn from an unchanged part is not drawn again.
      const prev = state.value;
      if (prev) state.value = { ...applyDelta(prev, m.sim), zones: m.zones ?? prev.zones, chronicle: m.chronicle ?? prev.chronicle, finds: m.finds ?? prev.finds, articles: m.articles ?? prev.articles };
      break;
    }
    case "cmdResult": {
      const done = pending.get(m.id);
      pending.delete(m.id);
      done?.({ ok: m.ok, reason: m.reason, ids: m.ids });
      break;
    }
    case "queryResult": {
      const done = queries.get(m.id);
      queries.delete(m.id);
      done?.(m.data);
      break;
    }
    case "life":
      lifeTrips.value = m.trips;
      lifeRests.value = m.rests;
      lifeTraffic.value = m.traffic;
      lifeLights.value = m.lights;
      break;
    case "resetDone":
      location.reload();
      break;
    case "error":
      console.error("sim worker:", m.message);
      break;
  }
}

// The worker died: the town is gone and the page says so. A later load may bring it back.
function onWorkerError(error: ErrorEvent): void {
  console.error("sim worker:", error.message);
  worker?.terminate();
  worker = null;
  batch(() => {
    loadFailure.value = "unavailable";
    speed.value = 0;
    city.value = null;
    frame.value = null;
    state.value = null;
  });
  for (const done of pending.values()) done({ ok: false, reason: L("Поселение недоступно", "Settlement unavailable") });
  for (const done of queries.values()) done(null);
  pending.clear();
  queries.clear();
}

export function load(): void {
  if (import.meta.env.VITE_PLATFORM === "crazygames") {
    const storage = platform.saveStorage;
    if (!storage) {
      loadFailure.value = "unavailable";
      return;
    }
    const { port1, port2 } = new MessageChannel();
    serveSaveStorage(port1, storage);
    simWorker().postMessage({ t: "load", legacy: null, now: Date.now(), savePort: port2 } satisfies ToWorker, [port2]);
    return;
  }

  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    // ignore
  }
  send({ t: "load", legacy, now: Date.now() });
}

export function downloadUnreadableSave(): void {
  const data = typeof unreadableSave === "string" ? unreadableSave : JSON.stringify(unreadableSave);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "rebirth-save.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function found(c: City, elevation?: number): void {
  if (!loaded.peek() || loadFailure.peek() || city.peek() || foundPending.peek()) return;
  foundFailed.value = false;
  foundPending.value = true;
  send({ t: "found", city: c, now: Date.now(), elevation });
}

export const flush = () => send({ t: "flush" });
export const reset = () => {
  resetFailed.value = false;
  send({ t: "reset" });
};

export function setSpeed(v: Speed): void {
  const s = state.peek();
  const was = speed.peek();
  if (was === v) return;
  const now = Date.now();
  batch(() => {
    if (s) {
      const done = was === 0
        ? (frozen?.at === s.gameMinutes ? (frozen.clock - s.gameMinutes) / BASE_TICK : 0)
        : tickFraction(s.gameMinutes, s.realTime, now, { speed: was, offline: false });
      if (v === 0) frozen = { at: s.gameMinutes, clock: s.gameMinutes + done * BASE_TICK };
      else {
        // Mirror the worker's anchor until its next snapshot arrives.
        state.value = { ...s, realTime: now - done * tickMs(s.gameMinutes, { speed: v, offline: false }) };
        frozen = null;
      }
    }
    speed.value = v;
  });
  send({ t: "speed", speed: v, now });
}

document.addEventListener("visibilitychange", () => {
  const hidden = document.visibilityState === "hidden";
  send({ t: "visibility", hidden, now: Date.now() });
  if (hidden) flush();
});
addEventListener("pagehide", flush);
