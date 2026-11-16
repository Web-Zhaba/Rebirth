import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The well in the interface: its inspector icon and its build-bar tool.
export const wellUi: BuildingUi = {
  icon: "well",
  tool: {
    icon: "well",
    color: "#4f7f9c",
    purpose: L("Вода рядом с домами: настроение и здоровье", "Water near the houses: mood and health"),
    hint: (h) => h.service("well", ""),
  },
};
