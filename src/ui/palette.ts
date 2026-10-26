// Colors of the "Field atlas" (PLAN-ui.md section 2) for code that cannot read CSS variables: MapLibre paint
// properties, canvas patterns, legends. Every entry here has a custom property of the same name (camelCase ->
// kebab-case) in tokens.css with the same value; palette.test.ts fails when the two drift apart.
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
} as const;
export type PaletteKey = keyof typeof PALETTE;

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

export const toKebab = (k: string): string => k.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

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
