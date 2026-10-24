import { calendar } from "../sim/clock";
import type { City } from "../sim/types";
import { reset } from "../simClient";
import { useGameMinutes } from "./useGameMinutes";

const SEASON_RU = ["Весна", "Лето", "Осень", "Зима"];
const pad = (n: number) => String(n).padStart(2, "0");

export function Hud({ city }: { city: City }) {
  const cal = calendar(useGameMinutes());
  const onReset = () => {
    if (confirm("Удалить поселение и начать заново?")) reset();
  };
  return (
    <div class="hud panel">
      <div class="hud-name">{city.name}</div>
      <div class="hud-date">
        Год {cal.year} · {SEASON_RU[cal.season]}, день {cal.dayOfSeason} · {pad(cal.hour)}:{pad(cal.minute)}
      </div>
      <button class="link" onClick={onReset}>
        Начать заново
      </button>
    </div>
  );
}
