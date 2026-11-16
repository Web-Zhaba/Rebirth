import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The pottery in the interface: its inspector icon and its kind on a build-bar tool.
export const potteryUi: BuildingUi = {
  icon: "craft",
  variant: { label: L("Гончарня", "Pottery"), title: L("Гончарня: посуда", "Pottery: dishes") },
};
