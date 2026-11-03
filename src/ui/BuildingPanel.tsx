import { useEffect, useState } from "preact/hooks";
import { BUILDINGS, houseCapacity, JOB_NAMES, materialsOf, type JobGroup, type Materials, UPGRADE } from "../sim/buildings";
import { domainName } from "../sim/domains";
import { kindName, siteDomain, siteTitle } from "../sim/heritage";
import { SPEED } from "../sim/research";
import { upgradeBlockers } from "../sim/coverage";
import { queuedLabel } from "../sim/clock";
import { handHours } from "../sim/production";
import { DIG, revealedArea } from "../sim/excavation";
import { SERVICE, SERVICES } from "../sim/services";
import { massText } from "../sim/units";
import { familyGenitive } from "../sim/people";
import type { Building, BuildingQuery, FoundFoundation, ProductionInfo, Stock } from "../sim/types";
import { selectedBuilding } from "../view/layers/buildings";
import { PLACE_TOOLS, tool, type PlaceTool } from "../map/tools";
import { buildings, digs, gameClock, queryBuilding, state, stock } from "../simClient";
import { Icon } from "./Icon";
import { act, InspectorHead, Line, num, plural, siteEta, SiteLevers } from "./InspectorParts";
import { buildingRemaining, buildingStatus, OUTPUT, templateIcon } from "./inspectorModel";
import { JOB_ICON, PRIORITY_LONG, staffLimit } from "./jobsModel";
import { Button, Confirm, IconButton, ProgressBar, Segmented } from "./kit";
import { TRADE, TRADE_GOODS, tradeCapacity, tradeRate, type TradeGood, type TradeOrder } from "../sim/trade";
import { closePanel, rightPanel } from "./panels";
import { buildFactorText, workFactorText } from "./weatherModel";
import { duplicateTemplate } from "./actionModel";
import { followResident } from "./follow";
import { NeedsBars } from "./NeedsBars";
import { SEMANTIC_IDS } from "./semanticIds";
import { decimal, L } from "../i18n";

const REFRESH_MS = 4000;

const pct = (v: number) => `${Math.round(v * 100)} %`;
const tons = (kg: number) => decimal((Math.round(kg / 100) / 10).toString());

const MISSING: Record<string, string> = { [L("брёвна", "logs")]: L("Нет брёвен", "No logs"), [L("брёвна (на уголь)", "logs (for charcoal)")]: L("Нет брёвен (на уголь)", "No logs (for charcoal)"), [L("доски", "planks")]: L("Нет досок", "No planks") };

const MATERIALS: [keyof Materials, string, string][] = [
  ["logs", L("брёвна", "logs"), L("м³", "m³")],
  ["planks", L("доски", "planks"), L("м³", "m³")],
  ["stone", L("камень", "stone"), L("т", "t")],
];

// What a site under construction takes from the stock, and the hand-made hours its shortfall adds.
function SiteMaterials({ m, paid, hand, st }: { m: Materials | undefined; paid: boolean; hand?: number; st: Stock | null }) {
  if (!m) return null;
  const need = MATERIALS.filter(([g]) => m[g] > 0)
    .map(([g, name, unit]) => `${name} ${num(m[g])} ${unit}`)
    .join(" · ");
  const extra = paid ? (hand ?? 0) : st ? handHours(m, st) : 0;
  return (
    <div class="prod">
      <div>
        {paid ? L("Взято", "Taken") : L("Потребуется", "Needed")}: {need}
      </div>
      {extra > 0 ? (
        <div class="prod-warn">
          {paid ? L("Не хватило на складе", "The store fell short") : L("Не хватает на складе", "The store is short")}: {L(`ещё ${num(extra)} ч ручной работы`, `${num(extra)} more h of hand work`)}
        </div>
      ) : (
        <div class="people-note">{paid ? L("Хватило запасов склада", "The store had enough") : L("Запасов склада хватает", "The store has enough")}</div>
      )}
    </div>
  );
}

