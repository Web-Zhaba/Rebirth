import { batch, effect, signal } from "@preact/signals";
import { selectedBuilding } from "../map/buildingLayer";
import { selectedSite } from "../map/heritageSpots";
import { tool } from "../map/tools";
import { selectedClearing } from "../map/zoneLayer";
import { cancelUiState } from "./inputModel";

// The right-hand slot (PLAN-ui.md section 5) holds one panel at a time: the inspector of the selected
// building or clearing, the town panel, the notebook, the science panel or an old building to restore.
export type RightPanel = "inspector" | "town" | "notebook" | "tech" | "heritage";

export const rightPanel = signal<RightPanel | null>(null);

// Opens a panel and closes the others; the inspector is opened by selecting something, so asking for
// another panel (or for none) drops the selection.
export function openPanel(p: RightPanel | null): void {
  batch(() => {
    if (p !== "inspector") {
      selectedBuilding.value = null;
      selectedClearing.value = null;
    }
    if (p !== "heritage") selectedSite.value = null;
    rightPanel.value = p;
  });
}

export const closePanel = (): void => openPanel(null);

// Opens `p`, or closes it when it is already the one shown.
export const togglePanel = (p: RightPanel): void => openPanel(rightPanel.peek() === p ? null : p);

// A click on the map selects something: the inspector takes the slot; deselecting frees it.
effect(() => {
  const selected = selectedBuilding.value !== null || selectedClearing.value !== null;
  if (selected) {
    rightPanel.value = "inspector";
    selectedSite.value = null;
  } else if (rightPanel.peek() === "inspector") rightPanel.value = null;
});

// A typed old building selected on the map opens its panel; deselecting frees the slot.
effect(() => {
  if (selectedSite.value !== null) {
    selectedBuilding.value = null;
    selectedClearing.value = null;
    rightPanel.value = "heritage";
  } else if (rightPanel.peek() === "heritage") rightPanel.value = null;
});

// Escape is the universal non-modal cancel: tools, selections and the right slot all close together.
// An open dialog owns Escape and is left to the dialog component.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const next = cancelUiState(
      {
        tool: tool.peek(),
        rightPanel: rightPanel.peek(),
        building: selectedBuilding.peek(),
        clearing: selectedClearing.peek(),
        site: selectedSite.peek(),
      },
      !!document.querySelector("dialog[open]"),
    );
    if (next.tool !== null || next.rightPanel !== null || next.building !== null || next.clearing !== null || next.site !== null) return;
    batch(() => {
      tool.value = null;
      selectedBuilding.value = null;
      selectedClearing.value = null;
      selectedSite.value = null;
      rightPanel.value = null;
    });
  });
}
