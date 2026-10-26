import type { DomainId } from "./domains";

// Which OpenMapTiles POI classes mark a notable old building and which knowledge domain it feeds
// (PLAN-research.ru.md section 3). Static; the values were checked against real z14 tiles. A game
// abstraction: the player-facing text never claims a historical cause.

// POI `class` -> domain, when the class alone is enough.
const BY_CLASS: Record<string, DomainId> = {
  castle: "build", // castle/castle, castle/ruins
  monument: "build",
  town_hall: "build", // town_hall/townhall, courthouse, public_building
  school: "learn",
  college: "learn", // college/college, college/university
  library: "learn",
  museum: "learn",
  theatre: "learn",
  place_of_worship: "care",
  hospital: "care", // hospital/hospital, hospital/clinic
  doctors: "care",
  pharmacy: "care",
  harbor: "trade",
  ferry_terminal: "trade",
  bank: "trade",
};

// "class/subclass" where the subclass decides: [kind, domain] picks it, null drops a subclass of an accepted class.
// The kind is what is stored as a foundation's `cls`, so the domain can be read back from it alone.
const BY_SUB: Record<string, [string, DomainId] | null> = {
  "grocery/marketplace": ["marketplace", "trade"],
  "grocery/department_store": ["department_store", "trade"],
  "shop/mall": ["mall", "trade"],
  "shop/wholesale": ["wholesale", "trade"],
  "railway/station": ["station", "trade"],
  "railway/halt": ["halt", "trade"],
  "bus/bus_station": ["bus_station", "trade"],
  "car/car_repair": ["car_repair", "craft"],
  "school/kindergarten": null,
  "town_hall/community_centre": null,
};

const BY_KIND: Record<string, DomainId> = Object.fromEntries(Object.values(BY_SUB).flatMap((v) => (v ? [v] : [])));

// The stored kind of a curated POI, or null when it is not one.
export function heritageKind(cls: string, subclass?: string): string | null {
  if (subclass) {
    const k = `${cls}/${subclass}`;
    if (k in BY_SUB) return BY_SUB[k] ? BY_SUB[k]![0] : null;
  }
  return cls in BY_CLASS ? cls : null;
}

// Domain of a POI class (with its subclass) or of a stored kind; null when not curated.
export function heritageDomain(cls: string | undefined, subclass?: string): DomainId | null {
  if (!cls) return null;
  const kind = subclass ? heritageKind(cls, subclass) : cls;
  if (kind === null) return null;
  return BY_CLASS[kind] ?? BY_KIND[kind] ?? null;
}

// A typed (notable) foundation: its stored kind is in the table.
export const isHeritage = (f: { cls?: string }): boolean => !!f.cls && (f.cls in BY_CLASS || f.cls in BY_KIND);
