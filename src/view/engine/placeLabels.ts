import { effect } from "@preact/signals";
import type { Engine } from "../../engine/engine";
import { geodeticToEcef } from "../../engine/geo/ellipsoid";
import { lngLatToTile, tileToLngLat } from "../../engine/geo/mercator";
import { loadVector } from "../../world/tiles";
import { placeLabelsOn } from "../placeNames";
import { LABEL_PX, labelPriority, labelTileZoom, pickLabels, PLACE_CLASSES, type LabelBox, type PlaceClass } from "./labelLayout";

// Old place names on the engine: DOM text over the canvas, faint like pencil notes in an atlas (the look of the old
// MapLibre symbol layer). Names come from the OpenMapTiles `place` layer of the tiles around the camera target at the
// zoom a web map would show (cities from afar, hamlets close up); every frame they are projected, the important ones
// placed first and the rest dropped where they would overlap.

interface Place {
  key: string;
  name: string;
  cls: PlaceClass;
  priority: number;
  lng: number;
  lat: number;
}

const RADIUS = 2; // tiles around the target's tile: a 5 x 5 block
const CACHE = 96;
const FAR = 6; // names farther from the eye than this many camera distances are dropped (the horizon of pitched views)
const MARGIN = 40; // px beyond the canvas edge a label may still be placed from

export function attachPlaceLabels(engine: Engine, container: HTMLElement): void {
  const layer = document.createElement("div");
  layer.className = "engine-place-labels";
  layer.setAttribute("aria-hidden", "true");
  container.append(layer);

  const tiles = new Map<string, Place[] | Promise<void>>(); // insertion order = LRU order
  let shown: string[] = []; // tile keys whose names are drawn
  const nodes = new Map<string, HTMLElement>();
  const widths = new Map<string, number>();
  const measure = document.createElement("canvas").getContext("2d")!;

  const load = (z: number, x: number, y: number, key: string) => {
    const p = loadVector(z, x, y)
      .then((vt) => {
        const out: Place[] = [];
        const l = vt?.layers.place;
        for (let i = 0; l && i < l.length; i++) {
          const f = l.feature(i);
          const cls = f.properties.class as PlaceClass;
          const name = (f.properties["name:ru"] ?? f.properties.name) as string | undefined;
          if (f.type !== 1 || !PLACE_CLASSES.includes(cls) || !name) continue;
          const pt = f.loadGeometry()[0]?.[0];
          if (!pt || pt.x < 0 || pt.y < 0 || pt.x > l.extent || pt.y > l.extent) continue; // the buffer belongs to the neighbour
          const ll = tileToLngLat(z, x, y, pt.x / l.extent, pt.y / l.extent);
          const rank = Number(f.properties.rank ?? 99);
          out.push({ key: `${name}|${ll.lng.toFixed(4)}|${ll.lat.toFixed(4)}`, name, cls, priority: labelPriority(cls, rank), lng: ll.lng, lat: ll.lat });
        }
        tiles.set(key, out);
      })
      .catch(() => void tiles.delete(key)); // asked for again next frame
    tiles.set(key, p);
    while (tiles.size > CACHE) {
      const old = tiles.keys().next().value!;
      if (shown.includes(old)) break;
      tiles.delete(old);
    }
  };

  // The tiles the view wants; the ones drawn switch over only once all of them are in, so names do not blink while
  // the zoom changes.
  const want = (): string[] => {
    const s = engine.state;
    const mpp = (2 * s.distance * Math.tan((s.fovY * Math.PI) / 360)) / Math.max(1, engine.canvas.clientHeight);
    const z = labelTileZoom(mpp, s.lat);
    const n = 2 ** z;
    const c = lngLatToTile(s.lng, s.lat, z);
    const keys: string[] = [];
    const r = Math.min(RADIUS, Math.floor((n - 1) / 2));
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const y = Math.floor(c.y) + dy;
        if (y < 0 || y >= n) continue;
        const x = (((Math.floor(c.x) + dx) % n) + n) % n;
        const key = `${z}/${x}/${y}`;
        const t = tiles.get(key);
        if (t === undefined) load(z, x, y, key);
        else {
          tiles.delete(key); // touch: most recently used
          tiles.set(key, t);
        }
        keys.push(key);
      }
    return keys;
  };

  const width = (p: Place) => {
    let w = widths.get(p.key);
    if (w === undefined) {
      measure.font = `italic ${LABEL_PX[p.cls]}px "Golos Text", "PT Sans", sans-serif`;
      w = measure.measureText(p.name).width;
      widths.set(p.key, w);
    }
    return w;
  };

  const node = (p: Place) => {
    let el = nodes.get(p.key);
    if (!el) {
      el = document.createElement("div");
      el.className = "engine-place-label";
      el.textContent = p.name;
      el.style.fontSize = `${LABEL_PX[p.cls]}px`;
      layer.append(el);
      nodes.set(p.key, el);
    }
    return el;
  };

  effect(() => {
    layer.style.display = placeLabelsOn.value ? "" : "none";
  });

  engine.onFrame(() => {
    if (!placeLabelsOn.peek() || !engine.view) return;
    const keys = want();
    if (keys.every((k) => Array.isArray(tiles.get(k)))) shown = keys;
    const w = engine.canvas.clientWidth;
    const h = engine.canvas.clientHeight;
    const eye = engine.view.eye;
    const far = FAR * engine.state.distance + 2000;
    const places: Place[] = [];
    const boxes: LabelBox[] = [];
    const seen = new Set<string>();
    for (const k of shown) {
      const list = tiles.get(k);
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        if (seen.has(p.key)) continue;
        seen.add(p.key);
        const g = engine.groundAt(p.lat, p.lng) ?? 0;
        const e = geodeticToEcef(p.lat, p.lng, g);
        if (Math.hypot(e[0] - eye[0], e[1] - eye[1], e[2] - eye[2]) > far) continue;
        const s = engine.project(p.lat, p.lng, g);
        if (!s || s[0] < -MARGIN || s[1] < -MARGIN || s[0] > w + MARGIN || s[1] > h + MARGIN) continue;
        places.push(p);
        boxes.push({ x: s[0], y: s[1], w: width(p), h: LABEL_PX[p.cls] * 1.3, priority: p.priority });
      }
    }
    const visible = new Set<string>();
    for (const i of pickLabels(boxes)) {
      const p = places[i];
      const el = node(p);
      el.style.transform = `translate(${boxes[i].x}px, ${boxes[i].y}px) translate(-50%, -50%)`;
      el.style.display = "";
      visible.add(p.key);
    }
    for (const [k, el] of nodes) if (!visible.has(k)) el.style.display = "none";
  });
}
