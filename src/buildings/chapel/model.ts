import { type TownModel } from "../../map/townKit";
import { buildHeritageModel } from "../../map/heritageModels";

// The temple's 3D model: a hall of worship as the old buildings have them (map/heritageModels.ts), a little lower than
// its template height.
export const chapelModel: TownModel = { whole: (ring, height, opts) => buildHeritageModel(ring, height * 0.75, "place_of_worship", opts.seed) };
