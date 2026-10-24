import type maplibregl from "maplibre-gl";
import { effect, signal } from "@preact/signals";
import { addRoad, distToEdge, ROAD_KINDS, segmentCost, snapPoint, type Snap } from "../sim/roads";
import type { RoadKind } from "../sim/types";
import { frame, roads, sendCmd } from "../simClient";
import { sampleProfile } from "../world/profile";

export type Tool = RoadKind | "bulldoze";

export const tool = signal<Tool | null>(null);
// Brief message about a rejected action, shown by the toolbar.
export const roadMsg = signal<string | null>(null);

export const MIN_DRAW_ZOOM = 14;
const SNAP_PX = 12;
const PREVIEW_MS = 120;
const EQUATOR_M = 40075016.686;

const mapMpp = (lat: number, zoom: number) => (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const line = (a: [number, number], b: [number, number], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: [a, b] },
});

let msgTimer = 0;
function flash(text: string): void {
  roadMsg.value = text;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (roadMsg.value = null), 3500);
}

// Interactive road drawing and bulldozing on top of the map.
export function attachRoadTool(map: maplibregl.Map): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  map.getContainer().appendChild(label);

  let ready = false;
  let start: Snap | null = null; // last placed point of the current chain
  let busy = false; // a click is being validated/sent
  let cursor: { x: number; y: number } | null = null; // last mouse position, px
  let hoverEdge: number | null = null;
  let seq = 0; // bumped to drop stale async preview results
  let timer = 0;
  let pendingCost: { a: Snap; b: Snap } | null = null;
  let verdict: { ok: boolean; text: string } | null = null;
  let lastEvent: maplibregl.MapMouseEvent | null = null;

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
      paint: { "line-color": "#d0342c", "line-width": 6, "line-opacity": 0.75 },
    });
    map.addLayer({
      id: "road-preview",
      type: "line",
      source: "road-preview",
      paint: {
        "line-color": ["case", ["get", "ok"], "#2f9e44", "#d0342c"],
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
        "circle-color": "rgba(255,255,255,0.35)",
        "circle-stroke-color": "#2f6fdf",
        "circle-stroke-width": 2,
      },
    });
  };
  const ensure = () => {
    if (map.isStyleLoaded()) setup();
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
    seq++;
    clearTimeout(timer);
    timer = 0;
    pendingCost = null;
    verdict = null;
    hoverEdge = null;
    if (!ready) return;
    source("road-preview")?.setData(empty());
    source("road-hover")?.setData(empty());
    source("road-snap")?.setData(empty());
    setLabel(null);
  };

  const drawPreview = (a: Snap, b: Snap) => {
    const f = frame.value;
    if (!f) return;
    source("road-preview")?.setData({
      type: "FeatureCollection",
      features: [line(f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y), { ok: verdict?.ok ?? true })],
    });
  };

  const setSnap = (s: Snap | null) => {
    const f = frame.value;
    const pt: GeoJSON.Feature[] =
      s && f && s.kind !== "free"
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(s.x, s.y) } }]
        : [];
    source("road-snap")?.setData({ type: "FeatureCollection", features: pt });
  };

  const costText = (len: number, labor: number) => `${Math.round(len)} м · ${Math.round(labor)} чел.-ч`;

  // Terrain sampling is throttled; results of superseded requests are dropped.
  const requestCost = (a: Snap, b: Snap) => {
    pendingCost = { a, b };
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      const req = pendingCost;
      const f = frame.value;
      const t = tool.value;
      if (!req || !f || !t || t === "bulldoze") return;
      const mine = ++seq;
      sampleProfile(f, [req.a.x, req.a.y], [req.b.x, req.b.y])
        .then((p) => {
          if (mine !== seq) return;
          const c = segmentCost(p, t);
          verdict = c.ok ? { ok: true, text: costText(p.length, c.labor) } : { ok: false, text: c.reason ?? "Нельзя" };
          drawPreview(req.a, req.b);
          setLabel(verdict.text);
        })
        .catch(() => {
          if (mine !== seq) return;
          verdict = { ok: false, text: "Нет данных о местности" };
          drawPreview(req.a, req.b);
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

  const onMove = (e: maplibregl.MapMouseEvent) => {
    lastEvent = e;
    cursor = { x: e.point.x, y: e.point.y };
    const t = tool.value;
    if (!t || !ensure()) return;
    const ctx = context(e);
    if (!ctx) return;
    if (map.getZoom() < MIN_DRAW_ZOOM) {
      clearOverlay();
      setLabel("Приблизьте карту");
      return;
    }
    const { f, g, x, y, tol } = ctx;
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
      setLabel(`${ROAD_KINDS[edge.kind].name} · ${Math.round(edge.length)} м · ${pct >= 100 ? "построено" : `${pct} %`}`);
      return;
    }
    const snap = snapPoint(g, { x, y }, tol);
    setSnap(snap);
    if (!start) {
      setLabel(null);
      return;
    }
    drawPreview(start, snap);
    const local = addRoad(g, [[start.x, start.y], [snap.x, snap.y]], t, tol, [0]);
    if (!local.ok) {
      seq++; // drop any in-flight sampling for an older endpoint
      pendingCost = null;
      verdict = { ok: false, text: local.reason };
      drawPreview(start, snap);
      setLabel(local.reason);
      return;
    }
    setLabel(verdict ? verdict.text : "…");
    requestCost(start, snap);
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    const t = tool.value;
    if (!t || busy || !ensure()) return;
    const ctx = context(e);
    if (!ctx || map.getZoom() < MIN_DRAW_ZOOM) return;
    const { f, g, x, y, tol } = ctx;
    if (t === "bulldoze") {
      const id = nearestEdge(x, y, tol);
      if (id === null) return;
      hoverEdge = null;
      source("road-hover")?.setData(empty());
      setLabel(null);
      void sendCmd({ type: "removeRoad", edgeId: id }).then((r) => {
        if (!r.ok) flash(r.reason ?? "Не удалось снести");
      });
      return;
    }
    const snap = snapPoint(g, { x, y }, tol);
    if (!start) {
      start = snap;
      return;
    }
    const a = start;
    busy = true;
    const finish = (ok: boolean) => {
      busy = false;
      if (ok) {
        start = snap;
        verdict = null;
        if (lastEvent) onMove(lastEvent);
      }
    };
    const local = addRoad(g, [[a.x, a.y], [snap.x, snap.y]], t, tol, [0]);
    if (!local.ok) {
      flash(local.reason);
      finish(false);
      return;
    }
    sampleProfile(f, [a.x, a.y], [snap.x, snap.y])
      .then((p) => {
        const c = segmentCost(p, t);
        if (!c.ok) {
          flash(c.reason ?? "Нельзя");
          return false;
        }
        return sendCmd({
          type: "addRoad",
          kind: t,
          pts: [[a.x, a.y], [snap.x, snap.y]],
          snapTol: tol,
          labor: [c.labor],
        }).then((r) => {
          if (!r.ok) flash(r.reason ?? "Не удалось проложить");
          return r.ok;
        });
      })
      .catch(() => {
        flash("Нет данных о местности");
        return false;
      })
      .then(finish);
  };

  const endChain = () => {
    start = null;
    clearOverlay();
  };

  const onContext = (e: maplibregl.MapMouseEvent) => {
    if (!tool.value) return;
    e.preventDefault();
    e.originalEvent.preventDefault();
    if (start) endChain();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !tool.value) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
    if (start) endChain();
    else tool.value = null;
  };

  map.on("mousemove", onMove);
  map.on("click", onClick);
  map.on("contextmenu", onContext);
  map.getCanvas().addEventListener("mouseleave", () => {
    cursor = null;
    if (!start) clearOverlay();
    else setLabel(null);
  });
  window.addEventListener("keydown", onKey);

  // Tool switched on or off from the toolbar.
  effect(() => {
    const t = tool.value;
    start = null;
    busy = false;
    if (ready) clearOverlay();
    map.getCanvas().style.cursor = t ? "crosshair" : "";
    if (t) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  });
}
