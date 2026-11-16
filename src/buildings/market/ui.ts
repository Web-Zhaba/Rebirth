import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The market in the interface: its inspector icon and its build-bar tool.
export const marketUi: BuildingUi = {
  icon: "trade",
  tool: {
    icon: "trade",
    color: "#b9772f", // a trade building, not a service
    purpose: L("Рынок: работники обменивают товары с соседями, заказы обмена задают в окне рынка", "Market: workers swap goods with the neighbours; set the trade orders in the market window"),
    hint: (h) => h.place,
  },
};
