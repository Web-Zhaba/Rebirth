import { calendar } from "../sim/clock";
import { WORK_END, WORK_START, WORKERS } from "../sim/roads";
import type { City } from "../sim/types";
import { reset, roads, zones } from "../simClient";
import { useGameMinutes } from "./useGameMinutes";

const SEASON_RU = ["Весна", "Лето", "Осень", "Зима"];
const plural = (n: number) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "участков";
  return n % 10 === 1 ? "участок" : n % 10 >= 2 && n % 10 <= 4 ? "участка" : "участков";
};
const pad = (n: number) => String(n).padStart(2, "0");

export function Hud({ city }: { city: City }) {
  const cal = calendar(useGameMinutes());
  const onReset = () => {
    if (confirm("Удалить поселение и начать заново?")) reset();
  };
  const g = roads.value;
  let queue = 0;
  let remaining = 0;
  if (g) {
    for (const e of Object.values(g.edges)) {
      if (e.done < e.labor) {
        queue++;
        remaining += e.labor - e.done;
      }
    }
  }
  const z = zones.value;
  let res = 0;
  let craft = 0;
  let trade = 0;
  let fieldArea = 0;
  if (z) {
    for (const c of z.cells) {
      if (c.block) continue;
      if (c.zone === "res") res++;
      else if (c.zone === "craft") craft++;
      else if (c.zone === "trade") trade++;
    }
    for (const f of z.fields) fieldArea += f.area;
  }
  const ga = (fieldArea / 10000).toFixed(1).replace(".", ",");
  return (
    <div class="hud panel">
      <div class="hud-name">{city.name}</div>
      <div class="hud-date">
        Год {cal.year} · {SEASON_RU[cal.season]}, день {cal.dayOfSeason} · {pad(cal.hour)}:{pad(cal.minute)}
      </div>
      <div class="hud-date">
        Строители: {WORKERS} · работают {pad(WORK_START)}–{pad(WORK_END)}
      </div>
      <div class="hud-date">
        Зоны: жильё {res} · ремесло {craft} · торговля {trade} · поля {ga} га
      </div>
      {queue > 0 && (
        <div class="hud-date">
          В очереди: {queue} {plural(queue)} · ~{Math.ceil(remaining / WORKERS)} ч работы
        </div>
      )}
      <button class="link" onClick={onReset}>
        Начать заново
      </button>
    </div>
  );
}
