import { play } from "../ui/sound";
import { mppAtZoom, type View, type ViewPointer } from "../view/view";
import { effect } from "@preact/signals";
import { clearingLabor, clearingLogs, validateClearing } from "../sim/clearing";
import type { Cmd } from "../sim/protocol";
import type { Building } from "../sim/types";
import { pointInPolygon, validateField } from "../sim/zones";
import { frame, roads, sendCmd, state, zones } from "../simClient";
import type { Frame } from "../world/frame";
import { landAt } from "../world/landcover";
import { fieldDraft } from "../view/layers/land";
import { etaText } from "./buildCost";
import { flash, setSpacePan, syncPan, tool } from "./tools";
import { decimal, L } from "../i18n";

const CLOSE_PX = 12;
const TOUCH_CLOSE_PX = 28; // a fingertip covers far more than a cursor
const FIELD_MAX_MPP = mppAtZoom(14); // old FIELD_MIN_ZOOM 14
const GRID_STEP = 10; // m, land sampling inside a field
const ANALYZE_MS = 200;

type Pt = [number, number];

const areaText = (m2: number) => `${decimal((m2 / 10000).toFixed(m2 < 10000 ? 2 : 1))} ${L("га", "ha")}`;
const clearingText = (area: number, forest: number) =>
  L(`${areaText(area)} · лес ${Math.round(forest * 100)} % · брёвна ~${Math.round(clearingLogs(area, forest))} м³ · ${Math.round(clearingLabor(area, forest))} чел.-ч · ${etaText(clearingLabor(area, forest))}`, `${areaText(area)} · forest ${Math.round(forest * 100)}% · logs ~${Math.round(clearingLogs(area, forest))} m³ · ${Math.round(clearingLabor(area, forest))} person-h · ${etaText(clearingLabor(area, forest))}`);

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

