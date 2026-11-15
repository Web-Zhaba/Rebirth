import { L } from "../../i18n";
import { foodYield, type BuildingUi } from "../uiKit";

// The hunting post in the interface: its inspector icon and its build-bar tool.
export const hunterUi: BuildingUi = {
  icon: "hunter",
  tool: {
    icon: "hunter",
    color: "#7a5a3c",
    purpose: L("Охотник приносит дичь, зимой и осенью больше всего", "The hunter brings game, most of all in winter and autumn"),
    reach: () => foodYield("hunter"),
    hint: (h) => h.place,
  },
};
