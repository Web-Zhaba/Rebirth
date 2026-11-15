import { L } from "../../i18n";
import { foodYield, type BuildingUi } from "../uiKit";

// The orchard in the interface: its inspector icon and its build-bar tool.
export const orchardUi: BuildingUi = {
  icon: "orchard",
  tool: {
    icon: "orchard",
    color: "#8f9a3c",
    purpose: L("Фруктовый сад: плодоносит через год после посадки, осенью; заморозки в цвету и засуха снижают урожай", "Fruit orchard: bears fruit in autumn from a year after planting; frost at blossom and drought cut the yield"),
    site: L("Не на воде и не на болоте", "Not on water or marsh"),
    reach: () => foodYield("orchard"),
    hint: (h) => h.place,
  },
};
