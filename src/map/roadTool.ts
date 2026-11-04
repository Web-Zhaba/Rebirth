import { play } from "../ui/sound";
import type { View, ViewPointer } from "../view/view";
import { effect, signal } from "@preact/signals";
import { queuedLabel } from "../sim/clock";
import { lockReason } from "../sim/tech";
import { addRoad, cutOffEdges, distToEdge, effectiveSpans, fitBridgeKind, isBridge, isRoadKind, longestSpan, MIN_SEGMENT, oldStreetKind, ROAD_KINDS, segmentCost, segmentKind, snapPoint, stoneOwed, upgradeReason, upgradeWork, workShare, type Snap, type TerrainProfile } from "../sim/roads";
import type { RoadGraph, RoadKind } from "../sim/types";
import { roadChains } from "./roadChains";
import { frame, gameClock, roads, sendCmd, state } from "../simClient";
import { oldWorld } from "./excavation";
import { roadLine, snapToOldStreets, streetJunctions, stretchShort } from "../world/oldStreets";
import type { Street } from "../world/oldworld";
import { samplePathProfile } from "../world/profile";
import { PALETTE } from "../ui/palette";
import { etaText } from "./buildCost";
import { needsRoadDemolishConfirm } from "../ui/actionModel";
import { arcPath, snapAngle, type Pt } from "./curve";
import { restoreMissingPieces } from "./roadRestoreModel";
import { flash, isRoadTool, roadKindOf, ROAD_MAX_MPP, roadMode, setSpacePan, syncPan, tool, type RoadTool } from "./tools";
import { decimal, L } from "../i18n";


export const roadDemolishRequest = signal<number | null>(null);
const SNAP_PX = 12;
const PREVIEW_MS = 120;
const DRAG_PX = 4; // screen pixels: beyond this a press is a drag, not a click
const TOUCH_DRAG_PX = 15; // a finger drifts: the same slack the map gives a tap (view/engine/scale.ts)
const ANGLE_STEP_DEG = 15;
const CURVE_SNAP_M = 1; // curve ends are already resolved; interior points must not jump onto nearby roads
const SHORT_WAY_M = MIN_SEGMENT + 2.5; // an old way shorter than a road segment is laid this long, over the ways it joins

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
  return roadKindOf(tool.value);
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

// A built (or planned) stretch of road under a drawing tool of a better kind of its sort: a click rebuilds it as that
// kind (sim/roads.ts upgradeRoads). `labor`: each edge built anew as `kind`; `work`: the rebuilding, all edges together.
interface Upgrade {
  key: string;
  kind: RoadKind;
  from: RoadKind;
  edges: number[];
  pts: Pt[];
  length: number;
  priced: boolean;
  ok: boolean;
  reason: string | null;
  labor: number[];
  work: number;
  stone: number;
  span: number;
}

