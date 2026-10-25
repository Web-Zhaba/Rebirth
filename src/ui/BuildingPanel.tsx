import { useEffect, useState } from "preact/hooks";
import { BUILDINGS, houseCapacity, type Materials } from "../sim/buildings";
import { queuedLabel } from "../sim/clock";
import { handHours } from "../sim/production";
import { DIG, revealedArea } from "../sim/excavation";
import { SERVICES } from "../sim/services";
import { massText } from "../sim/units";
import { familyGenitive } from "../sim/people";
import type { BuildingQuery, ProductionInfo, Stock } from "../sim/types";
import { selectedBuilding } from "../map/buildingLayer";
import { tool } from "../map/tools";
import { buildings, digs, gameClock, queryBuilding, state, stock } from "../simClient";
import { Icon } from "./Icon";
import { act, InspectorHead, Line, num, plural, siteEta, SiteLevers } from "./InspectorParts";
import { buildingRemaining, buildingStatus, OUTPUT, templateIcon } from "./inspectorModel";
import { Button, Confirm, ProgressBar } from "./kit";
import { closePanel, rightPanel } from "./panels";

const REFRESH_MS = 4000;

const pct = (v: number) => `${Math.round(v * 100)} %`;
const tons = (kg: number) => (Math.round(kg / 100) / 10).toString().replace(".", ",");

const MISSING: Record<string, string> = { "брёвна": "Нет брёвен", "брёвна (на уголь)": "Нет брёвен (на уголь)", "доски": "Нет досок" };

const MATERIALS: [keyof Materials, string, string][] = [
  ["logs", "брёвна", "м³"],
  ["planks", "доски", "м³"],
  ["stone", "камень", "т"],
];

// What a site under construction takes from the stock, and the hand-made hours its shortfall adds.
function SiteMaterials({ template, paid, hand, st }: { template: string; paid: boolean; hand?: number; st: Stock | null }) {
  const m = BUILDINGS[template]?.materials;
  if (!m) return null;
  const need = MATERIALS.filter(([g]) => m[g] > 0)
    .map(([g, name, unit]) => `${name} ${num(m[g])} ${unit}`)
    .join(" · ");
  const extra = paid ? (hand ?? 0) : st ? handHours(m, st) : 0;
  return (
    <div class="prod">
      <div>
        {paid ? "Взято" : "Потребуется"}: {need}
      </div>
      {extra > 0 ? (
        <div class="prod-warn">
          {paid ? "Не хватило на складе" : "Не хватает на складе"}: ещё {num(extra)} ч ручной работы
        </div>
      ) : (
        <div class="people-note">{paid ? "Хватило запасов склада" : "Запасов склада хватает"}</div>
      )}
    </div>
  );
}

const moodWord = (m: number) => (m >= 75 ? "отличное" : m >= 55 ? "хорошее" : m >= 35 ? "неважное" : "плохое");

// Residents or workers of the selected building, fetched from the worker while the panel is open.
function useResidents(id: number | null, active: boolean): BuildingQuery | null {
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
  }, [id, active]);
  return data && data.id === id ? data.q : null;
}

function Production({ template, p }: { template: string; p: ProductionInfo }) {
  const site = p.site;
  return (
    <div class="prod">
      {site && template === "woodcutter" && <div>Лес вокруг: {pct(site.forest)}</div>}
      {site && template === "fisher" && <div>Вода рядом: {pct(site.water)}</div>}
      {site && template === "quarry" && <div>Камень и песок: {pct(site.rock)}</div>}
      {p.storage !== undefined && <div>Склад: +{tons(p.storage)} т провизии</div>}
      {p.fields && (
        <div>
          {p.fields.count > 0 ? (
            <>
              <div>
                Полей: {p.fields.count}, {num(p.fields.ha)} га
              </div>
              <div>Засеяно: {pct(p.fields.sown)}</div>
              <div>
                Сжато: {massText(p.fields.reaped)} из {massText(p.fields.expected)}
              </div>
            </>
          ) : (
            <div class="people-note">Нет полей в радиусе 400 м</div>
          )}
        </div>
      )}
      {p.missing && <div class="prod-warn">{MISSING[p.missing] ?? `Нет: ${p.missing}`}</div>}
    </div>
  );
}

const EMPTY_STOCK: Stock = { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 };

