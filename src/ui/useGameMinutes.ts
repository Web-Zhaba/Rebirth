import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import { gameNow, state } from "../simClient";

const now = (): number => (state.peek() ? gameNow() : 0);

// The game minute, interpolated between snapshots, as one signal for the clock's own leaves: they re-render on a new
// whole minute and the top bar around them does not (perf/reports/ui.md measured 7-22 re-renders a second of the largest
// HUD subtree). Checked every frame, so at any speed the clock steps minute by minute instead of a fixed number of
// minutes per refresh.
export const gameMinute = signal(0);

// One rAF loop for all subscribers, stopped when the last of them unmounts.
let watchers = 0;
let frame = 0;
const tick = (): void => {
  // Read fresh each frame: a load, a pause (the clock freezes in simClient) or a new speed shows on the next frame.
  gameMinute.value = Math.floor(now());
  frame = requestAnimationFrame(tick);
};

export function useGameMinutes(): number {
  useEffect(() => {
    if (watchers++ === 0) frame = requestAnimationFrame(tick);
    return () => {
      if (--watchers === 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
  }, []);
  // The loop starts after the first paint, so take the minute from the clock as well: a save loaded into a fresh
  // clock must not show 00:00 for a frame.
  return Math.max(gameMinute.value, Math.floor(now()));
}
