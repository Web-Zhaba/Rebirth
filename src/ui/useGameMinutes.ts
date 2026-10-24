import { useEffect, useState } from "preact/hooks";
import { BASE_TICK, MS_PER_GAME_MINUTE } from "../sim/clock";
import { sim } from "../simClient";

// Game minutes interpolated between snapshots, refreshed every second.
export function useGameMinutes(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = sim.value;
  if (!s) return 0;
  const extra = Math.max(0, (Date.now() - s.realTime) / MS_PER_GAME_MINUTE);
  return s.gameMinutes + Math.min(extra, BASE_TICK - 0.001);
}
