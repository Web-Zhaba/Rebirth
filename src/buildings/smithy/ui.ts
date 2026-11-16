import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The smithy in the interface: its inspector icon and its kind on a build-bar tool.
export const smithyUi: BuildingUi = {
  icon: "craft",
  variant: { label: L("Кузница", "Smithy"), title: L("Кузница: инструменты", "Smithy: tools") },
};
