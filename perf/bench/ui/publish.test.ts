// How often a snapshot reaches the main thread, and what that turns into per second.
// Run: npx vitest run perf/bench/ui/publish.test.ts --reporter=verbose
import { it } from "vitest";
import { POLL_MS, BASE_TICK } from "../../../src/sim/clock";
import { buildTown, STEP_MS } from "./town";

const keysOf = (d: unknown): string[] => Object.keys(d as Record<string, unknown>);
const bytesOf = (d: unknown): number => JSON.stringify(d).length;

it("snapshot publication: how many messages a second, and how big", async () => {
  const town = await buildTown({ road: 800, days: 6, housePasses: 1 });
  console.log(`POLL_MS = ${POLL_MS} ms, LIVE_MS_PER_GAME_MINUTE = 250 (src/sim/clock.ts:35-38): a game tick of BASE_TICK = ${BASE_TICK} game minutes falls due every 2500 ms at 1× (625 ms at 4×, and 4× faster still at night); only a poll that walked the clock over a tick posts a snapshot (src/sim/handler.ts:540-545). Each harness call below is one worker poll.`);
  for (const speed of [1, 2, 4] as const) {
    await town.h.handle({ t: "speed", speed, now: town.now });
    const ticks = Math.round((100 * 1000) / POLL_MS); // a worker poll every POLL_MS, for 100 s of play
    const before = town.st.gameMinutes;
    const deltas = town.ticks(ticks, POLL_MS) as { sim?: { patch?: unknown }; zones?: unknown; chronicle?: unknown; finds?: unknown; articles?: unknown }[];
    const withSim = deltas.filter((d) => d.sim && Object.keys(d.sim).length > 2);
    const patched = deltas.filter((d) => d.sim?.patch);
    const sizes = deltas.map(bytesOf).sort((a, b) => a - b);
    const seconds = (ticks * POLL_MS) / 1000;
    const keySets = new Map<string, number>();
    for (const d of deltas) {
      const k = keysOf(d.sim ?? {}).sort().slice(0, 8).join("+");
      keySets.set(k, (keySets.get(k) ?? 0) + 1);
    }
    console.log(`\nspeed ${speed}×, ${seconds.toFixed(0)} s of play, ${ticks} worker ticks:`);
    console.log(`  worker polls: ${ticks} (every POLL_MS = 250 ms); messages posted: ${deltas.length} (${(deltas.length / seconds).toFixed(2)}/s)`);
    console.log(`  with more than the clock: ${withSim.length} (${(withSim.length / seconds).toFixed(2)}/s), of them a buildings/edges patch: ${patched.length}`);
    console.log(`  message bytes: median ${sizes[sizes.length >> 1]}, p90 ${sizes[Math.floor(sizes.length * 0.9)]}, max ${sizes[sizes.length - 1]}`);
    const perSec = (town.st.gameMinutes - before) / seconds;
    console.log(`  game minutes per real second: ${perSec.toFixed(2)} → a game minute every ${(1000 / perSec).toFixed(0)} ms, a game day every ${(1440 / perSec).toFixed(0)} s; the clock's leaves (src/ui/Clock.tsx) re-render whenever the whole minute changes: ${Math.min(60, Math.round(perSec)).toFixed(0)}×/s (capped by the 60 fps frame loop) — TopBar itself only on a snapshot`);
    console.log(`  payload keys, most common: ${[...keySets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n}× ${k || "(clock only)"}`).join("; ")}`);
  }
}, 300000);
