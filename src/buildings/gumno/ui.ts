import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";
import { FIELD } from "../../sim/fields";

// The farm in the interface: its inspector icon and its build-bar tool.
export const gumnoUi: BuildingUi = {
  icon: "gumno",
  tool: {
    icon: "gumno",
    color: "#b8963f",
    purpose: L("Ферма: даёт работу на полях рядом и хранит урожай", "Farm: provides work on the nearby fields and stores the harvest"),
    reach: () => L(`Поля до ${FIELD.radius} м от фермы`, `Fields within ${FIELD.radius} m of the farm`),
    hint: (h) => `${h.place}. ${L(`Круг — досягаемость полей (${FIELD.radius} м)`, `Circle — field reach (${FIELD.radius} m)`)}`,
  },
};
