import { L } from "../i18n";
import { SEASON_NAMES } from "../map/seasonPreview";
import { isNight, NIGHT_BOOST } from "../sim/clock";
import { speed } from "../simClient";
import { clockFace } from "./clockFace";
import { Icon } from "./Icon";
import { PHASE_LABEL } from "./topbarModel";
import { useGameMinutes } from "./useGameMinutes";

// The clock's leaves live where the clock is drawn, so only they re-render when a game minute passes and the top bar
// around them keeps to its snapshots (perf/reports/ui.md). Each one subscribes through useGameMinutes: one frame loop.

export function Clock() {
  const face = clockFace(useGameMinutes());
  return (
    <div class="tb-clock" role="group" aria-label={`${L("Время", "Time")} ${face.time}, ${PHASE_LABEL[face.phase]}`}>
      <span class="tb-time" aria-hidden="true">
        <Icon name={face.phase} size={14} class={`phase-${face.phase}`} />
        {face.time}
      </span>
      {/* The day as a ruler: night, morning, day and evening spans, a resin needle at the current minute. */}
      <span class="tb-ruler" aria-hidden="true">
        <i style={{ left: `${face.needle}%` }} />
      </span>
    </div>
  );
}

export function ClockDate() {
  const face = clockFace(useGameMinutes());
  return (
    <div class="city-date">
      {L("Год", "Year")} {face.year} · {SEASON_NAMES[face.season]}, {L("день", "day")} {face.dayOfSeason}
    </div>
  );
}

// «×4» while the night runs faster. While paused the clock stands still, so only running time needs the minute.
export function NightBoost() {
  return speed.value > 0 ? <NightBoostNote /> : null;
}

function NightBoostNote() {
  const minute = useGameMinutes();
  if (!isNight(minute)) return null;
  return (
    <span class="speed-note" title={L("Ночью время идёт быстрее", "Night passes faster")}>
      <Icon name="night" size={12} />×{NIGHT_BOOST}
    </span>
  );
}
