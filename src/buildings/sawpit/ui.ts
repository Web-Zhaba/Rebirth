import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The sawmill in the interface: its inspector icon and its build-bar tool.
export const sawpitUi: BuildingUi = {
  icon: "sawpit",
  tool: {
    icon: "sawpit",
    color: "#a97d4d",
    purpose: L("Пилит брёвна в доски", "Saws logs into planks"),
    hint: (h) => h.place,
  },
};
