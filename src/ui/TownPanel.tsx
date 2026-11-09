import { signal } from "@preact/signals";
import type { View } from "../view/view";
import { atLeastAsClose, CLOSE_UP_MPP, TOWN_VIEW_MPP } from "../view/scale";
import { useState } from "preact/hooks";
import { clearingLogs, isCleared } from "../sim/clearing";
import { calendar } from "../sim/clock";
import { JOB_GROUPS, JOB_NAMES, type JobKey, type Priority } from "../sim/buildings";
import { CALL, RATIONS, workHours, type Rations } from "../sim/levers";
import { SERVICE_LIST } from "../sim/services";
import { INFLOW } from "../sim/attraction";
import type { City, GrowthWhy, ZoneType } from "../sim/types";
import { massText } from "../sim/units";
import { ZONE_COLORS } from "../map/tools";
import { economy, events, frame, incomingCount, people, reset, roads, services, state, zones } from "../simClient";
import { Icon } from "./Icon";
import { act, Line, plural } from "./InspectorParts";
import { jobNotes, JOB_ICON, PRIORITY_LONG, PRIORITY_SHORT } from "./jobsModel";
import { Button, Confirm, IconButton, ProgressBar, Segmented, Tabs, type TabItem } from "./kit";
import { closePanel, rightPanel } from "./panels";
import { amount, pad, roadQueue } from "./topbarModel";
import { effectLines, weatherReason } from "./weatherModel";
import { tabId, tabPanelId } from "./tabSemantics";
import { SEMANTIC_IDS } from "./semanticIds";
import { decimal, L } from "../i18n";

type Tab = "people" | "work" | "services" | "events" | "orders";

const TABS: TabItem<Tab>[] = [
  { id: "people", label: L("Жители", "People") },
  { id: "work", label: L("Работа", "Work") },
  { id: "services", label: L("Службы", "Services") },
  { id: "events", label: L("События", "Events") },
  { id: "orders", label: L("Приказы", "Orders") },
];

const tab = signal<Tab>("people");

const families = (n: number) => plural(n, "семья", "семьи", "семей", "family", "families");
const PRIORITIES: Priority[] = [0, 1, 2, 3];
const PRIORITY_OPTIONS = PRIORITIES.map((id) => ({ id, label: PRIORITY_SHORT[id], title: PRIORITY_LONG[id] }));

// One job group: workers and places, and the hiring priority. Construction has no places: its priority sets the floor of builders.
function JobRow({ k, text, hint }: { k: JobKey; text: string; hint?: string }) {
  const value = state.value?.levers.jobs?.[k] ?? 2;
  return (
    <div class="job-row">
      <div class="job-head">
        <Icon name={JOB_ICON[k]} size={18} />
        <span>{JOB_NAMES[k]}</span>
        <span class="job-count">{text}</span>
      </div>
      <Segmented options={PRIORITY_OPTIONS} value={value} label={`${L("Приоритет", "Priority")}: ${JOB_NAMES[k].toLowerCase()}`} onChange={(priority) => act({ type: "setJobPriority", group: k, priority })} />
      {hint && <div class="people-note">{hint}</div>}
    </div>
  );
}

// «Работа»: priorities of the job groups and of construction, who is without work and why places stay empty.
function JobsBlock() {
  const p = people.value;
  const r = p?.jobs;
  if (!p || !r) return null;
  const notes = jobNotes(r);
  const drafted = r.drafted > 0 ? L(`, из них ${r.drafted} сняты с работы`, `, ${r.drafted} of them taken off their jobs`) : "";
  const floorHint = !r.construction ? L("Строить пока нечего", "Nothing to build yet") : r.floor > 0 ? L(`Не меньше ${r.floor} ${plural(r.floor, "строителя", "строителей", "строителей")}${drafted}`, `At least ${r.floor} ${plural(r.floor, "", "", "", "builder")}${drafted}`) : L("Строят только те, у кого нет работы", "Only those without jobs build");
  return (
    <div class="rs-list" role="group" aria-label={L("Приоритеты работ", "Work priorities")}>
      {JOB_GROUPS.map((k) => {
        const g = r.groups.find((x) => x.key === k)!;
        return <JobRow key={k} k={k} text={`${g.workers} ${L("из", "of")} ${g.places}${g.open > 0 ? `, ${L("свободно", "open")} ${g.open}` : ""}`} />;
      })}
      <JobRow k="build" text={L(`строителей ${p.builders}`, `builders ${p.builders}`)} hint={floorHint} />
      {notes.map((n) => (
        <div class="people-note" key={n}>
          {n}
        </div>
      ))}
    </div>
  );
}

