import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";
import { DIG } from "../../sim/excavation";

// The dig in the interface: its inspector icon and its build-bar tool.
export const digUi: BuildingUi = {
  icon: "dig",
  tool: {
    icon: "dig",
    color: "#7d6340",
    purpose: L("Раскоп на месте старых построек: находки для тетради, камень от фундаментов", "A dig on the site of old buildings: finds for the notebook, stone from foundations"),
    reach: () => L(`Вскрывает ${DIG.startRadius} м, потом растёт до ${DIG.maxRadius} м и снимается сам`, `Opens ${DIG.startRadius} m, then grows to ${DIG.maxRadius} m and removes itself`),
    hint: (h) => `${h.place}. ${L(`Круг — первое вскрытие (${DIG.startRadius} м), потом растёт до ${DIG.maxRadius} м и снимается, а найденное остаётся на карте`, `Circle — the first opening (${DIG.startRadius} m); it grows to ${DIG.maxRadius} m and is then removed, while the finds stay on the map`)}`,
    context: "ruins",
  },
};
