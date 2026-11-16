import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The tavern in the interface: its inspector icon and its build-bar tool.
export const tavernUi: BuildingUi = {
  icon: "trade",
  tool: {
    icon: "tavern",
    color: "#b07d4c",
    purpose: L("Таверны вдоль дороги: вечерний отдых", "Taverns along a road: evening rest"),
    site: L("Вдоль построенной дороги; старые фундаменты у неё — первыми", "Along a built road; old foundations by it go first"),
    hint: (h) => h.stroke,
  },
};
