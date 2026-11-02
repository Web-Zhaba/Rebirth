import { PALETTE } from "../ui/palette";
import { isNatureLandcover } from "./nature";

// Colours of the rewilded land, shared by every renderer (the MapLibre style and the engine's drape baker), so both
// paint the same atlas. Atlas palette (ui/palette.ts): paper land, ink-blue water, muted green forest.

export const C = {
  meadow: PALETTE.mapLand,
  grass: PALETTE.mapGrass,
  forest: PALETTE.mapForest,
  forestDeep: PALETTE.mapForestDeep,
  woodLight: PALETTE.mapWoodLight,
  scrub: PALETTE.mapScrub,
  heath: PALETTE.mapHeath,
  fell: PALETTE.mapFell,
  wetland: PALETTE.mapWetland,
  bog: PALETTE.mapBog,
  farm: PALETTE.mapFarm,
  sand: PALETTE.mapSand,
  beach: PALETTE.mapBeach,
  shore: PALETTE.mapShore,
  rock: PALETTE.mapRock,
  ice: PALETTE.mapIce,
  water: PALETTE.mapWater,
};

// Colour by "class/subclass" from the tiles; a class without a listed subclass falls back to its class colour.
export const BIOME_FILL: [string, string][] = [
  ["wood/forest", C.forest],
  ["wood/wood", C.woodLight],
  ["grass/grassland", C.grass],
  ["grass/meadow", C.grass],
  ["grass/scrub", C.scrub],
  ["grass/heath", C.heath],
  ["grass/fell", C.fell],
  ["wetland/wetland", C.wetland],
  ["wetland/bog", C.bog],
  ["wetland/swamp", C.bog],
  ["farmland/farmland", C.farm],
  ["farmland/orchard", C.farm],
  ["farmland/vineyard", C.farm],
  ["sand/beach", C.beach],
  ["sand/sand", C.sand],
  ["rock/bare_rock", C.rock],
  ["rock/scree", C.rock],
];
export const CLASS_FILL: [string, string][] = [
  ["wood", C.forest],
  ["grass", C.grass],
  ["wetland", C.wetland],
  ["farmland", C.farm],
  ["sand", C.sand],
  ["rock", C.rock],
  ["ice", C.ice],
];

const BY_BIOME = new Map(BIOME_FILL);
const BY_CLASS = new Map(CLASS_FILL);

// Landcover drawn on the map: the game's nature classes plus farmland, which the game counts as meadow.
export function isDrawnLandcover(p: Record<string, unknown>): boolean {
  return isNatureLandcover(p) || p.class === "farmland";
}

export function biomeColor(cls: string, sub: string): string {
  return BY_BIOME.get(`${cls}/${sub}`) ?? BY_CLASS.get(cls) ?? C.meadow;
}
