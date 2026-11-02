import { computed, type ReadonlySignal } from "@preact/signals";
import type { FeatureCollection } from "geojson";
import type { Engine } from "../../engine/engine";
import { clearingLabels } from "../layers/zones";
import { ruinPois, ruinStreets, ruinTypedNames } from "../layers/ruins";
import { ruinsAutoShown, ruinsShown } from "../ruinsShown";
import { mppAtZoom } from "../view";
import { lineLabelAnchor, pickLabels, rotatedExtent, wrapExtent, type LabelBox } from "./labelLayout";
import { labelSight } from "./labelSight";

// The game's own map text on the engine, DOM over the canvas like the place names (placeLabels.ts), in the look and
// gates of the old MapLibre symbol layers: the percent done of unfinished clearings and, while the
// old city is shown, the names of its notable buildings, named points and streets (from zoom 15).
// Street names run along their line, one per street. Labels are placed in priority order without overlaps.

type Kind = "clearing" | "name" | "poi" | "street";

interface KindStyle {
  px: number; // font size, CSS px (the old text-size)
  priority: number; // lower is placed first
  ruins: boolean; // part of the old city: shown with it only
  maxMpp?: number; // shown only this close (the old minzoom)
  spacing?: number; // letter spacing, em
  maxWidthEm?: number; // wrap width, em (the old text-max-width)
}

const RUIN_MPP = mppAtZoom(15);
const STYLES: Record<Kind, KindStyle> = {
  clearing: { px: 12, priority: 0, ruins: false },
  name: { px: 12, priority: 1, ruins: true, maxMpp: RUIN_MPP, maxWidthEm: 8 },
  poi: { px: 11, priority: 2, ruins: true, maxMpp: RUIN_MPP, maxWidthEm: 8 },
  street: { px: 11, priority: 3, ruins: true, maxMpp: RUIN_MPP, spacing: 0.05 },
};
const POI_OFFSET_EM = 0.4; // named points hang below their spot (text-anchor top, text-offset 0.4 em)
const LINE_H = 1.3; // line height in font sizes, for the collision boxes
const MARGIN = 40; // px beyond the canvas a point may still be placed from

interface Label {
  key: string;
  kind: Kind;
  text: string;
  pts: [number, number][]; // lng, lat: one point, or a street's line
  ground: Float64Array; // drawn ground height under each point, NaN until its terrain is in
  zoom: Int8Array; // the DEM zoom each ground height came from: looked up again when finer pages come
  version: number; // the engine's groundVersion when the zooms were last checked
}

function labelsOf(kind: Kind, data: FeatureCollection, field: string): Label[] {
  const out: Label[] = [];
  for (const f of data.features) {
    const text = f.properties?.[field];
    const g = f.geometry;
    if (typeof text !== "string" || !text || !g) continue;
    const pts = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : null;
    if (!pts?.length) continue;
    const ll = pts.map((p) => [p[0], p[1]] as [number, number]);
    out.push({ key: `${kind}|${text}|${ll[0][0].toFixed(6)},${ll[0][1].toFixed(6)}`, kind, text, pts: ll, ground: new Float64Array(ll.length).fill(NaN), zoom: new Int8Array(ll.length).fill(-1), version: -1 });
  }
  return out;
}

