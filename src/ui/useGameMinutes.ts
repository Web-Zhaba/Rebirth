import { useEffect, useState } from "preact/hooks";
import { clockAt } from "../sim/clock";
import { speed, state } from "../simClient";

// Game minutes interpolated between snapshots, refreshed four times a second.
export function useGameMinutes(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const s = state.value;
  if (!s) return 0;
  return clockAt(s.gameMinutes, s.realTime, Date.now(), speed.value);
}
