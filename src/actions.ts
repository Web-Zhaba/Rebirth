// The only glue between world/ (terrain analysis) and game/ (economy).
import { gridDisk } from "h3-js";
import { analyzeCell, type CellInfo } from "./world/cells";
import type { BuildingType } from "./game/defs";
import { canBuild } from "./game/placement";
import { advanceTo, build } from "./game/sim";
import { saveNow } from "./game/loop";
import { economy, selected, selectedData } from "./game/state";

// Selects a cell (or clears with null) and loads terrain for it and its ring-1 neighbours.
export function selectCell(cell: string | null): void {
  selected.value = cell;
  if (!cell) {
    selectedData.value = null;
    return;
  }
  selectedData.value = { cell, status: "loading" };
  const ring = gridDisk(cell, 1).filter((c) => c !== cell);
  Promise.all([analyzeCell(cell), Promise.allSettled(ring.map(analyzeCell))]).then(
    ([info, rest]) => {
      if (selected.value !== cell) return;
      const neighbours = rest.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      selectedData.value = { cell, status: "ready", info, neighbours };
    },
    () => {
      if (selected.value === cell) selectedData.value = { cell, status: "error" };
    },
  );
}

// Re-checks the rules against fresh state, then builds and saves immediately.
export function buildOn(cell: string, type: BuildingType): boolean {
  const data = selectedData.value;
  const cur = economy.value;
  if (!cur || !data || data.cell !== cell || data.status !== "ready") return false;
  const state = advanceTo(cur, Date.now());
  if (!canBuild(type, { info: data.info as CellInfo, neighbours: data.neighbours, state }).ok) return false;
  economy.value = build(state, type, cell, data.info);
  saveNow();
  return true;
}
