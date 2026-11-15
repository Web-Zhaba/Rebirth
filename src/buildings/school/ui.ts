import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The school in the interface: its inspector icon and its build-bar tool.
export const schoolUi: BuildingUi = {
  icon: "school",
  tool: {
    icon: "school",
    color: "#3f8a6b",
    purpose: L("Учит детей грамоте, грамотные работают лучше", "Teaches children to read; literate people work better"),
    hint: (h) => h.service("school", L(", нужны работники", ", needs workers")),
  },
};
