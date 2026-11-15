import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The museum in the interface: its inspector icon and its build-bar tool.
export const museumUi: BuildingUi = {
  icon: "museum",
  tool: {
    icon: "museum",
    color: "#6f6a8a",
    purpose: L("Музей на старом фундаменте: в залах тематические выставки находок; полная выставка даёт знания и привлекает людей", "A museum on an old foundation: its halls show themed exhibitions of finds; a complete one gives knowledge and draws people"),
  },
};
