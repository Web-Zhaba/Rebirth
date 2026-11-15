import type { TownModel } from "../map/townKit";
import type { TemplateId } from "./rules";
import { izbaModel } from "./izba/model";
import { izba5Model } from "./izba5/model";
import { smithyModel } from "./smithy/model";
import { carpentryModel } from "./carpentry/model";
import { potteryModel } from "./pottery/model";
import { weaverModel } from "./weaver/model";
import { shopModel } from "./shop/model";
import { tavernModel } from "./tavern/model";
import { gumnoModel } from "./gumno/model";
import { woodcutterModel } from "./woodcutter/model";
import { sawpitModel } from "./sawpit/model";
import { quarryModel } from "./quarry/model";
import { fisherModel } from "./fisher/model";
import { barnModel } from "./barn/model";
import { wellModel } from "./well/model";
import { marketModel } from "./market/model";
import { chapelModel } from "./chapel/model";
import { schoolModel } from "./school/model";
import { healerModel } from "./healer/model";
import { gardenModel } from "./garden/model";
import { hunterModel } from "./hunter/model";
import { foragerModel } from "./forager/model";
import { orchardModel } from "./orchard/model";
import { apiaryModel } from "./apiary/model";
import { cellarModel } from "./cellar/model";
import { logyardModel } from "./logyard/model";
import { stoneyardModel } from "./stoneyard/model";
import { warehouseModel } from "./warehouse/model";
import { townhallModel } from "./townhall/model";
import { officeModel } from "./office/model";
import { digModel } from "./dig/model";
import { museumModel } from "./museum/model";

// Every building's 3D model (src/buildings/<id>/model.ts). null: drawn elsewhere (a foundation dig on the ruins layer,
// a monument as the old building it was, map/heritageModels.ts); map/townModels.ts draws a log house for it.
export const MODELS: Record<TemplateId, TownModel | null> = {
  izba: izbaModel,
  izba5: izba5Model,
  smithy: smithyModel,
  carpentry: carpentryModel,
  pottery: potteryModel,
  weaver: weaverModel,
  shop: shopModel,
  tavern: tavernModel,
  gumno: gumnoModel,
  woodcutter: woodcutterModel,
  sawpit: sawpitModel,
  quarry: quarryModel,
  fisher: fisherModel,
  barn: barnModel,
  well: wellModel,
  market: marketModel,
  chapel: chapelModel,
  school: schoolModel,
  healer: healerModel,
  garden: gardenModel,
  hunter: hunterModel,
  forager: foragerModel,
  orchard: orchardModel,
  apiary: apiaryModel,
  cellar: cellarModel,
  logyard: logyardModel,
  stoneyard: stoneyardModel,
  warehouse: warehouseModel,
  townhall: townhallModel,
  office: officeModel,
  dig: digModel,
  museum: museumModel,
  excavation: null,
  restored: null,
};