const RATION_IDS: Rations[] = ["reduced", "normal", "generous"];

// Why a zone type is (not) growing, in words.
const ADVICE: Record<GrowthWhy, string> = {
  ok: L("Растёт", "Growing"),
  nozone: L("Не растёт: нет размеченных участков", "Not growing: no zoned plots"),
  demand: L("Не растёт: нет спроса", "Not growing: no demand"),
  lots: L("Не растёт: нет свободных участков у построенной дороги", "Not growing: no free plots along a built road"),
  hands: L("Не растёт: некому строить", "Not growing: no one to build"),
  materials: L("Растёт медленно: не хватает материалов, часть работы делают вручную", "Growing slowly: short of materials, part of the work is done by hand"),
};

const ZONES: { id: ZoneType; label: string }[] = [
  { id: "res", label: L("Жильё", "Housing") },
  { id: "craft", label: L("Ремесло", "Crafts") },
  { id: "trade", label: L("Торговля", "Trade") },
];

const pct = (v: number) => `${Math.round(v * 100)}${L(" %", "%")}`;

// Why families come, or do not (docs/PLAN-balance.md B6): the score, its parts and the inflow it brings now.
function AttractionBlock() {
  const s = state.value;
  if (!s?.attraction || !s.inflow) return null;
  const a = s.attraction;
  const { free, perDay } = s.inflow;
  const rate = perDay < 0.01 ? L("никто", "no one") : perDay >= 1 ? L(`около ${decimal(perDay.toFixed(1))} семьи в день`, `about ${decimal(perDay.toFixed(1))} families a day`) : L(`одна семья в ${Math.round(1 / perDay)} дн.`, `one family in ${Math.round(1 / perDay)} d`);
  const why = free === 0 ? L("Свободных домов нет: новые семьи не едут", "No free homes: new families do not come") : a.food <= 0 ? L("Еды не хватит до урожая: новые семьи не едут", "The food will not last until the harvest: new families do not come") : null;
  return (
    <>
      <Line label={L("Привлекательность", "Attractiveness")}>{pct(a.score)}</Line>
      <Line label={L("Приезжают", "Arrivals")}>{rate}</Line>
      <div class="people-note">
        {L(
          `Еда до урожая ${pct(a.food)} (умножает остальное) · настроение ${pct(a.mood)} · работа ${pct(a.jobs)} · службы у домов ${pct(a.services)} · свободных домов ${free}`,
          `Food until the harvest ${pct(a.food)} (multiplies the rest) · mood ${pct(a.mood)} · jobs ${pct(a.jobs)} · services at the houses ${pct(a.services)} · free homes ${free}`,
        )}
      </div>
      {why && <div class="prod-warn">{why}</div>}
      <div class="people-note">
        {L(
          `При полной привлекательности и свободных домах: до ${decimal(a.cap.toFixed(1))} семьи в день. С ростом города приток растёт всё медленнее (не больше ${INFLOW.max}), дальше город растёт рождениями.`,
          `At full attractiveness with free homes: up to ${decimal(a.cap.toFixed(1))} families a day. As the town grows the inflow grows ever slower (at most ${INFLOW.max}); beyond that the town grows by births.`,
        )}
      </div>
    </>
  );
}

