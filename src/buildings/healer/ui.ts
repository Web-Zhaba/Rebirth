import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The infirmary in the interface: its inspector icon and its build-bar tool.
export const healerUi: BuildingUi = {
  icon: "healer",
  tool: {
    icon: "healer",
    color: "#b24d46",
    purpose: L("Лечит: меньше смертей, настроение выше", "Heals: fewer deaths, higher mood"),
    hint: (h) => h.service("healer", L(", нужен работник", ", needs a worker")),
  },
};
