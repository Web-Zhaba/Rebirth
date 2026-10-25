import { flyOrJump } from "../map/motion";
import { signal } from "@preact/signals";
import type maplibregl from "maplibre-gl";
import { useState } from "preact/hooks";
import { clearingLogs, isCleared } from "../sim/clearing";
import { calendar } from "../sim/clock";
import { JOB_GROUPS, JOB_NAMES, type JobKey, type Priority } from "../sim/buildings";
import { CALL, RATIONS, workHours, type Rations } from "../sim/levers";
import { SERVICE_LIST } from "../sim/services";
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

type Tab = "people" | "work" | "services" | "events" | "orders";

const TABS: TabItem<Tab>[] = [
  { id: "people", label: "Жители" },
  { id: "work", label: "Работа" },
  { id: "services", label: "Службы" },
  { id: "events", label: "События" },
  { id: "orders", label: "Распоряжения" },
];

const tab = signal<Tab>("people");

const families = (n: number) => plural(n, "семья", "семьи", "семей");
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
      <Segmented options={PRIORITY_OPTIONS} value={value} label={`Приоритет: ${JOB_NAMES[k].toLowerCase()}`} onChange={(priority) => act({ type: "setJobPriority", group: k, priority })} />
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
  const drafted = r.drafted > 0 ? `, из них ${r.drafted} сняты с работы` : "";
  const floorHint = !r.construction ? "Строить пока нечего" : r.floor > 0 ? `Не меньше ${r.floor} ${plural(r.floor, "строителя", "строителей", "строителей")}${drafted}` : "Строят только те, у кого нет работы";
  return (
    <div class="rs-list" role="group" aria-label="Приоритеты работ">
      {JOB_GROUPS.map((k) => {
        const g = r.groups.find((x) => x.key === k)!;
        return <JobRow key={k} k={k} text={`${g.workers} из ${g.places}${g.open > 0 ? `, свободно ${g.open}` : ""}`} />;
      })}
      <JobRow k="build" text={`строителей ${p.builders}`} hint={floorHint} />
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
  ok: "Растёт",
  nozone: "Не растёт: нет размеченных участков",
  demand: "Не растёт: нет спроса",
  lots: "Не растёт: нет свободных участков у построенной дороги",
  hands: "Не растёт: некому строить",
  materials: "Растёт медленно: не хватает материалов, часть работы делают вручную",
};

const ZONES: { id: ZoneType; label: string }[] = [
  { id: "res", label: "Жильё" },
  { id: "craft", label: "Ремесло" },
  { id: "trade", label: "Торговля" },
];

function PeopleTab() {
  const p = people.value;
  const sv = services.value;
  const eco = economy.value;
  const log = events.value;
  const births = log.filter((e) => e.kind === "birth").length;
  const deaths = log.filter((e) => e.kind === "death").length;
  if (!p) return <div class="people-note">Пока нет данных</div>;
  return (
    <div class="rs-list">
      <Line icon="person" label="Жителей">
        {p.pop} (взрослых {p.adults}, детей {p.children})
      </Line>
      <Line label="Семей">{p.households}</Line>
      <Line icon="tent" label="В палатках">
        {p.tents}
      </Line>
      <Line label="В пути">{incomingCount.value > 0 ? `${incomingCount.value} ${families(incomingCount.value)}` : "никого"}</Line>
      {sv && sv.houses > 0 && <Line label="Грамотные">{Math.round(sv.literate * 100)} % взрослых</Line>}
      {eco && eco.avgMood > 0 && (
        <Line icon="mood" label="Настроение">
          {Math.round(eco.avgMood)} из 100
        </Line>
      )}
      {sv && sv.houses > 0 && <Line label="Земля, в среднем">{Math.round(sv.avgLandValue)}</Line>}
      {sv && sv.level2 > 0 && <Line label="Дома 2-го уровня">{sv.level2}</Line>}
      <Line label="Рождений и смертей">
        {births} и {deaths}
      </Line>
      <div class="people-note">Рождения и смерти считаются по последним записям журнала событий.</div>
    </div>
  );
}

