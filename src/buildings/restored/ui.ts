import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The monument in the interface: its inspector icon and its build-bar tool.
export const restoredUi: BuildingUi = {
  icon: "foundations",
  tool: {
    icon: "monument",
    color: "#8a7f6a",
    purpose: L("Сохранить старую постройку памятником на её фундаменте: без жителей и работы, рядом людям лучше и земля дороже", "Keep an old building as a monument on its foundation: no residents or jobs; people nearby feel better and land is worth more"),
  },
};
