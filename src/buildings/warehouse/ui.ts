import { L } from "../../i18n";
import type { BuildingUi } from "../uiKit";

// The warehouse in the interface: its inspector icon and its kind on a build-bar tool.
export const warehouseUi: BuildingUi = {
  icon: "barn",
  variant: { label: L("Товары", "Goods"), title: L("Товарный склад: одежда, посуда, утварь, инструменты", "Warehouse: clothing, dishes, furnishings, tools") },
};
