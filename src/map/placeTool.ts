import type maplibregl from "maplibre-gl";
import { effect, untracked } from "@preact/signals";
import { BUILDINGS, type BuildingTemplate } from "../sim/buildings";
import { DIG } from "../sim/excavation";
import { FIELD, fieldCentroid, haOf } from "../sim/fields";
import { canPlace, makeBuilding } from "../sim/growth";
import { lotFront } from "../sim/people";
import { isService, SERVICES } from "../sim/services";
import type { Site, ZoneCell } from "../sim/types";
import { cellCorners } from "../sim/zones";
import { buildingSet, frame, sendCmd, state, zones } from "../simClient";
import { cachedSite, NO_SITE, siteAt } from "../world/site";
import { PALETTE } from "../ui/palette";
import { costText } from "./buildCost";
import { flash, isPlaceTool, MIN_ZONE_ZOOM, PLACED_COLORS, placeReach, SITE_RADIUS, tool, type PlaceTool } from "./tools";

const MAX_SNAP_M = 24; // how far from the cursor the first cell of the lot may be
const BUCKET = 16;
const SAMPLE_DELAY_MS = 150; // the cursor must rest on a lot before its terrain is sampled
const CIRCLE_STEPS = 64;
const PENDING_COLOR = PALETTE.warn;

type Pt = [number, number];
const bucketKey = (bx: number, by: number) => bx * 65536 + by;
const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const pct = (v: number) => `${Math.round(v * 100)} %`;
const gaText = (ha: number) => ha.toFixed(1).replace(".", ",");

interface Verdict {
  ok: boolean;
  pending: boolean; // terrain still being sampled
  text: string;
  footprint: Pt[];
  center: Pt;
  edge: number;
  side: 1 | -1;
  i: number;
  radius: number | undefined; // site radius of the template
  front: Pt | null; // door of the lot, for the reach preview of services
}

