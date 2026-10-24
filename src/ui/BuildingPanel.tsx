import { useEffect, useState } from "preact/hooks";
import { BUILDINGS } from "../sim/buildings";
import { familyGenitive } from "../sim/people";
import type { BuildingQuery, ProductionInfo, Stock } from "../sim/types";
import { selectedBuilding } from "../map/buildingLayer";
import { flash, tool } from "../map/tools";
import { buildings, queryBuilding, sendCmd } from "../simClient";

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
                Сжато: {tons(p.fields.reaped)} из {tons(p.fields.expected)} т
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
  const info = useResidents(id, shown && b?.state === "active");
  if (!b || !t || !shown) return null;
  const status =
    b.state === "active" ? "Готово" : b.state === "building" ? `Строится ${Math.floor((b.done / b.labor) * 100)} %` : "В планах";
  const jobs = info?.kind === "workplace" ? info.capacity : t.jobs;
  const capacity =
    t.residents > 0
      ? `Вмещает ${t.residents} чел.`
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
        ×
      </button>
      <div class="building-name">{t.name}</div>
      <div>{status}</div>
      <div>
        {t.along} × {t.deep} м, высота {t.height} м
      </div>
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
                  <div class="person-role">{p.role}</div>
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
              <div class="person-role">{w.commute === null ? "дорога неизвестна" : `дорога ~${Math.round(w.commute)} мин`}</div>
            </div>
          ))}
        </div>
      )}
      <button class="demolish" onClick={onDemolish}>
        Снести
      </button>
    </div>
  );
}
