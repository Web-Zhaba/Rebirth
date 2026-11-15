import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The temple in the interface: its inspector icon and its build-bar tool.
export const chapelUi: BuildingUi = {
  icon: "chapel",
  tool: {
    icon: "chapel",
    color: "#85689f",
    purpose: L("Место для общей жизни: настроение людей", "A place for community life: people’s mood"),
    hint: (h) => h.service("chapel", L(", нужен работник", ", needs a worker")),
  },
};
