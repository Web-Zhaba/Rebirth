// Place search: Photon (komoot) over OpenStreetMap, CORS open, no key. Only place=* objects (cities to hamlets).

export interface PlaceHit {
  name: string;
  kind: string; // Russian word for the place type, may be empty
  where: string; // county, state, country
  lng: number;
  lat: number;
  bbox?: [number, number, number, number]; // west, south, east, north
}

const API = "https://photon.komoot.io/api/";
export const MIN_QUERY = 2;

// Biased to the map centre so nearby namesakes come first.
export function searchUrl(q: string, near?: { lng: number; lat: number }, limit = 8): string {
  const u = new URL(API);
  u.searchParams.set("q", q.trim());
  u.searchParams.set("osm_tag", "place");
  u.searchParams.set("limit", String(limit));
  if (near) {
    u.searchParams.set("lat", near.lat.toFixed(3));
    u.searchParams.set("lon", near.lng.toFixed(3));
  }
  return u.toString();
}

const KIND_RU: Record<string, string> = {
  city: "город",
  town: "город",
  village: "село",
  hamlet: "деревня",
  isolated_dwelling: "хутор",
  farm: "хутор",
  locality: "урочище",
  suburb: "район",
  quarter: "район",
  neighbourhood: "район",
  island: "остров",
  islet: "остров",
  state: "регион",
  region: "регион",
  province: "регион",
  county: "округ",
  country: "страна",
};

export function parseSearch(json: unknown): PlaceHit[] {
  const list = (json as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(list)) return [];
  const out: PlaceHit[] = [];
  for (const f of list as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[]) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (typeof p.name !== "string" || !Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const where = [p.county, p.state, p.country].filter((v): v is string => typeof v === "string" && v !== p.name).join(", ");
    const hit: PlaceHit = { name: p.name, kind: KIND_RU[String(p.osm_value)] ?? "", where, lng: c[0], lat: c[1] };
    const e = p.extent; // Photon order: west, north, east, south
    if (Array.isArray(e) && e.length === 4 && e.every((v) => typeof v === "number")) {
      hit.bbox = [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])];
    }
    out.push(hit);
  }
  return out;
}

export async function searchPlaces(q: string, near?: { lng: number; lat: number }, signal?: AbortSignal): Promise<PlaceHit[]> {
  const r = await fetch(searchUrl(q, near), { signal });
  if (!r.ok) throw new Error(`photon ${r.status}`);
  return parseSearch(await r.json());
}
