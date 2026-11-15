import { L } from "../../i18n";
import { radiusText, type BuildingUi } from "../uiKit";
import { BUILDINGS } from "../../sim/buildings";

// The forager in the interface: its inspector icon and its build-bar tool.
export const foragerUi: BuildingUi = {
  icon: "forager",
  tool: {
    icon: "forager",
    color: "#5f7a52",
    purpose: L("Ягоды, грибы и орехи: летом и осенью, весной немного, зимой и под снегом ничего", "Berries, mushrooms and nuts: summer and autumn, a little in spring, nothing in winter or under snow"),
    site: L(`В лесу: от ${Math.round(BUILDINGS.forager.needs!.forest! * 100)} % леса в ${BUILDINGS.forager.reach} м вокруг`, `In forest: at least ${Math.round(BUILDINGS.forager.needs!.forest! * 100)}% forest within ${BUILDINGS.forager.reach} m`),
    reach: () => radiusText("forager"),
    hint: (h) => `${h.place}. ${L(`Круг — лес вокруг (${BUILDINGS.forager.reach} м)`, `Circle — forest around (${BUILDINGS.forager.reach} m)`)}`,
  },
};
