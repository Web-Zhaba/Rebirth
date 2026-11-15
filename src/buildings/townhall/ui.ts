import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The town hall in the interface: its inspector icon and its kind on a build-bar tool.
export const townhallUi: BuildingUi = {
  icon: "townhall",
  variant: { label: L("Ратуша", "Town hall"), title: L("Ратуша: одна на город", "Town hall: one per town") },
};
