import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The stone yard in the interface: its inspector icon and its kind on a build-bar tool.
export const stoneyardUi: BuildingUi = {
  icon: "barn",
  variant: { label: L("Камень", "Stone"), title: L("Склад камня", "Stone yard") },
};
