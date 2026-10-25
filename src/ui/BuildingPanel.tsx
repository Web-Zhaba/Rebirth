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
import { flash, tool } from "../map/tools";
import { buildings, digs, gameClock, queryBuilding, sendCmd, state, stock } from "../simClient";
import { Icon } from "./Icon";
import { Button } from "./kit";

const REFRESH_MS = 4000;

// Russian plural: one / few / many.
const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

const pct = (v: number) => `${Math.round(v * 100)} %`;
const num = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace(".", ",");
const tons = (kg: number) => (Math.round(kg / 100) / 10).toString().replace(".", ",");

const GOOD: Record<keyof Stock, { name: string; unit: string }> = {
  food: { name: "провизии", unit: "кг" },
  logs: { name: "брёвен", unit: "м³" },
  planks: { name: "досок", unit: "м³" },
  stone: { name: "камня", unit: "т" },
  wares: { name: "утвари", unit: "шт" },
};

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

// Game time to wait, in words: «3 ч», «2 дн.».
const waitText = (min: number) => (min >= 1440 ? `${Math.ceil(min / 1440)} дн.` : `${Math.max(1, Math.ceil(min / 60))} ч`);

// Levers for a site that still needs work: served first, and a толока (all adults come, production stands).
function SiteLevers({ id }: { id: number }) {
  const lv = state.value?.levers;
  if (!lv) return null;
  const first = lv.priority === id;
  const wait = Math.max(0, lv.tolokaReady - gameClock.value);
  const running = !!lv.toloka && gameClock.value < lv.toloka.until;
  const act = (cmd: Parameters<typeof sendCmd>[0]) =>
    void sendCmd(cmd).then((r) => {
      if (!r.ok) flash(r.reason ?? "Не удалось");
    });
  return (
    <div class="site-levers">
      <Button aria-label="В первую очередь" aria-pressed={first} variant={first ? "primary" : "default"} onClick={() => act({ type: "setPriority", key: first ? null : id })}>
        {first ? "Первая очередь: снять" : "В первую очередь"}
      </Button>
      <Button
        aria-label="Толока"
        title="Все взрослые идут на эту стройку до конца рабочего дня, прочие дела стоят"
        disabled={wait > 0 || running}
        onClick={() => act({ type: "callToloka", key: id })}
      >
        {running ? "Толока идёт" : wait > 0 ? `Толока (через ${waitText(wait)})` : "Толока"}
      </Button>
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
  const good = p.good ? GOOD[p.good] : null;
  const site = p.site;
  return (
    <div class="prod">
      {good && p.good && (
        <div>
          {template === "gumno" ? "Вчера собрано" : "Вчера сделано"}: {num(p.yesterday)} {good.unit}
        </div>
      )}
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

export function BuildingPanel() {
  const id = selectedBuilding.value;
  const b = id === null ? undefined : buildings.value?.[id];
  const t = b ? BUILDINGS[b.template] : undefined;
  const shown = !!b && !!t && !tool.value;
  const dig = b && b.template === DIG.template && b.state === "active" ? digs.value.find((d) => d.id === b.id) : undefined;
  const info = useResidents(id, shown && b?.state === "active");
  if (!b || !t || !shown) return null;
  const queued = b.state === "active" ? null : queuedLabel(gameClock.value, state.value?.levers); // «начнут в 07:00» outside work hours
  const status =
    (b.state === "active" ? "Готово" : b.state === "building" ? `Строится ${Math.floor((b.done / b.labor) * 100)} %` : "В планах") + (queued ? ` · ${queued}` : "");
  const jobs = info?.kind === "workplace" ? info.capacity : t.jobs;
  const capacity =
    t.residents > 0
      ? `Вмещает ${houseCapacity(b)} чел.`
      : b.template === "gumno" && info?.kind !== "workplace"
        ? "Места зависят от полей"
        : jobs > 0
          ? `${jobs} ${plural(jobs, "рабочее место", "рабочих места", "рабочих мест")}`
          : null;
  const onDemolish = () => {
    const occupied =
      info?.kind === "house" ? info.households.some((h) => h.people.length > 0) : info?.kind === "workplace" && info.workers.length > 0;
    if (occupied && !confirm(`Снести: ${t.name}? Здесь ${info?.kind === "house" ? "живут люди" : "работают люди"}.`)) return;
    void sendCmd({ type: "demolish", id: b.id }).then((r) => {
      if (!r.ok) flash(r.reason ?? "Не удалось снести");
    });
    selectedBuilding.value = null;
  };
  return (
    <div class="building-panel panel">
      <button class="close" aria-label="Закрыть" onClick={() => (selectedBuilding.value = null)}>
        <Icon name="close" size={16} />
      </button>
      <div class="building-name">{t.name}</div>
      <div>{status}</div>
      <div>
        {t.along} × {t.deep} м, высота {b.height} м
      </div>
      {b.zone === "res" && b.state === "active" && <div>Уровень {b.level}</div>}
      {b.onRuins && <div class="people-note">{b.state === "active" ? "Стоит на старом фундаменте" : "Строится на старом фундаменте"}</div>}
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
      {(b.state !== "active" || !!b.upgrade) && <SiteLevers id={b.id} />}
      {b.state !== "active" && <SiteMaterials template={b.template} paid={b.paid} hand={b.hand} st={stock.value} />}
      {b.upgrade && <div class="people-note">Перестраивается: {Math.floor((b.upgrade.done / b.upgrade.labor) * 100)} %</div>}
      {info?.kind === "house" && (
        <>
          <div>Стоимость земли: {info.landValue}</div>
          <div class={info.services.length === 0 ? "people-note" : ""}>
            Рядом: {info.services.length > 0 ? info.services.map((id) => SERVICES[id].name.toLowerCase()).join(", ") : "ничего из служб"}
          </div>
          {b.template === "izba" && b.level < 2 && !b.upgrade && b.streak > 0 && (
            <div class="people-note">Хороших дней подряд: {b.streak} из 20</div>
          )}
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
      <button class="demolish" onClick={onDemolish}>
        <Icon name="trash" size={16} />
        Снести
      </button>
    </div>
  );
}
