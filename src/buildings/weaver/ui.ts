import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The weaving workshop in the interface: its inspector icon and its kind on a build-bar tool.
export const weaverUi: BuildingUi = {
  icon: "craft",
  variant: { label: L("Ткацкая", "Weaving"), title: L("Ткацкая мастерская: одежда", "Weaving workshop: clothing") },
};
