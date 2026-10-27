// Colors of the "Field atlas" (PLAN-ui.md section 2) for code that cannot read CSS variables: MapLibre paint
// properties, canvas patterns, legends. Every entry here has a custom property of the same name (camelCase ->
// kebab-case) in tokens.css with the same value; palette.test.ts fails when the two drift apart.
import type { DomainId } from "../sim/domains";

export const PALETTE = {
  paper: "#f4eddc",
  paperRaised: "#fbf7ec",
  paperShade: "#e9dfc8",
  paperSunk: "#e3d8bf",
  ink: "#2b261f",
  ink2: "#4a4234",
  pencil: "#6b604f",
  pencilFaint: "#9a8e76",
  ruleSoft: "#cdbf9f",
  ruleDotted: "#b5a684",
  kbdBorder: "#8a7d63",
  ok: "#4a6136",
  okText: "#3f5a2c",
  okFill: "#d5dfc4",
  warn: "#b07a1c",
  warnText: "#7d5410",
  warnFill: "#efd9a6",
  bad: "#94331b",
  badFill: "#ebc9bc",
  info: "#3a5a78",
  infoFill: "#d3dfe8",
  // Knowledge domains: notable old buildings on the map.
  domainBuild: "#a4562f",
  domainFarm: "#6b8e3d",
  domainCraft: "#7b5f8c",
  domainTrade: "#c08a1e",
  domainLearn: "#3a6f9c",
  domainCare: "#9c3a52",
  dusk: "#26303a",
  duskInk: "#ede6d3",
  // Base map, muted so zones, roads and buildings read on top of it.
  mapLand: "#ebe4cb",
  mapGrass: "#dfe2bd",
  mapForest: "#a6b685",
  mapWetland: "#bcc9a3",
  mapSand: "#e6d9ae",
  mapRock: "#cdc6b2",
  mapIce: "#f2f1e8",
  mapWater: "#9fbac8",
  // Biomes from the same OpenMapTiles data (subclasses): map only, the game still counts them as meadow or forest.
  mapForestDeep: "#7d9462", // soft edge of dense forest
  mapWoodLight: "#bccb9b", // open wood, lighter than the forest
  mapScrub: "#c9cc98",
  mapHeath: "#d9c99d",
  mapFell: "#cfcab4",
  mapBog: "#93a37b",
  mapFarm: "#e4dba6",
  mapBeach: "#efe4c0",
  mapShore: "#d6cca3", // a sand band where the land meets water
  // Roads: surface and edge per kind.
  roadPath: "#dccfa6",
  roadPathEdge: "#8a7d63",
  roadDirt: "#a98a58",
  roadBridge: "#8c7b5a",
  roadBridgeEdge: "#3e3424",
  roadDirtEdge: "#5e4a2c",
  roadStone: "#a3a39b",
  roadStoneEdge: "#4a4a45",
} as const;
export type PaletteKey = keyof typeof PALETTE;

// Map colour of each knowledge domain.
export const DOMAIN_COLORS: Record<DomainId, string> = {
  build: PALETTE.domainBuild,
  farm: PALETTE.domainFarm,
  craft: PALETTE.domainCraft,
  trade: PALETTE.domainTrade,
  learn: PALETTE.domainLearn,
  care: PALETTE.domainCare,
};

// Map colors that have no CSS counterpart (lights, hillshading, moving dots).
export const MAP_ONLY = {
  lamp: "#ffbe55",
  hillShadow: "#5d5a48",
  hillAccent: "#7a7660",
  cart: "#6d4f2a",
  badDeep: "#5e2314",
} as const;

// Building colors by category: houses/workshops/shops by zone, and the player-placed templates. Map only.
export const BUILDING_ZONE_COLORS = { res: "#a9865c", craft: "#857b6c", trade: "#b07d4c" } as const;
export const PLACED_BUILDING_COLORS = {
  gumno: "#b8963f",
  woodcutter: "#5c7342",
  sawpit: "#a97d4d",
  quarry: "#7d7f82",
  fisher: "#4a7088",
  garden: "#6f8a3a",
  hunter: "#7a5a3c",
  forager: "#5f7a52",
  orchard: "#8f9a3c",
  apiary: "#c49a2c",
  cellar: "#7a6048",
  barn: "#94503a",
  dig: "#7d6340",
  well: "#4f7f9c",
  market: "#b9772f",
  chapel: "#85689f",
  school: "#3f8a6b",
  healer: "#b24d46",
} as const;