export function attachGameLabels(engine: Engine, container: HTMLElement): void {
  const layer = document.createElement("div");
  layer.className = "engine-game-labels";
  layer.setAttribute("aria-hidden", "true");
  container.append(layer);

  const sources: ReadonlySignal<Label[]>[] = [
    computed(() => labelsOf("clearing", clearingLabels.value, "text")),
    computed(() => labelsOf("name", ruinTypedNames.value, "name")),
    computed(() => labelsOf("poi", ruinPois.value, "name")),
    computed(() => labelsOf("street", ruinStreets.value, "name")),
  ];

  const nodes = new Map<string, HTMLElement>();
  const widths = new Map<string, number>();
  const measure = document.createElement("canvas").getContext("2d")!;

  const textWidth = (l: Label) => {
    const k = `${l.kind}|${l.text}`;
    let w = widths.get(k);
    if (w === undefined) {
      const st = STYLES[l.kind];
      measure.font = `${st.px}px "Golos Text", "PT Sans", sans-serif`;
      w = measure.measureText(l.text).width + (st.spacing ?? 0) * st.px * l.text.length;
      widths.set(k, w);
    }
    return w;
  };

  const node = (l: Label) => {
    let el = nodes.get(l.key);
    if (!el) {
      el = document.createElement("div");
      el.className = `engine-game-label engine-game-label--${l.kind}`;
      el.textContent = l.text;
      layer.append(el);
      nodes.set(l.key, el);
    }
    return el;
  };

  // A label's ground under each point, looked up when the terrain there is in and again when finer pages have come
  // (the first pages after a load are coarse stand-ins, far off the drawn ground).
  const seat = (l: Label) => {
    const v = engine.groundVersion;
    if (l.version === v) return;
    l.version = v;
    for (let i = 0; i < l.pts.length; i++) {
      const [lng, lat] = l.pts[i];
      const z = engine.groundZoomAt(lat, lng);
      if (z <= l.zoom[i]) continue;
      l.zoom[i] = z;
      l.ground[i] = engine.groundAt(lat, lng) ?? NaN;
    }
  };

  // Screen position of a label's point i on its ground, or null before the terrain there is in.
  const screen = (l: Label, i: number): [number, number] | null => {
    seat(l);
    const g = l.ground[i];
    return Number.isNaN(g) ? null : engine.project(l.pts[i][1], l.pts[i][0], g);
  };

  const hidden = labelSight(engine);
  engine.onFrame(() => {
    if (!engine.view) return;
    const s = engine.state;
    const w = engine.canvas.clientWidth;
    const h = engine.canvas.clientHeight;
    const mpp = (2 * s.distance * Math.tan((s.fovY * Math.PI) / 360)) / Math.max(1, h);
    const ruins = ruinsShown.peek() || ruinsAutoShown.peek();
    const onScreen = (p: [number, number] | null): p is [number, number] => !!p && p[0] >= -MARGIN && p[1] >= -MARGIN && p[0] <= w + MARGIN && p[1] <= h + MARGIN;

    const placed: { l: Label; transform: string }[] = [];
    const boxes: LabelBox[] = [];
    for (const src of sources)
      for (const l of src.peek()) {
        const st = STYLES[l.kind];
        if ((st.ruins && !ruins) || (st.maxMpp !== undefined && mpp > st.maxMpp)) continue;
        const tw = textWidth(l);
        if (l.kind === "street") {
          const line: [number, number][] = [];
          for (let i = 0; i < l.pts.length; i++) {
            const p = screen(l, i);
            if (p) line.push(p);
          }
          const a = lineLabelAnchor(line, tw);
          if (!a || !onScreen([a.x, a.y])) continue;
          const e = rotatedExtent(tw, st.px * LINE_H, a.angle);
          boxes.push({ x: a.x, y: a.y, w: e.w, h: e.h, priority: st.priority });
          placed.push({ l, transform: `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) rotate(${a.angle}rad)` });
          continue;
        }
        const p = screen(l, 0);
        if (!onScreen(p)) continue;
        if (hidden(l.key, l.pts[0][1], l.pts[0][0], l.ground[0])) continue;
        const wrap = st.maxWidthEm ? wrapExtent(tw, st.maxWidthEm * st.px) : { lines: 1, w: tw };
        const bh = wrap.lines * st.px * LINE_H;
        if (l.kind === "poi") {
          boxes.push({ x: p[0], y: p[1] + POI_OFFSET_EM * st.px + bh / 2, w: wrap.w, h: bh, priority: st.priority });
          placed.push({ l, transform: `translate(${p[0]}px, ${p[1]}px) translate(-50%, ${POI_OFFSET_EM}em)` });
        } else {
          boxes.push({ x: p[0], y: p[1], w: wrap.w, h: bh, priority: st.priority });
          placed.push({ l, transform: `translate(${p[0]}px, ${p[1]}px) translate(-50%, -50%)` });
        }
      }

    const visible = new Set<string>();
    for (const i of pickLabels(boxes)) {
      const { l, transform } = placed[i];
      const el = node(l);
      el.style.transform = transform;
      el.style.display = "";
      visible.add(l.key);
    }
    for (const [k, el] of nodes) {
      if (visible.has(k)) continue;
      el.style.display = "none";
      if (nodes.size > 400) {
        el.remove(); // labels of data that went away (a finished clearing's old percent) do not pile up
        nodes.delete(k);
      }
    }
  });
}
