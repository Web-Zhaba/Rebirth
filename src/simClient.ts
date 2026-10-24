import { computed, signal } from "@preact/signals";
import type { Away, Cmd, CmdResult, FromWorker, ToWorker } from "./sim/protocol";
import type { BuildingQuery, City, ClientState } from "./sim/types";
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
export const events = computed(() => state.value?.events ?? []);
export const away = signal<Away | null>(null);

const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
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

const queries = new Map<number, (d: BuildingQuery | null) => void>();

// Who lives in / works at a building; null when it does not exist (any more).
export function queryBuilding(id: number): Promise<BuildingQuery | null> {
  return new Promise((resolve) => {
    const qid = nextCmdId++;
    queries.set(qid, resolve);
    send({ t: "query", id: qid, q: { type: "building", id } });
  });
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  switch (m.t) {
    case "loaded":
      if (m.migrated) {
        try {
          localStorage.removeItem(LEGACY_KEY); // only after the v3 copy is persisted
        } catch {
          // storage unavailable: nothing to clean up
        }
      }
      city.value = m.save?.city ?? null;
      state.value = m.save?.sim ?? null;
      away.value = m.away;
      break;
    case "snapshot": {
      // Zones ride along only when they changed; otherwise keep the ones we have.
      const z = m.zones ?? state.value?.zones;
      if (z) state.value = { ...m.sim, zones: z };
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") send({ t: "flush" });
});
addEventListener("pagehide", () => send({ t: "flush" }));
