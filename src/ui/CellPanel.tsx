import { hovered } from "../game/state";
import type { Land } from "../world/landcover";

const LAND_RU: Record<Land, string> = {
  water: "Вода",
  forest: "Лес",
  meadow: "Луг",
  wetland: "Болото",
  sand: "Песок",
  rock: "Скалы",
  ice: "Лёд",
};

export function CellPanel() {
  const h = hovered.value;
  if (!h) return null;
  if (h.status !== "ready") {
    return <div class="cell-panel panel">{h.status === "loading" ? "Загрузка…" : "Нет данных"}</div>;
  }
  const i = h.info;
  return (
    <div class="cell-panel panel">
      <div class="cell-land">
        {LAND_RU[i.land]}
        {i.steep && <span class="tag">крутой склон</span>}
      </div>
      <div>
        Высота: {Math.round(i.elevation)} м ({Math.round(i.elevMin)}–{Math.round(i.elevMax)})
      </div>
      <div>Уклон: {Math.round(i.slope)}°</div>
      {i.river && <div>Река рядом</div>}
    </div>
  );
}