// The stretches of road between branches, per edge: what one upgrade click takes.
interface Run {
  edges: number[];
  nodes: number[];
}
let runsOf: RoadGraph | null = null;
let runOfEdge = new Map<number, Run>();
function runAt(g: RoadGraph, edge: number): Run | undefined {
  if (runsOf !== g) {
    runsOf = g;
    runOfEdge = new Map();
    const byEnds = new Map<string, number>();
    for (const e of Object.values(g.edges)) byEnds.set(e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`, e.id);
    for (const ch of roadChains(g, () => "built")) {
      const edges: number[] = [];
      for (let i = 0; i + 1 < ch.nodes.length; i++) {
        const [p, q] = [ch.nodes[i], ch.nodes[i + 1]];
        const id = byEnds.get(p < q ? `${p},${q}` : `${q},${p}`);
        if (id !== undefined) edges.push(id);
      }
      if (edges.length !== ch.nodes.length - 1) continue; // a doubled stretch: leave it out
      const run = { edges, nodes: ch.nodes };
      for (const id of edges) runOfEdge.set(id, run);
    }
  }
  return runOfEdge.get(edge);
}

// Where the cursor points: a snapped node/edge, an old street vertex, or free ground; Shift locks the angle from the anchor.
interface Aim {
  snap: Snap;
  old: OldRef | null;
  guide: boolean;
  name?: string;
  deg: number | null; // the locked direction in degrees, null when the angle is free
}

// Interactive road drawing and bulldozing on top of the map.
export function attachRoadTool(view: View): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  view.container.appendChild(label);

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
  let lastEvent: ViewPointer | null = null;
  let streetHint = ""; // " · по старой улице X" while the snap is on a named old street
  let angleHint = ""; // "45°" while Shift locks the direction
  let pressing = false; // the primary pointer is down on the map
  let dragging = false; // the press has become a drag
  let activePointerId: number | null = null;
  const activePointers = new Set<number>();
  let multiPointer = false;
  let pressScreen: { x: number; y: number } | null = null;
  let pressSnap: Snap | null = null; // where the drag began
  let pressOld: OldRef | null = null;
  let suppressClick = false; // swallow the click MapLibre fires after a drag
  let bending = false; // arc mode: the pointer is down to bend the arc; its release lays it once it has moved
  let bendMoved = false;
  let touchInput = false; // the last press was a finger: no hover, no right button, no Esc
  let spaceDown = false;
  let shiftDown = false;
  let restore: Restore | null = null;
  let gen = 0; // bumped when the tool or the drawing mode changes: a road sent before then does not continue the chain
  let upgrade: Upgrade | null = null; // the stretch of road a click would rebuild
  let upgradeOnPrice: Upgrade | null = null; // clicked before it was priced: rebuild it once it is

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
    upgrade = null;
    upgradeOnPrice = null;
    streetHint = "";
    angleHint = "";
    view.overlay("road-preview").setData(empty());
    view.overlay("road-hover").setData(empty());
    view.overlay("road-snap").setData(empty());
    setLabel(null);
  };

  const drawPreview = (pts: readonly Pt[]) => {
    const f = frame.value;
    if (!f || pts.length < 2) {
      view.overlay("road-preview").setData(empty());
      return;
    }
    view.overlay("road-preview").setData({
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
    view.overlay("road-snap").setData({ type: "FeatureCollection", features: pt });
  };

  const costText = (len: number, labor: number, stone = 0) =>
    `${Math.round(len)} ${L("м", "m")} · ${Math.round(labor)} ${L("чел.-ч", "person-h")}${stone > 0 ? ` · ${L("камня", "stone")} ${decimal(String(Math.round(stone * 10) / 10))} ${L("т", "t")}` : ""} · ${etaText(labor)}`;
  const spans = () => effectiveSpans(state.peek()?.progress);
  const locked = (k: RoadKind) => lockOf(k) !== null;
  // The kind a drawn piece is built as: along an old bridge that bridge, of a kind that spans the water and is open.
  const kindFor = (t: RoadKind, along: OldRef | null, p: TerrainProfile): RoadKind => {
    const k = segmentKind(t, along);
    return k === t ? k : fitBridgeKind(k, longestSpan(p), spans(), locked);
  };

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
          const c = segmentCost(p, kindFor(t, req.along, p), spans());
          const queued = queuedLabel(gameClock.peek(), state.peek()?.levers);
          verdict = c.ok ? { ok: true, text: costText(p.length, c.labor, c.stone) + (queued ? ` · ${queued}` : "") } : { ok: false, text: c.reason ?? L("Нельзя", "Not allowed") };
          drawPreview(req.pts);
          setLabel(verdict.text);
        })
        .catch(() => {
          if (mine !== seq) return;
          verdict = { ok: false, text: L("Нет данных о местности", "No terrain data") };
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

  const context = (e: ViewPointer) => {
    const f = frame.value;
    const g = roads.value;
    if (!f || !g) return null;
    const [x, y] = f.toLocal(e.lngLat[0], e.lngLat[1]);
    const tol = SNAP_PX * view.metersPerPixel();
    return { f, g, x, y, tol };
  };

  const shiftOn = (e: ViewPointer) => shiftDown || !!e.original.shiftKey;

  const aim = (e: ViewPointer, ctx: NonNullable<ReturnType<typeof context>>, anchor: Snap | null): Aim => {
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
      verdict = { ok: false, text: L("Слишком коротко", "Too short") };
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
  // A finger has no hover preview and no right button or Esc to end a chain, so on touch each road stands alone:
  // a stray tap must not lay another road from the last end.
  const commitPath = (pts: Pt[], target: Snap, old: OldRef | null) => {
    const chain = !touchInput;
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
      flash(L("Слишком коротко", "Too short"));
      return;
    }
    const local = addRoad(g, pts, t, CURVE_SNAP_M, laborByLength(pts, 1));
    if (!local.ok) {
      flash(local.reason);
      return;
    }
    const along = sameOldStreet(startOld, old);
    const mine = gen;
    busy = true;
    samplePathProfile(f, pts, state.value?.clearings)
      .then((p) => {
        const kind = kindFor(t, along, p);
        const c = segmentCost(p, kind, spans());
        if (!c.ok) {
          flash(c.reason ?? L("Нельзя", "Not allowed"));
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
          if (!res.ok) flash(res.reason ?? L("Не удалось проложить", "Could not lay the road"));
          else if (cutOffEdges(local.graph).size > cutOffEdges(g).size) {
            flash(L("Дорога не связана с лагерем — её не построят. Ведите её от лагеря или от готовой дороги", "The road is not connected to the camp and won’t be built. Lead it from the camp or from a finished road"));
          } else play("place");
          return res.ok;
        });
      })
      .catch(() => {
        flash(L("Нет данных о местности", "No terrain data"));
        return false;
      })
      .then((ok) => {
        if (mine !== gen) return; // the tool or the mode changed meanwhile: that reset the chain already
        busy = false;
        if (ok) {
          if (chain) {
            start = target;
            startOld = old;
          } else {
            start = null;
            startOld = null;
            clearOverlay();
          }
          verdict = null;
          if (lastEvent) onMove(lastEvent);
        }
      });
  };

  // ---------- upgrading built roads ----------

  // The stretch of road under the cursor that drawing tool kind `t` can rebuild: the edge nearest within `tol` and the
  // edges before and after it up to the next branch that can be rebuilt as `t` too. Null over a node (a new road
  // starts there) or a road that is already as good, of the other sort, or while `t` is closed.
  const upgradeRunAt = (g: RoadGraph, x: number, y: number, tol: number, t: RoadKind, snap: Snap): Run | null => {
    if (snap.kind === "node" || lockOf(t)) return null;
    const id = nearestEdge(x, y, tol);
    if (id === null || upgradeReason(g.edges[id], t)) return null;
    const run = runAt(g, id);
    if (!run) return { edges: [id], nodes: [g.edges[id].a, g.edges[id].b] };
    const at = run.edges.indexOf(id);
    let lo = at;
    let hi = at;
    while (lo > 0 && !upgradeReason(g.edges[run.edges[lo - 1]], t)) lo--;
    while (hi + 1 < run.edges.length && !upgradeReason(g.edges[run.edges[hi + 1]], t)) hi++;
    return { edges: run.edges.slice(lo, hi + 1), nodes: run.nodes.slice(lo, hi + 2) };
  };

  const upgradeText = (u: Upgrade): string => {
    const title = `${ROAD_KINDS[u.from].name} · ${L("улучшение", "upgrade")}: ${ROAD_KINDS[u.kind].name.toLowerCase()}`;
    if (!u.priced) return `${title} · …`;
    if (!u.ok) return `${title} · ${u.reason ?? L("Нельзя", "Not allowed")}`;
    return `${title} · ${costText(u.length, u.work, u.stone)} · ${L("клик — улучшить", "click to upgrade")}`;
  };

  const drawUpgrade = (u: Upgrade) => {
    const f = frame.value;
    if (!f) return;
    view.overlay("road-hover").setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { up: true, ok: u.priced ? u.ok : null },
          geometry: { type: "LineString", coordinates: u.pts.map(([x, y]) => f.toLngLat(x, y)) },
        },
      ],
    });
    if (cursor) setLabel(upgradeText(u));
  };

  const clearUpgrade = () => {
    if (!upgrade) return;
    upgrade = null;
    upgradeOnPrice = null;
    view.overlay("road-hover").setData(empty());
  };

  // Shows the stretch and prices it: the whole line for the verdict (slope, water, span, banks), each edge for its work.
  const pickUpgrade = (g: RoadGraph, t: RoadKind, run: Run) => {
    const key = `${t}:${run.edges.join(",")}`;
    if (upgrade?.key === key) {
      drawUpgrade(upgrade);
      return;
    }
    const f = frame.value;
    if (!f) return;
    const pts = run.nodes.map((id): Pt => [g.nodes[id].x, g.nodes[id].y]);
    const u: Upgrade = { key, kind: t, from: g.edges[run.edges[0]].kind, edges: run.edges, pts, length: lengthOf(pts), priced: false, ok: false, reason: null, labor: [], work: 0, stone: 0, span: 0 };
    upgrade = u;
    upgradeOnPrice = null;
    drawUpgrade(u);
    const clearings = state.value?.clearings;
    const edgeLine = (id: number): Pt[] => {
      const e = g.edges[id];
      return [[g.nodes[e.a].x, g.nodes[e.a].y], [g.nodes[e.b].x, g.nodes[e.b].y]];
    };
    Promise.all([samplePathProfile(f, pts, clearings), ...run.edges.map((id) => samplePathProfile(f, edgeLine(id), clearings))])
      .then(([whole, ...each]) => {
        if (upgrade !== u) return;
        const c = segmentCost(whole, t, spans());
        u.labor = each.map((p, i) => {
          const full = segmentCost(p, t).labor; // a sliver edge has no cost of its own: it goes by the metre
          return full > 0 ? full : ROAD_KINDS[t].labor * g.edges[run.edges[i]].length;
        });
        u.work = run.edges.reduce((s, id, i) => s + upgradeWork(g.edges[id], u.labor[i]), 0);
        u.stone = c.stone;
        u.span = c.span;
        u.ok = c.ok || (whole.length < MIN_SEGMENT && !isBridge(t)); // a stretch too short to check is fine on the ground
        u.reason = u.ok ? null : (c.reason ?? null);
      })
      .catch(() => {
        u.ok = false;
        u.reason = L("Нет данных о местности", "No terrain data");
      })
      .then(() => {
        if (upgrade !== u) return;
        u.priced = true;
        drawUpgrade(u);
        if (upgradeOnPrice === u) commitUpgrade();
      });
  };

  const commitUpgrade = () => {
    const u = upgrade;
    if (!u || busy) return;
    if (!u.priced) {
      upgradeOnPrice = u; // a click right after the cursor came onto the road: go on once it is priced
      return;
    }
    upgradeOnPrice = null;
    if (!u.ok) {
      flash(u.reason ?? L("Нельзя", "Not allowed"));
      return;
    }
    const mine = gen;
    busy = true;
    void sendCmd({ type: "upgradeRoad", kind: u.kind, edges: u.edges, labor: u.labor, ...(isBridge(u.kind) ? { span: u.span } : {}) }).then((res) => {
      if (mine !== gen) return;
      busy = false;
      if (!res.ok) flash(res.reason ?? L("Не удалось улучшить", "Could not upgrade"));
      else play("place");
      clearUpgrade();
      if (lastEvent) onMove(lastEvent);
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
    view.overlay("road-preview").setData({
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
    if (ok.length === 0) return `${r.title} · ${r.reason ?? L("Нельзя", "Not allowed")}`;
    const len = ok.reduce((s, l) => s + lengthOf(l.pts), 0);
    const labor = ok.reduce((s, l) => s + l.labor, 0);
    const missing = r.lines.length - ok.length;
    return `${r.title} · ${costText(len, labor)}${missing ? ` · ${L("не пройдёт участков", "sections that won’t pass")}: ${missing}` : ""} · ${L("клик — восстановить", "click to restore")}`;
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
    const r: Restore = { key, title: name ? L(`Улица «${name}»`, `${name} street`) : L("Старая дорога", "Old road"), lines: [], priced: false, reason: null };
    let hadGeometry = false;
    for (const w of ways) {
      const pts = roadLine(w.pts, MIN_SEGMENT, junctions) ?? stretchShort(w.pts, SHORT_WAY_M);
      if (!pts) continue;
      hadGeometry = true;
      // An old way comes back as the road it was: a footway as a path, anything wider as a dirt road, and a bridge
      // as the matching bridge; while that kind is locked, the lighter one of the same sort.
      let kind: RoadKind = oldStreetKind(w.cls, w.bridge === true);
      if (lockOf(kind)) kind = kind === "bridge" ? "footbridge" : kind === "dirt" ? "path" : kind;
      // Existing parallel road pieces are not an error: restore only the missing gaps of the old street.
      for (const piece of restoreMissingPieces(g, pts, kind)) {
        const local = addRoad(g, piece, kind, CURVE_SNAP_M, laborByLength(piece, 1));
        if (!local.ok && !r.reason) r.reason = local.reason;
        r.lines.push({ pts: piece, cls: w.cls, kind, labor: 0, span: 0, ok: local.ok });
      }
    }
    if (r.lines.length === 0) r.reason = hadGeometry ? L("Улица уже восстановлена", "The street is already restored") : L("Слишком коротко", "Too short");
    restore = r;
    drawRestore(r);
    void Promise.all(
      r.lines
        .filter((l) => l.ok)
        .map(async (l) => {
          try {
            const p = await samplePathProfile(f, l.pts, state.value?.clearings);
            if (isBridge(l.kind)) l.kind = fitBridgeKind(l.kind, longestSpan(p), spans(), locked); // the bridge that spans it
            const c = segmentCost(p, l.kind, spans());
            const lock = lockOf(l.kind);
            l.labor = c.labor;
            l.span = c.span;
            if (!c.ok || lock) {
              l.ok = false;
              if (!r.reason) r.reason = lock ?? c.reason ?? L("Нельзя", "Not allowed");
            }
          } catch {
            l.ok = false;
            if (!r.reason) r.reason = L("Нет данных о местности", "No terrain data");
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
      setLabel(all.length ? null : L("Старых улиц пока нет: их открывают раскопки", "No old streets yet: digs uncover them"));
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
      flash(r.reason ?? L("Нельзя", "Not allowed"));
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
      } else if (!reason) reason = res.reason ?? L("Не удалось проложить", "Could not lay the road");
    }
    busy = false;
    if (restore === r) clearOverlay();
    if (built > 0) play("place");
    if (reason) flash(built > 0 ? L(`Восстановлено участков: ${built} из ${todo.length}. ${reason}`, `Sections restored: ${built} of ${todo.length}. ${reason}`) : reason);
    else if (before && after && cutOffEdges(after).size > cutOffEdges(before).size) {
      flash(L("Улица не связана с лагерем — её не построят. Восстановите сначала улицу, что ведёт к лагерю или к готовой дороге", "The street is not connected to the camp and won’t be built. First restore a street leading to the camp or to a finished road"));
    }
    if (lastEvent) onMove(lastEvent);
  };

  const onMove = (e: ViewPointer) => {
    if (multiPointer || !e.isPrimary || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    lastEvent = e;
    cursor = { x: e.point[0], y: e.point[1] };
    const t = roadT();
    if (!t) return;
    const ctx = context(e);
    if (!ctx) return;
    if (view.metersPerPixel() > ROAD_MAX_MPP) {
      clearOverlay();
      setLabel(L("Приблизьте карту", "Zoom in on the map"));
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
        view.overlay("road-hover").setData(empty());
        setLabel(null);
        return;
      }
      const a = g.nodes[edge.a];
      const b = g.nodes[edge.b];
      view.overlay("road-hover").setData({
        type: "FeatureCollection",
        features: [line(f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y))],
      });
      const pct = Math.floor(100 * workShare(edge));
      const up = edge.done >= edge.labor && edge.upgrade ? ` · ${L("улучшение", "upgrade")}: ${ROAD_KINDS[edge.upgrade.kind].name.toLowerCase()}` : "";
      const progress = up ? `${pct}${L(" %", "%")}` : pct >= 100 ? L("построено", "built") : `${pct}${L(" %", "%")}`;
      setLabel(`${ROAD_KINDS[edge.kind].name}${up} · ${Math.round(edge.length)} ${L("м", "m")} · ${progress}${stoneOwed(edge) > (state.peek()?.stock.stone ?? Infinity) ? L(" · Нет камня", " · No stone") : ""}`);
      return;
    }
    if (spaceDown) {
      clearOverlay();
      setLabel(null);
      return;
    }
    // Arc mode, second stage: the chord is fixed and the cursor bends the arc through itself.
    if (arcEnd && start) {
      if (bending && pressScreen && Math.hypot(e.point[0] - pressScreen.x, e.point[1] - pressScreen.y) >= dragPx(e)) bendMoved = true;
      angleHint = "";
      streetHint = "";
      setSnap(null);
      showPath(arcPath([start.x, start.y], [x, y], [arcEnd.x, arcEnd.y]), sameOldStreet(startOld, arcOld));
      return;
    }
    if (pressing && pressScreen) {
      if (!dragging && Math.hypot(e.point[0] - pressScreen.x, e.point[1] - pressScreen.y) >= dragPx(e)) dragging = true;
      const anchor = pressSnap;
      if (dragging && anchor) {
        clearUpgrade(); // a drag from a road lays a new one off it
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
    streetHint = a.name && a.old ? L(` · по старой улице ${a.name}`, ` · along the old street ${a.name}`) : "";
    if (!start) {
      // Over a road of a lesser kind of its sort: it lights up, and a click rebuilds it.
      const k = drawT();
      const run = k && a.deg === null ? upgradeRunAt(g, x, y, tol, k, a.snap) : null;
      if (run && k) {
        streetHint = "";
        setSnap(null);
        pickUpgrade(g, k, run);
        return;
      }
      clearUpgrade();
      setSnap(a.snap, a.guide);
      setLabel(null);
      return;
    }
    setSnap(a.snap, a.guide);
    showPath([[start.x, start.y], [a.snap.x, a.snap.y]], sameOldStreet(startOld, a.old));
  };

  const onClick = (e: ViewPointer) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const t = roadT();
    if (!t || busy) return;
    const ctx = context(e);
    if (!ctx || view.metersPerPixel() > ROAD_MAX_MPP || spaceDown) return;
    const { g, x, y, tol } = ctx;
    if (t === "restore") {
      // The click picks the street under it (a finger has no hover); a click on the street already picked restores it.
      const picked = restore;
      cursor = { x: e.point[0], y: e.point[1] };
      lastEvent = e;
      hoverRestore(x, y, tol);
      if (restore && restore === picked) void commitRestore();
      return;
    }
    if (t === "bulldoze") {
      const id = nearestEdge(x, y, tol);
      if (id === null) return;
      const edge = g.edges[id];
      hoverEdge = null;
      view.overlay("road-hover").setData(empty());
      setLabel(null);
      if (edge && needsRoadDemolishConfirm(edge.kind, edge.done, edge.labor)) {
        roadDemolishRequest.value = id;
        return;
      }
      void sendCmd({ type: "removeRoad", edgeId: id }).then((r) => {
        if (!r.ok) flash(r.reason ?? L("Не удалось снести", "Could not demolish"));
        else play("place");
      });
      return;
    }
    // Third click of an arc: the bend point is where the cursor is.
    if (arcEnd && start) {
      layArc(start, arcEnd, x, y);
      return;
    }
    const a = aim(e, ctx, start);
    if (!start) {
      // The click picks the road under it to rebuild (a finger has no hover); a click on the stretch already picked does it.
      const k = drawT();
      const run = k && a.deg === null ? upgradeRunAt(g, x, y, tol, k, a.snap) : null;
      if (run && k) {
        const picked = upgrade;
        cursor = { x: e.point[0], y: e.point[1] };
        lastEvent = e;
        pickUpgrade(g, k, run);
        if (upgrade && upgrade === picked) commitUpgrade();
        return;
      }
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

  const layArc = (from: Snap, end: Snap, x: number, y: number) => {
    const endOld = arcOld;
    arcEnd = null;
    arcOld = null;
    commitPath(arcPath([from.x, from.y], [x, y], [end.x, end.y]), end, endOld);
  };

  const dragPx = (e: ViewPointer) => (e.pointerType === "touch" ? TOUCH_DRAG_PX : DRAG_PX);

  const resetPress = () => {
    bending = false;
    bendMoved = false;
    pressing = false;
    dragging = false;
    pressScreen = null;
    pressSnap = null;
    pressOld = null;
  };

  const onDown = (e: ViewPointer) => {
    if (e.pointerId === null) return;
    if (activePointers.size === 0) multiPointer = false;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1 || !e.isPrimary) {
      multiPointer = true;
      activePointerId = null;
      resetPress();
      clearOverlay();
      return;
    }
    activePointerId = e.pointerId;
    suppressClick = false;
    const t = roadT();
    // Arc bend stage: a press drags the bend (a finger cannot hover), its release lays the arc.
    bending = !!t && !!arcEnd && !!start && !busy && !spaceDown && e.original.button === 0;
    bendMoved = false;
    if (bending) {
      pressScreen = { x: e.point[0], y: e.point[1] };
      return;
    }
    if (!t || !roadKindOf(t) || busy || spaceDown || arcEnd) return;
    if (e.original.button !== 0) return;
    const ctx = context(e);
    if (!ctx || view.metersPerPixel() > ROAD_MAX_MPP) return;
    const a = aim(e, ctx, null);
    pressing = true;
    dragging = false;
    pressScreen = { x: e.point[0], y: e.point[1] };
    pressSnap = a.snap;
    pressOld = a.old;
  };

  const onUp = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) multiPointer = false;
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    if (bending) {
      const moved = bendMoved;
      resetPress();
      // A plain tap is left to the click, which lays the arc through the tap.
      if (!moved || !arcEnd || !start || !lastEvent || spaceDown || busy) return;
      const ctx = context(lastEvent);
      if (!ctx || view.metersPerPixel() > ROAD_MAX_MPP) return;
      suppressClick = true;
      layArc(start, arcEnd, ctx.x, ctx.y);
      return;
    }
    if (!pressing) return;
    const wasDrag = dragging;
    const anchor = pressSnap;
    const anchorOld = pressOld;
    resetPress();
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

  const onCancel = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) multiPointer = false;
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    resetPress();
    clearOverlay();
    if (!multiPointer && lastEvent) onMove(lastEvent);
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
  const onContext = (e: ViewPointer) => {
    if (!roadT()) return;
    e.original.preventDefault();
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
      syncPan(view);
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
      syncPan(view);
      if (roadT() && lastEvent) onMove(lastEvent);
    } else if (e.key === "Shift") {
      shiftDown = false;
      if (roadT() && lastEvent) onMove(lastEvent);
    }
  };

  view.on("pointermove", onMove);
  view.on("pointerdown", onDown);
  // Track every canvas pointer, including a second finger placed over the sky.
  // The View event above only dispatches when the ray hits the planet.
  const trackPointerDown = (e: PointerEvent) => {
    touchInput = e.pointerType === "touch";
    if (activePointers.size === 0) multiPointer = false;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1 || !e.isPrimary) {
      const wasMultiPointer = multiPointer;
      multiPointer = true;
      activePointerId = null;
      if (!wasMultiPointer) {
        resetPress();
        clearOverlay();
      }
    }
  };
  view.canvas.addEventListener("pointerdown", trackPointerDown);
  view.on("click", onClick);
  view.on("contextmenu", onContext);
  view.on("move", () => syncPan(view));
  view.canvas.addEventListener("pointerleave", (e) => {
    // A lifted finger leaves the canvas too: keep the street a tap picked, so the next tap can restore it.
    if (e.pointerType === "touch" && restore) return;
    cursor = null;
    if (!start && !dragging) clearOverlay();
    else setLabel(null);
  });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => {
    shiftDown = false;
    spaceDown = false;
    activePointers.clear();
    activePointerId = null;
    multiPointer = false;
    resetPress();
    setSpacePan(false);
    syncPan(view);
  });

  // Tool switched on or off from the toolbar.
  effect(() => {
    const t = tool.value;
    gen++;
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
    clearOverlay();
    view.canvas.style.cursor = t ? "crosshair" : "";
    view.setDoubleClickZoomEnabled(!t); // also box zoom: Shift-drag locks the road angle instead
    syncPan(view);
  });

  // A different drawing mode starts a fresh chain.
  effect(() => {
    void roadMode.value;
    gen++;
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
  });
}