// Field and clearing drawing on top of the map; a click on a field (or an unfinished clearing) with its tool removes it.
export function attachLandTool(view: View): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  view.container.appendChild(label);

  let cursor: { x: number; y: number } | null = null; // px
  let local: Pt | null = null; // m
  let spaceDown = false;
  let activePointerId: number | null = null;
  const activePointers = new Set<number>();
  let multiPointer = false;

  const setLabel = (text: string | null) => {
    if (text === null || !cursor) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.textContent = text;
    label.style.transform = `translate(${cursor.x + 16}px, ${cursor.y + 16}px)`;
  };

  const clearingActive = () => tool.value === "clearing";
  const fieldActive = () => tool.value === "field" || clearingActive(); // both are drawn as a polygon

  const fieldAt = (x: number, y: number) => zones.value?.fields.find((fl) => pointInPolygon(x, y, fl.pts)) ?? null;
  const clearingAt = (x: number, y: number) => state.value?.clearings.find((c) => c.done < c.labor && pointInPolygon(x, y, c.pts)) ?? null;
  // Before the first corner, a point over a field (with the field tool) or over an unfinished clearing (with the clearing
  // tool) removes it instead of starting an outline: neither can be drawn over the other anyway.
  const removalAt = (x: number, y: number): { label: string; cmd: Cmd; fail: string } | null => {
    if (pts.length > 0) return null;
    if (clearingActive()) {
      const c = clearingAt(x, y);
      return c ? { label: L("Клик — убрать вырубку", "Click — remove the clearing"), cmd: { type: "removeClearing", id: c.id }, fail: L("Не удалось убрать вырубку", "Could not remove the clearing") } : null;
    }
    const fl = fieldAt(x, y);
    return fl ? { label: L("Клик — убрать поле", "Click — remove the field"), cmd: { type: "removeField", id: fl.id }, fail: L("Не удалось убрать поле", "Could not remove the field") } : null;
  };

  // ----- field -----
  let pts: Pt[] = [];
  let busy = false;
  let seq = 0;
  let timer = 0;
  let analysis: { sig: string; a: Analysis } | null = null;

  // The same checks the sim makes; the forest share is only known after the land is sampled.
  const check = (poly: Pt[], g: NonNullable<typeof roads.value>, z: NonNullable<typeof zones.value>, buildings: Record<number, Building> = {}) =>
    clearingActive() ? validateClearing(poly, 0, g, z.fields, state.value?.clearings ?? []) : validateField(poly, g, z.fields, Object.values(buildings).map((b) => b.footprint));

  const sig = (poly: Pt[]) => poly.map((p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`).join(";");

  const showDraft = () => {
    const f = frame.value;
    const g = roads.value;
    const z = zones.value;
    if (!f || !g || !z || !local || pts.length === 0) {
      fieldDraft.value = pts.length > 0 ? { pts: [...pts], ok: true } : null;
      setLabel(local ? (removalAt(local[0], local[1])?.label ?? null) : null);
      return;
    }
    const poly: Pt[] = [...pts, local];
    if (poly.length < 3) {
      fieldDraft.value = { pts: poly, ok: true };
      setLabel(L("Клик — следующая точка", "Click — next point"));
      return;
    }
    const v = check(poly, g, z, state.value?.buildings);
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
      if (a?.water) return L("Поле заходит в воду", "The field runs into water");
      return a ? `${areaText(v.area)} · ${L("лес", "forest")} ${Math.round(a.forest * 100)}${L(" %", "%")}` : areaText(v.area);
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
          if (mine === seq) setLabel(`${areaText(v.area)} · ${L("нет данных о местности", "no terrain data")}`);
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
      flash(L("Нужно минимум 3 точки", "At least 3 points are needed"));
      return;
    }
    const v = check(pts, g, z, state.value?.buildings);
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
          flash(L("Поле заходит в воду", "The field runs into water"));
          return false;
        }
        const cmd = clearing ? ({ type: "addClearing", pts: poly, forest: a.forest } as const) : ({ type: "addField", pts: poly } as const);
        return sendCmd(cmd).then((r) => {
          if (!r.ok) flash(r.reason ?? (clearing ? L("Не удалось создать вырубку", "Could not create the clearing") : L("Не удалось создать поле", "Could not create the field")));
          else play("place");
          return r.ok;
        });
      })
      .catch(() => {
        flash(L("Нет данных о местности", "No terrain data"));
        return false;
      })
      .then((ok) => {
        busy = false;
        if (ok) resetField();
      });
  };

  const onFieldClick = (e: ViewPointer) => {
    const f = frame.value;
    if (!f || busy || view.metersPerPixel() > FIELD_MAX_MPP) return;
    const [x, y] = f.toLocal(e.lngLat[0], e.lngLat[1]);
    const touch = e.pointerType === "touch";
    const near = (p: Pt) => {
      const s = view.project(f.toLngLat(p[0], p[1]));
      return Math.hypot(s[0] - e.point[0], s[1] - e.point[1]) <= (touch ? TOUCH_CLOSE_PX : CLOSE_PX);
    };
    const gone = removalAt(x, y);
    if (gone) {
      void sendCmd(gone.cmd).then((r) => {
        if (!r.ok) flash(r.reason ?? gone.fail);
        else play("place");
        showDraft(); // the label over what was removed
      });
      return;
    }
    if (pts.length >= 3 && near(pts[0])) {
      finishField();
      return;
    }
    // A finger has no right button: a tap on the last corner takes it back.
    if (touch && pts.length > 0 && near(pts[pts.length - 1])) {
      pts.pop();
      local = [x, y];
      showDraft();
      return;
    }
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < 0.5) return;
    pts.push([x, y]);
    local = [x, y];
    showDraft();
  };

  // ----- events -----
  const onMove = (e: ViewPointer) => {
    if (multiPointer || !e.isPrimary || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    cursor = { x: e.point[0], y: e.point[1] };
    if (!fieldActive()) return;
    if (spaceDown) {
      setLabel(null);
      return;
    }
    const f = frame.value;
    if (!f) return;
    if (view.metersPerPixel() > FIELD_MAX_MPP) {
      setLabel(L("Приблизьте карту", "Zoom in on the map"));
      return;
    }
    local = f.toLocal(e.lngLat[0], e.lngLat[1]);
    showDraft();
  };

  const onClick = (e: ViewPointer) => {
    if (fieldActive() && !spaceDown && !multiPointer) onFieldClick(e);
  };

  const onContext = (e: ViewPointer) => {
    if (!fieldActive()) return;
    e.original.preventDefault();
    if (pts.length > 0) {
      pts.pop();
      showDraft();
    }
  };

  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (typing(e) || !fieldActive()) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        setSpacePan(true);
        syncPan(view);
      }
      return;
    }
    if (e.key === "Escape") {
      if (pts.length > 0) resetField();
      else tool.value = null;
    } else if (e.key === "Enter") {
      finishField();
    }
  };
  const releaseSpacePan = () => {
    if (!spaceDown) return;
    spaceDown = false;
    setSpacePan(false);
    syncPan(view);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") releaseSpacePan();
  };

  // Every canvas pointer, including a second finger placed over the sky (the View events only fire when the ray hits
  // the planet): two fingers pinch the map, they draw nothing.
  const onPointerDown = (e: PointerEvent) => {
    if (activePointers.size === 0) multiPointer = false;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1 || !e.isPrimary) {
      multiPointer = true;
      activePointerId = null;
      setLabel(null);
    } else activePointerId = e.pointerId;
  };
  const onPointerEnd = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (activePointerId === e.pointerId) activePointerId = null;
    if (activePointers.size === 0) multiPointer = false;
  };

  view.on("pointermove", onMove);
  view.on("click", onClick);
  view.canvas.addEventListener("pointerdown", onPointerDown);
  view.on("contextmenu", onContext);
  view.on("move", () => syncPan(view));
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => {
    activePointers.clear();
    activePointerId = null;
    multiPointer = false;
    releaseSpacePan();
  });
  view.canvas.addEventListener("pointerleave", () => {
    cursor = null;
    setLabel(null);
  });

  // Tool switched or cleared: drop everything in progress.
  effect(() => {
    void tool.value;
    resetField();
    busy = false;
    if (!fieldActive()) releaseSpacePan();
    syncPan(view);
  });
}
