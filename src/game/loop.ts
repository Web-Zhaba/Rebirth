// Runtime glue: live ticking, autosave and offline catch-up. All simulation logic stays in sim.ts.
import { OFFLINE_REPORT_MIN_MS } from "./defs";
import { writeSave } from "./save";
import { advanceTo, type EconomyState } from "./sim";
import { city, economy, offlineReport } from "./state";

const TICK_MS = 250;
const AUTOSAVE_MS = 5000;

let started = false;
let savingEnabled = true;

export function saveNow(): void {
  const c = city.value;
  const e = economy.value;
  if (savingEnabled && c && e) writeSave({ version: 2, city: c, economy: e });
}

// After a reset the page reloads; without this the pagehide save would resurrect the old city.
export function stopSaving(): void {
  savingEnabled = false;
}

// Catches a loaded economy up to now and reports what happened while the page was closed.
export function resumeEconomy(saved: EconomyState, now: number): void {
  const after = advanceTo(saved, now);
  economy.value = after;
  const gap = now - saved.time;
  if (gap > OFFLINE_REPORT_MIN_MS) {
    offlineReport.value = {
      ms: gap,
      food: after.food - saved.food,
      wood: after.wood - saved.wood,
      stone: after.stone - saved.stone,
      popDelta: after.pop - saved.pop,
    };
  }
}

export function startLoop(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    const e = economy.value;
    if (!e) return;
    const next = advanceTo(e, Date.now());
    if (next.time !== e.time) economy.value = next;
  }, TICK_MS);
  setInterval(saveNow, AUTOSAVE_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });
  window.addEventListener("pagehide", saveNow);
}
