import { BUILDINGS } from "../sim/buildings";
import { FOOD_RATE } from "../sim/fields";
import { workLength } from "../sim/levers";
import type { ServiceId } from "../sim/types";
import type { IconName } from "../ui/icons";
import { L } from "../i18n";

// The contract of a building's ui.ts (src/buildings/<id>/ui.ts) and the helpers they share. Main thread only.

export interface BuildingUi {
  icon: IconName; // in the inspector (houses, workshops and shops share their class's icon)
  variant?: { label: string; title: string }; // as a kind of a group tool (house, workshop, storehouse, administration)
  tool?: ToolUi; // a build-bar tool of its own, with the template's id
}

export interface ToolUi {
  icon: IconName; // on the build bar
  color: string; // on the map while placing
  purpose: string; // the tool card: what it does
  site?: string; // the tool card: where it may stand (default: by a built road, on free plots)
  reach?: () => string; // the tool card: what it reaches or yields
  hint?: (h: HintParts) => string; // the line under the build bar while placing
}

// The common lines of the placing hints, for a mouse or a finger (ui/BuildBar.tsx).
export interface HintParts {
  place: string; // placing one building
  stroke: string; // laying a row along a road
  service: (id: ServiceId, tail: string) => string; // placing a service, with its reach by road
}

export const radiusText = (id: string): string => L(`Радиус ${BUILDINGS[id].reach} м`, `Radius ${BUILDINGS[id].reach} m`);

// The food a producer gives in its best season with every job filled, a full working day.
export function foodYield(id: string): string {
  const rate = FOOD_RATE[id];
  const kg = Math.round(Math.max(...rate.season) * rate.kgHour * BUILDINGS[id].jobs * workLength());
  return L(`Даёт до ${kg} кг еды в день`, `Yields up to ${kg} kg of food a day`);
}
