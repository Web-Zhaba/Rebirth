import { type TownModel } from "../../map/townKit";
import { cabin } from "../../map/townForms";

// The house's 3D model (map/townKit.ts has the shared parts).

export const izbaModel: TownModel = { build: (c) => cabin(c) };
