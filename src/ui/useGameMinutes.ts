import { useEffect, useState } from "preact/hooks";
import { gameNow, speed, state } from "../simClient";

const now = (): number => (state.peek() ? gameNow() : 0);

// Game minutes interpolated between snapshots. Checked every frame and re-rendered on each new whole minute, so at any
// speed the clock steps minute by minute instead of a fixed number of minutes per refresh.
export function useGameMinutes(): number {
  const [minute, setMinute] = useState(() => Math.floor(now()));
  useEffect(() => {
    let id = 0;
    const frame = () => {
      setMinute(Math.floor(now()));
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, []);
  void state.value; // re-render on a new snapshot or speed too (a load, a pause)
  void speed.value;
  return Math.max(minute, Math.floor(now()));
}
