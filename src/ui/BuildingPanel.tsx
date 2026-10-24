import { BUILDINGS } from "../sim/buildings";
import { selectedBuilding } from "../map/buildingLayer";
import { tool } from "../map/tools";
import { buildings } from "../simClient";

// Russian plural: one / few / many.
const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

export function BuildingPanel() {
  const id = selectedBuilding.value;
  const b = id === null ? undefined : buildings.value?.[id];
  const t = b ? BUILDINGS[b.template] : undefined;
  if (!b || !t || tool.value) return null;
  const status =
    b.state === "active" ? "Готово" : b.state === "building" ? `Строится ${Math.floor((b.done / b.labor) * 100)} %` : "В планах";
  const capacity =
    t.residents > 0
      ? `${t.residents} ${plural(t.residents, "житель", "жителя", "жителей")}`
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
    </div>
  );
}
