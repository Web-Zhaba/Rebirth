import { calendar, daylight } from "../sim/clock";
import { useGameMinutes } from "./useGameMinutes";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Full-screen overlay: dark blue at night, warm at dawn/dusk, clear by day.
export function NightTint() {
  const cal = calendar(useGameMinutes());
  const hour = cal.hour + cal.minute / 60;
  const d = daylight(hour);
  const night = 1 - d;
  // Warmth peaks mid-transition (d around 0.5).
  const warm = Math.max(0, 1 - Math.abs(d - 0.5) * 2) * (d > 0 && d < 1 ? 1 : 0);
  const r = Math.round(lerp(20, 255, warm));
  const g = Math.round(lerp(40, 150, warm));
  const b = Math.round(lerp(90, 60, warm));
  const alpha = Math.max(night * 0.35, warm * 0.18);
  return <div class="night-tint" style={{ background: `rgba(${r},${g},${b},${alpha.toFixed(3)})` }} />;
}
