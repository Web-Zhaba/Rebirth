// Vegetation over the land, shared by the renderers and the bake workers (docs/PLAN-engine.md N5): which landcover
// classes carry trees or small details (bushes, reed clumps, boulders) and how densely, what the ruins' foundations
// add, and how the tree kinds split by latitude. The engine's cover pages store an 8-bit class id per texel and the
// scatter shader reads the shares from COVER_SHARES; the old CPU scatter (map/forest.ts) reads the same table, so both
// grow the same things in the same places.

export const TREE_SPACING = 9; // m between candidate trees (treeScatter.ts SPACING)

export type DetailKind = "bush" | "reed" | "boulder";
export const DETAIL_KINDS: readonly DetailKind[] = ["bush", "reed", "boulder"];
export const DETAIL_SPACING: Record<DetailKind, number> = { bush: 5, reed: 2.5, boulder: 7 };

// Detail sizes (m, treeScatter.ts): the old layer sized per class; one canonical range per kind (the widest), so a
// class id alone pins a detail's look.
export const DETAIL_SIZE: Record<DetailKind, [number, number]> = { bush: [0.3, 2.4], reed: [0.6, 2.5], boulder: [0.15, 2.6] };

export interface CoverClass {
  key: string; // "class" or "class/subclass"
  tree: boolean; // full trees (the wood classes)
  bush: number; // share of bush cells
  reed: number;
  boulder: number;
}

// map/forest.ts MIXES as one table: the id a cover page stores (0 = no cover, ids 1..) and what grows there.
// `coverIdOf` matches "class/subclass" exactly, then the bare class (the "" fallback).
export const COVER_TABLE: readonly CoverClass[] = [
  { key: "wood", tree: true, bush: 0.04, reed: 0, boulder: 0 },
  { key: "grass/scrub", tree: false, bush: 0.5, reed: 0, boulder: 0.02 },
  { key: "grass/heath", tree: false, bush: 0.3, reed: 0, boulder: 0.04 },
  { key: "grass/fell", tree: false, bush: 0.08, reed: 0, boulder: 0.12 },
  { key: "grass/tundra", tree: false, bush: 0.1, reed: 0, boulder: 0.06 },
  { key: "grass/wet_meadow", tree: false, bush: 0.15, reed: 0.02, boulder: 0 },
  { key: "grass", tree: false, bush: 0.025, reed: 0, boulder: 0 },
  { key: "wetland/marsh", tree: false, bush: 0, reed: 0.7, boulder: 0 },
  { key: "wetland/reedbed", tree: false, bush: 0, reed: 0.85, boulder: 0 },
  { key: "wetland/saltmarsh", tree: false, bush: 0, reed: 0.4, boulder: 0 },
  { key: "wetland/swamp", tree: false, bush: 0.15, reed: 0.3, boulder: 0 },
  { key: "wetland/bog", tree: false, bush: 0.12, reed: 0.1, boulder: 0 },
  { key: "wetland", tree: false, bush: 0.05, reed: 0.4, boulder: 0 },
  { key: "rock/scree", tree: false, bush: 0, reed: 0, boulder: 0.5 },
  { key: "rock", tree: false, bush: 0, reed: 0, boulder: 0.35 },
  { key: "sand", tree: false, bush: 0.02, reed: 0, boulder: 0.01 },
];

const BY_KEY = new Map(COVER_TABLE.map((c, i) => [c.key, i + 1]));

// The id a cover page paints for a landcover feature, 0 when nothing grows there.
export function coverIdOf(cls: string, sub: string): number {
  return BY_KEY.get(`${cls}/${sub}`) ?? BY_KEY.get(cls) ?? 0;
}

export interface CoverShares {
  tree: boolean;
  bush: number;
  reed: number;
  boulder: number;
}

export function coverShares(id: number): CoverShares {
  const c = COVER_TABLE[id - 1];
  return c ? { tree: c.tree, bush: c.bush, reed: c.reed, boulder: c.boulder } : { tree: false, bush: 0, reed: 0, boulder: 0 };
}

type Share = { share: number; size: [number, number] };
export type DetailMix = Partial<Record<DetailKind, Share>>;

// The old scatter's share+size mix for a class (map/forest.ts), derived from the same table.
export function mixOfDetail(cls: string, sub: string): DetailMix | null {
  const id = coverIdOf(cls, sub);
  if (!id) return null;
  const s = coverShares(id);
  const out: DetailMix = {};
  if (s.bush) out.bush = { share: s.bush, size: DETAIL_SIZE.bush };
  if (s.reed) out.reed = { share: s.reed, size: DETAIL_SIZE.reed };
  if (s.boulder) out.boulder = { share: s.boulder, size: DETAIL_SIZE.boulder };
  return out;
}

// What the ruins' foundations add (map/forest.ts RUIN_MIX); the game mask paints this add id, the scatter adds the
// shares on top of the landcover's own.
export const RUIN_ADD_ID = 1;
export const RUIN_ADD: CoverShares = { tree: false, bush: 0.3, reed: 0, boulder: 0.35 };

// Kind shares by latitude (treeScatter.ts): conifers dominate towards the poles, birches appear in the cold belt.
export function coniferShare(lat: number): number {
  return Math.min(0.85, Math.max(0.1, (Math.abs(lat) - 42) / 20));
}
export function birchShare(lat: number): number {
  return Math.min(0.25, Math.max(0, (Math.abs(lat) - 50) / 40));
}

// Base tree sizes (m, treeScatter.ts scatterTrees) and how much the per-tree hash varies them.
export const TREE_SIZE: [number, number, number] = [13, 10, 11]; // conifer, broadleaf, birch
