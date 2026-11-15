import { type TownModel } from "../../map/townKit";
import { cabin } from "../../map/townForms";

// The large house's 3D model (map/townKit.ts has the shared parts).

export const izba5Model: TownModel = { build: (c) => cabin(c) };
