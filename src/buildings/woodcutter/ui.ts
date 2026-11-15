import { L } from "../../i18n";
import { radiusText, type BuildingUi } from "../uiKit";
import { BUILDINGS } from "../../sim/buildings";

// The woodcutter in the interface: its inspector icon and its build-bar tool.
export const woodcutterUi: BuildingUi = {
  icon: "woodcutter",
  tool: {
    icon: "woodcutter",
    color: "#5c7342",
    purpose: L("Валит лес вокруг и приносит брёвна на склад", "Fells the forest around and brings logs to the store"),
    site: L(`В лесу: от ${Math.round(BUILDINGS.woodcutter.needs!.forest! * 100)} % леса в ${BUILDINGS.woodcutter.reach} м вокруг`, `In forest: at least ${Math.round(BUILDINGS.woodcutter.needs!.forest! * 100)}% forest within ${BUILDINGS.woodcutter.reach} m`),
    reach: () => radiusText("woodcutter"),
    hint: (h) => `${h.place}. ${L(`Круг — лес вокруг (${BUILDINGS.woodcutter.reach} м)`, `Circle — forest around (${BUILDINGS.woodcutter.reach} m)`)}`,
    context: "forest",
  },
};
