import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The quarry in the interface: its inspector icon and its build-bar tool.
export const quarryUi: BuildingUi = {
  icon: "quarry",
  tool: {
    icon: "quarry",
    color: "#7d7f82",
    purpose: L("Добывает камень", "Quarries stone"),
    site: L("Не на воде и не на болоте; камень добывается на любой суше", "Not on water or marsh; stone can be quarried on any land"),
    hint: (h) => h.place,
    context: "quarry",
  },
};