function WorkTab({ city, map }: { city: City; map: maplibregl.Map }) {
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
    if (eco.fields.window === "sowing") fieldLine = `Сев: ${Math.round(eco.fields.sown * 100)} %`;
    else if (eco.fields.window === "harvest") fieldLine = `Уборка урожая: ${massText(eco.fields.reaped)} из ${massText(eco.fields.expected)}`;
  }
  const clearing = (state.value?.clearings ?? []).filter((c) => !isCleared(c));
  const clearLabor = clearing.reduce((a, c) => a + c.labor, 0);
  const clearLine =
    clearing.length > 0
      ? `${Math.floor((clearing.reduce((a, c) => a + c.done, 0) / clearLabor) * 100)} %, брёвна +${amount(clearing.reduce((a, c) => a + (clearingLogs(c.area, c.forest) * c.done) / c.labor, 0))} из ${amount(clearing.reduce((a, c) => a + clearingLogs(c.area, c.forest), 0))} м³`
      : null;
  if (!p) return <div class="people-note">Пока нет данных</div>;
  return (
    <div class="rs-list">
      <JobsBlock />
      <h3 class="rs-sub">Занятость</h3>
      <Line label="Работают">{p.employed}</Line>
      <Line label="На стройке">{p.builders}</Line>
      <Line label="Без работы">{p.unemployed}</Line>
      <Line label="Дорога на работу">{p.employed > 0 ? `~${Math.round(p.avgCommute)} мин` : "—"}</Line>
      <Line label="Рабочий день">
        {pad(hours.start)}–{pad(hours.end)}
      </Line>
      {queue > 0 && (
        <Line label="Дороги в очереди">
          {queue} {plural(queue, "участок", "участка", "участков")}, {p.builders > 0 ? `~${Math.ceil(remaining / p.builders)} ч работы` : "некому строить"}
        </Line>
      )}
      {fieldLine && <Line icon="field" label="Поля">{fieldLine}</Line>}
      {clearLine && <Line icon="clearing" label="Вырубка">{clearLine}</Line>}
      {cut.size > 0 && (
        <div class="hud-warn rs-warn">
          <Icon name="warning" size={16} /> Отрезано от лагеря: {cut.size} {plural(cut.size, "участок", "участка", "участков")} дорог. Их не построят: ведите дорогу от лагеря или от готовой дороги.{" "}
          <button type="button" class="link" onClick={() => flyOrJump(map, { center: [city.lng, city.lat], zoom: Math.max(map.getZoom(), 16) })}>
            К лагерю
          </button>
        </div>
      )}
      <h3 class="rs-sub">Спрос на новые здания</h3>
      {ZONES.map((zn) => (
        <div class="demand-card" key={zn.id}>
          <div class="demand-head">
            <span class="demand-sw" style={{ background: ZONE_COLORS[zn.id] }} />
            <span>{zn.label}</span>
            <span class="demand-count">{cnt[zn.id]} яч.</span>
          </div>
          <ProgressBar value={Math.min(5, Math.max(0, dem[zn.id])) / 5} label={`Спрос: ${zn.label.toLowerCase()}`} />
          <div class={p.growth?.[zn.id] && p.growth[zn.id] !== "ok" ? "prod-warn" : "people-note"}>{ADVICE[p.growth?.[zn.id] ?? "ok"]}</div>
        </div>
      ))}
      <div class="people-note">Поля: {(fieldArea / 10000).toFixed(1).replace(".", ",")} га</div>
    </div>
  );
}

function ServicesTab() {
  const sv = services.value;
  if (!sv || sv.houses === 0) return <div class="people-note">Служб пока нет: когда построят дома, здесь появится охват.</div>;
  return (
    <div class="rs-list">
      <div class="people-note">Дома в охвате (из {sv.houses})</div>
      {SERVICE_LIST.map((s) => (
        <div class="demand-card" key={s.id}>
          <Line label={s.name}>
            {sv.covered[s.id]} из {sv.houses}
          </Line>
          <ProgressBar value={sv.houses > 0 ? sv.covered[s.id] / sv.houses : 0} label={`Охват: ${s.name.toLowerCase()}`} />
        </div>
      ))}
      <Line label="Грамотные">{Math.round(sv.literate * 100)} % взрослых</Line>
    </div>
  );
}