// A restored old building: its real name, the way it was restored and what it adds to the research.
function Restored({ b, site }: { b: Building; site: FoundFoundation | undefined }) {
  const domain = siteDomain(site?.cls);
  const w = b.restoreWeight ?? 0;
  return (
    <div class="prod">
      <div>
        {L("Восстановленная постройка", "Restored building")}{site?.cls ? ` · ${kindName(site.cls)}` : ""}
      </div>
      <div>{L("Назначение:", "Purpose:")} {b.restoreMode === "working" ? L(`в деле (как «${BUILDINGS[b.template]?.name.toLowerCase()}»)`, `in use (as a ${BUILDINGS[b.template]?.name.toLowerCase()})`) : L("памятник", "monument")}</div>
      {domain && (
        <div class="people-note">
          {w > 0 ? L(`Вклад в науку: +${num(w * SPEED.restored * 100)} % к скорости: ${domainName(domain)}`, `Research contribution: +${num(w * SPEED.restored * 100)}% speed: ${domainName(domain)}`) : L(`Область: ${domainName(domain)}; вклад появится, когда постройка будет готова`, `Field: ${domainName(domain)}; the contribution starts once the building is finished`)}
        </div>
      )}
      {b.restoreMode === "monument" && b.state === "active" && <div class="people-note">{L("Дома в 200 м довольнее, земля там дороже.", "Houses within 200 m are happier and land there is worth more.")}</div>}
    </div>
  );
}

const moodWord = (m: number) => (m >= 75 ? L("отличное", "excellent") : m >= 55 ? L("хорошее", "good") : m >= 35 ? L("неважное", "so-so") : L("плохое", "poor"));

