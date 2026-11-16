import { type TownModel } from "../../map/townKit";
import { cabin } from "../../map/townForms";

// The museum's 3D model where it is not the old building restored as it was (that one is drawn as the old building,
// map/heritageModels.ts): a log house.
export const museumModel: TownModel = { build: (c) => cabin(c) };
