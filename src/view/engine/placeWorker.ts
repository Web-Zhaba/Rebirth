import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { tileToLngLat } from "../../engine/geo/mercator";
import { labelPriority, PLACE_CLASSES, type PlaceClass } from "./labelLayout";
import { lang } from "../../i18n";

// Place names of one OpenMapTiles vector tile, read off the main thread (placeLabels.ts): the low-zoom tiles a view
// from afar asks for weigh a megabyte or more, and parsing a few of them at once stalled the page for 50-110 ms.

export interface Place {
  key: string;
  name: string;
  cls: PlaceClass;
  priority: number;
  lng: number;
  lat: number;
}

export type ToPlaceWorker = { id: number; url: string; z: number; x: number; y: number };
export type FromPlaceWorker = { id: number; ok: true; places: Place[] } | { id: number; ok: false; error: string };

interface Scope {
  onmessage: ((e: MessageEvent<ToPlaceWorker>) => void) | null;
  postMessage(msg: FromPlaceWorker): void;
}
const scope = self as unknown as Scope;

async function places({ url, z, x, y }: ToPlaceWorker): Promise<Place[]> {
  const res = await fetch(url);
  if (res.status === 404 || res.status === 204) return []; // no features there, e.g. open ocean
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const l = new VectorTile(new PbfReader(await res.arrayBuffer())).layers.place;
  const out: Place[] = [];
  for (let i = 0; l && i < l.length; i++) {
    const f = l.feature(i);
    const cls = f.properties.class as PlaceClass;
    const name = (f.properties[`name:${lang}`] ?? f.properties.name) as string | undefined;
    if (f.type !== 1 || !PLACE_CLASSES.includes(cls) || !name) continue;
    const pt = f.loadGeometry()[0]?.[0];
    if (!pt || pt.x < 0 || pt.y < 0 || pt.x > l.extent || pt.y > l.extent) continue; // the buffer belongs to the neighbour
    const ll = tileToLngLat(z, x, y, pt.x / l.extent, pt.y / l.extent);
    const rank = Number(f.properties.rank ?? 99);
    out.push({ key: `${name}|${ll.lng.toFixed(4)}|${ll.lat.toFixed(4)}`, name, cls, priority: labelPriority(cls, rank), lng: ll.lng, lat: ll.lat });
  }
  return out;
}

scope.onmessage = (e) => {
  const msg = e.data;
  places(msg).then(
    (list) => scope.postMessage({ id: msg.id, ok: true, places: list }),
    (err) => scope.postMessage({ id: msg.id, ok: false, error: String(err) }),
  );
};
