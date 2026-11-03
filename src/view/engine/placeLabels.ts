import { effect } from "@preact/signals";
import type { Engine } from "../../engine/engine";
import { geodeticToEcef } from "../../engine/geo/ellipsoid";
import { lngLatToTile } from "../../engine/geo/mercator";
import { vectorTileUrl } from "../../world/tiles";
import { placeLabelsOn } from "../placeNames";
import { LABEL_PX, labelTileZoom, pickLabels, type LabelBox } from "./labelLayout";
import { labelSight } from "./labelSight";
import type { FromPlaceWorker, Place, ToPlaceWorker } from "./placeWorker";
import { lang } from "../../i18n";

// Old place names on the engine: DOM text over the canvas, faint like pencil notes in an atlas (the look of the old
// MapLibre symbol layer). Names come from the OpenMapTiles `place` layer of the tiles around the camera target at the
// zoom a web map would show (cities from afar, hamlets close up); every frame they are projected, the important ones
// placed first and the rest dropped where they would overlap. The tiles are read in a worker (placeWorker.ts).

const RADIUS = 2; // tiles around the target's tile: a 5 x 5 block
const CACHE = 96;
const FAR = 6; // names farther from the eye than this many camera distances are dropped (the horizon of pitched views)
const MARGIN = 40; // px beyond the canvas edge a label may still be placed from
const KEEP_MS = 2000; // a name's node stays this long after it was last placed, then leaves the DOM

interface LabelNode {
  el: HTMLElement;
  shown: boolean;
  at: number; // when it was last placed
}

export function attachPlaceLabels(engine: Engine, container: HTMLElement): void {
  const layer = document.createElement("div");
  layer.className = "engine-place-labels";
  layer.setAttribute("aria-hidden", "true");
  container.append(layer);

  const tiles = new Map<string, Place[] | Promise<void>>(); // insertion order = LRU order
  let shown: string[] = []; // tile keys whose names are drawn
  // Only the names placed lately have nodes: a trip out to the planet and back met thousands, and restyling every one of
  // them each frame stalled the page's style and layout for a tenth of a second at a time.
  const nodes = new Map<string, LabelNode>();
  const widths = new Map<string, number>();
  const measure = document.createElement("canvas").getContext("2d")!;

  const worker = new Worker(new URL("./placeWorker.ts", import.meta.url), { type: "module", name: lang });
  const asked = new Map<number, (r: FromPlaceWorker) => void>();
  let nextId = 1;
  worker.onmessage = (e: MessageEvent<FromPlaceWorker>) => {
    asked.get(e.data.id)?.(e.data);
    asked.delete(e.data.id);
  };
  const read = (z: number, x: number, y: number): Promise<Place[]> =>
    vectorTileUrl(z, x, y).then(
      (url) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          asked.set(id, (r) => (r.ok ? resolve(r.places) : reject(new Error(r.error))));
          worker.postMessage({ id, url, z, x, y } satisfies ToPlaceWorker);
        }),
    );

  const load = (z: number, x: number, y: number, key: string) => {
    const p = read(z, x, y)
      .then((out) => void tiles.set(key, out))
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
    let n = nodes.get(p.key);
    if (!n) {
      const el = document.createElement("div");
      el.className = "engine-place-label";
      el.textContent = p.name;
      el.style.fontSize = `${LABEL_PX[p.cls]}px`;
      layer.append(el);
      n = { el, shown: true, at: 0 };
      nodes.set(p.key, n);
    }
    return n;
  };

  effect(() => {
    layer.style.display = placeLabelsOn.value ? "" : "none";
  });

  const hidden = labelSight(engine);
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
        if (hidden(p.key, p.lat, p.lng, g)) continue;
        places.push(p);
        boxes.push({ x: s[0], y: s[1], w: width(p), h: LABEL_PX[p.cls] * 1.3, priority: p.priority });
      }
    }
    const now = performance.now();
    for (const i of pickLabels(boxes)) {
      const n = node(places[i]);
      n.el.style.transform = `translate(${boxes[i].x}px, ${boxes[i].y}px) translate(-50%, -50%)`;
      if (!n.shown) (n.shown = true), (n.el.style.display = "");
      n.at = now;
    }
    for (const [k, n] of nodes) {
      if (n.at === now) continue;
      if (now - n.at > KEEP_MS) (n.el.remove(), nodes.delete(k), widths.delete(k));
      else if (n.shown) (n.shown = false), (n.el.style.display = "none");
    }
  });
}