function PeopleTab() {
  const p = people.value;
  const sv = services.value;
  const eco = economy.value;
  const log = events.value;
  const births = log.filter((e) => e.kind === "birth").length;
  const deaths = log.filter((e) => e.kind === "death").length;
  if (!p) return <div class="people-note">{L("Пока нет данных", "No data yet")}</div>;
  return (
    <div class="rs-list">
      <Line icon="person" label={L("Жителей", "Residents")}>
        {p.pop} ({L("взрослых", "adults")} {p.adults}, {L("детей", "children")} {p.children})
      </Line>
      <Line label={L("Семей", "Families")}>{p.households}</Line>
      {eco?.admin && (
        <Line label={L("Управление", "Administration")}>
          {L(`${eco.admin.pop} из ${Math.round(eco.admin.capacity)} жителей`, `${eco.admin.pop} of ${Math.round(eco.admin.capacity)} residents`)}
          {eco.admin.factor < 1 ? L(` · работа −${Math.round((1 - eco.admin.factor) * 100)} %`, ` · work −${Math.round((1 - eco.admin.factor) * 100)}%`) : ""}
        </Line>
      )}
      {eco?.admin && eco.admin.factor < 1 && <div class="prod-warn">{L("Перегрузка управления: нужна ратуша или районная управа с писарями", "The administration is overloaded: a town hall or a district office with clerks is needed")}</div>}
      <Line icon="tent" label={L("В палатках", "In tents")}>
        {p.tents}
      </Line>
      <Line label={L("В пути", "On the way")}>{incomingCount.value > 0 ? `${incomingCount.value} ${families(incomingCount.value)}` : L("никого", "no one")}</Line>
      <AttractionBlock />
      {sv && sv.houses > 0 && <Line label={L("Грамотные", "Literate")}>{Math.round(sv.literate * 100)}{L(" % взрослых", "% of adults")}</Line>}
      {eco && eco.avgMood > 0 && (
        <Line icon="mood" label={L("Настроение", "Mood")}>
          {Math.round(eco.avgMood)} {L("из", "of")} 100
        </Line>
      )}
      <Line label={L("Сытость", "Food")}>
        {Math.round(p.needs.avg.food)} {L("из", "of")} 100{p.needs.starving > 0 ? ` · ${L("голодают", "starving")} ${p.needs.starving}` : ""}
      </Line>
      <Line label={L("Отдых", "Rest")}>
        {Math.round(p.needs.avg.rest)} {L("из", "of")} 100{p.needs.tired > 0 ? ` · ${L("не высыпаются", "not sleeping enough")} ${p.needs.tired}` : ""}
      </Line>
      <Line label={L("Общение", "Company")}>
        {Math.round(p.needs.avg.social)} {L("из", "of")} 100{p.needs.lonely > 0 ? ` · ${L("одиноки", "lonely")} ${p.needs.lonely}` : ""}
      </Line>
      <Line label={L("Тепло", "Warmth")}>
        {Math.round(p.needs.avg.warmth)} {L("из", "of")} 100{p.needs.freezing > 0 ? ` · ${L("мёрзнут", "freezing")} ${p.needs.freezing}` : ""}
      </Line>
      <Line label={L("Силы к работе", "Fitness for work")}>{Math.round(p.needs.work * 100)}{L(" %", "%")}</Line>
      {sv && sv.houses > 0 && <Line label={L("Земля, в среднем", "Average land value")}>{Math.round(sv.avgLandValue)}</Line>}
      {sv && sv.level2 > 0 && <Line label={L("Дома 2-го уровня", "Level 2 houses")}>{sv.level2}</Line>}
      <Line label={L("Рождений и смертей", "Births and deaths")}>
        {births} {L("и", "and")} {deaths}
      </Line>
      <div class="people-note">{L("Рождения и смерти считаются по последним записям журнала событий.", "Births and deaths are counted from the latest entries of the event log.")}</div>
    </div>
  );
}

// What the weather takes from the town today: the two big factors, fuel and food. Visible without hovering the chip.
function WeatherBlock() {
  const ws = state.value?.weather;
  const lines = effectLines(ws, economy.value);
  if (lines.length === 0) return null;
  const reason = weatherReason(ws);
  return (
    <>
      <h3 class="rs-sub">{L("Погода", "Weather")}</h3>
      <div class="rs-list">
        {lines.map((l) => (
          <Line key={l.key} label={l.label} tone={l.tone}>
            {l.value}
          </Line>
        ))}
        {reason && <div class="people-note">{L("Сейчас:", "Now:")} {reason}</div>}
      </div>
    </>
  );
}

