import { useEffect, useState } from "preact/hooks";
import { BUILDINGS } from "../sim/buildings";
import { familyGenitive } from "../sim/people";
import type { BuildingQuery } from "../sim/types";
import { selectedBuilding } from "../map/buildingLayer";
import { tool } from "../map/tools";
import { buildings, queryBuilding } from "../simClient";

const REFRESH_MS = 4000;

// Russian plural: one / few / many.
const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

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

export function BuildingPanel() {
  const id = selectedBuilding.value;
  const b = id === null ? undefined : buildings.value?.[id];
  const t = b ? BUILDINGS[b.template] : undefined;
  const shown = !!b && !!t && !tool.value;
  const info = useResidents(id, shown && b?.state === "active");
  if (!b || !t || !shown) return null;
  const status =
    b.state === "active" ? "Готово" : b.state === "building" ? `Строится ${Math.floor((b.done / b.labor) * 100)} %` : "В планах";
  const capacity =
    t.residents > 0
      ? `Вмещает ${t.residents} чел.`
      : `${t.jobs} ${plural(t.jobs, "рабочее место", "рабочих места", "рабочих мест")}`;
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
      <div>{capacity}</div>
      {info?.kind === "house" &&
        (info.households.length === 0 ? (
          <div class="people-note">Пока пустует</div>
        ) : (
          info.households.map((h) => (
            <div class="people" key={h.id}>
              <div class="people-title">Семья {familyGenitive(h.last)}</div>
              {h.people.map((p) => (
                <div class="person" key={p.id}>
                  <span class="person-name">{p.name}</span>, {p.age} {plural(p.age, "год", "года", "лет")}
                  <div class="person-role">{p.role}</div>
                </div>
              ))}
            </div>
          ))
        ))}
      {info?.kind === "workplace" && (
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
    </div>
  );
}
