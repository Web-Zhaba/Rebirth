import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The district office in the interface: its inspector icon and its kind on a build-bar tool.
export const officeUi: BuildingUi = {
  icon: "townhall",
  variant: { label: L("Управа", "Office"), title: L("Районная управа", "District office") },
};