// Residents or workers of the selected building, fetched from the worker while the panel is open.
// `bump` changes when something that moves the workers does (staff limit, priority), so the list is fetched again at once.
function useResidents(id: number | null, active: boolean, bump: string): BuildingQuery | null {
  const [data, setData] = useState<{ id: number; q: BuildingQuery | null } | null>(null);
  useEffect(() => {
    if (id === null || !active) return;
    let alive = true;
    const load = () =>
      void queryBuilding(id).then((q) => {
        if (alive) setData({ id, q });
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, active, bump]);
  return data && data.id === id ? data.q : null;
}

function Production({ template, p }: { template: string; p: ProductionInfo }) {
  const site = p.site;
  return (
    <div class="prod">
      {site && template === "woodcutter" && <div>{L("Лес вокруг:", "Forest around:")} {pct(site.forest)}</div>}
      {site && template === "fisher" && <div>{L("Вода рядом:", "Water nearby:")} {pct(site.water)}</div>}
      {site && template === "forager" && <div>{L("Лес вокруг:", "Forest around:")} {pct(site.forest)}</div>}
      {p.orchard && <div>{p.orchard.ripeDays > 0 ? L(`Деревья растут: ещё ${p.orchard.ripeDays} дн.`, `Trees are growing: ${p.orchard.ripeDays} more d`) : L(`Урожай этого года: ${pct(p.orchard.quality)}`, `This year’s crop: ${pct(p.orchard.quality)}`)}</div>}
      {p.storage !== undefined && <div>{L("Склад:", "Storage:")} +{tons(p.storage)} {L("т еды", "t of food")}</div>}
      {p.fields && (
        <div>
          {p.fields.count > 0 ? (
            <>
              <div>
                {L("Полей:", "Fields:")} {p.fields.count}, {num(p.fields.ha)} {L("га", "ha")}
              </div>
              <div>{L("Засеяно:", "Sown:")} {pct(p.fields.sown)}</div>
              <div>
                {L("Сжато:", "Reaped:")} {massText(p.fields.reaped)} {L("из", "of")} {massText(p.fields.expected)}
              </div>
            </>
          ) : (
            <div class="people-note">{L("Нет полей в радиусе 400 м", "No fields within 400 m")}</div>
          )}
        </div>
      )}
      {p.missing && <div class="prod-warn">{MISSING[p.missing] ?? `${L("Нет", "Missing")}: ${p.missing}`}</div>}
    </div>
  );
}

// Group and priority of a workplace, and its staff limit with − / + (0 closes hiring).
function StaffControl({ id, group, jobs, workers, staff }: { id: number; group: JobGroup; jobs: number; workers: number; staff: number | undefined }) {
  const priority = state.value?.levers.jobs?.[group] ?? 2;
  const limit = staffLimit(staff, jobs);
  const set = (next: number) => act({ type: "setStaff", id, staff: next });
  return (
    <div class="staff">
      <Line icon={JOB_ICON[group]} label={`${L("Группа", "Group")}: ${JOB_NAMES[group]}`}>
        {L("приоритет", "priority")} {PRIORITY_LONG[priority].toLowerCase()}
      </Line>
      <div class="insp-line">
        <span class="people-title">{L("Работники", "Workers")}</span>
        <span class="staff-ctl" role="group" aria-label={L("Лимит найма", "Hiring limit")}>
          <IconButton icon="minus" size={14} label={L("Меньше работников", "Fewer workers")} disabled={limit <= 0} onClick={() => set(limit - 1)} />
          <b aria-live="polite">
            {workers} {L("из", "of")} {limit}
          </b>
          <IconButton icon="plus" size={14} label={L("Больше работников", "More workers")} disabled={limit >= jobs} onClick={() => set(limit + 1)} />
        </span>
      </div>
      {limit < jobs && (
        <div class="people-note">
          {L(`Мест ${jobs}, найм ограничен до ${limit}`, `${jobs} jobs, hiring limited to ${limit}`)}
        </div>
      )}
      {priority === 0 && <div class="prod-warn">{L("Найм закрыт: приоритет группы «Нет»", "Hiring closed: group priority is “None”")}</div>}
    </div>
  );
}

const EMPTY_STOCK: Stock = { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 };

const TRADE_LABEL: Record<TradeGood, string> = { food: L("Еда", "Food"), logs: L("Брёвна", "Logs"), planks: L("Доски", "Planks"), stone: L("Камень", "Stone"), wares: L("Товары", "Goods") };
const TRADE_OFF = { id: "none", label: "—", title: L("Не меняем", "No trade") } as const;

// The town's trade order, shown in every market: one good given, one got, swapped each day by the market workers.
function MarketTrade({ workers }: { workers: number }) {
  const order = state.value?.levers.trade ?? null;
  const last = state.value?.economy.trade;
  const st = stock.value ?? EMPTY_STOCK;
  const set = (o: TradeOrder | null) => act({ type: "setTrade", order: o });
  const options = (skip: TradeGood | null) => TRADE_GOODS.map((g) => ({ id: g as string, label: TRADE_LABEL[g], title: OUTPUT[g].name, disabled: g === skip }));
  const unit = (g: TradeGood) => OUTPUT[g].unit;
  const surplus = order ? st[order.give] - TRADE.keep[order.give] : 0;
  return (
    <div class="prod">
      <div class="people-title">{L("Обмен", "Trade")}</div>
      <Segmented
        label={L("Отдаём", "We give")}
        value={order?.give ?? TRADE_OFF.id}
        options={[TRADE_OFF, ...options(null)]}
        onChange={(id) => {
          if (id === TRADE_OFF.id) return set(null);
          const give = id as TradeGood;
          set({ give, get: order && order.get !== give ? order.get : give === "wares" ? "food" : "wares" });
        }}
      />
      {order && (
        <>
          <Segmented label={L("Получаем", "We get")} value={order.get} options={options(order.give)} onChange={(id) => set({ give: order.give, get: id as TradeGood })} />
          <div>
            1 {unit(order.give)} = {num(tradeRate(order))} {unit(order.get)} · {L("до", "up to")} {num(tradeCapacity(order, workers))} {unit(order.give)} {L("в день", "a day")}
          </div>
          <div class="people-note">
            {L("Остаётся на складе:", "Kept in store:")} {num(TRADE.keep[order.give])} {unit(order.give)}. {L("Обмен общий для всех рынков", "The trade is shared by all markets")}
          </div>
          {workers === 0 && <div class="prod-warn">{L("Некому торговать: нужны работники рынка", "No one to trade: the market needs workers")}</div>}
          {workers > 0 && surplus <= 0 && <div class="prod-warn">{L("Излишков нет: всё, что есть, остаётся на складе", "No surplus: everything stays in store")}</div>}
          {last && (
            <div>
              {L("Вчера: отдали", "Yesterday: gave")} {num(last.gave)} {unit(last.give)}, {L("получили", "got")} {num(last.got)} {unit(last.get)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Inspector of the selected building (right slot).
export function BuildingPanel() {
  const [confirming, setConfirming] = useState(false);
  const id = selectedBuilding.value;
  const b = id === null ? undefined : buildings.value?.[id];
  const t = b ? BUILDINGS[b.template] : undefined;
  const site = b?.siteId ? state.value?.finds.foundations.find((f) => f.id === b.siteId) : undefined;
  const shown = !!b && !!t && !tool.value && rightPanel.value === "inspector";
  const dig = b && b.template === DIG.template && b.state === "active" ? digs.value.find((d) => d.id === b.id) : undefined;
  const snap = state.value;
  const upgradeNote = b && snap && b.state === "active" && b.template === UPGRADE.template && b.level < 2 && !b.upgrade ? upgradeBlockers(snap, b, snap.houseMood[b.id]) : null;
  const group = t?.group ?? null;
  const info = useResidents(id, shown && b?.state === "active", `${b?.staff ?? "-"}|${group ? (state.value?.levers.jobs?.[group] ?? 2) : "-"}`);
  const ws = snap?.weather;
  const weatherWork = b && b.state === "active" && info?.kind === "workplace" ? workFactorText(b.template, ws) : null;
  const weatherBuild = b && b.state !== "active" ? buildFactorText(ws) : null;
  useEffect(() => setConfirming(false), [id]);
  if (!b || !t || !shown) return null;
  const upgrading = b.state === "active" && !!b.upgrade;
  const queued = b.state === "active" && !upgrading ? null : queuedLabel(gameClock.value, state.value?.levers); // «начнут в 07:00» outside work hours
  const shortfall = b.state === "planned" && !b.paid && handHours(materialsOf(b) ?? t.materials, stock.value ?? EMPTY_STOCK) > 0;
  const chip = buildingStatus(b, info, shortfall);
  const jobs = info?.kind === "workplace" ? info.capacity : t.jobs;
  const capacity =
    t.residents > 0
      ? L(`Вмещает ${houseCapacity(b)} чел.`, `Houses ${houseCapacity(b)} people`)
      : b.template === "gumno" && info?.kind !== "workplace"
        ? L("Места зависят от полей", "Jobs depend on the fields")
        : jobs > 0
          ? `${jobs} ${plural(jobs, "рабочее место", "рабочих места", "рабочих мест", "job")}`
          : null;
  const occupied = info?.kind === "house" ? info.households.some((h) => h.people.length > 0) : info?.kind === "workplace" && info.workers.length > 0;
  const duplicate = duplicateTemplate(b.template, b.siteId, PLACE_TOOLS);
  const onDuplicate = () => {
    if (!duplicate) return;
    closePanel();
    tool.value = duplicate as PlaceTool;
  };
  const onDemolish = () => {
    act({ type: "demolish", id: b.id });
    selectedBuilding.value = null;
  };
  // Work left on the site: construction, or the rebuild of a finished house.
  const left = buildingRemaining(b);
  const labor = upgrading ? b.upgrade!.labor : b.labor;
  const share = labor > 0 ? (labor - left) / labor : 1;
  const output = info?.kind === "workplace" && info.production?.good ? { ...OUTPUT[info.production.good], made: info.production.yesterday } : null;
  const residents = info?.kind === "house" ? info.households.reduce((a, h) => a + h.people.length, 0) : 0;
  return (
    <aside class="rs-panel inspector panel" aria-labelledby={SEMANTIC_IDS.buildingInspectorTitle}>
      <InspectorHead icon={templateIcon(b.template)} title={site ? siteTitle(site) : t.name} chip={chip} onClose={closePanel} headingId={SEMANTIC_IDS.buildingInspectorTitle} />
      <div class="insp-sub">
        {site ? L(`${Math.round(site.area)} м², высота ${b.height} м`, `${Math.round(site.area)} m², height ${b.height} m`) : L(`${t.along} × ${t.deep} м, высота ${b.height} м`, `${t.along} × ${t.deep} m, height ${b.height} m`)}
        {b.zone === "res" && b.state === "active" ? ` · ${L("уровень", "level")} ${b.level}` : ""}
      </div>
      {b.siteId && <Restored b={b} site={site} />}
      {b.onRuins && <div class="people-note">{b.state === "active" ? L("Стоит на старом фундаменте", "Stands on an old foundation") : L("Строится на старом фундаменте", "Being built on an old foundation")}</div>}
      {left > 0 && (
        <div class="insp-block">
          <ProgressBar big value={share} label={upgrading ? L("Перестройка", "Rebuild") : L("Строительство", "Construction")} />
          <Line icon="hourglass" label={upgrading ? L("Перестроено", "Rebuilt") : L("Готово", "Done")}>
            {Math.floor(share * 100)}{L(" % · осталось", "% · left")} {num(left)} {L("чел.-ч", "person-h")}
          </Line>
          <Line label={L("Ждать", "Wait")}>{siteEta(left, b.id) || "—"}</Line>
          {queued && <div class="people-note">{queued}</div>}
          <SiteLevers siteKey={b.id} />
        </div>
      )}
      {weatherBuild && (
        <Line label={L("Стройка сегодня", "Building today")} tone={weatherBuild.pct <= 50 ? "bad" : "warn"}>
          {weatherBuild.pct}{L(" %", "%")}{weatherBuild.reason ? ` — ${weatherBuild.reason}` : ""}
        </Line>
      )}
      {b.state !== "active" && <SiteMaterials m={materialsOf(b)} paid={b.paid} hand={b.hand} st={stock.value} />}
      {upgradeNote && (
        <div class="prod">
          {upgradeNote.length > 0 ? (
            <div>{L("Расширение до второго уровня: нет —", "Expansion to level two: no —")} {upgradeNote.join("; ")}</div>
          ) : (
            <div>
              {L(`Расширение до второго уровня: условия выполнены, ${b.streak} из ${SERVICE.upgradeDays} дней подряд`, `Expansion to level two: conditions met, ${b.streak} of ${SERVICE.upgradeDays} days in a row`)}
            </div>
          )}
        </div>
      )}
      {dig && (
        <div class="prod">
          <div>
            {L(`Радиус вскрытия: ${Math.round(dig.r)} м из ${DIG.maxRadius} м`, `Opened radius: ${Math.round(dig.r)} m of ${DIG.maxRadius} m`)}
          </div>
          <div>{L("Вскрыто:", "Opened:")} {Math.round(revealedArea(dig.r))} {L("м²", "m²")}</div>
          <div>
            {L("Находки:", "Finds:")} {dig.foundations} {plural(dig.foundations, "фундамент", "фундамента", "фундаментов", "foundation")}, {dig.pois}{" "}
            {plural(dig.pois, "место", "места", "мест", "place")}, {dig.streets} {plural(dig.streets, "улица", "улицы", "улиц", "street")}
          </div>
        </div>
      )}
      {info?.kind === "house" && (
        <>
          <Line icon="person" label={L("Жители", "Residents")}>
            {residents} {L("из", "of")} {houseCapacity(b)}
          </Line>
          <Line icon="value" label={L("Стоимость земли", "Land value")}>
            {info.landValue}
          </Line>
          <div class={info.services.length === 0 ? "people-note" : ""}>
            {L("Рядом:", "Nearby:")} {info.services.length > 0 ? info.services.map((sid) => SERVICES[sid].name.toLowerCase()).join(", ") : L("ничего из служб", "no services")}
          </div>
          {b.template === "izba" && b.level < 2 && !b.upgrade && b.streak > 0 && <div class="people-note">{L("Хороших дней подряд:", "Good days in a row:")} {b.streak} {L("из", "of")} 20</div>}
        </>
      )}
      {info?.kind === "workplace" && info.service && (
        <>
          <div>
            {L(`Охват ${info.service.reach} м: ${info.service.covered} из ${info.service.houses} домов`, `Reach ${info.service.reach} m: ${info.service.covered} of ${info.service.houses} houses`)}
          </div>
          {info.service.id === "school" && (
            <div class="people-note">
              {L(`Учеников: ${info.service.pupils} из ${info.service.seats} мест`, `Pupils: ${info.service.pupils} of ${info.service.seats} places`)}
            </div>
          )}
          {!info.service.working && <div class="prod-warn">{L("Не работает: нет работников", "Not working: no workers")}</div>}
        </>
      )}
      {capacity && <div>{capacity}</div>}
      {weatherWork && (
        <Line label={L("Работа сегодня", "Work today")} tone={weatherWork.pct <= 50 ? "bad" : "warn"}>
          {weatherWork.pct} %{weatherWork.reason ? ` — ${weatherWork.reason}` : ""}
        </Line>
      )}
      {output && (
        <Line icon={output.icon} label={`${L("Делает", "Makes")}: ${output.name}`}>
          {b.template === "gumno" ? L("вчера собрано", "gathered yesterday") : L("вчера", "yesterday")} {num(output.made)} {output.unit}
        </Line>
      )}
      {info?.kind === "workplace" && info.production && <Production template={b.template} p={info.production} />}
      {b.template === "market" && b.state === "active" && info?.kind === "workplace" && <MarketTrade workers={info.workers.length} />}
      {info?.kind === "house" &&
        (info.households.length === 0 ? (
          <div class="people-note">{L("Пока пустует", "Empty for now")}</div>
        ) : (
          info.households.map((h) => (
            <div class="people" key={h.id}>
              <div class="people-title">{L(`Семья ${familyGenitive(h.last)}`, `The ${h.last} family`)}</div>
              <div class={h.mood < 35 ? "prod-warn" : "people-note"}>
                {L("Настроение:", "Mood:")} {moodWord(h.mood)} ({h.mood})
              </div>
              {h.people.map((p) => (
                <div class="person" key={p.id}>
                  <div class="person-line">
                    <span class="person-name">{p.name}</span>, {p.age} {plural(p.age, "год", "года", "лет", "year")}
                    <button type="button" class="link person-follow" title={`${L("Следить за", "Follow")} ${p.name}`} onClick={() => followResident(p.id, p.name)}>
                      <Icon name="locate" size={13} /> {L("следить", "follow")}
                    </button>
                  </div>
                  <div class="person-role">
                    {p.role}
                    {p.literate ? L(" · грамотный", " · literate") : p.learn > 0 && L(` · грамотность ${p.learn} %`, ` · literacy ${p.learn}%`)}
                  </div>
                  {p.needs && <NeedsBars needs={p.needs} compact />}
                  {p.problems && p.problems.length > 0 && <div class="prod-warn">{L("Тяжело:", "Struggling:")} {p.problems.join(", ")}</div>}
                </div>
              ))}
            </div>
          ))
        ))}
      {info?.kind === "workplace" && info.capacity > 0 && (
        <div class="people">
          {group ? <StaffControl id={b.id} group={group} jobs={info.capacity} workers={info.workers.length} staff={b.staff} /> : <div class="people-title">{L("Работники", "Workers")} {info.workers.length} {L("из", "of")} {info.capacity}</div>}
          {info.workers.map((w) => (
            <div class="person" key={w.id}>
              <div class="person-line">
                <span class="person-name">{w.name}</span>, {w.age} {plural(w.age, "год", "года", "лет", "year")}
                <button type="button" class="link person-follow" title={`${L("Следить за", "Follow")} ${w.name}`} onClick={() => followResident(w.id, w.name)}>
                  <Icon name="locate" size={13} /> {L("следить", "follow")}
                </button>
              </div>
              <div class="person-role">
                {w.idle && L("сейчас на стройке (нет работы) · ", "at a building site now (no job) · ")}
                {w.commute === null ? L("дорога неизвестна", "commute unknown") : L(`дорога ~${Math.round(w.commute)} мин`, `commute ~${Math.round(w.commute)} min`)}
                {typeof w.work === "number" && w.work < 0.95 ? L(` · силы ${Math.round(w.work * 100)} %`, ` · fitness ${Math.round(w.work * 100)}%`) : ""}
              </div>
              {w.needs && <NeedsBars needs={w.needs} compact />}
              {w.problems && w.problems.length > 0 && <div class="prod-warn">{L("Тяжело:", "Struggling:")} {w.problems.join(", ")}</div>}
            </div>
          ))}
        </div>
      )}
      <div class="insp-actions">
        {duplicate && (
          <Button icon="plus" onClick={onDuplicate}>
            {L("Построить ещё", "Build another")}
          </Button>
        )}
        <Button variant="danger" icon="trash" aria-label={L("Снести", "Demolish")} onClick={() => setConfirming(true)}>
          {L("Снести", "Demolish")}
        </Button>
      </div>
      {confirming && (
        <Confirm title={`${L("Снести", "Demolish")}: ${t.name}?`} okLabel={L("Снести", "Demolish")} onOk={onDemolish} onCancel={() => setConfirming(false)}>
          {b.siteId ? L("Постройка будет утрачена навсегда: восстановить её снова нельзя. Полученные идеи останутся.", "The building will be lost forever and cannot be restored again. Ideas already gained stay.") : occupied ? (info?.kind === "house" ? L("Здесь живут люди, они останутся без дома.", "People live here; they will be left homeless.") : L("Здесь работают люди, они останутся без места.", "People work here; they will lose their jobs.")) : L("Здание будет снесено.", "The building will be demolished.")}
          {b.state !== "planned" && b.paid ? L(" Потраченные материалы не вернутся.", " Materials spent are not returned.") : ""}
        </Confirm>
      )}
    </aside>
  );
}
