import { L } from "../../i18n";
import { radiusText, type BuildingUi } from "../uiKit";
import { BUILDINGS } from "../../sim/buildings";

// The fishing pier in the interface: its inspector icon and its build-bar tool.
export const fisherUi: BuildingUi = {
  icon: "fisher",
  tool: {
    icon: "fisher",
    color: "#4a7088",
    purpose: L("Ловит рыбу, еда без полей", "Catches fish: food without fields"),
    site: L(`У воды: от ${Math.round(BUILDINGS.fisher.needs!.water! * 100)} % воды в ${BUILDINGS.fisher.reach} м вокруг`, `By water: at least ${Math.round(BUILDINGS.fisher.needs!.water! * 100)}% water within ${BUILDINGS.fisher.reach} m`),
    reach: () => radiusText("fisher"),
    hint: (h) => `${h.place}. ${L(`Круг — вода рядом (${BUILDINGS.fisher.reach} м)`, `Circle — water nearby (${BUILDINGS.fisher.reach} m)`)}`,
  },
};