// Inspector of the selected building (right slot).
export function BuildingPanel() {
  const [confirming, setConfirming] = useState(false);
  const id = selectedBuilding.value;
  const b = id === null ? undefined : buildings.value?.[id];
  const t = b ? BUILDINGS[b.template] : undefined;
  const shown = !!b && !!t && !tool.value && rightPanel.value === "inspector";
  const dig = b && b.template === DIG.template && b.state === "active" ? digs.value.find((d) => d.id === b.id) : undefined;
  const info = useResidents(id, shown && b?.state === "active");
  useEffect(() => setConfirming(false), [id]);
  if (!b || !t || !shown) return null;
  const upgrading = b.state === "active" && !!b.upgrade;
  const queued = b.state === "active" && !upgrading ? null : queuedLabel(gameClock.value, state.value?.levers); // «начнут в 07:00» outside work hours
  const shortfall = b.state === "planned" && !b.paid && handHours(t.materials, stock.value ?? EMPTY_STOCK) > 0;
  const chip = buildingStatus(b, info, shortfall);
  const jobs = info?.kind === "workplace" ? info.capacity : t.jobs;
  const capacity =
    t.residents > 0
      ? `Вмещает ${houseCapacity(b)} чел.`
      : b.template === "gumno" && info?.kind !== "workplace"
        ? "Места зависят от полей"
        : jobs > 0
          ? `${jobs} ${plural(jobs, "рабочее место", "рабочих места", "рабочих мест")}`
          : null;
  const occupied = info?.kind === "house" ? info.households.some((h) => h.people.length > 0) : info?.kind === "workplace" && info.workers.length > 0;
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
    <div class="rs-panel inspector panel" role="region" aria-label={`Здание: ${t.name}`}>
      <InspectorHead icon={templateIcon(b.template)} title={t.name} chip={chip} onClose={closePanel} />
      <div class="insp-sub">
        {t.along} × {t.deep} м, высота {b.height} м{b.zone === "res" && b.state === "active" ? ` · уровень ${b.level}` : ""}
      </div>
      {b.onRuins && <div class="people-note">{b.state === "active" ? "Стоит на старом фундаменте" : "Строится на старом фундаменте"}</div>}
      {left > 0 && (
        <div class="insp-block">
          <ProgressBar big value={share} label={upgrading ? "Перестройка" : "Строительство"} />
          <Line icon="hourglass" label={upgrading ? "Перестроено" : "Готово"}>
            {Math.floor(share * 100)} % · осталось {num(left)} чел.-ч
          </Line>
          <Line label="Ждать">{siteEta(left, b.id) || "—"}</Line>
          {queued && <div class="people-note">{queued}</div>}
          <SiteLevers siteKey={b.id} />
        </div>
      )}
      {b.state !== "active" && <SiteMaterials template={b.template} paid={b.paid} hand={b.hand} st={stock.value} />}
      {dig && (
        <div class="prod">
          <div>
            Радиус вскрытия: {Math.round(dig.r)} м из {DIG.maxRadius} м
          </div>
          <div>Вскрыто: {Math.round(revealedArea(dig.r))} м²</div>
          <div>
            Находки: {dig.foundations} {plural(dig.foundations, "фундамент", "фундамента", "фундаментов")}, {dig.pois}{" "}
            {plural(dig.pois, "место", "места", "мест")}, {dig.streets} {plural(dig.streets, "улица", "улицы", "улиц")}
          </div>
          {dig.r >= DIG.maxRadius - 1e-6 && <div class="prod-warn">Раскоп завершён</div>}
        </div>
      )}
      {info?.kind === "house" && (
        <>
          <Line icon="person" label="Жители">
            {residents} из {houseCapacity(b)}
          </Line>
          <Line icon="value" label="Стоимость земли">
            {info.landValue}
          </Line>
          <div class={info.services.length === 0 ? "people-note" : ""}>
            Рядом: {info.services.length > 0 ? info.services.map((sid) => SERVICES[sid].name.toLowerCase()).join(", ") : "ничего из служб"}
          </div>
          {b.template === "izba" && b.level < 2 && !b.upgrade && b.streak > 0 && <div class="people-note">Хороших дней подряд: {b.streak} из 20</div>}
        </>
      )}
      {info?.kind === "workplace" && info.service && (
        <>
          <div>
            Охват {info.service.reach} м: {info.service.covered} из {info.service.houses} домов
          </div>
          {!info.service.working && <div class="prod-warn">Не работает: нет работников</div>}
        </>
      )}
      {capacity && <div>{capacity}</div>}
      {output && (
        <Line icon={output.icon} label={`Делает: ${output.name}`}>
          {b.template === "gumno" ? "вчера собрано" : "вчера"} {num(output.made)} {output.unit}
        </Line>
      )}
      {info?.kind === "workplace" && info.production && <Production template={b.template} p={info.production} />}
      {info?.kind === "house" &&
        (info.households.length === 0 ? (
          <div class="people-note">Пока пустует</div>
        ) : (
          info.households.map((h) => (
            <div class="people" key={h.id}>
              <div class="people-title">Семья {familyGenitive(h.last)}</div>
              <div class={h.mood < 35 ? "prod-warn" : "people-note"}>
                Настроение: {moodWord(h.mood)} ({h.mood})
              </div>
              {h.people.map((p) => (
                <div class="person" key={p.id}>
                  <span class="person-name">{p.name}</span>, {p.age} {plural(p.age, "год", "года", "лет")}
                  <div class="person-role">
                    {p.role}
                    {p.literate && " · грамотный"}
                  </div>
                </div>
              ))}
            </div>
          ))
        ))}
      {info?.kind === "workplace" && info.capacity > 0 && (
        <div class="people">
          <div class="people-title">
            Работники {info.workers.length} из {info.capacity}
          </div>
          {info.workers.map((w) => (
            <div class="person" key={w.id}>
              <span class="person-name">{w.name}</span>, {w.age} {plural(w.age, "год", "года", "лет")}
              <div class="person-role">
                {w.idle && "сейчас на стройке (нет работы) · "}
                {w.commute === null ? "дорога неизвестна" : `дорога ~${Math.round(w.commute)} мин`}
              </div>
            </div>
          ))}
        </div>
      )}
      <div class="insp-actions">
        <Button variant="danger" icon="trash" aria-label="Снести" onClick={() => setConfirming(true)}>
          Снести
        </Button>
      </div>
      {confirming && (
        <Confirm title={`Снести: ${t.name}?`} okLabel="Снести" onOk={onDemolish} onCancel={() => setConfirming(false)}>
          {occupied ? (info?.kind === "house" ? "Здесь живут люди, они останутся без дома." : "Здесь работают люди, они останутся без места.") : "Здание будет снесено."}
          {b.state !== "planned" && b.paid ? " Потраченные материалы не вернутся." : ""}
        </Confirm>
      )}
    </div>
  );
}
