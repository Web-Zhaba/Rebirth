import { signal } from "@preact/signals";
import type { Away, FromWorker, ToWorker } from "./sim/protocol";
import type { City, SimState } from "./sim/types";

const LEGACY_KEY = "rebirth.save";

export const city = signal<City | null>(null);
export const sim = signal<SimState | null>(null);
export const away = signal<Away | null>(null);

const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => worker.postMessage(msg);

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
      sim.value = m.save?.sim ?? null;
      away.value = m.away;
      break;
    case "snapshot":
      sim.value = m.sim;
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") send({ t: "flush" });
});
addEventListener("pagehide", () => send({ t: "flush" }));
