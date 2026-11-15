import { type TownModel } from "../../map/townKit";
import { cabin } from "../../map/townForms";

// The district office's 3D model (map/townKit.ts has the shared parts).

export const officeModel: TownModel = { build: (c) => cabin(c) };