function EventsTab({ map }: { map: maplibregl.Map }) {
  const list = events.value.slice().reverse();
  const fl = frame.value;
  if (list.length === 0) return <div class="people-note">Пока тихо</div>;
  return (
    <ul class="rs-events">
      {list.map((e) => {
        const c = calendar(e.at);
        const pos = e.pos;
        return (
          <li key={`${e.at}:${e.text}`}>
            <span class="event-at">
              г{c.year} д{c.dayOfYear}
            </span>{" "}
            {pos && fl ? (
              <button type="button" class="link event-go" title="Показать на карте" onClick={() => flyOrJump(map, { center: fl.toLngLat(pos[0], pos[1]), zoom: Math.max(map.getZoom(), 17) })}>
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
    <div class="rs-list orders" role="group" aria-label="Распоряжения">
      <div class="orders-row">
        <Button
          aria-label="Долгий день"
          aria-pressed={lv.strada}
          variant={lv.strada ? "primary" : "default"}
          title="Работа с 05 до 21 часа: на треть больше труда, но настроение ниже на 8"
          onClick={() => act({ type: "setSchedule", strada: !lv.strada })}
        >
          {lv.strada ? "Долгий день: до 21:00" : "Обычный день: 07–19"}
        </Button>
      </div>
      <div class="orders-row" role="radiogroup" aria-label="Нормы еды">
        {RATION_IDS.map((id) => (
          <Button
            key={id}
            role="radio"
            aria-checked={lv.rations === id}
            aria-label={`Нормы еды: ${RATIONS[id].name.toLowerCase()}`}
            variant={lv.rations === id ? "primary" : "default"}
            title={`Еда ${RATIONS[id].food * 100 - 100 > 0 ? "+" : ""}${Math.round(RATIONS[id].food * 100 - 100)} %, настроение ${RATIONS[id].mood > 0 ? "+" : ""}${RATIONS[id].mood}`}
            onClick={() => act({ type: "setRations", rations: id })}
          >
            {RATIONS[id].name}
          </Button>
        ))}
      </div>
      <div class="orders-row">
        <Button aria-label="Призвать поселенцев" disabled={block !== null} onClick={() => act({ type: "callSettlers" })}>
          Призвать поселенцев
        </Button>
      </div>
      <div class={block ? "people-note" : "hud-date"}>{block ?? `Стоит ${CALL.food} кг еды и ${CALL.wares} шт товаров`}</div>
      <div class="rs-danger">
        <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
          Начать заново
        </Button>
      </div>
      {confirming && (
        <Confirm
          title="Начать заново?"
          okLabel="Удалить поселение"
          onOk={() => {
            setConfirming(false);
            closePanel();
            reset();
          }}
          onCancel={() => setConfirming(false)}
        >
          Поселение и всё, что в нём построено, будет удалено. Вернуть его не получится.
        </Confirm>
      )}
    </div>
  );
}

// Town panel (right slot): people, work and demand, services, events and orders.
export function TownPanel({ city, map }: { city: City; map: maplibregl.Map }) {
  if (rightPanel.value !== "town") return null;
  return (
    <div class="rs-panel town-panel panel" role="region" aria-label="Город">
      <div class="insp-head">
        <span class="insp-ic">
          <Icon name="town" size={28} />
        </span>
        <div class="insp-title">
          <h2>{city.name}</h2>
          <span class="insp-sub">Город</span>
        </div>
        <IconButton icon="close" size={16} label="Закрыть" onClick={closePanel} />
      </div>
      <Tabs tabs={TABS} active={tab.value} onChange={(id) => (tab.value = id)} label="Разделы города" />
      <div class="rs-body">
        {tab.value === "people" && <PeopleTab />}
        {tab.value === "work" && <WorkTab city={city} map={map} />}
        {tab.value === "services" && <ServicesTab />}
        {tab.value === "events" && <EventsTab map={map} />}
        {tab.value === "orders" && <OrdersTab />}
      </div>
    </div>
  );
}
