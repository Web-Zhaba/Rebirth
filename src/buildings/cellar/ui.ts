import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The cellar in the interface: its inspector icon and its build-bar tool.
export const cellarUi: BuildingUi = {
  icon: "cellar",
  tool: {
    icon: "cellar",
    color: "#7a6048",
    purpose: L("Погреб: хранит запасы лучше склада, меньше портится в жару и сырость", "Cellar: keeps stores better than a storehouse, less spoils in heat and damp"),
    hint: (h) => h.place,
  },
};
