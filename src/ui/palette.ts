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
  okFill: "#d5dfc4",
  warn: "#b07a1c",
  warnFill: "#efd9a6",
  bad: "#9e3b22",
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
  // Roads: surface and edge per kind.
  roadPath: "#dccfa6",
  roadPathEdge: "#8a7d63",
  roadDirt: "#a98a58",
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

export const toKebab = (k: string): string => k.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

// "#rrggbb" mixed towards another by t (0..1).
export function mixHex(a: string, b: string, t: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}
