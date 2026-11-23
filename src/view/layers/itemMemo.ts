import type { Light } from "../../map/life";
import type { Building, Finds } from "../../sim/types";
import type { FlagDesign } from "../../sim/heraldry";

// What a building's model item was made of. Snapshots carry only what changed (sim/delta.ts), so an untouched building
// is the same object as in the previous one; two keys that agree on every part describe the same picture, and the item
// built from the first still does. Kept pure: the layer owns the memo, this owns the rule.
export interface ItemKey {
  building: Building;
  finds: Finds;
  overlay: string; // the colouring overlay in effect (map/tools.ts `Overlay`)
  lamp: Light["kind"] | undefined; // lit in the evening like this, absent: dark
  flag: FlagDesign | undefined; // the town hall's colours, on the seat of the town
  tint: string; // the overlay colour of this building, "" for none
  step: number; // progress in 1/24s (progressStep): a site growing slowly keeps its item between steps
}

export const sameKey = (a: ItemKey, b: ItemKey): boolean =>
  a.building === b.building && a.finds === b.finds && a.overlay === b.overlay && a.lamp === b.lamp && a.flag === b.flag && a.tint === b.tint && a.step === b.step;

// Progress quantised the way a model is: the site look has PROGRESS_STEPS of it, so a tick that moves a site by a
// hundredth of its work asks for no new model.
export const PROGRESS_STEPS = 24;
export const progressStep = (progress: number): number => (progress >= 1 ? PROGRESS_STEPS : Math.floor(progress * PROGRESS_STEPS));
