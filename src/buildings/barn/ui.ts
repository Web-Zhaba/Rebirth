import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The barn in the interface: its inspector icon and its kind on a build-bar tool.
export const barnUi: BuildingUi = {
  icon: "barn",
  variant: { label: L("Еда", "Food"), title: L("Амбар: зерно и припасы", "Barn: grain and provisions") },
};
