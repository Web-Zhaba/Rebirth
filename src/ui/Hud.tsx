import type maplibregl from "maplibre-gl";
import { useEffect } from "preact/hooks";
import { calendar, isNight, NIGHT_BOOST, type Speed } from "../sim/clock";
import { cutOffEdges, WORK_END, WORK_START } from "../sim/roads";
import type { City } from "../sim/types";
import { SERVICE_LIST } from "../sim/services";
import { OVERLAYS, overlay, tool, ZONE_COLORS, type Overlay } from "../map/tools";
import { economy, events, people, reset, roads, services, setSpeed, speed, stock, zones } from "../simClient";
import { useGameMinutes } from "./useGameMinutes";

const SEASON_RU = ["Весна", "Лето", "Осень", "Зима"];
const plural = (n: number) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "участков";
  return n % 10 === 1 ? "участок" : n % 10 >= 2 && n % 10 <= 4 ? "участка" : "участков";
};
// Tons with one decimal, comma as the separator: 1600 -> "1,6", 33000 -> "33".
const tons = (kg: number) => (Math.round(kg / 100) / 10).toString().replace(".", ",");
const amount = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace(".", ",");
const LOW_FOOD_DAYS = 30;
const pad = (n: number) => String(n).padStart(2, "0");
const SPEEDS: { v: Speed; label: string; key: string }[] = [
  { v: 0, label: "Пауза", key: "P" },
  { v: 1, label: "1×", key: "1" },
  { v: 2, label: "2×", key: "2" },
  { v: 4, label: "4×", key: "3" },
];
const KEY_SPEED: Record<string, Speed> = { "1": 1, "2": 2, "3": 4 };

// 1/2/3 pick a speed, P pauses; Space too, unless a map tool is active (the zone brush pans with Space).
function onSpeedKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const el = e.target as HTMLElement | null;
  if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
  const toggle = () => setSpeed(speed.peek() === 0 ? 1 : 0);
  if (e.key in KEY_SPEED) setSpeed(KEY_SPEED[e.key]);
  else if (e.key === "p" || e.key === "P") toggle();
  else if (e.key === " " && tool.value === null && !(el && ["BUTTON", "A", "SUMMARY"].includes(el.tagName))) toggle();
  else return;
  e.preventDefault();
}

export function Hud({ city, map }: { city: City; map: maplibregl.Map }) {
  const gm = useGameMinutes();
  const cal = calendar(gm);
  useEffect(() => {
    window.addEventListener("keydown", onSpeedKey);
    return () => window.removeEventListener("keydown", onSpeedKey);
  }, []);
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
  const st = stock.value;
  const eco = economy.value;
  const sv = services.value;
  let fieldLine: string | null = null;
  if (eco && eco.fields.assignedHa > 0) {
    if (eco.fields.window === "sowing") fieldLine = `Сев: ${Math.round(eco.fields.sown * 100)} %`;
    else if (eco.fields.window === "harvest") fieldLine = `Жатва: ${tons(eco.fields.reaped)} из ${tons(eco.fields.expected)} т`;
  }
  const ga = (fieldArea / 10000).toFixed(1).replace(".", ",");
  return (
    <div class="hud panel">
      <div class="hud-name">{city.name}</div>
      <div class="hud-date">
        Год {cal.year} · {SEASON_RU[cal.season]}, день {cal.dayOfSeason} · {pad(cal.hour)}:{pad(cal.minute)}
      </div>
      <div class="speed" role="group" aria-label="Скорость времени">
        {SPEEDS.map((s) => (
          <button key={s.v} type="button" aria-pressed={speed.value === s.v} title={`Клавиша ${s.key}`} onClick={() => setSpeed(s.v)}>
            {s.label}
          </button>
        ))}
        {speed.value > 0 && isNight(gm) && <span class="speed-note">ночь ×{NIGHT_BOOST}</span>}
      </div>
      {p && (
        <>
          <div class="hud-date">
            Население: {p.pop} · семей {p.households} · в палатках {p.tents}
          </div>
          <div class="hud-date">
            Работают: {p.employed} · на стройке: {p.builders} · без работы: {p.unemployed}
          </div>
        </>
      )}
      {st && eco && (
        <div class="stock">
          <div class={eco.foodDays < LOW_FOOD_DAYS && eco.foodPerDay > 0 ? "hud-date stock-low" : "hud-date"}>
            Провизия {tons(st.food)} из {tons(eco.foodCap)} т
            {eco.foodPerDay > 0 && ` · на ${eco.foodDays >= 999 ? "999+" : Math.floor(eco.foodDays)} дн.`}
            {eco.forage > 0 && ` · собирают +${amount(eco.forage)} кг/день`}
            {eco.foodPerDay > 0 && eco.outlook < 1 && (
              <span class="stock-low" title="Запасов и одного урожая не хватит на год вперёд: приезжих меньше"> · на год не хватит</span>
            )}
          </div>
          <div class="hud-date">
            Брёвна {amount(st.logs)} м³ · доски {amount(st.planks)} м³ · камень {amount(st.stone)} т · утварь {Math.floor(st.wares)} шт
          </div>
          {fieldLine && <div class="hud-date">{fieldLine}</div>}
          {eco.avgMood > 0 && <div class="hud-date">Настроение: {Math.round(eco.avgMood)}</div>}
        </div>
      )}
      {sv && sv.houses > 0 && (
        <div class="hud-date">
          Грамотные: {Math.round(sv.literate * 100)} % · земля: {Math.round(sv.avgLandValue)}
          {sv.level2 > 0 && ` · дома 2-го уровня: ${sv.level2}`}
        </div>
      )}
      <label class="layers">
        Слои
        <select value={overlay.value} onChange={(e) => (overlay.value = (e.currentTarget as HTMLSelectElement).value as Overlay)}>
          {OVERLAYS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {overlay.value === "traffic" && (
        <div class="traffic-legend" title="Жителей в день на участке дороги">
          <span>мало</span>
          <span class="traffic-ramp" />
          <span>много</span>
        </div>
      )}
      <details class="hud-more">
        <summary>Подробнее</summary>
        {p && (
          <div class="hud-date">
            Дорога на работу: {p.employed > 0 ? `~${Math.round(p.avgCommute)} мин` : "—"} · стройка {pad(WORK_START)}–{pad(WORK_END)}
          </div>
        )}
        {sv && sv.houses > 0 && (
          <div class="hud-date">
            Охват домов (из {sv.houses}): {SERVICE_LIST.map((s) => `${s.name.toLowerCase()} ${sv.covered[s.id]}`).join(" · ")}
          </div>
        )}
        <div class="hud-date">
          Зоны: жильё {res} · ремесло {craft} · торговля {trade} · поля {ga} га
        </div>
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
      </details>
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
