import { lang } from "./i18n";
import { computed, effect, signal } from "@preact/signals";
import type { Light, Rest, Trip } from "./map/life";
import { BASE_TICK, clockAt, tickMs, type Speed } from "./sim/clock";
import { applyDelta } from "./sim/delta";
import type { Cmd, CmdResult, FromWorker, ToWorker } from "./sim/protocol";
import type { BuildingQuery, City, ClientState, ResidentQuery } from "./sim/types";
import { makeFrame } from "./world/frame";

const LEGACY_KEY = "rebirth.save";

export const city = signal<City | null>(null);
export const state = signal<ClientState | null>(null);
export const roads = computed(() => state.value?.roads ?? null);
export const zones = computed(() => state.value?.zones ?? null);
export const buildings = computed(() => state.value?.buildings ?? null);
// Changes only when buildings appear or vanish (lots never move), not on every construction tick.
export const buildingSet = computed(() => Object.keys(state.value?.buildings ?? {}).join(","));
export const frame = computed(() => (city.value ? makeFrame(city.value.lat, city.value.lng) : null));
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

// Visual life of the current game day (cosmetic, from the worker; see PLAN.md section 10).
export const lifeTrips = signal<Trip[]>([]);
export const lifeRests = signal<Rest[]>([]);
export const lifeTraffic = signal<Record<number, number>>({});
export const lifeLights = signal<Light[]>([]);
// Game speed of this session (0 = paused); not saved, 1x after every load.
export const speed = signal<Speed>(1);
// Game minutes, interpolated between snapshots and refreshed every 2 s for the life layer.
export const gameClock = signal(0);
const syncClock = () => {
  const s = state.peek();
  if (s) gameClock.value = clockAt(s.gameMinutes, s.realTime, Date.now(), speed.peek());
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
  return s ? clockAt(s.gameMinutes, s.realTime, Date.now(), speed.peek()) : gameClock.peek();
};

const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module", name: lang }); // the worker reads its language from its name (i18n.ts)
const send = (msg: ToWorker) => worker.postMessage(msg);

let nextCmdId = 1;
const pending = new Map<number, (r: CmdResult) => void>();

export function sendCmd(cmd: Cmd): Promise<CmdResult> {
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

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  switch (m.t) {
    case "loaded":
      if (m.migrated) {
        try {
          localStorage.removeItem(LEGACY_KEY); // only after the v4 copy is persisted
        } catch {
          // storage unavailable: nothing to clean up
        }
      }
      speed.value = 1; // the worker starts every town at 1x
      city.value = m.save?.city ?? null;
      state.value = m.save?.sim ?? null;
      loaded.value = true;
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
      done?.({ ok: m.ok, reason: m.reason });
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
};

export function load(): void {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    // ignore
  }
  send({ t: "load", legacy, now: Date.now() });
}

export const found = (c: City) => send({ t: "found", city: c, now: Date.now() });
export const reset = () => send({ t: "reset" });

export function setSpeed(v: Speed): void {
  speed.value = v;
  send({ t: "speed", speed: v, now: Date.now() });
}

document.addEventListener("visibilitychange", () => {
  const hidden = document.visibilityState === "hidden";
  send({ t: "visibility", hidden, now: Date.now() });
  if (hidden) send({ t: "flush" });
});
addEventListener("pagehide", () => send({ t: "flush" }));
