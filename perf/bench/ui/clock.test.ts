// The clock: how often the top bar re-rendered on a new game minute before the fix (perf/reports/ui.md §4, the largest
// HUD subtree) and what is left of that after it, plus the bar's own per-render work, so the two can be compared on one
// machine in one process. No DOM here: the frame loop is simulated with the real clock functions.
// Run: npx vitest run --config vitest.perf.config.ts perf/bench/ui/clock.test.ts --reporter=verbose
import { it } from "vitest";
import { BASE_TICK, calendar, clockAt, isNight, type Speed, tickMs } from "../../../src/sim/clock";
import { clockFace } from "../../../src/ui/clockFace";
import { deltaDir, dayPhase, foodNet, pad, perDay, tons } from "../../../src/ui/topbarModel";
import { weatherChip } from "../../../src/ui/weatherModel";
import { researchStatusView } from "../../../src/ui/researchStatusModel";
import { loadFixture, time } from "./fixture";

const FRAME_MS = 1000 / 60;
const SECONDS = 20;

// One snapshot as the worker posts it: the game minutes of the tick and the real time it fell due. A frame between two
// ticks reads the clock interpolated from them, exactly as simClient.gameNow does.
interface Snap {
  gameMinutes: number;
  realTime: number;
}

// Frames of `SECONDS` at 60 fps: how many times the floor of the clock changes (a re-render of the old top bar), and how
// many snapshots arrive in that time.
function run(speed: Speed, startMinute: number): { minutes: number; snapshots: number } {
  let snap: Snap = { gameMinutes: startMinute, realTime: 0 };
  const ms = tickMs(startMinute, { speed, offline: false });
  let shown = Math.floor(clockAt(snap.gameMinutes, snap.realTime, 0, speed));
  let minutes = 0;
  let snapshots = 0;
  for (let t = FRAME_MS; t <= SECONDS * 1000; t += FRAME_MS) {
    if (speed > 0 && t - snap.realTime >= ms) {
      snap = { gameMinutes: snap.gameMinutes + BASE_TICK, realTime: t };
      snapshots++;
    }
    const minute = Math.floor(clockAt(snap.gameMinutes, snap.realTime, t, speed));
    if (minute !== shown) {
      minutes++;
      shown = minute;
    }
  }
  return { minutes, snapshots };
}

const NOON = (12 - 6) * 60; // the first day starts at 06:00 (sim/time.ts)
const MIDNIGHT_HOUR = (23 - 6) * 60;

it("the clock: re-renders a second of the top bar, before and after", async () => {
  const f = await loadFixture();
  const eco = f.state.economy;
  // What one render of the old bar ran besides the clock: the models it calls (§2 of the report, ~0.01 ms in total).
  const barModels = () => {
    const cal = calendar(NOON);
    dayPhase(cal.hour);
    pad(cal.hour);
    weatherChip(f.state.weather, cal.season, eco);
    foodNet(eco);
    perDay(21, "kg");
    deltaDir(-3);
    tons(1600);
    researchStatusView("Земледелие", 0.42, []);
  };
  const bar = time("the bar's models, once", barModels, { samples: 21 }).median;
  const face = time("clockFace, once", () => clockFace(NOON), { samples: 21 }).median;

  console.log("\nspeed  when        game min/s  bar re-renders/s   bar models ms/s");
  console.log("                              before    after    before    after");
  for (const speed of [0, 1, 2, 4] as Speed[]) {
    for (const [when, start] of [["day", NOON], ["night", MIDNIGHT_HOUR]] as [string, number][]) {
      const r = run(speed, start);
      const night = isNight(start) && speed > 0 ? " (×4)" : "";
      const before = r.minutes / SECONDS; // before: a re-render per new minute, whatever the snapshot rate
      const after = r.snapshots / SECONDS; // after: the bar itself follows the snapshots only
      console.log(
        `${String(speed + "×").padEnd(7)}${(when + night).padEnd(12)}${before.toFixed(1).padStart(10)}` +
          `${before.toFixed(1).padStart(11)}${after.toFixed(2).padStart(8)}${(before * bar).toFixed(3).padStart(11)}${(after * bar).toFixed(3).padStart(9)}`,
      );
    }
  }
  // The JS inside one bar render was never the cost; the diff of its subtree is, and that needs a DOM this harness has
  // not got. So the win is counted in renders, not milliseconds.
  console.log(`\none render of the bar's models ${bar.toFixed(4)} ms, one clockFace ${face.toFixed(5)} ms: a minute now costs` +
    `\nthe clock's three leaves (${(3 * face).toFixed(5)} ms) instead of a whole bar render, and the bar keeps to its` +
    `\nsnapshot renders. What is saved per second is that many diffs of the largest HUD subtree.`);
}, 300000);
