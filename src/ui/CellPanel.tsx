import { buildOn, selectCell } from "../actions";
import { BUILDABLE_TYPES, BUILDINGS, RESOURCES, type BuildingType } from "../game/defs";
import { canBuild } from "../game/placement";
import { buildCost, buildingOutput, rates, yieldMult } from "../game/sim";
import { economy, hovered, selectedData } from "../game/state";
import type { CellInfo } from "../world/cells";
import type { Land } from "../world/landcover";
import { fmtRate, RES_ICON } from "./format";

const LAND_RU: Record<Land, string> = {
  water: "Вода",
  forest: "Лес",
  meadow: "Луг",
  wetland: "Болото",
  sand: "Песок",
  rock: "Скалы",
  ice: "Лёд",
};

function Info({ i }: { i: CellInfo }) {
  return (
    <>
      <div class="cell-land">
        {LAND_RU[i.land]}
        {i.steep && <span class="tag">крутой склон</span>}
      </div>
      <div>
        Высота: {Math.round(i.elevation)} м ({Math.round(i.elevMin)}–{Math.round(i.elevMax)})
      </div>
      <div>Уклон: {Math.round(i.slope)}°</div>
      {i.river && <div>Река рядом</div>}
    </>
  );
}

function effectText(type: BuildingType, mult: number): string {
  const def = BUILDINGS[type];
  const parts: string[] = [];
  if (def.housing) parts.push(`🏠 +${def.housing}`);
  for (const r of RESOURCES) {
    const rate = def.rates[r];
    if (rate) parts.push(`${RES_ICON[r]} ${fmtRate(rate * mult, 2)}`);
  }
  if (type === "well") parts.push("💧 вода рядом");
  return parts.join(" ");
}

function costText(cost: Record<"food" | "wood" | "stone", number>): string {
  return RESOURCES.filter((r) => cost[r] > 0)
    .map((r) => `${RES_ICON[r]}${cost[r]}`)
    .join(" ");
}

function Selected() {
  const d = selectedData.value!;
  const e = economy.value;
  const close = (
    <button class="close" aria-label="Закрыть" onClick={() => selectCell(null)}>
      ×
    </button>
  );
  if (d.status !== "ready" || !e) {
    return (
      <div class="cell-panel panel interactive">
        {close}
        {d.status === "error" ? "Нет данных" : "Загрузка…"}
      </div>
    );
  }
  const { info, neighbours } = d;
  const placed = e.buildings[d.cell];
  const r = rates(e);
  return (
    <div class="cell-panel panel interactive">
      {close}
      <Info i={info} />
      {placed ? (
        <div class="bld-current">
          <div class="cell-land">
            {BUILDINGS[placed.type].emoji} {BUILDINGS[placed.type].name}
          </div>
          {BUILDINGS[placed.type].housing > 0 && <div>Жильё: +{BUILDINGS[placed.type].housing}</div>}
          {RESOURCES.map((k) => {
            const v = buildingOutput(placed, r.staffing)[k];
            return v ? (
              <div key={k}>
                {RES_ICON[k]} {fmtRate(v, 2)}
              </div>
            ) : null;
          })}
          {BUILDINGS[placed.type].workers > 0 && (
            <div class="muted">
              Работники: {BUILDINGS[placed.type].workers}, укомплектовано {Math.round(r.staffing * 100)}%
            </div>
          )}
        </div>
      ) : (
        <div class="bld-list">
          {BUILDABLE_TYPES.map((t) => {
            const res = canBuild(t, { info, neighbours, state: e });
            return (
              <div class="bld" key={t}>
                <div class="bld-head">
                  <span>
                    {BUILDINGS[t].emoji} {BUILDINGS[t].name}
                  </span>
                  <span class="muted">{costText(buildCost(t, e))}</span>
                </div>
                <div class="muted">{effectText(t, yieldMult(t, info))}</div>
                <button disabled={!res.ok} onClick={() => buildOn(d.cell, t)}>
                  Построить
                </button>
                {!res.ok && <div class="reason">{res.reason}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CellPanel() {
  if (selectedData.value) return <Selected />;
  const h = hovered.value;
  if (!h) return null;
  if (h.status !== "ready") {
    return <div class="cell-panel panel">{h.status === "loading" ? "Загрузка…" : "Нет данных"}</div>;
  }
  return (
    <div class="cell-panel panel">
      <Info i={h.info} />
    </div>
  );
}
