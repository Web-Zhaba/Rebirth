import { play } from "../ui/sound";
import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { queuedLabel } from "../sim/clock";
import { lockReason } from "../sim/tech";
import { addRoad, cutOffEdges, distToEdge, effectiveSpans, isRoadKind, MIN_SEGMENT, oldStreetKind, ROAD_KINDS, segmentCost, segmentKind, snapPoint, type Snap } from "../sim/roads";
import type { RoadKind } from "../sim/types";
import { frame, gameClock, roads, sendCmd, state } from "../simClient";
import { oldWorld } from "./excavation";
import { roadLine, snapToOldStreets, streetJunctions } from "../world/oldStreets";
import type { Street } from "../world/oldworld";
import { samplePathProfile } from "../world/profile";
import { PALETTE } from "../ui/palette";
import { etaText } from "./buildCost";
import { arcPath, snapAngle, type Pt } from "./curve";
import { flash, isRoadTool, mapMpp, MIN_ROAD_ZOOM, roadMode, setSpacePan, syncPan, tool, type RoadTool } from "./tools";

const SNAP_PX = 12;
const PREVIEW_MS = 120;
const DRAG_PX = 4; // screen pixels: beyond this a press is a drag, not a click
const ANGLE_STEP_DEG = 15;
const CURVE_SNAP_M = 1; // curve ends are already resolved; interior points must not jump onto nearby roads

// The active tool when it is a road tool, else null (zone tools are handled by zoneTool.ts).
const roadT = (): RoadTool | null => {
  const t = tool.value;
  return t && isRoadTool(t) ? t : null;
};

// The revealed old way a road end sits on, if any.
interface OldRef {
  id: string;
  cls: string;
  bridge: boolean;
}
// The old way both ends sit on, else null.
const sameOldStreet = (a: OldRef | null, b: OldRef | null): OldRef | null => (a && b && a.id === b.id ? a : null);

// The road kind being drawn, or null for the bulldozer, the restore tool or no road tool.
const drawT = (): RoadKind | null => {
  const t = tool.value;
  return t && isRoadKind(t) ? t : null;
};

// The revealed old street under the restore tool: each of its ways is a line, priced once `priced`; the `ok` ones get built.
interface RestoreLine {
  pts: Pt[];
  cls: string;
  kind: RoadKind;
  labor: number;
  span: number; // m, longest run of water
  ok: boolean;
}
interface Restore {
  key: string; // "name:…" for a named street (all its ways), "id:…" for a single unnamed way
  title: string;
  lines: RestoreLine[];
  priced: boolean;
  reason: string | null;
}

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const line = (a: [number, number], b: [number, number], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: [a, b] },
});
const lengthOf = (pts: readonly Pt[]): number => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return total;
};
// Splits `labor` between the pieces of a polyline by length.
const laborByLength = (pts: readonly Pt[], labor: number): number[] => {
  const total = lengthOf(pts);
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    out.push(total > 0 ? (labor * l) / total : 0);
  }
  return out;
};

// Where the cursor points: a snapped node/edge, an old street vertex, or free ground; Shift locks the angle from the anchor.
interface Aim {
  snap: Snap;
  old: OldRef | null;
  guide: boolean;
  name?: string;
  deg: number | null; // the locked direction in degrees, null when the angle is free
}