function WorkTab({ city, view }: { city: City; view: View }) {
  const p = people.value;
  const dem = p?.demand ?? { res: 0, craft: 0, trade: 0 };
  const eco = economy.value;
  const z = zones.value;
  const lv = state.value?.levers;
  const { cut, queue, remaining } = roadQueue(roads.value);
  const hours = workHours(lv);
  const cnt = { res: 0, craft: 0, trade: 0 };
  let fieldArea = 0;
  if (z) {
    for (const c of z.cells) if (!c.block && c.zone !== "none") cnt[c.zone]++;
    for (const f of z.fields) fieldArea += f.area;
  }
  let fieldLine: string | null = null;
  if (eco && eco.fields.assignedHa > 0) {
    if (eco.fields.window === "sowing") fieldLine = L(`Сев: ${Math.round(eco.fields.sown * 100)} %`, `Sowing: ${Math.round(eco.fields.sown * 100)}%`);
    else if (eco.fields.window === "harvest") fieldLine = L(`Уборка урожая: ${massText(eco.fields.reaped)} из ${massText(eco.fields.expected)}`, `Harvest: ${massText(eco.fields.reaped)} of ${massText(eco.fields.expected)}`);
  }
  const clearing = (state.value?.clearings ?? []).filter((c) => !isCleared(c));
  const clearLabor = clearing.reduce((a, c) => a + c.labor, 0);
  const clearLine =
    clearing.length > 0
      ? `${Math.floor((clearing.reduce((a, c) => a + c.done, 0) / clearLabor) * 100)}${L(" %, брёвна", "%, logs")} +${amount(clearing.reduce((a, c) => a + (clearingLogs(c.area, c.forest) * c.done) / c.labor, 0))} ${L("из", "of")} ${amount(clearing.reduce((a, c) => a + clearingLogs(c.area, c.forest), 0))} ${L("м³", "m³")}`
      : null;
  if (!p) return <div class="people-note">{L("Пока нет данных", "No data yet")}</div>;
  return (
    <div class="rs-list">
      <JobsBlock />
      <WeatherBlock />
      <h3 class="rs-sub">{L("Занятость", "Employment")}</h3>
      <Line label={L("Работают", "Working")}>{p.employed}</Line>
      <Line label={L("На стройке", "Building")}>{p.builders}</Line>
      <Line label={L("Без работы", "Without work")}>{p.unemployed}</Line>
      {p.inClass > 0 && <Line label={L("В школе", "At school")}>{p.inClass}</Line>}
      <Line label={L("Дорога на работу", "Commute")}>{p.employed > 0 ? `~${Math.round(p.avgCommute)} ${L("мин", "min")}` : "—"}</Line>
      <Line label={L("Рабочий день", "Workday")}>
        {pad(hours.start)}–{pad(hours.end)}
      </Line>
      {queue > 0 && (
        <Line label={L("Дороги в очереди", "Roads queued")}>
          {queue} {plural(queue, "участок", "участка", "участков", "section")}, {p.builders > 0 ? L(`~${Math.ceil(remaining / p.builders)} ч работы`, `~${Math.ceil(remaining / p.builders)} h of work`) : L("некому строить", "no one to build")}
        </Line>
      )}
      {fieldLine && <Line icon="field" label={L("Поля", "Fields")}>{fieldLine}</Line>}
      {clearLine && <Line icon="clearing" label={L("Вырубка", "Clearing")}>{clearLine}</Line>}
      {cut.size > 0 && (
        <div class="hud-warn rs-warn">
          <Icon name="warning" size={16} /> {L("Отрезано от лагеря:", "Cut off from the camp:")} {cut.size} {plural(cut.size, "участок", "участка", "участков", "road section")}{L(" дорог. Их не построят: ведите дорогу от лагеря или от готовой дороги.", ". They won’t be built: lead a road from the camp or from a finished road.")}{" "}
          <button type="button" class="link" onClick={() => view.flyTo({ center: [city.lng, city.lat], mpp: atLeastAsClose(view.metersPerPixel(), TOWN_VIEW_MPP) })}>
            {L("К лагерю", "To the camp")}
          </button>
        </div>
      )}
      <h3 class="rs-sub">{L("Спрос на новые здания", "Demand for new buildings")}</h3>
      {ZONES.map((zn) => (
        <div class="demand-card" key={zn.id}>
          <div class="demand-head">
            <span class="demand-sw" style={{ background: ZONE_COLORS[zn.id] }} />
            <span>{zn.label}</span>
            <span class="demand-count">{cnt[zn.id]} {L("яч.", "cells")}</span>
          </div>
          <ProgressBar value={Math.min(5, Math.max(0, dem[zn.id])) / 5} label={`${L("Спрос", "Demand")}: ${zn.label.toLowerCase()}`} />
          <div class={p.growth?.[zn.id] && p.growth[zn.id] !== "ok" ? "prod-warn" : "people-note"}>{ADVICE[p.growth?.[zn.id] ?? "ok"]}</div>
        </div>
      ))}
      <div class="people-note">{L("Поля:", "Fields:")} {decimal((fieldArea / 10000).toFixed(1))} {L("га", "ha")}</div>
    </div>
  );
}

