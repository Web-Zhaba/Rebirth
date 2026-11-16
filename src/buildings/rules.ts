import type { BuildingRules } from "./types";
import { izba } from "./izba/rules";
import { izba5 } from "./izba5/rules";
import { smithy } from "./smithy/rules";
import { carpentry } from "./carpentry/rules";
import { pottery } from "./pottery/rules";
import { weaver } from "./weaver/rules";
import { shop } from "./shop/rules";
import { tavern } from "./tavern/rules";
import { gumno } from "./gumno/rules";
import { woodcutter } from "./woodcutter/rules";
import { sawpit } from "./sawpit/rules";
import { quarry } from "./quarry/rules";
import { fisher } from "./fisher/rules";
import { barn } from "./barn/rules";
import { well } from "./well/rules";
import { market } from "./market/rules";
import { chapel } from "./chapel/rules";
import { school } from "./school/rules";
import { healer } from "./healer/rules";
import { garden } from "./garden/rules";
import { hunter } from "./hunter/rules";
import { forager } from "./forager/rules";
import { orchard } from "./orchard/rules";
import { apiary } from "./apiary/rules";
import { cellar } from "./cellar/rules";
import { logyard } from "./logyard/rules";
import { stoneyard } from "./stoneyard/rules";
import { warehouse } from "./warehouse/rules";
import { townhall } from "./townhall/rules";
import { office } from "./office/rules";
import { dig } from "./dig/rules";
import { museum } from "./museum/rules";
import { excavation } from "./excavation/rules";
import { restored } from "./restored/rules";

// Every building of the town, one folder each (src/buildings/<id>/rules.ts). The order is the order of the lists that
// show them all (the model sheet, the inspector's lookups): keep new ones next to their kin.
export const RULES = {
  izba,
  izba5,
  smithy,
  carpentry,
  pottery,
  weaver,
  shop,
  tavern,
  gumno,
  woodcutter,
  sawpit,
  quarry,
  fisher,
  barn,
  well,
  market,
  chapel,
  school,
  healer,
  garden,
  hunter,
  forager,
  orchard,
  apiary,
  cellar,
  logyard,
  stoneyard,
  warehouse,
  townhall,
  office,
  dig,
  museum,
  excavation,
  restored,
} satisfies Record<string, BuildingRules>;

export type TemplateId = keyof typeof RULES;
export const isTemplateId = (v: string): v is TemplateId => Object.hasOwn(RULES, v);