// Interactive road drawing and bulldozing on top of the map.
export function attachRoadTool(map: maplibregl.Map): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  map.getContainer().appendChild(label);

  let ready = false;
  let start: Snap | null = null; // last placed point of the current chain
  let startOld: OldRef | null = null; // the old street start sits on
  let arcEnd: Snap | null = null; // arc mode: the chord's far end; the cursor then bends the arc
  let arcOld: OldRef | null = null;
  let busy = false; // a segment is being validated/sent
  let cursor: { x: number; y: number } | null = null; // last mouse position, px
  let hoverEdge: number | null = null;
  let seq = 0; // bumped to drop stale async preview results
  let timer = 0;
  let pendingCost: { pts: Pt[]; along: OldRef | null } | null = null;
  let verdict: { ok: boolean; text: string } | null = null;
  let lastEvent: maplibregl.MapMouseEvent | null = null;
  let streetHint = ""; // " · по старой улице X" while the snap is on a named old street
  let angleHint = ""; // "45°" while Shift locks the direction
  let pressing = false; // left button is down on the map
  let dragging = false; // the press has become a drag
  let pressScreen: { x: number; y: number } | null = null;
  let pressSnap: Snap | null = null; // where the drag began
  let pressOld: OldRef | null = null;
  let suppressClick = false; // swallow the click MapLibre fires after a drag
  let spaceDown = false;
  let shiftDown = false;
  let restore: Restore | null = null;

  const source = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;

  const setup = () => {
    if (ready) return;
    ready = true;
    map.addSource("road-preview", { type: "geojson", data: empty() });
    map.addSource("road-hover", { type: "geojson", data: empty() });
    map.addSource("road-snap", { type: "geojson", data: empty() });
    map.addLayer({
      id: "road-hover",
      type: "line",
      source: "road-hover",
      paint: { "line-color": PALETTE.bad, "line-width": 6, "line-opacity": 0.75 },
    });
    map.addLayer({
      id: "road-preview",
      type: "line",
      source: "road-preview",
      paint: {
        "line-color": ["case", ["get", "ok"], PALETTE.ok, PALETTE.bad],
        "line-width": 3,
        "line-dasharray": [2, 1.5],
      },
    });
    map.addLayer({
      id: "road-snap",
      type: "circle",
      source: "road-snap",
      paint: {
        "circle-radius": 6,
        "circle-color": PALETTE.paperRaised,
        "circle-stroke-color": PALETTE.info,
        "circle-stroke-width": 2,
      },
    });
  };
  const ensure = () => {
    if (map.isStyleLoaded()) setup();
    return ready;
  };

  const setLabel = (raw: string | null) => {
    const base = raw === null ? (streetHint ? streetHint.slice(3) : null) : raw + streetHint;
    const text = base === null ? (angleHint || null) : angleHint ? `${base} · ${angleHint}` : base;
    if (text === null || !cursor) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.textContent = text;
    label.style.transform = `translate(${cursor.x + 16}px, ${cursor.y + 16}px)`;
  };

  const clearOverlay = () => {
    seq++;
    restore = null;
    clearTimeout(timer);
    timer = 0;
    pendingCost = null;
    verdict = null;
    hoverEdge = null;
    streetHint = "";
    angleHint = "";
    if (!ready) return;
    source("road-preview")?.setData(empty());
    source("road-hover")?.setData(empty());
    source("road-snap")?.setData(empty());
    setLabel(null);
  };

  const drawPreview = (pts: readonly Pt[]) => {
    const f = frame.value;
    if (!f || pts.length < 2) {
      source("road-preview")?.setData(empty());
      return;
    }
    source("road-preview")?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { ok: verdict?.ok ?? true },
          geometry: { type: "LineString", coordinates: pts.map(([x, y]) => f.toLngLat(x, y)) },
        },
      ],
    });
  };

  // Existing road nodes and edges first; when none is near, the revealed old streets (vertices, then segments).
  const resolve = (g: NonNullable<typeof roads.value>, p: { x: number; y: number }, tol: number): { snap: Snap; guide: boolean; name?: string; old: OldRef | null } => {
    const snap = snapPoint(g, p, tol);
    if (snap.kind !== "free") return { snap, guide: true, old: null };
    const old = snapToOldStreets(p, oldWorld.value?.streets ?? [], tol);
    if (!old) return { snap, guide: false, old: null };
    const ref = old.id !== undefined && old.cls !== undefined ? { id: old.id, cls: old.cls, bridge: old.bridge === true } : null;
    return { snap: { x: old.x, y: old.y, kind: "free" }, guide: true, name: old.name, old: ref };
  };

  const setSnap = (s: Snap | null, guide = true) => {
    const f = frame.value;
    const pt: GeoJSON.Feature[] =
      s && f && guide
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(s.x, s.y) } }]
        : [];
    source("road-snap")?.setData({ type: "FeatureCollection", features: pt });
  };

  const costText = (len: number, labor: number, stone = 0) =>
    `${Math.round(len)} м · ${Math.round(labor)} чел.-ч${stone > 0 ? ` · камня ${Math.round(stone * 10) / 10} т`.replace(".", ",") : ""} · ${etaText(labor)}`;
  const spans = () => effectiveSpans(state.peek()?.progress);

  // Terrain sampling is throttled; results of superseded requests are dropped.
  const requestCost = (pts: Pt[], along: OldRef | null) => {
    pendingCost = { pts, along };
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      const req = pendingCost;
      const f = frame.value;
      const t = drawT();
      if (!req || !f || !t) return;
      const mine = ++seq;
      samplePathProfile(f, req.pts, state.value?.clearings)
        .then((p) => {
          if (mine !== seq) return;
          const c = segmentCost(p, segmentKind(t, req.along), spans());
          const queued = queuedLabel(gameClock.peek(), state.peek()?.levers);
          verdict = c.ok ? { ok: true, text: costText(p.length, c.labor, c.stone) + (queued ? ` · ${queued}` : "") } : { ok: false, text: c.reason ?? "Нельзя" };
          drawPreview(req.pts);
          setLabel(verdict.text);
        })
        .catch(() => {
          if (mine !== seq) return;
          verdict = { ok: false, text: "Нет данных о местности" };
          drawPreview(req.pts);
          setLabel(verdict.text);
        });
    }, PREVIEW_MS);
  };

  const nearestEdge = (x: number, y: number, tol: number): number | null => {
    const g = roads.value;
    if (!g) return null;
    let best = tol;
    let id: number | null = null;
    for (const e of Object.values(g.edges)) {
      const d = distToEdge(g, e, x, y);
      if (d <= best) {
        best = d;
        id = e.id;
      }
    }
    return id;
  };

  const context = (e: maplibregl.MapMouseEvent) => {
    const f = frame.value;
    const g = roads.value;
    if (!f || !g) return null;
    const [x, y] = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    const tol = SNAP_PX * mapMpp(e.lngLat.lat, map.getZoom());
    return { f, g, x, y, tol };
  };

  const shiftOn = (e: maplibregl.MapMouseEvent) => shiftDown || !!e.originalEvent.shiftKey;

  const aim = (e: maplibregl.MapMouseEvent, ctx: NonNullable<ReturnType<typeof context>>, anchor: Snap | null): Aim => {
    const r = resolve(ctx.g, { x: ctx.x, y: ctx.y }, ctx.tol);
    if (!anchor || !shiftOn(e)) return { snap: r.snap, old: r.old, guide: r.guide, name: r.name, deg: null };
    const a = snapAngle([anchor.x, anchor.y], [ctx.x, ctx.y], ANGLE_STEP_DEG);
    return { snap: { x: a.x, y: a.y, kind: "free" }, old: null, guide: false, deg: a.deg };
  };

  // Preview of the segment being drawn: validation, then the terrain cost.
  const showPath = (pts: Pt[], along: OldRef | null) => {
    const g = roads.value;
    const t = drawT();
    if (!g || !t) return;
    const locked = lockOf(t);
    if (locked) {
      seq++;
      pendingCost = null;
      verdict = { ok: false, text: locked };
      drawPreview(pts);
      setLabel(locked);
      return;
    }
    if (pts.length < 2) {
      seq++;
      pendingCost = null;
      verdict = { ok: false, text: "Слишком коротко" };
      drawPreview(pts);
      setLabel(verdict.text);
      return;
    }
    drawPreview(pts);
    const local = addRoad(g, pts, t, CURVE_SNAP_M, laborByLength(pts, 1));
    if (!local.ok) {
      seq++; // drop any in-flight sampling for an older path
      pendingCost = null;
      verdict = { ok: false, text: local.reason };
      drawPreview(pts);
      setLabel(local.reason);
      return;
    }
    setLabel(verdict ? verdict.text : "…");
    requestCost(pts, along);
  };

  // Sends the segment and, when it is built, continues the chain from its end.
  const commitPath = (pts: Pt[], target: Snap, old: OldRef | null) => {
    const f = frame.value;
    const g = roads.value;
    const t = drawT();
    if (!f || !g || !t) return;
    const locked = lockOf(t);
    if (locked) {
      flash(locked);
      return;
    }
    if (pts.length < 2) {
      flash("Слишком коротко");
      return;
    }
    const local = addRoad(g, pts, t, CURVE_SNAP_M, laborByLength(pts, 1));
    if (!local.ok) {
      flash(local.reason);
      return;
    }
    const along = sameOldStreet(startOld, old);
    busy = true;
    samplePathProfile(f, pts, state.value?.clearings)
      .then((p) => {
        const kind = segmentKind(t, along);
        const c = segmentCost(p, kind, spans());
        if (!c.ok) {
          flash(c.reason ?? "Нельзя");
          return false;
        }
        return sendCmd({
          type: "addRoad",
          kind,
          pts,
          snapTol: CURVE_SNAP_M,
          labor: laborByLength(pts, c.labor),
          span: c.span,
        }).then((res) => {
          if (!res.ok) flash(res.reason ?? "Не удалось проложить");
          else if (cutOffEdges(local.graph).size > cutOffEdges(g).size) {
            flash("Дорога не связана с лагерем — её не построят. Ведите её от лагеря или от готовой дороги");
          } else play("place");
          return res.ok;
        });
      })
      .catch(() => {
        flash("Нет данных о местности");
        return false;
      })
      .then((ok) => {
        busy = false;
        if (ok) {
          start = target;
          startOld = old;
          verdict = null;
          if (lastEvent) onMove(lastEvent);
        }
      });
  };

  // Restore tool: the old street under the cursor is drawn whole and priced; a click builds every way of it that fits.
  const lockOf = (k: RoadKind): string | null => {
    const progress = state.peek()?.progress;
    return progress ? lockReason({ progress }, k) : null;
  };

  const drawRestore = (r: Restore) => {
    const f = frame.value;
    if (!f) return;
    source("road-preview")?.setData({
      type: "FeatureCollection",
      features: r.lines.map((l) => ({
        type: "Feature",
        properties: { ok: l.ok },
        geometry: { type: "LineString", coordinates: l.pts.map(([x, y]) => f.toLngLat(x, y)) },
      })),
    });
  };

  const restoreText = (r: Restore): string => {
    if (!r.priced) return `${r.title} · …`;
    const ok = r.lines.filter((l) => l.ok);
    if (ok.length === 0) return `${r.title} · ${r.reason ?? "Нельзя"}`;
    const len = ok.reduce((s, l) => s + lengthOf(l.pts), 0);
    const labor = ok.reduce((s, l) => s + l.labor, 0);
    const missing = r.lines.length - ok.length;
    return `${r.title} · ${costText(len, labor)}${missing ? ` · не пройдёт участков: ${missing}` : ""} · клик — восстановить`;
  };

  // The ends of the old streets, recomputed when a dig reveals more.
  let junctionsOf: readonly Street[] | null = null;
  let junctions = new Set<string>();

  const pickRestore = (key: string, name: string | undefined, ways: readonly Street[], all: readonly Street[]) => {
    const g = roads.value;
    const f = frame.value;
    if (!g || !f) return;
    if (junctionsOf !== all) {
      junctionsOf = all;
      junctions = streetJunctions(all);
    }
    const r: Restore = { key, title: name ? `Улица «${name}»` : "Старая дорога", lines: [], priced: false, reason: null };
    for (const w of ways) {
      const pts = roadLine(w.pts, MIN_SEGMENT, junctions);
      if (!pts) continue;
      // An old way comes back as the road it was: a footway as a path, anything wider as a dirt road, and a bridge
      // as the matching bridge; while that kind is locked, the lighter one of the same sort.
      let kind: RoadKind = oldStreetKind(w.cls, w.bridge === true);
      if (lockOf(kind)) kind = kind === "bridge" ? "footbridge" : kind === "dirt" ? "path" : kind;
      const local = addRoad(g, pts, kind, CURVE_SNAP_M, laborByLength(pts, 1));
      if (!local.ok && !r.reason) r.reason = local.reason;
      r.lines.push({ pts, cls: w.cls, kind, labor: 0, span: 0, ok: local.ok });
    }
    if (r.lines.length === 0) r.reason = "Слишком коротко";
    restore = r;
    drawRestore(r);
    void Promise.all(
      r.lines
        .filter((l) => l.ok)
        .map(async (l) => {
          try {
            const p = await samplePathProfile(f, l.pts, state.value?.clearings);
            const c = segmentCost(p, l.kind, spans());
            const lock = lockOf(l.kind);
            l.labor = c.labor;
            l.span = c.span;
            if (!c.ok || lock) {
              l.ok = false;
              if (!r.reason) r.reason = lock ?? c.reason ?? "Нельзя";
            }
          } catch {
            l.ok = false;
            if (!r.reason) r.reason = "Нет данных о местности";
          }
        }),
    ).then(() => {
      if (restore !== r) return; // the cursor moved on while pricing
      r.priced = true;
      drawRestore(r);
      if (cursor) setLabel(restoreText(r));
    });
  };

  // Hovering: the nearest revealed old street within the snap distance, with every way of the same name.
  const hoverRestore = (x: number, y: number, tol: number) => {
    const all = oldWorld.value?.streets ?? [];
    const hit = snapToOldStreets({ x, y }, all, tol);
    if (!hit || hit.id === undefined) {
      if (restore) clearOverlay();
      setLabel(all.length ? null : "Старых улиц пока нет: их открывают раскопки");
      return;
    }
    const key = hit.name ? `name:${hit.name}` : `id:${hit.id}`;
    if (restore?.key !== key) pickRestore(key, hit.name, hit.name ? all.filter((s) => s.name === hit.name) : all.filter((s) => s.id === hit.id), all);
    setSnap(null);
    if (restore) setLabel(restoreText(restore));
  };

  // Builds every `ok` way in order; the server has the last word on each one.
  const commitRestore = async () => {
    const r = restore;
    if (!r || !r.priced || busy) return; // nothing under the cursor, or still pricing: a click does nothing
    const todo = r.lines.filter((l) => l.ok);
    if (todo.length === 0) {
      flash(r.reason ?? "Нельзя");
      return;
    }
    const before = roads.peek();
    let after = before; // the graph as the accepted ways leave it, to tell whether they reach the camp
    busy = true;
    let built = 0;
    let reason = "";
    for (const l of todo) {
      const res = await sendCmd({ type: "addRoad", kind: l.kind, pts: l.pts, snapTol: CURVE_SNAP_M, labor: laborByLength(l.pts, l.labor), span: l.span });
      if (res.ok) {
        built++;
        const local = after && addRoad(after, l.pts, l.kind, CURVE_SNAP_M, laborByLength(l.pts, l.labor));
        if (local && local.ok) after = local.graph;
      } else if (!reason) reason = res.reason ?? "Не удалось проложить";
    }
    busy = false;
    if (restore === r) clearOverlay();
    if (built > 0) play("place");
    if (reason) flash(built > 0 ? `Восстановлено участков: ${built} из ${todo.length}. ${reason}` : reason);
    else if (before && after && cutOffEdges(after).size > cutOffEdges(before).size) {
      flash("Улица не связана с лагерем — её не построят. Восстановите сначала улицу, что ведёт к лагерю или к готовой дороге");
    }
    if (lastEvent) onMove(lastEvent);
  };

  const onMove = (e: maplibregl.MapMouseEvent) => {
    lastEvent = e;
    cursor = { x: e.point.x, y: e.point.y };
    const t = roadT();
    if (!t || !ensure()) return;
    const ctx = context(e);
    if (!ctx) return;
    if (map.getZoom() < MIN_ROAD_ZOOM) {
      clearOverlay();
      setLabel("Приблизьте карту");
      return;
    }
    const { f, g, x, y, tol } = ctx;
    if (t === "restore") {
      hoverRestore(x, y, tol);
      return;
    }
    if (t === "bulldoze") {
      hoverEdge = nearestEdge(x, y, tol);
      const edge = hoverEdge === null ? null : g.edges[hoverEdge];
      if (!edge) {
        source("road-hover")?.setData(empty());
        setLabel(null);
        return;
      }
      const a = g.nodes[edge.a];
      const b = g.nodes[edge.b];
      source("road-hover")?.setData({
        type: "FeatureCollection",
        features: [line(f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y))],
      });
      const pct = edge.labor > 0 ? Math.floor((100 * edge.done) / edge.labor) : 100;
      setLabel(`${ROAD_KINDS[edge.kind].name} · ${Math.round(edge.length)} м · ${pct >= 100 ? "построено" : `${pct} %`}${(edge.stone ?? 0) > (state.peek()?.stock.stone ?? Infinity) ? " · Нет камня" : ""}`);
      return;
    }
    if (spaceDown) {
      clearOverlay();
      setLabel(null);
      return;
    }
    // Arc mode, second stage: the chord is fixed and the cursor bends the arc through itself.
    if (arcEnd && start) {
      angleHint = "";
      streetHint = "";
      setSnap(null);
      showPath(arcPath([start.x, start.y], [x, y], [arcEnd.x, arcEnd.y]), sameOldStreet(startOld, arcOld));
      return;
    }
    if (pressing && pressScreen) {
      if (!dragging && Math.hypot(e.point.x - pressScreen.x, e.point.y - pressScreen.y) >= DRAG_PX) dragging = true;
      const anchor = pressSnap;
      if (dragging && anchor) {
        const a = aim(e, ctx, anchor);
        angleHint = a.deg === null ? "" : `${a.deg}°`;
        streetHint = "";
        setSnap(a.snap, a.guide);
        showPath([[anchor.x, anchor.y], [a.snap.x, a.snap.y]], sameOldStreet(startOld, a.old));
        return;
      }
    }
    const a = aim(e, ctx, start);
    angleHint = a.deg === null ? "" : `${a.deg}°`;
    streetHint = a.name && a.old ? ` · по старой улице ${a.name}` : "";
    setSnap(a.snap, a.guide);
    if (!start) {
      setLabel(null);
      return;
    }
    showPath([[start.x, start.y], [a.snap.x, a.snap.y]], sameOldStreet(startOld, a.old));
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const t = roadT();
    if (!t || busy || !ensure()) return;
    const ctx = context(e);
    if (!ctx || map.getZoom() < MIN_ROAD_ZOOM || spaceDown) return;
    if (t === "restore") {
      void commitRestore();
      return;
    }
    const { g, x, y, tol } = ctx;
    if (t === "bulldoze") {
      const id = nearestEdge(x, y, tol);
      if (id === null) return;
      hoverEdge = null;
      source("road-hover")?.setData(empty());
      setLabel(null);
      void sendCmd({ type: "removeRoad", edgeId: id }).then((r) => {
        if (!r.ok) flash(r.reason ?? "Не удалось снести");
        else play("place");
      });
      return;
    }
    // Third click of an arc: the bend point is where the cursor is.
    if (arcEnd && start) {
      const end = arcEnd;
      const endOld = arcOld;
      arcEnd = null;
      arcOld = null;
      commitPath(arcPath([start.x, start.y], [x, y], [end.x, end.y]), end, endOld);
      return;
    }
    const a = aim(e, ctx, start);
    if (!start) {
      start = a.snap;
      startOld = a.old;
      return;
    }
    if (roadMode.value === "arc") {
      arcEnd = a.snap;
      arcOld = a.old;
      return;
    }
    commitPath([[start.x, start.y], [a.snap.x, a.snap.y]], a.snap, a.old);
  };

  const onDown = (e: maplibregl.MapMouseEvent) => {
    suppressClick = false;
    const t = roadT();
    if (!t || !isRoadKind(t) || busy || spaceDown || arcEnd || !ensure()) return;
    if (e.originalEvent.button !== 0) return;
    const ctx = context(e);
    if (!ctx || map.getZoom() < MIN_ROAD_ZOOM) return;
    const a = aim(e, ctx, null);
    pressing = true;
    dragging = false;
    pressScreen = { x: e.point.x, y: e.point.y };
    pressSnap = a.snap;
    pressOld = a.old;
  };

  const onUp = () => {
    if (!pressing) return;
    const wasDrag = dragging;
    const anchor = pressSnap;
    const anchorOld = pressOld;
    pressing = false;
    dragging = false;
    pressScreen = null;
    pressSnap = null;
    pressOld = null;
    if (!wasDrag || !anchor || !lastEvent || spaceDown) return;
    suppressClick = true;
    const ctx = context(lastEvent);
    if (!ctx) return;
    const a = aim(lastEvent, ctx, anchor);
    // Arc mode: the drag sets the chord; the mouse then bends the arc until the next click.
    if (roadMode.value === "arc") {
      start = anchor;
      startOld = anchorOld;
      arcEnd = a.snap;
      arcOld = a.old;
      onMove(lastEvent);
      return;
    }
    commitPath([[anchor.x, anchor.y], [a.snap.x, a.snap.y]], a.snap, a.old);
  };

  const endChain = () => {
    start = null;
    startOld = null;
    arcEnd = null;
    arcOld = null;
    pressing = false;
    dragging = false;
    pressScreen = null;
    pressSnap = null;
    pressOld = null;
    clearOverlay();
  };

  // Back from the bend stage to the chord, or out of the chain.
  const onContext = (e: maplibregl.MapMouseEvent) => {
    if (!roadT()) return;
    e.preventDefault();
    e.originalEvent.preventDefault();
    if (arcEnd) {
      arcEnd = null;
      arcOld = null;
      clearOverlay();
    } else if (start || pressing) endChain();
  };

  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };

  const onKey = (e: KeyboardEvent) => {
    if (typing(e)) return;
    if (e.key === " " && roadT()) {
      e.preventDefault();
      spaceDown = true;
      if (pressing) {
        pressing = false;
        dragging = false;
        pressScreen = null;
        pressSnap = null;
        pressOld = null;
      }
      setSpacePan(true);
      syncPan(map);
      clearOverlay();
      return;
    }
    if (e.key === "Shift" && roadT()) {
      shiftDown = true;
      if (lastEvent) onMove(lastEvent);
      return;
    }
    if (e.key !== "Escape" || !roadT()) return;
    if (arcEnd) {
      arcEnd = null;
      arcOld = null;
      clearOverlay();
    } else if (start || pressing) endChain();
    else tool.value = null;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      spaceDown = false;
      setSpacePan(false);
      syncPan(map);
      if (roadT() && lastEvent) onMove(lastEvent);
    } else if (e.key === "Shift") {
      shiftDown = false;
      if (roadT() && lastEvent) onMove(lastEvent);
    }
  };

  map.on("mousemove", onMove);
  map.on("mousedown", onDown);
  map.on("click", onClick);
  map.on("contextmenu", onContext);
  map.on("zoom", () => syncPan(map));
  map.getCanvas().addEventListener("mouseleave", () => {
    cursor = null;
    if (!start && !dragging) clearOverlay();
    else setLabel(null);
  });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => {
    shiftDown = false;
    spaceDown = false;
    pressing = false;
    dragging = false;
    pressSnap = null;
    pressOld = null;
    setSpacePan(false);
    syncPan(map);
  });

  // Tool switched on or off from the toolbar.
  effect(() => {
    const t = tool.value;
    start = null;
    startOld = null;
    arcEnd = null;
    arcOld = null;
    busy = false;
    pressing = false;
    dragging = false;
    pressScreen = null;
    pressSnap = null;
    pressOld = null;
    if (ready) clearOverlay();
    map.getCanvas().style.cursor = t ? "crosshair" : "";
    if (t) {
      map.doubleClickZoom.disable();
      map.boxZoom.disable(); // Shift-drag locks the road angle instead
    } else {
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
    }
    syncPan(map);
  });

  // A different drawing mode starts a fresh chain.
  effect(() => {
    void roadMode.value;
    start = null;
    startOld = null;
    arcEnd = null;
    arcOld = null;
    pressing = false;
    dragging = false;
    pressScreen = null;
    pressSnap = null;
    pressOld = null;
    if (ready) clearOverlay();
  });
}
