import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The timber yard in the interface: its inspector icon and its kind on a build-bar tool.
export const logyardUi: BuildingUi = {
  icon: "barn",
  variant: { label: L("Лес", "Timber"), title: L("Склад леса: брёвна и доски", "Timber yard: logs and planks") },
};