function ServicesTab() {
  const sv = services.value;
  if (!sv || sv.houses === 0) return <div class="people-note">{L("Служб пока нет: когда построят дома, здесь появится охват.", "No services yet: coverage will show here once houses are built.")}</div>;
  return (
    <div class="rs-list">
      <div class="people-note">{L("Дома в охвате (из", "Houses covered (of")} {sv.houses})</div>
      {SERVICE_LIST.map((s) => (
        <div class="demand-card" key={s.id}>
          <Line label={s.name}>
            {sv.covered[s.id]} {L("из", "of")} {sv.houses}
          </Line>
          <ProgressBar value={sv.houses > 0 ? sv.covered[s.id] / sv.houses : 0} label={`${L("Охват", "Coverage")}: ${s.name.toLowerCase()}`} />
        </div>
      ))}
      <Line label={L("Грамотные", "Literate")}>{Math.round(sv.literate * 100)}{L(" % взрослых", "% of adults")}</Line>
    </div>
  );
}

function EventsTab({ view }: { view: View }) {
  const list = events.value.slice().reverse();
  const fl = frame.value;
  if (list.length === 0) return <div class="people-note">{L("Пока тихо", "All quiet so far")}</div>;
  return (
    <ul class="rs-events">
      {list.map((e) => {
        const c = calendar(e.at);
        const pos = e.pos;
        return (
          <li key={`${e.at}:${e.text}`}>
            <span class="event-at">
              {L("г", "Y")}{c.year} {L("д", "D")}{c.dayOfYear}
            </span>{" "}
            {pos && fl ? (
              <button type="button" class="link event-go" title={L("Показать на карте", "Show on the map")} onClick={() => view.flyTo({ center: fl.toLngLat(pos[0], pos[1]), mpp: atLeastAsClose(view.metersPerPixel(), CLOSE_UP_MPP) })}>
                {e.text}
              </button>
            ) : (
              e.text
            )}
          </li>
        );
      })}
    </ul>
  );
}

