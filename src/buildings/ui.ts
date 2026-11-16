import type { BuildingUi } from "./uiKit";
import type { TemplateId } from "./rules";
import { izbaUi } from "./izba/ui";
import { izba5Ui } from "./izba5/ui";
import { smithyUi } from "./smithy/ui";
import { carpentryUi } from "./carpentry/ui";
import { potteryUi } from "./pottery/ui";
import { weaverUi } from "./weaver/ui";
import { shopUi } from "./shop/ui";
import { tavernUi } from "./tavern/ui";
import { gumnoUi } from "./gumno/ui";
import { woodcutterUi } from "./woodcutter/ui";
import { sawpitUi } from "./sawpit/ui";
import { quarryUi } from "./quarry/ui";
import { fisherUi } from "./fisher/ui";
import { barnUi } from "./barn/ui";
import { wellUi } from "./well/ui";
import { marketUi } from "./market/ui";
import { chapelUi } from "./chapel/ui";
import { schoolUi } from "./school/ui";
import { healerUi } from "./healer/ui";
import { gardenUi } from "./garden/ui";
import { hunterUi } from "./hunter/ui";
import { foragerUi } from "./forager/ui";
import { orchardUi } from "./orchard/ui";
import { apiaryUi } from "./apiary/ui";
import { cellarUi } from "./cellar/ui";
import { logyardUi } from "./logyard/ui";
import { stoneyardUi } from "./stoneyard/ui";
import { warehouseUi } from "./warehouse/ui";
import { townhallUi } from "./townhall/ui";
import { officeUi } from "./office/ui";
import { digUi } from "./dig/ui";
import { museumUi } from "./museum/ui";
import { excavationUi } from "./excavation/ui";
import { restoredUi } from "./restored/ui";

// Every building in the interface (src/buildings/<id>/ui.ts): its inspector icon, its kind on a group tool, or its
// own build-bar tool.
export const UI: Record<TemplateId, BuildingUi> = {
  izba: izbaUi,
  izba5: izba5Ui,
  smithy: smithyUi,
  carpentry: carpentryUi,
  pottery: potteryUi,
  weaver: weaverUi,
  shop: shopUi,
  tavern: tavernUi,
  gumno: gumnoUi,
  woodcutter: woodcutterUi,
  sawpit: sawpitUi,
  quarry: quarryUi,
  fisher: fisherUi,
  barn: barnUi,
  well: wellUi,
  market: marketUi,
  chapel: chapelUi,
  school: schoolUi,
  healer: healerUi,
  garden: gardenUi,
  hunter: hunterUi,
  forager: foragerUi,
  orchard: orchardUi,
  apiary: apiaryUi,
  cellar: cellarUi,
  logyard: logyardUi,
  stoneyard: stoneyardUi,
  warehouse: warehouseUi,
  townhall: townhallUi,
  office: officeUi,
  dig: digUi,
  museum: museumUi,
  excavation: excavationUi,
  restored: restoredUi,
};

// The templates with a build-bar tool of their own (the tool's id is the template's).
export const BUILDING_TOOLS = (Object.keys(UI) as TemplateId[]).filter((id) => UI[id].tool);
