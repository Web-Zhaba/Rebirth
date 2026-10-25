import type maplibregl from "maplibre-gl";
import { clearingLogs, isCleared } from "../sim/clearing";
import { calendar } from "../sim/clock";
import { WORK_END, WORK_START } from "../sim/roads";
import { SERVICE_LIST } from "../sim/services";
import type { City } from "../sim/types";
import { massText } from "../sim/units";
import { ZONE_COLORS } from "../map/tools";
import { economy, events, frame, incomingCount, people, reset, roads, services, state, zones } from "../simClient";
import { Icon } from "./Icon";
import { LayerBar } from "./LayerBar";
import { amount, pad, roadQueue } from "./topbarModel";

const plural = (n: number) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "участков";
  return n % 10 === 1 ? "участок" : n % 10 >= 2 && n % 10 <= 4 ? "участка" : "участков";
};
const families = (n: number) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "семей";
  return n % 10 === 1 ? "семья" : n % 10 >= 2 && n % 10 <= 4 ? "семьи" : "семей";
};

// Everything from the old HUD that is not top-bar material. It becomes the town panel in U4.
export function TownPanel({ city, map }: { city: City; map: maplibregl.Map }) {
  const onReset = () => {
    if (confirm("Удалить поселение и начать заново?")) reset();
  };
  const { cut, queue, remaining } = roadQueue(roads.value);
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
  const eco = economy.value;
  const sv = services.value;
  let fieldLine: string | null = null;
  if (eco && eco.fields.assignedHa > 0) {
    if (eco.fields.window === "sowing") fieldLine = `Сев: ${Math.round(eco.fields.sown * 100)} %`;
    else if (eco.fields.window === "harvest") fieldLine = `Жатва: ${massText(eco.fields.reaped)} из ${massText(eco.fields.expected)}`;
  }
  // Clearings in work: share of the labor done and the logs they have given so far.
  const clearing = (state.value?.clearings ?? []).filter((c) => !isCleared(c));
  const clearLabor = clearing.reduce((a, c) => a + c.labor, 0);
  const clearLine =
    clearing.length > 0
      ? `Вырубка: ${Math.floor((clearing.reduce((a, c) => a + c.done, 0) / clearLabor) * 100)} % · брёвна +${amount(clearing.reduce((a, c) => a + (clearingLogs(c.area, c.forest) * c.done) / c.labor, 0))} из ${amount(clearing.reduce((a, c) => a + clearingLogs(c.area, c.forest), 0))} м³`
      : null;
  const ga = (fieldArea / 10000).toFixed(1).replace(".", ",");
  return (
    <div class="town panel">
      <LayerBar />
      {incomingCount.value > 0 && (
        <div class="hud-date">
          в пути: {incomingCount.value} {families(incomingCount.value)}
        </div>
      )}
      {fieldLine && <div class="hud-date">{fieldLine}</div>}
      {clearLine && <div class="hud-date">{clearLine}</div>}
      {sv && sv.houses > 0 && (
        <div class="hud-date">
          Грамотные: {Math.round(sv.literate * 100)} % · земля: {Math.round(sv.avgLandValue)}
          {sv.level2 > 0 && ` · дома 2-го уровня: ${sv.level2}`}
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
          <Icon name="warning" size={16} /> Отрезано от лагеря: {cut.size} {plural(cut.size)} дорог. Их не построят — ведите дорогу от лагеря или от готовой дороги.{" "}
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
          const pos = e.pos;
          const fl = frame.value;
          return (
            <div class="event" key={`${e.at}:${e.text}`}>
              <span class="event-at">
                г{c.year} д{c.dayOfYear}
              </span>{" "}
              {pos && fl ? (
                <button class="link event-go" title="Показать на карте" onClick={() => map.flyTo({ center: fl.toLngLat(pos[0], pos[1]), zoom: Math.max(map.getZoom(), 17) })}>
                  {e.text}
                </button>
              ) : (
                e.text
              )}
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
