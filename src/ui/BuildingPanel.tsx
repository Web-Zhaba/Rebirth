import { GOOD_NAMES, GOODS_UPGRADE, needsAt } from "../sim/goods";
import { useEffect, useState } from "preact/hooks";
import { BUILDINGS, floorArea, homesOf, houseCapacity, JOB_NAMES, materialsOf, maxLevel, STORE_GROUPS, type JobGroup, type Materials, type StoreGroup, upgradable } from "../sim/buildings";
import { storeAmount, storeGroupName } from "./buildMenu";
import { domainName } from "../sim/domains";
import { kindName, siteDomain, siteTitle } from "../sim/heritage";
import { SPEED } from "../sim/research";
import { upgradeBlockers } from "../sim/coverage";
import { foundationKindText } from "../sim/foundationLots";
import { queuedLabel } from "../sim/clock";
import { handHours } from "../sim/production";
import { DIG, revealedArea } from "../sim/excavation";
import { SERVICE, SERVICES } from "../sim/services";
import { massText } from "../sim/units";
import { familyGenitive } from "../sim/people";
import type { ComponentChildren } from "preact";
import type { Building, BuildingQuery, FoundFoundation, Needs, ProductionInfo, Stock } from "../sim/types";
import { selectedBuilding } from "../view/layers/buildings";
import { PLACE_TOOLS, tool, type PlaceTool } from "../map/tools";
import { buildings, digs, gameClock, queryBuilding, state, stock } from "../simClient";
import { act, InspectorHead, Line, num, plural, Section, siteEta, SiteLevers } from "./InspectorParts";
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

const MISSING: Record<string, string> = { [L("брёвна", "logs")]: L("Нет брёвен", "No logs"), [L("брёвна (на уголь)", "logs (for charcoal)")]: L("Нет брёвен (на уголь)", "No logs (for charcoal)"), [L("доски", "planks")]: L("Нет досок", "No planks") };

const MATERIALS: [keyof Materials, string, string][] = [
  ["logs", L("брёвна", "logs"), L("м³", "m³")],
  ["planks", L("доски", "planks"), L("м³", "m³")],
  ["stone", L("камень", "stone"), L("т", "t")],
];

// What a site under construction takes from the stock, and the hand-made hours its shortfall adds.
function SiteMaterials({ m, paid, hand, haul, st }: { m: Materials | undefined; paid: boolean; hand?: number; haul?: number; st: Stock | null }) {
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
      {paid && (haul ?? 0) >= 0.05 && <div class="people-note">{L(`Подвоз со складов: ${num(haul!)} ч работы`, `Carting from the stores: ${num(haul!)} h of work`)}</div>}
    </div>
  );
}

