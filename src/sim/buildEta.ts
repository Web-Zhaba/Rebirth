import { BASE_TICK, tickMs, type Speed } from "./clock";
import { calendar } from "./time";
import { WORK_END, WORK_START } from "./roads";

const MAX_DAYS = 60;

// Real milliseconds until `personHours` of work are done by `hands` builders, starting at `gameMinutes` and
// running at `speed`. Builders work between WORK_START and WORK_END only; real time per game minute follows
// tickMs (so night passes faster). Infinity when paused, nobody builds, or the job is beyond MAX_DAYS.
export function etaRealMs(personHours: number, hands: number, gameMinutes: number, speed: Speed): number {
  if (personHours <= 0) return 0;
  if (speed === 0 || hands <= 0) return Infinity;
  let left = personHours;
  let real = 0;
  let gm = gameMinutes;
  const perHour = hands; // person-hours done in one working hour
  for (let i = 0; i < MAX_DAYS * 24 * 6; i++) {
    const h = calendar(gm).hour;
    const msPerMin = tickMs(gm, { speed, offline: false }) / BASE_TICK;
    const step = 10; // game minutes
    if (h >= WORK_START && h < WORK_END) {
      const done = (perHour * step) / 60;
      if (done >= left) return real + (left / done) * step * msPerMin;
      left -= done;
    }
    real += step * msPerMin;
    gm += step;
  }
  return Infinity;
}

// "~3 мин", "~40 с", "~2 ч".
export function formatReal(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 90) return `~${s} с`;
  const m = Math.round(s / 60);
  if (m < 90) return `~${m} мин`;
  return `~${Math.round((m / 60) * 10) / 10} ч`.replace(".", ",");
}
