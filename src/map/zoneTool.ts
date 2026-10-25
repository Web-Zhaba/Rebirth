import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import type { ZoneCell, ZoneType } from "../sim/types";
import { clearingLabor, clearingLogs, validateClearing } from "../sim/clearing";
import { pointInPolygon, validateField } from "../sim/zones";
import { frame, roads, sendCmd, state, zones } from "../simClient";
import type { Frame } from "../world/frame";
import { landAt } from "../world/landcover";
import { fieldDraft, hoverKeys, paintPreview } from "./zoneLayer";
import { etaText } from "./buildCost";
import { flash, isBrushTool, mapMpp, MIN_ZONE_ZOOM, tool, type BrushTool } from "./tools";

const BRUSH_PX = 16;
const MIN_BRUSH_M = 6;
const CLOSE_PX = 12;
const FIELD_MIN_ZOOM = 14;
const GRID_STEP = 10; // m, land sampling inside a field
const ANALYZE_MS = 200;
const BUCKET = 16;

type Pt = [number, number];
const bucketKey = (bx: number, by: number) => bx * 65536 + by;
const brushZone = (t: BrushTool): "none" | ZoneType => (t === "clear" ? "none" : t);

const areaText = (m2: number) => `${(m2 / 10000).toFixed(m2 < 10000 ? 2 : 1).replace(".", ",")} га`;
const clearingText = (area: number, forest: number) =>
  `${areaText(area)} · лес ${Math.round(forest * 100)} % · брёвна ~${Math.round(clearingLogs(area, forest))} м³ · ${Math.round(clearingLabor(area, forest))} чел.-ч · ${etaText(clearingLabor(area, forest))}`;

interface Analysis {
  water: boolean;
  forest: number; // share 0..1
}

// Land type on a 10 m grid inside the polygon (plus its corners).
async function analyzeField(f: Frame, poly: Pt[]): Promise<Analysis> {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const samples: Pt[] = [];
  for (let x = Math.min(...xs) + GRID_STEP / 2; x < Math.max(...xs); x += GRID_STEP) {
    for (let y = Math.min(...ys) + GRID_STEP / 2; y < Math.max(...ys); y += GRID_STEP) {
      if (pointInPolygon(x, y, poly)) samples.push([x, y]);
    }
  }
  if (samples.length === 0) samples.push([xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length]);
  const inside = samples.length;
  const all = [...samples, ...poly];
  const lands = await Promise.all(
    all.map(([x, y]) => {
      const [lng, lat] = f.toLngLat(x, y);
      return landAt(lng, lat);
    }),
  );
  return {
    water: lands.some((l) => l === "water"),
    forest: lands.slice(0, inside).filter((l) => l === "forest").length / inside,
  };
}

