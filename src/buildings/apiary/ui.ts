import { L } from "../../i18n";
import { foodYield, type BuildingUi } from "../uiKit";

// The apiary in the interface: its inspector icon and its build-bar tool.
export const apiaryUi: BuildingUi = {
  icon: "apiary",
  tool: {
    icon: "apiary",
    color: "#c49a2c",
    purpose: L("Пасека: мёд летом и осенью, пчёлы летают только в тёплую сухую тихую погоду", "Apiary: honey in summer and autumn; bees fly only in warm, dry, calm weather"),
    site: L("Не на воде и не на болоте", "Not on water or marsh"),
    reach: () => foodYield("apiary"),
    hint: (h) => h.place,
  },
};