// A building "as it was" on the foundation of a known old kind: its real name and what it adds to the research.
function Restored({ b, site }: { b: Building; site: FoundFoundation | undefined }) {
  const domain = siteDomain(site?.cls);
  const w = b.restoreWeight ?? 0;
  return (
    <div class="prod">
      <div>
        {L("Восстановлено как было", "Restored as it was")}{site?.cls ? ` · ${kindName(site.cls)}` : ""}
      </div>
      {domain && (
        <div class="people-note">
          {w > 0 ? L(`Вклад в науку: +${num(w * SPEED.restored * 100)} % к скорости: ${domainName(domain)}`, `Research contribution: +${num(w * SPEED.restored * 100)}% speed: ${domainName(domain)}`) : L(`Область: ${domainName(domain)}; вклад появится, когда постройка будет готова`, `Field: ${domainName(domain)}; the contribution starts once the building is finished`)}
        </div>
      )}
      {b.template === "restored" && b.state === "active" && <div class="people-note">{L("Дома в 200 м довольнее, земля там дороже.", "Houses within 200 m are happier and land there is worth more.")}</div>}
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

const SITE_FACT = new Set(["woodcutter", "fisher", "forager"]);
// Whether Production below has anything to show for this workplace.
const hasProduction = (template: string, p: ProductionInfo): boolean => (!!p.site && SITE_FACT.has(template)) || !!p.orchard || !!p.store || !!p.haul || !!p.full || !!p.fields || !!p.missing;

function Production({ template, p }: { template: string; p: ProductionInfo }) {
  const site = p.site;
  return (
    <div class="prod">
      {site && template === "woodcutter" && <div>{L("Лес вокруг:", "Forest around:")} {pct(site.forest)}</div>}
      {site && template === "fisher" && <div>{L("Вода рядом:", "Water nearby:")} {pct(site.water)}</div>}
      {site && template === "forager" && <div>{L("Лес вокруг:", "Forest around:")} {pct(site.forest)}</div>}
      {p.orchard && <div>{p.orchard.ripeDays > 0 ? L(`Деревья растут: ещё ${p.orchard.ripeDays} дн.`, `Trees are growing: ${p.orchard.ripeDays} more d`) : L(`Урожай этого года: ${pct(p.orchard.quality)}`, `This year’s crop: ${pct(p.orchard.quality)}`)}</div>}
      {p.store &&
        (Object.keys(p.store.room) as StoreGroup[]).map((g) => {
          const held = STORE_GROUPS[g].reduce((n, k) => n + (p.store!.held[k] ?? 0), 0);
          return (
            <div key={g}>
              {storeGroupName(g).replace(/^./, (c) => c.toUpperCase())}: {storeAmount(g, held)} {L("из", "of")} {storeAmount(g, p.store!.room[g]!)}
            </div>
          );
        })}
      {p.haul && p.haul.share >= 0.005 && <div>{L(`До склада ${Math.round(p.haul.metres)} м: подвоз берёт ${pct(p.haul.share)} времени`, `${Math.round(p.haul.metres)} m to the store: carting takes ${pct(p.haul.share)} of the time`)}</div>}
      {p.full && <div class="prod-warn">{L("Склады полны: работа стоит", "The stores are full: work has stopped")}</div>}
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
      <div class="insp-line staff-line">
        <span class="insp-label">{L("Работают", "Working")}</span>
        <span class="staff-ctl" role="group" aria-label={L("Лимит найма", "Hiring limit")}>
          <IconButton icon="minus" size={14} label={L("Меньше работников", "Fewer workers")} disabled={limit <= 0} onClick={() => set(limit - 1)} />
          <b aria-live="polite">
            {workers} {L("из", "of")} {limit}
          </b>
          <IconButton icon="plus" size={14} label={L("Больше работников", "More workers")} disabled={limit >= jobs} onClick={() => set(limit + 1)} />
        </span>
      </div>
      <Line icon={JOB_ICON[group]} label={`${L("Группа", "Group")}: ${JOB_NAMES[group]}`}>
        {L("приоритет", "priority")} {PRIORITY_LONG[priority].toLowerCase()}
      </Line>
      {limit < jobs && (
        <div class="people-note">
          {L(`Мест ${jobs}, найм ограничен до ${limit}`, `${jobs} jobs, hiring limited to ${limit}`)}
        </div>
      )}
      {priority === 0 && <div class="prod-warn">{L("Найм закрыт: приоритет группы «Нет»", "Hiring closed: group priority is “None”")}</div>}
    </div>
  );
}

const EMPTY_STOCK: Stock = { food: 0, logs: 0, planks: 0, stone: 0, clothes: 0, dishes: 0, furniture: 0, tools: 0 };

const TRADE_LABEL: Record<TradeGood, string> = { food: L("Еда", "Food"), logs: L("Брёвна", "Logs"), planks: L("Доски", "Planks"), stone: L("Камень", "Stone"), clothes: GOOD_NAMES.clothes, dishes: GOOD_NAMES.dishes, furniture: GOOD_NAMES.furniture, tools: GOOD_NAMES.tools };
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
      <Segmented
        label={L("Отдаём", "We give")}
        value={order?.give ?? TRADE_OFF.id}
        options={[TRADE_OFF, ...options(null)]}
        onChange={(id) => {
          if (id === TRADE_OFF.id) return set(null);
          const give = id as TradeGood;
          set({ give, get: order && order.get !== give ? order.get : give === "food" ? "tools" : "food" });
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

// One resident: name and age, follow, what they do, their needs and what is hard for them.
function PersonRow({ id, name, age, needs, problems, children }: { id: number; name: string; age: number; needs?: Needs; problems?: string[]; children: ComponentChildren }) {
  return (
    <div class="person">
      <div class="person-line">
        <span class="person-name">{name}</span>
        <span class="person-age">
          {age} {plural(age, "год", "года", "лет", "year")}
        </span>
        <IconButton icon="locate" size={14} class="person-follow" label={`${L("Следить за", "Follow")} ${name}`} onClick={() => followResident(id, name)} />
      </div>
      <div class="person-role">{children}</div>
      {needs && <NeedsBars needs={needs} compact />}
      {problems && problems.length > 0 && (
        <div class="prod-warn">
          {L("Тяжело:", "Struggling:")} {problems.join(", ")}
        </div>
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
  const site = b?.foundationId ? state.value?.finds.foundations.find((f) => f.id === b.foundationId) : undefined;
  const shown = !!b && !!t && !tool.value && rightPanel.value === "inspector";
  const dig = b && b.template === DIG.template && b.state === "active" ? digs.value.find((d) => d.id === b.id) : undefined;
  const snap = state.value;
  const upgradeNote = b && snap && upgradable(b) ? upgradeBlockers(snap, b, snap.houseMood[b.id], snap.houseGoods?.[b.id]) : null;
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
  const duplicate = duplicateTemplate(b.template, b.asItWas ? b.foundationId : undefined, PLACE_TOOLS);
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
  const height = Math.round(b.height * 10) / 10;
  const size = b.foundationId ? L(`${Math.round(floorArea(b))} м² этажей, высота ${decimal(String(height))} м`, `${Math.round(floorArea(b))} m² of floors, height ${height} m`) : L(`${t.along} × ${t.deep} м, высота ${decimal(String(height))} м`, `${t.along} × ${t.deep} m, height ${height} m`);
  const level = b.foundationId ? ` · ${L("этажей", "floors")} ${b.level}${b.level < maxLevel(b) ? ` ${L("из", "of")} ${maxLevel(b)}` : ""}` : b.zone === "res" && b.state === "active" ? ` · ${L("уровень", "level")} ${b.level} ${L("из", "of")} ${maxLevel(b)}` : "";
  return (
    <aside class="rs-panel inspector panel" aria-labelledby={SEMANTIC_IDS.buildingInspectorTitle}>
      <InspectorHead icon={templateIcon(b.template)} title={b.asItWas && site ? siteTitle(site) : t.name} chip={chip} sub={`${size}${level}`} onClose={closePanel} headingId={SEMANTIC_IDS.buildingInspectorTitle} />
      {b.foundationId && (
        <Section>
          {b.asItWas && <Restored b={b} site={site} />}
          {!b.asItWas && <div class="people-note">{b.state === "active" ? L("Стоит на старом фундаменте", "Stands on an old foundation") : L("Строится на старом фундаменте", "Being built on an old foundation")}</div>}
          {!b.asItWas && site?.cls && <div class="people-note">{foundationKindText(site, t)}</div>}
        </Section>
      )}
      {(left > 0 || b.state !== "active") && (
        <Section title={upgrading ? L("Перестройка", "Rebuild") : L("Стройка", "Construction")}>
          {left > 0 && (
            <>
              <div class="insp-progress">
                <b>
                  {Math.floor(share * 100)}
                  {L(" %", "%")}
                </b>
                <ProgressBar big value={share} label={upgrading ? L("Перестройка", "Rebuild") : L("Строительство", "Construction")} />
              </div>
              <Line icon="hourglass" label={L("Осталось", "Left")}>
                {num(left)} {L("чел.-ч", "person-h")}
              </Line>
              <Line label={L("Ждать", "Wait")}>{siteEta(left, b.id) || "—"}</Line>
              {queued && <div class="people-note">{queued}</div>}
            </>
          )}
          {weatherBuild && (
            <Line label={L("Стройка сегодня", "Building today")} tone={weatherBuild.pct <= 50 ? "bad" : "warn"}>
              {weatherBuild.pct}
              {L(" %", "%")}
              {weatherBuild.reason ? ` — ${weatherBuild.reason}` : ""}
            </Line>
          )}
          {b.state !== "active" && <SiteMaterials m={materialsOf(b)} paid={b.paid} hand={b.hand} haul={b.haul} st={stock.value} />}
          {left > 0 && <SiteLevers siteKey={b.id} />}
        </Section>
      )}
      {(capacity || info?.kind === "house" || (info?.kind === "workplace" && info.service) || output || weatherWork || upgradeNote || dig) && (
        <Section>
          {info?.kind === "house" ? (
            <>
              <Line icon="person" label={L("Жители", "Residents")}>
                {residents} {L("из", "of")} {houseCapacity(b)}
              </Line>
              <Line label={L("Семьи", "Families")}>
                {info.households.length} {L("из", "of")} {homesOf(b)}
              </Line>
              <Line label={L("Нужны товары", "Goods needed")} tone={(snap?.houseGoods?.[b.id] ?? 1) < GOODS_UPGRADE ? "warn" : undefined}>
                {needsAt(b.level)
                  .map((g) => GOOD_NAMES[g].toLowerCase())
                  .join(", ")}
                {snap?.houseGoods?.[b.id] !== undefined && ` · ${L("получено", "served")} ${Math.round(snap.houseGoods[b.id] * 100)} %`}
              </Line>
              <Line icon="value" label={L("Стоимость земли", "Land value")}>
                {info.landValue}
              </Line>
              <Line label={L("Рядом", "Nearby")} tone={info.services.length === 0 ? "warn" : undefined}>
                {info.services.length > 0 ? info.services.map((sid) => SERVICES[sid].name.toLowerCase()).join(", ") : L("ничего из служб", "no services")}
              </Line>
              {upgradable(b) && b.streak > 0 && (
                <div class="people-note">
                  {L("Хороших дней подряд:", "Good days in a row:")} {b.streak} {L("из", "of")} 20
                </div>
              )}
            </>
          ) : (
            capacity && <Line label={L("Вместимость", "Capacity")}>{capacity}</Line>
          )}
          {info?.kind === "workplace" && info.service && (
            <>
              <Line label={L(`Охват ${info.service.reach} м`, `Reach ${info.service.reach} m`)}>
                {info.service.covered} {L("из", "of")} {info.service.houses} {L("домов", "houses")}
              </Line>
              {info.service.id === "school" && (
                <Line label={L("Ученики", "Pupils")}>
                  {info.service.pupils} {L("из", "of")} {info.service.seats}
                </Line>
              )}
              {!info.service.working && <div class="prod-warn">{L("Не работает: нет работников", "Not working: no workers")}</div>}
            </>
          )}
          {output && (
            <Line icon={output.icon} label={`${L("Делает", "Makes")}: ${output.name}`}>
              {b.template === "gumno" ? L("вчера собрано", "gathered yesterday") : L("вчера", "yesterday")} {num(output.made)} {output.unit}
            </Line>
          )}
          {weatherWork && (
            <Line label={L("Работа сегодня", "Work today")} tone={weatherWork.pct <= 50 ? "bad" : "warn"}>
              {weatherWork.pct} %{weatherWork.reason ? ` — ${weatherWork.reason}` : ""}
            </Line>
          )}
          {upgradeNote && (
            <div class={upgradeNote.length > 0 ? "people-note" : "insp-ok"}>
              {upgradeNote.length > 0
                ? `${L("Расширение до второго уровня: нет —", "Expansion to level two: no —")} ${upgradeNote.join("; ")}`
                : L(`Расширение до второго уровня: условия выполнены, ${b.streak} из ${SERVICE.upgradeDays} дней подряд`, `Expansion to level two: conditions met, ${b.streak} of ${SERVICE.upgradeDays} days in a row`)}
            </div>
          )}
          {dig && (
            <>
              <Line label={L("Радиус вскрытия", "Opened radius")}>
                {Math.round(dig.r)} {L("из", "of")} {DIG.maxRadius} {L("м", "m")}
              </Line>
              <Line label={L("Вскрыто", "Opened")}>
                {Math.round(revealedArea(dig.r))} {L("м²", "m²")}
              </Line>
              <div class="people-note">
                {L("Находки:", "Finds:")} {dig.foundations} {plural(dig.foundations, "фундамент", "фундамента", "фундаментов", "foundation")}, {dig.pois}{" "}
                {plural(dig.pois, "место", "места", "мест", "place")}, {dig.streets} {plural(dig.streets, "улица", "улицы", "улиц", "street")}
              </div>
            </>
          )}
        </Section>
      )}
      {info?.kind === "workplace" && info.production && hasProduction(b.template, info.production) && (
        <Section title={L("Хозяйство", "Production")}>
          <Production template={b.template} p={info.production} />
        </Section>
      )}
      {b.template === "market" && b.state === "active" && info?.kind === "workplace" && (
        <Section title={L("Обмен", "Trade")}>
          <MarketTrade workers={info.workers.length} />
        </Section>
      )}
      {info?.kind === "house" && (
        <Section title={L("Семьи", "Families")}>
          {info.households.length === 0 ? (
            <div class="people-note">{L("Пока пустует", "Empty for now")}</div>
          ) : (
            info.households.map((h) => (
              <div class="household" key={h.id}>
                <div class="household-head">
                  <span>{L(`Семья ${familyGenitive(h.last)}`, `The ${h.last} family`)}</span>
                  <span class={h.mood < 35 ? "prod-warn" : "people-note"}>
                    {moodWord(h.mood)} · {h.mood}
                  </span>
                </div>
                {h.people.map((p) => (
                  <PersonRow key={p.id} id={p.id} name={p.name} age={p.age} needs={p.needs} problems={p.problems}>
                    {p.role}
                    {p.literate ? L(" · грамотный", " · literate") : p.learn > 0 && L(` · грамотность ${p.learn} %`, ` · literacy ${p.learn}%`)}
                  </PersonRow>
                ))}
              </div>
            ))
          )}
        </Section>
      )}
      {info?.kind === "workplace" && info.capacity > 0 && (
        <Section
          title={L("Работники", "Workers")}
          aside={
            group ? undefined : (
              <b class="insp-sec-count">
                {info.workers.length} {L("из", "of")} {info.capacity}
              </b>
            )
          }
        >
          {group && <StaffControl id={b.id} group={group} jobs={info.capacity} workers={info.workers.length} staff={b.staff} />}
          {info.workers.map((w) => (
            <PersonRow key={w.id} id={w.id} name={w.name} age={w.age} needs={w.needs} problems={w.problems}>
              {w.idle && L("сейчас на стройке (нет работы) · ", "at a building site now (no job) · ")}
              {w.commute === null ? L("дорога неизвестна", "commute unknown") : L(`дорога ~${Math.round(w.commute)} мин`, `commute ~${Math.round(w.commute)} min`)}
              {typeof w.work === "number" && w.work < 0.95 ? L(` · силы ${Math.round(w.work * 100)} %`, ` · fitness ${Math.round(w.work * 100)}%`) : ""}
            </PersonRow>
          ))}
        </Section>
      )}
      <div class="insp-actions">
        {duplicate && (
          <Button variant="primary" icon="plus" onClick={onDuplicate}>
            {L("Построить ещё", "Build another")}
          </Button>
        )}
        <Button variant="danger" icon="trash" aria-label={L("Снести", "Demolish")} onClick={() => setConfirming(true)}>
          {L("Снести", "Demolish")}
        </Button>
      </div>
      {confirming && (
        <Confirm title={`${L("Снести", "Demolish")}: ${t.name}?`} okLabel={L("Снести", "Demolish")} onOk={onDemolish} onCancel={() => setConfirming(false)}>
          {b.asItWas ? L("Постройка будет утрачена навсегда: восстановить её снова нельзя. Полученные идеи останутся.", "The building will be lost forever and cannot be restored again. Ideas already gained stay.") : occupied ? (info?.kind === "house" ? L("Здесь живут люди, они останутся без дома.", "People live here; they will be left homeless.") : L("Здесь работают люди, они останутся без места.", "People work here; they will lose their jobs.")) : L("Здание будет снесено.", "The building will be demolished.")}
          {b.state !== "planned" && b.paid ? L(" Потраченные материалы не вернутся.", " Materials spent are not returned.") : ""}
        </Confirm>
      )}
    </aside>
  );
}
