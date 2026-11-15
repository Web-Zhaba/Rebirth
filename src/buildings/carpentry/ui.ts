import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The carpentry workshop in the interface: its inspector icon and its kind on a build-bar tool.
export const carpentryUi: BuildingUi = {
  icon: "craft",
  variant: { label: L("Столярная", "Carpentry"), title: L("Столярная мастерская: утварь из досок", "Carpentry workshop: furnishings from planks") },
};
