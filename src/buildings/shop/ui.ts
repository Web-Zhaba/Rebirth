import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";
import { SERVICES } from "../../sim/services";

// The shop in the interface: its inspector icon and its build-bar tool.
export const shopUi: BuildingUi = {
  icon: "trade",
  tool: {
    icon: "shop",
    color: "#b07d4c",
    purpose: L("Магазины вдоль дороги: раздают товары по домам, настроение жителей рядом выше", "Shops along a road: hand goods out to the houses; people nearby feel better"),
    site: L("Вдоль построенной дороги; старые фундаменты у неё — первыми", "Along a built road; old foundations by it go first"),
    hint: (h) => `${h.stroke}. ${L(`Охват ${SERVICES.shop.reach} м по дорогам, нужны работники`, `Reach ${SERVICES.shop.reach} m by road, needs workers`)}`,
  },
};