// «Распоряжения»: workday schedule, rations and a call for settlers; then the restart.
function OrdersTab() {
  const [confirming, setConfirming] = useState(false);
  const s = state.value;
  const lv = s?.levers;
  if (!s || !lv) return null;
  const block = s.callBlock;
  return (
    <div class="rs-list orders" role="group" aria-label={L("Приказы", "Orders")}>
      <div class="orders-row">
        <Button
          aria-label={L("Долгий день", "Long day")}
          aria-pressed={lv.strada}
          variant={lv.strada ? "primary" : "default"}
          title={L("Работа с 05 до 21 часа: на треть больше труда, но настроение ниже на 8", "Work from 05:00 to 21:00: a third more labour, but mood is 8 lower")}
          onClick={() => act({ type: "setSchedule", strada: !lv.strada })}
        >
          {lv.strada ? L("Долгий день: до 21:00", "Long day: until 21:00") : L("Обычный день: 07–19", "Normal day: 07–19")}
        </Button>
        <Button
          aria-label={L("Взрослые в школу", "Adults to school")}
          aria-pressed={lv.adultSchool}
          variant={lv.adultSchool ? "primary" : "default"}
          title={L("Неграмотные взрослые ходят в школу вместо работы, пока не выучатся. Места в школах ограничены: 30 на школу, сначала дети", "Illiterate adults go to school instead of work until they learn. School places are limited: 30 per school, children first")}
          onClick={() => act({ type: "setAdultSchool", on: !lv.adultSchool })}
        >
          {lv.adultSchool ? L("Взрослые учатся", "Adults study") : L("Взрослые работают", "Adults work")}
        </Button>
      </div>
      <div class="orders-row" role="radiogroup" aria-label={L("Нормы еды", "Rations")}>
        {RATION_IDS.map((id) => (
          <Button
            key={id}
            role="radio"
            aria-checked={lv.rations === id}
            aria-label={`${L("Нормы еды", "Rations")}: ${RATIONS[id].name.toLowerCase()}`}
            variant={lv.rations === id ? "primary" : "default"}
            title={`${L("Еда", "Food")} ${RATIONS[id].food * 100 - 100 > 0 ? "+" : ""}${Math.round(RATIONS[id].food * 100 - 100)}${L(" %, настроение", "%, mood")} ${RATIONS[id].mood > 0 ? "+" : ""}${RATIONS[id].mood}`}
            onClick={() => act({ type: "setRations", rations: id })}
          >
            {RATIONS[id].name}
          </Button>
        ))}
      </div>
      <div class="orders-row">
        <Button aria-label={L("Призвать поселенцев", "Call settlers")} disabled={block !== null} onClick={() => act({ type: "callSettlers" })}>
          {L("Призвать поселенцев", "Call settlers")}
        </Button>
      </div>
      <div class={block ? "people-note" : "hud-date"}>{block ?? L(`Стоит ${CALL.food} кг еды и ${CALL.goods} шт одежды, посуды или утвари`, `Costs ${CALL.food} kg of food and ${CALL.goods} pieces of clothing, dishes or furnishings`)}</div>
      <div class="rs-danger">
        <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
          {L("Начать заново", "Start over")}
        </Button>
      </div>
      {confirming && (
        <Confirm
          title={L("Начать заново?", "Start over?")}
          okLabel={L("Удалить поселение", "Delete the settlement")}
          onOk={() => {
            setConfirming(false);
            closePanel();
            reset();
          }}
          onCancel={() => setConfirming(false)}
        >
          {L("Поселение и всё, что в нём построено, будет удалено. Вернуть его не получится.", "The settlement and everything built in it will be deleted. It cannot be recovered.")}
        </Confirm>
      )}
    </div>
  );
}

// Town panel (right slot): people, work and demand, services, events and orders.
export function TownPanel({ city, view }: { city: City; view: View }) {
  if (rightPanel.value !== "town") return null;
  return (
    <aside class="rs-panel town-panel panel" id={SEMANTIC_IDS.townPanel} aria-label={L("Город", "Town")}>
      <div class="insp-head">
        <span class="insp-ic">
          <Icon name="town" size={28} />
        </span>
        <div class="insp-title">
          <h2>{city.name}</h2>
          <span class="insp-sub">{L("Город", "Town")}</span>
        </div>
        <IconButton icon="close" size={16} label={L("Закрыть", "Close")} onClick={closePanel} />
      </div>
      <Tabs tabs={TABS} active={tab.value} onChange={(id) => (tab.value = id)} label={L("Разделы города", "Town sections")} idPrefix="town" />
      <div class="rs-body" role="tabpanel" id={tabPanelId("town", tab.value)} aria-labelledby={tabId("town", tab.value)}>
        {tab.value === "people" && <PeopleTab />}
        {tab.value === "work" && <WorkTab city={city} view={view} />}
        {tab.value === "services" && <ServicesTab />}
        {tab.value === "events" && <EventsTab view={view} />}
        {tab.value === "orders" && <OrdersTab />}
      </div>
    </aside>
  );
}