// Restored old buildings drawn as 3D models (heritageModels.ts): wall, roof and accent (dome, spire, chimney, cornice)
// choices per model family; each building picks one of each from its seed. Map only, like the colours above; the
// scaffold is the timber look of a building under construction (wall = log courses, roof = deck, accent = posts).
export const MODEL_COLORS = {
  house: {
    wall: ["#c9b48a", "#b89468", "#d8ccb0", "#a9845c", "#cdb98f", "#bfa27a"],
    roof: ["#94503a", "#7a5a44", "#6b5f52", "#8c6a3e", "#5f6a58", "#a0603e"],
    accent: ["#6d4f2a", "#7a6048", "#8a7a68"],
  },
  worship: {
    wall: ["#e2dac4", "#ece6d6", "#d9c9a8", "#e6d2b4"],
    roof: ["#5f7a52", "#4f6a7a", "#7a5a3c", "#6b6f72"],
    accent: ["#c49a2c", "#c49a2c", "#5f7a52", "#3f5f7a", "#6b6f72"],
  },
  tower: {
    wall: ["#bdb4a0", "#a8987c", "#c9bfa8", "#b0a48c"],
    roof: ["#7a5a3c", "#5f6a58", "#94503a"],
    accent: ["#94503a", "#5f6a58", "#c49a2c"],
  },
  hip: {
    wall: ["#d3c3a0", "#c9a98a", "#dcd2bc", "#b8a27e", "#d6b994"],
    roof: ["#a4562f", "#8a4a32", "#6b5f52", "#5f6a58"],
    accent: ["#7a5a3c", "#6d5c48"],
  },
  flat: {
    wall: ["#b9ad96", "#a89c86", "#c4b8a0", "#9e8f78"],
    roof: ["#857b6c", "#77706a", "#8e8476"],
    accent: ["#6b604f", "#5e574e"],
  },
  scaffold: { wall: ["#c7a77a"], roof: ["#a98a60"], accent: ["#8a6a44"] },
} as const satisfies Record<string, { wall: readonly string[]; roof: readonly string[]; accent: readonly string[] }>;
export type ModelFamily = keyof typeof MODEL_COLORS;

// The town's own buildings drawn as 3D models (townModels.ts): material choices, each building picks from its seed. Map only.
export const TOWN_COLORS = {
  logs: ["#a47c52", "#8f6a45", "#b38a5c", "#9a7a5a", "#7d5e40", "#a88a64"],
  plaster: ["#d8ccb0", "#e2d6bc", "#cdbf9f", "#d6c29c"],
  stone: ["#9a948a", "#8a847a", "#a39b8c"],
  planks: ["#8c7a60", "#7a6a52", "#9c8a6c"],
  roofPlank: ["#7a7366", "#6b665c", "#857c6c"],
  thatch: ["#b39a5e", "#a68c52", "#bfa66a"],
  shingle: ["#7a5a44", "#8c6a3e", "#6e5440"],
  turf: ["#6a7448", "#5f6a40"],
  trim: ["#e8dcc0", "#d9c9a8", "#c9b48a"],
  foliage: ["#5f7a3a", "#6f8a3a", "#4f6a32", "#7a8a3a"],
  soil: ["#6e5638", "#7d6340"],
  hive: ["#d9c08a", "#c9a86a", "#e0d0a8"],
  canvas: ["#cdbf9f", "#b8a888", "#d6c8a8"],
  goods: ["#b24d46", "#c49a2c", "#6f8a3a", "#4f7f9c", "#b9772f"],
  water: ["#3f6a82"],
  flowers: ["#c9a2c8", "#e0c050", "#d0d8e8", "#b24d46"],
  healerRoof: ["#5f7a52", "#4f6a5a", "#6f7f5a"],
  cross: ["#3f9a5a"],
  clay: ["#b06a42", "#a45a38", "#c27a4e"],
  ember: ["#d0632a"],
  iron: ["#3a3a3c"],
  hide: ["#c2a06e"],
  bell: ["#b08a3a"],
  fruit: ["#b8402e", "#c9a632", "#a8322a"],
  berries: ["#a8283a", "#3a3a7a", "#b8402e"],
  mushroom: ["#8a5a32"],
  pit: ["#3a2a1c"],
} as const;

// Trees of the 3D forest (treeModels.ts, treeLayer.ts): bark and crowns, deciduous crowns by season. Map only.
export const TREE_COLORS = {
  bark: "#5b4632",
  birchBark: "#d9d4c4",
  conifer: "#3d5a3a",
  spring: "#8fae5a",
  summer: "#5f7d3e",
  autumn: "#c08a2e",
  autumnLate: "#a5562a",
  bare: "#7a6a58",
  snow: "#f3f4ef",
  reed: "#6f8a45",
  reedDry: "#b8a26c",
  cattail: "#5e4430",
  stone: "#8e8b82",
} as const;

// Farm fields of the 3D map (fieldLayer.ts): soil, the crop through the year, stubble, the grass of the headland and of
// fields no farm works. Map only.
export const FIELD_COLORS = {
  soil: "#4d3b2b", // freshly ploughed
  soilDry: "#6b5540", // the ridges, dried
  shoot: "#9cc063", // young shoots
  crop: "#5f8a38", // dense green
  ripe: "#d6b455", // gold
  straw: "#cfbd7c", // stubble
  stubbleRow: "#a58f57",
  grass: "#7f9c52", // the headland strip
  fallow: "#8b9c5b", // a field no farm works: grass and weeds
  fallowDry: "#a29a62",
  snow: "#f3f4ef",
} as const;

export const toKebab =(k: string): string => k.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

// "#rrggbb" mixed towards another by t (0..1).
export function mixHex(a: string, b: string, t: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

// WCAG 2.x contrast ratio of two "#rrggbb" colors (1..21).
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const ch = (i: number) => {
      const c = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
