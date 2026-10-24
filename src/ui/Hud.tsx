import type maplibregl from "maplibre-gl";
import { calendar } from "../sim/clock";
import { cutOffEdges, WORK_END, WORK_START } from "../sim/roads";
import type { City } from "../sim/types";
import { ZONE_COLORS } from "../map/tools";
import { events, people, reset, roads, zones } from "../simClient";
import { useGameMinutes } from "./useGameMinutes";

const SEASON_RU = ["Весна", "Лето", "Осень", "Зима"];
const plural = (n: number) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "участков";
  return n % 10 === 1 ? "участок" : n % 10 >= 2 && n % 10 <= 4 ? "участка" : "участков";
};
const pad = (n: number) => String(n).padStart(2, "0");

export function Hud({ city, map }: { city: City; map: maplibregl.Map }) {
  const cal = calendar(useGameMinutes());
  const onReset = () => {
    if (confirm("Удалить поселение и начать заново?")) reset();
  };
  const g = roads.value;
  const cut = g ? cutOffEdges(g) : new Set<number>();
  let queue = 0;
  let remaining = 0;
  if (g) {
    for (const e of Object.values(g.edges)) {
      if (e.done < e.labor && !cut.has(e.id)) {
        queue++;
        remaining += e.labor - e.done;
      }
    }
  }
  const p = people.value;
  const dem = p?.demand ?? { res: 0, craft: 0, trade: 0 };
  const recent = events.value.slice(-5).reverse();
  const bars: { label: string; value: number; color: string }[] = [
    { label: "жильё", value: dem.res, color: ZONE_COLORS.res },
    { label: "ремесло", value: dem.craft, color: ZONE_COLORS.craft },
    { label: "торговля", value: dem.trade, color: ZONE_COLORS.trade },
  ];
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
      {p && (
        <>
          <div class="hud-date">
            Население: {p.pop} · семей {p.households} · в палатках {p.tents}
          </div>
          <div class="hud-date">
            Работают: {p.employed} · на стройке: {p.builders} · без работы: {p.unemployed}
          </div>
          <div class="hud-date">
            Дорога на работу: {p.employed > 0 ? `~${Math.round(p.avgCommute)} мин` : "—"} · стройка {pad(WORK_START)}–{pad(WORK_END)}
          </div>
        </>
      )}
      <div class="demand" title="Спрос на новые здания">
        {bars.map((b) => (
          <div class="demand-row" key={b.label}>
            <span class="demand-label">{b.label}</span>
            <span class="demand-track">
              <span class="demand-fill" style={{ width: `${(Math.min(5, Math.max(0, b.value)) / 5) * 100}%`, background: b.color }} />
            </span>
          </div>
        ))}
      </div>
      <div class="hud-date">
        Зоны: жильё {res} · ремесло {craft} · торговля {trade} · поля {ga} га
      </div>
      {queue > 0 && (
        <div class="hud-date">
          В очереди: {queue} {plural(queue)} · {p && p.builders > 0 ? `~${Math.ceil(remaining / p.builders)} ч работы` : "некому строить"}
        </div>
      )}
      {cut.size > 0 && (
        <div class="hud-warn">
          Отрезано от лагеря: {cut.size} {plural(cut.size)} дорог. Их не построят — ведите дорогу от лагеря или от готовой дороги.{" "}
          <button class="link" onClick={() => map.flyTo({ center: [city.lng, city.lat], zoom: Math.max(map.getZoom(), 16) })}>
            К лагерю
          </button>
        </div>
      )}
      <details class="events">
        <summary>События</summary>
        {recent.length === 0 && <div class="hud-date">Пока тихо</div>}
        {recent.map((e) => {
          const c = calendar(e.at);
          return (
            <div class="event" key={`${e.at}:${e.text}`}>
              <span class="event-at">
                г{c.year} д{c.dayOfYear}
              </span>{" "}
              {e.text}
            </div>
          );
        })}
      </details>
      <button class="link" onClick={onReset}>
        Начать заново
      </button>
    </div>
  );
}