// Lot hover and placement of the six player-built buildings.
export function attachPlaceTool(map: maplibregl.Map): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  map.getContainer().appendChild(label);

  let ready = false;
  let cursor: { x: number; y: number } | null = null; // px
  let local: Pt | null = null; // m
  let busy = false;
  let timer = 0;

  const source = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;

  const setup = () => {
    if (ready) return;
    ready = true;
    map.addSource("place-lot", { type: "geojson", data: empty() });
    map.addSource("place-radius", { type: "geojson", data: empty() });
    const color = ["case", ["get", "pending"], PENDING_COLOR, ["get", "ok"], PALETTE.ok, PALETTE.bad] as never;
    map.addLayer({ id: "place-radius-fill", type: "fill", source: "place-radius", paint: { "fill-color": PALETTE.paperRaised, "fill-opacity": 0.25 } });
    map.addLayer({
      id: "place-radius-line",
      type: "line",
      source: "place-radius",
      paint: { "line-color": PALETTE.ink2, "line-width": 1.5, "line-dasharray": [3, 2], "line-opacity": 0.7 },
    });
    map.addLayer({ id: "place-lot-fill", type: "fill", source: "place-lot", paint: { "fill-color": color, "fill-opacity": 0.45 } });
    map.addLayer({ id: "place-lot-line", type: "line", source: "place-lot", paint: { "line-color": color, "line-width": 2 } });
  };
  const ensure = () => {
    if (!ready && map.isStyleLoaded()) setup();
    return ready;
  };

  const setLabel = (text: string | null) => {
    if (text === null || !cursor) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.textContent = text;
    label.style.transform = `translate(${cursor.x + 16}px, ${cursor.y + 16}px)`;
  };

  const clearOverlay = () => {
    clearTimeout(timer);
    timer = 0;
    if (ready) {
      source("place-lot")?.setData(empty());
      source("place-radius")?.setData(empty());
    }
    placeReach.value = null;
    setLabel(null);
  };

  const active = (): PlaceTool | null => {
    const t = tool.value;
    return t && isPlaceTool(t) ? t : null;
  };

  // ----- cell lookup (rebuilt when the zone state changes) -----
  let indexFor: unknown = null;
  let byKey = new Map<string, ZoneCell>();
  let starts = new Map<number, ZoneCell[]>(); // depth-0 cells, any block state
  const lookup = () => {
    const z = zones.value;
    if (indexFor !== z) {
      indexFor = z;
      byKey = new Map();
      starts = new Map();
      for (const c of z?.cells ?? []) {
        byKey.set(c.key, c);
        if (c.depth !== 0) continue;
        const k = bucketKey(Math.floor(c.cx / BUCKET), Math.floor(c.cy / BUCKET));
        const list = starts.get(k);
        if (list) list.push(c);
        else starts.set(k, [c]);
      }
    }
  };
  const nearestStart = (x: number, y: number): ZoneCell | null => {
    lookup();
    let best: ZoneCell | null = null;
    let bestD = MAX_SNAP_M;
    for (let bx = Math.floor((x - bestD) / BUCKET); bx <= Math.floor((x + bestD) / BUCKET); bx++) {
      for (let by = Math.floor((y - bestD) / BUCKET); by <= Math.floor((y + bestD) / BUCKET); by++) {
        for (const c of starts.get(bucketKey(bx, by)) ?? []) {
          const d = Math.hypot(c.cx - x, c.cy - y);
          if (d <= bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    return best;
  };

  // ----- evaluation -----
  const siteText = (id: PlaceTool, site: Site, t: BuildingTemplate, center: Pt): string => {
    if (id === "woodcutter") return `Лес вокруг: ${pct(site.forest)}`;
    if (id === "fisher") return `Вода рядом: ${pct(site.water)}`;
    if (id === "quarry") return `Камень: ${pct(site.rock)}`;
    if (id === "gumno") {
      let n = 0;
      let ha = 0;
      for (const f of zones.value?.fields ?? []) {
        const [fx, fy] = fieldCentroid(f);
        if (Math.hypot(fx - center[0], fy - center[1]) <= FIELD.radius) {
          n++;
          ha += haOf(f);
        }
      }
      return n > 0 ? `${t.name} · поля рядом: ${n} (${gaText(ha)} га)` : `${t.name} · полей рядом нет`;
    }
    if (isService(id)) return `${t.name} · охват ${SERVICES[id].reach} м по дорогам`;
    return t.name;
  };

  const evaluate = (id: PlaceTool, x: number, y: number): Verdict | null => {
    const st = state.value;
    const f = frame.value;
    const c0 = nearestStart(x, y);
    if (!st || !f || !c0) return null;
    const t = BUILDINGS[id];
    const far = byKey.get(`${c0.edge}:${c0.side}:${c0.i + t.w - 1}:${t.d - 1}`);
    // Same geometry the sim builds; without the far cell the lot does not fit, show the first cell.
    let footprint: Pt[];
    let center: Pt;
    let front: Pt | null = null;
    if (far) {
      const b = makeBuilding(t, c0, far, 0, 0);
      footprint = b.footprint;
      center = [b.lot.cx, b.lot.cy];
      front = lotFront(b);
    } else {
      footprint = cellCorners(c0);
      center = [c0.cx, c0.cy];
    }
    const radius = SITE_RADIUS[id];
    let site: Site = NO_SITE;
    let pending = false;
    if (radius !== undefined) {
      const known = cachedSite(center[0], center[1], radius, state.value?.clearings);
      if (known) site = known;
      else {
        pending = true;
        site = { forest: 1, water: 1, rock: 0 }; // optimistic: only the lot itself is judged until sampled
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          siteAt(f, center[0], center[1], radius, state.value?.clearings).then(refresh, () => setLabel("Нет данных о местности"));
        }, SAMPLE_DELAY_MS);
      }
    }
    const check = canPlace(st, t, c0.edge, c0.side, c0.i, site);
    const base = { footprint, center, edge: c0.edge, side: c0.side, i: c0.i, radius, front };
    if (!check.ok) return { ...base, ok: false, pending: false, text: check.reason };
    if (pending) return { ...base, ok: true, pending: true, text: "…" };
    return { ...base, ok: true, pending: false, text: `${siteText(id, site, t, center)}
${costText(t.labor, t.materials)}` };
  };

  const ring = (pts: Pt[], f: NonNullable<typeof frame.value>): [number, number][] => {
    const r = pts.map(([x, y]) => f.toLngLat(x, y));
    return [...r, r[0]];
  };

  const draw = (id: PlaceTool, v: Verdict | null) => {
    const f = frame.value;
    if (!ensure() || !f) return;
    // Services show the road edges they would reach from this lot (only when the lot is allowed).
    if (v && v.ok && v.front && isService(id)) {
      const cur = placeReach.value;
      const [x, y] = v.front;
      if (!cur || cur.x !== x || cur.y !== y) placeReach.value = { x, y, range: SERVICES[id].reach, color: SERVICES[id].color };
    } else if (placeReach.value) placeReach.value = null;
    if (!v) {
      source("place-lot")?.setData(empty());
      source("place-radius")?.setData(empty());
      return;
    }
    source("place-lot")?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { ok: v.ok, pending: v.pending },
          geometry: { type: "Polygon", coordinates: [ring(v.footprint, f)] },
        },
      ],
    });
    // Circle of the site: woodcutter and fisher reach, and the fields a farmstead can work.
    const r = id === "gumno" ? FIELD.radius : id === "woodcutter" || id === "fisher" ? v.radius : id === "dig" ? DIG.startRadius : undefined;
    if (r === undefined) {
      source("place-radius")?.setData(empty());
      return;
    }
    const pts: Pt[] = [];
    for (let k = 0; k < CIRCLE_STEPS; k++) {
      const a = (k / CIRCLE_STEPS) * 2 * Math.PI;
      pts.push([v.center[0] + r * Math.cos(a), v.center[1] + r * Math.sin(a)]);
    }
    source("place-radius")?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(pts, f)] } }],
    });
  };

  function refresh(): void {
    const id = active();
    if (!id || !local) return;
    if (map.getZoom() < MIN_ZONE_ZOOM) {
      draw(id, null);
      setLabel("Приблизьте карту");
      return;
    }
    const v = evaluate(id, local[0], local[1]);
    draw(id, v);
    setLabel(v ? v.text : "Здесь нет дороги");
  }

  // ----- events -----
  const onMove = (e: maplibregl.MapMouseEvent) => {
    cursor = { x: e.point.x, y: e.point.y };
    if (!active()) return;
    const f = frame.value;
    if (!f) return;
    local = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    refresh();
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    const id = active();
    const f = frame.value;
    if (!id || !f || busy) return;
    if (map.getZoom() < MIN_ZONE_ZOOM) {
      flash("Приблизьте карту");
      return;
    }
    const [x, y] = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    local = [x, y];
    const v = evaluate(id, x, y);
    if (!v) {
      flash("Здесь нет места вдоль дороги");
      return;
    }
    if (!v.ok) {
      flash(v.text);
      return;
    }
    busy = true;
    const t = BUILDINGS[id];
    const measure = v.radius !== undefined ? siteAt(f, v.center[0], v.center[1], v.radius, state.value?.clearings) : Promise.resolve(NO_SITE);
    measure
      .then((site) => {
        const st = state.value;
        const check = st ? canPlace(st, t, v.edge, v.side, v.i, site) : { ok: false as const, reason: "Нет данных" };
        if (!check.ok) {
          flash(check.reason);
          return;
        }
        return sendCmd({ type: "placeBuilding", template: id, edge: v.edge, side: v.side, i: v.i, site }).then((r) => {
          if (!r.ok) flash(r.reason ?? "Не удалось поставить здание");
        });
      })
      .catch(() => flash("Нет данных о местности"))
      .then(() => {
        busy = false;
        refresh();
      });
  };

  const onContext = (e: maplibregl.MapMouseEvent) => {
    if (!active()) return;
    e.preventDefault();
    e.originalEvent.preventDefault();
    tool.value = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    if (e.key === "Escape" && active()) tool.value = null;
  };

  map.on("mousemove", onMove);
  map.on("click", onClick);
  map.on("contextmenu", onContext);
  window.addEventListener("keydown", onKeyDown);
  map.getCanvas().addEventListener("mouseleave", () => {
    cursor = null;
    local = null;
    clearOverlay();
  });

  // Tool switched, or the zones and buildings changed under the cursor: redo the preview.
  effect(() => {
    void tool.value;
    void zones.value;
    void buildingSet.value;
    untracked(() => {
      clearOverlay();
      if (active() && local) refresh();
    });
  });
}
