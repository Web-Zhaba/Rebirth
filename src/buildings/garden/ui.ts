import { L } from "../../i18n";
import { foodYield, type BuildingUi } from "../uiKit";

// The vegetable garden in the interface: its inspector icon and its build-bar tool.
export const gardenUi: BuildingUi = {
  icon: "garden",
  tool: {
    icon: "garden",
    color: "#6f8a3a",
    purpose: L("Огород у дома: овощи летом и осенью, зимой не даёт ничего", "A garden by the house: vegetables in summer and autumn, nothing in winter"),
    reach: () => foodYield("garden"),
    hint: (h) => h.place,
  },
};