// Zone brush and field drawing on top of the map.
export function attachZoneTool(map: maplibregl.Map): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  map.getContainer().appendChild(label);

  let cursor: { x: number; y: number } | null = null; // px
  let local: Pt | null = null; // m
  let spaceDown = false;
  let panOff = false;

  // ----- cell lookup -----
  let indexFor: unknown = null;
  let index = new Map<number, ZoneCell[]>();
  const freeCells = () => {
    const z = zones.value;
    if (indexFor !== z) {
      indexFor = z;
      index = new Map();
      for (const c of z?.cells ?? []) {
        if (c.block) continue;
        const k = bucketKey(Math.floor(c.cx / BUCKET), Math.floor(c.cy / BUCKET));
        const list = index.get(k);
        if (list) list.push(c);
        else index.set(k, [c]);
      }
    }
    return index;
  };
  const cellsNear = (x: number, y: number, r: number): ZoneCell[] => {
    const idx = freeCells();
    const out: ZoneCell[] = [];
    for (let bx = Math.floor((x - r) / BUCKET); bx <= Math.floor((x + r) / BUCKET); bx++) {
      for (let by = Math.floor((y - r) / BUCKET); by <= Math.floor((y + r) / BUCKET); by++) {
        for (const c of idx.get(bucketKey(bx, by)) ?? []) if (Math.hypot(c.cx - x, c.cy - y) <= r) out.push(c);
      }
    }
    return out;
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

  const activeBrush = (): BrushTool | null => {
    const t = tool.value;
    return t && isBrushTool(t) ? t : null;
  };
  const clearingActive = () => tool.value === "clearing";
  const fieldActive = () => tool.value === "field" || clearingActive(); // both are drawn as a polygon

  // Dragging paints, so the map must not pan under a brush (hold Space to pan).
  const applyPan = () => {
    const want = activeBrush() !== null && map.getZoom() >= MIN_ZONE_ZOOM && !spaceDown;
    if (want === panOff) return;
    panOff = want;
    if (want) map.dragPan.disable();
    else map.dragPan.enable();
  };

  const radiusM = (lat: number) => Math.max(MIN_BRUSH_M, BRUSH_PX * mapMpp(lat, map.getZoom()));

  // ----- brush -----
  let dragging = false;
  let painted = new Map<string, "none" | ZoneType>();
  let dragBase = new Map<string, "none" | ZoneType>(); // earlier in-flight paints, kept visible during a drag
  let inflight = 0;
  let strokeEnd: [number, number] | null = null; // last brush point of the current drag

  const send = (keys: string[], zone: "none" | ZoneType) => {
    if (keys.length === 0) {
      if (!dragging && inflight === 0) paintPreview.value = null;
      return;
    }
    inflight++;
    void sendCmd({ type: "paintZones", keys, zone }).then((r) => {
      inflight--;
      if (inflight === 0 && !dragging) paintPreview.value = null; // the snapshot already arrived
      if (!r.ok) flash(r.reason ?? "Не удалось разметить");
    });
  };

  const fieldAt = (x: number, y: number) => zones.value?.fields.find((fl) => pointInPolygon(x, y, fl.pts)) ?? null;
  const clearingAt = (x: number, y: number) => state.value?.clearings.find((c) => c.done < c.labor && pointInPolygon(x, y, c.pts)) ?? null;

  const brushAt = (e: maplibregl.MapMouseEvent, t: BrushTool) => {
    const f = frame.value;
    if (!f) return null;
    const [x, y] = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    local = [x, y];
    return { x, y, r: radiusM(e.lngLat.lat), zone: brushZone(t) };
  };

  const onBrushMove = (e: maplibregl.MapMouseEvent, t: BrushTool) => {
    if (map.getZoom() < MIN_ZONE_ZOOM) {
      hoverKeys.value = [];
      setLabel("Приблизьте карту");
      return;
    }
    if (spaceDown) {
      hoverKeys.value = [];
      setLabel(null);
      return;
    }
    const b = brushAt(e, t);
    if (!b) return;
    const near = cellsNear(b.x, b.y, b.r);
    hoverKeys.value = near.map((c) => c.key);
    setLabel(t === "clear" ? (fieldAt(b.x, b.y) ? "Убрать поле" : clearingAt(b.x, b.y) ? "Убрать вырубку" : null) : null);
    if (dragging) {
      // Mouse events are sparse on fast drags: sweep the brush along the stroke so no cells are skipped.
      const [px, py] = strokeEnd ?? [b.x, b.y];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - px, b.y - py) / (b.r / 2)));
      strokeEnd = [b.x, b.y];
      let grew = false;
      for (let s = 1; s <= steps; s++) {
        const k = s / steps;
        for (const c of cellsNear(px + (b.x - px) * k, py + (b.y - py) * k, b.r)) {
          if (painted.get(c.key) !== b.zone) {
            painted.set(c.key, b.zone);
            grew = true;
          }
        }
      }
      if (grew) paintPreview.value = new Map([...dragBase, ...painted]);
    }
  };

  const onDown = (e: maplibregl.MapMouseEvent) => {
    const t = activeBrush();
    if (!t || e.originalEvent.button !== 0 || spaceDown || map.getZoom() < MIN_ZONE_ZOOM) return;
    const b = brushAt(e, t);
    if (!b) return;
    if (t === "clear") {
      const field = fieldAt(b.x, b.y);
      if (field) {
        void sendCmd({ type: "removeField", id: field.id }).then((r) => {
          if (!r.ok) flash(r.reason ?? "Не удалось убрать поле");
        });
        return;
      }
      const clearing = clearingAt(b.x, b.y);
      if (clearing) {
        void sendCmd({ type: "removeClearing", id: clearing.id }).then((r) => {
          if (!r.ok) flash(r.reason ?? "Не удалось убрать вырубку");
        });
        return;
      }
    }
    if (e.originalEvent.shiftKey) {
      // The whole side of the nearest edge, all depths.
      let best: ZoneCell | null = null;
      let bestD = Math.max(b.r, 8);
      for (const c of cellsNear(b.x, b.y, bestD)) {
        const d = Math.hypot(c.cx - b.x, c.cy - b.y);
        if (d <= bestD) {
          bestD = d;
          best = c;
        }
      }
      if (!best) return;
      const keys = [...freeCells().values()].flat().filter((c) => c.edge === best!.edge && c.side === best!.side).map((c) => c.key);
      const next = new Map(paintPreview.value ?? []);
      for (const k of keys) next.set(k, b.zone);
      paintPreview.value = next;
      send(keys, b.zone);
      return;
    }
    dragging = true;
    strokeEnd = [b.x, b.y];
    dragBase = paintPreview.value ?? new Map();
    painted = new Map();
    for (const c of cellsNear(b.x, b.y, b.r)) painted.set(c.key, b.zone);
    paintPreview.value = new Map([...dragBase, ...painted]);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    strokeEnd = null;
    const zone = [...painted.values()][0];
    const keys = [...painted.keys()];
    painted = new Map();
    if (zone === undefined) {
      if (inflight === 0) paintPreview.value = null;
      return;
    }
    send(keys, zone);
  };

  // ----- field -----
  let pts: Pt[] = [];
  let busy = false;
  let seq = 0;
  let timer = 0;
  let analysis: { sig: string; a: Analysis } | null = null;

  // The same checks the sim makes; the forest share is only known after the land is sampled.
  const check = (poly: Pt[], g: NonNullable<typeof roads.value>, z: NonNullable<typeof zones.value>) =>
    clearingActive() ? validateClearing(poly, 0, g, z.fields, state.value?.clearings ?? []) : validateField(poly, g, z.fields);

  const sig = (poly: Pt[]) => poly.map((p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`).join(";");

  const showDraft = () => {
    const f = frame.value;
    const g = roads.value;
    const z = zones.value;
    if (!f || !g || !z || !local || pts.length === 0) {
      fieldDraft.value = pts.length > 0 ? { pts: [...pts], ok: true } : null;
      setLabel(null);
      return;
    }
    const poly: Pt[] = [...pts, local];
    if (poly.length < 3) {
      fieldDraft.value = { pts: poly, ok: true };
      setLabel("Клик — следующая точка");
      return;
    }
    const v = check(poly, g, z);
    fieldDraft.value = { pts: poly, ok: v.ok };
    if (!v.ok) {
      seq++;
      clearTimeout(timer);
      timer = 0;
      setLabel(v.reason);
      return;
    }
    const s = sig(poly);
    const text = (a: Analysis | null) => {
      if (clearingActive()) return a ? clearingText(v.area, a.forest) : areaText(v.area);
      if (a?.water) return "Поле заходит в воду";
      return a ? `${areaText(v.area)} · лес ${Math.round(a.forest * 100)} %` : areaText(v.area);
    };
    if (analysis && analysis.sig === s) {
      setLabel(text(analysis.a));
      return;
    }
    setLabel(text(null));
    clearTimeout(timer);
    const mine = ++seq;
    timer = window.setTimeout(() => {
      analyzeField(f, poly)
        .then((a) => {
          if (mine !== seq) return;
          analysis = { sig: s, a };
          setLabel(text(a));
          if (a.water && !clearingActive()) fieldDraft.value = { pts: poly, ok: false };
        })
        .catch(() => {
          if (mine === seq) setLabel(`${areaText(v.area)} · нет данных о местности`);
        });
    }, ANALYZE_MS);
  };

  const resetField = () => {
    pts = [];
    seq++;
    clearTimeout(timer);
    timer = 0;
    analysis = null;
    fieldDraft.value = null;
    setLabel(null);
  };

  const finishField = () => {
    const f = frame.value;
    const g = roads.value;
    const z = zones.value;
    if (busy || !f || !g || !z) return;
    if (pts.length < 3) {
      flash("Нужно минимум 3 точки");
      return;
    }
    const v = check(pts, g, z);
    if (!v.ok) {
      flash(v.reason);
      return;
    }
    busy = true;
    const poly = [...pts];
    const clearing = clearingActive();
    analyzeField(f, poly)
      .then((a) => {
        if (a.water && !clearing) {
          flash("Поле заходит в воду");
          return false;
        }
        const cmd = clearing ? ({ type: "addClearing", pts: poly, forest: a.forest } as const) : ({ type: "addField", pts: poly } as const);
        return sendCmd(cmd).then((r) => {
          if (!r.ok) flash(r.reason ?? (clearing ? "Не удалось создать вырубку" : "Не удалось создать поле"));
          return r.ok;
        });
      })
      .catch(() => {
        flash("Нет данных о местности");
        return false;
      })
      .then((ok) => {
        busy = false;
        if (ok) resetField();
      });
  };

  const onFieldClick = (e: maplibregl.MapMouseEvent) => {
    const f = frame.value;
    if (!f || busy || map.getZoom() < FIELD_MIN_ZOOM) return;
    const [x, y] = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    if (pts.length >= 3) {
      const first = map.project(f.toLngLat(pts[0][0], pts[0][1]));
      if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX) {
        finishField();
        return;
      }
    }
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 0.5) return;
    pts.push([x, y]);
    local = [x, y];
    showDraft();
  };

  // ----- events -----
  const onMove = (e: maplibregl.MapMouseEvent) => {
    cursor = { x: e.point.x, y: e.point.y };
    const t = tool.value;
    if (!t) return;
    if (fieldActive()) {
      const f = frame.value;
      if (!f) return;
      if (map.getZoom() < FIELD_MIN_ZOOM) {
        setLabel("Приблизьте карту");
        return;
      }
      local = f.toLocal(e.lngLat.lng, e.lngLat.lat);
      showDraft();
      return;
    }
    const b = activeBrush();
    if (b) onBrushMove(e, b);
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    if (fieldActive()) onFieldClick(e);
  };

  const onContext = (e: maplibregl.MapMouseEvent) => {
    const t = tool.value;
    if (!t || !(fieldActive() || isBrushTool(t))) return;
    e.preventDefault();
    e.originalEvent.preventDefault();
    if (fieldActive() && pts.length > 0) {
      pts.pop();
      showDraft();
    }
  };

  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (typing(e)) return;
    if (e.key === " " && activeBrush()) {
      spaceDown = true;
      hoverKeys.value = [];
      applyPan();
      return;
    }
    if (!fieldActive() && !activeBrush()) return;
    if (e.key === "Escape") {
      if (fieldActive() && pts.length > 0) resetField();
      else tool.value = null;
    } else if (e.key === "Enter" && fieldActive()) {
      finishField();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    spaceDown = false;
    applyPan();
  };

  map.on("mousemove", onMove);
  map.on("click", onClick);
  map.on("mousedown", onDown);
  map.on("contextmenu", onContext);
  map.on("zoom", applyPan);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  map.getCanvas().addEventListener("mouseleave", () => {
    cursor = null;
    hoverKeys.value = [];
    setLabel(null);
  });

  // Tool switched or cleared: drop everything in progress.
  effect(() => {
    void tool.value;
    if (dragging) {
      dragging = false;
      painted = new Map();
    }
    hoverKeys.value = [];
    resetField();
    busy = false;
    if (inflight === 0) paintPreview.value = null;
    applyPan();
  });
}
