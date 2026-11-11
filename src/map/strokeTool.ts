import { play } from "../ui/sound";
import type { View, ViewPointer } from "../view/view";
import { effect, untracked } from "@preact/signals";
import { BUILDINGS, homesOf, materialsOf, scaledJobs } from "../sim/buildings";
import { excavationSite } from "../sim/digging";
import { foundationKindText, lotRing } from "../sim/foundationLots";
import { pointInRing } from "../sim/excavation";
import { planStroke, strokeTemplate, type StrokeItem, type StrokePlan, type StrokeSpan } from "../sim/stroke";
import type { ClientState, FoundFoundation } from "../sim/types";
import { frame, sendCmd, state } from "../simClient";
import { costText } from "./buildCost";
import { placementCursor } from "./contextModel";
import { itemLook, spansAlong, strokePad, strokeSummary } from "./strokeModel";
import { flash, isStrokeTool, onlyFoundations, placeTemplate, setOnlyFoundations, setSpacePan, syncPan, tool, ZONE_MAX_MPP, type StrokeTool } from "./tools";
import { decimal, L, plural } from "../i18n";

// The stroke tool (docs/PLAN-build.md sections 3.3-3.4): houses, workshops and shops laid in rows along roads. Hover
// shows the one building a click puts down; a drag shows the whole row live; on release a row of more than one is held
// as a plan with a summary card until the player confirms it, dropping single buildings by clicking them. The plan is
// the sim's own (sim/stroke.ts) computed on the main thread's copy of the town; the worker plans again on confirm.

type Pt = [number, number];
const MIN_STEP = 2; // m the pointer moves before the path takes a new point
const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const n1 = (v: number) => decimal(String(Math.round(v * 10) / 10));

interface Held {
  template: string;
  spans: StrokeSpan[];
  plan: StrokePlan;
  dropped: Set<string>;
}

export function attachStrokeTool(view: View): void {
  const label = document.createElement("div");
  label.className = "road-label";
  label.hidden = true;
  view.container.appendChild(label);

  const card = document.createElement("div");
  card.className = "stroke-card";
  card.hidden = true;
  view.container.appendChild(card);

  let cursor: { x: number; y: number } | null = null; // px
  let local: Pt | null = null; // m
  let path: Pt[] | null = null; // the drag in progress
  let pointer: number | null = null;
  let live: { template: string; spans: StrokeSpan[]; plan: StrokePlan } | null = null; // hover or drag
  let held: Held | null = null; // a released row waiting for the player
  let hover: string | null = null; // key of the item or skipped foundation under the cursor
  let shift = false;
  let spaceDown = false;
  let busy = false;
  let frameReq = 0;
  let lastIds: number[] = []; // the buildings of the last confirmed stroke, for Ctrl+Z

  const active = (): StrokeTool | null => {
    const t = tool.value;
    return isStrokeTool(t) ? t : null;
  };
  const town = (): ClientState | null => state.value;
  const foundationOf = (id: string): FoundFoundation | undefined => town()?.finds.foundations.find((f) => f.id === id);

  // ----- text -----

  const setLabel = (text: string | null) => {
    if (text === null || !cursor) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.textContent = text;
    label.style.transform = `translate(${cursor.x + 16}px, ${cursor.y + 16}px)`;
  };

  const itemText = (it: StrokeItem, dropped: boolean): string => {
    const b = it.building;
    const t = BUILDINGS[b.template];
    const lines = [t.name];
    const f = it.kind === "lot" ? undefined : foundationOf(it.foundationId);
    if (f) {
      const floors = (b.floors ?? 1) > 1 ? L(` · этажей ${b.level} из ${b.floors}`, ` · floors ${b.level} of ${b.floors}`) : "";
      lines.push(L(`Старый фундамент ${Math.round(f.area)} м²`, `Old foundation ${Math.round(f.area)} m²`) + floors);
      const kind = foundationKindText(f, t);
      if (kind) lines.push(kind);
    }
    const holds = t.zone === "res" ? homesOf(b) : scaledJobs(t.jobs, b);
    if (holds > 0) lines.push(t.zone === "res" ? `${L("Семей", "Families")}: ${holds}` : `${L("Рабочих мест", "Jobs")}: ${holds}`);
    if (it.kind === "dig" && f) lines.push(L(`Сначала раскопка: ${Math.round(excavationSite(f, 0, 0).labor)} чел.-ч`, `Dug first: ${Math.round(excavationSite(f, 0, 0).labor)} person-h`));
    lines.push(costText(b.labor, materialsOf(b)));
    if (dropped) lines.push(L("Убрано из плана: клик — вернуть", "Dropped from the plan: click to return it"));
    else if (held) lines.push(L("Клик — убрать из плана", "Click to drop it from the plan"));
    return lines.join("\n");
  };

  const summaryLines = (plan: StrokePlan, dropped: ReadonlySet<string>): string[] => {
    const st = town();
    const s = strokeSummary(plan, dropped, st?.finds.foundations ?? []);
    const lines = [`${L("Построек", "Buildings")}: ${s.total}` + (s.dropped > 0 ? L(` (убрано ${s.dropped})`, ` (${s.dropped} dropped)`) : "")];
    const parts: string[] = [];
    if (s.onFoundations > 0) parts.push(L(`на фундаментах ${s.onFoundations}`, `on foundations ${s.onFoundations}`) + (s.asItWas > 0 ? L(` (как было ${s.asItWas})`, ` (as it was ${s.asItWas})`) : ""));
    if (s.dig > 0) parts.push(L(`после раскопки ${s.dig}`, `after digging ${s.dig}`));
    if (s.fresh > 0) parts.push(L(`новых ${s.fresh}`, `new ${s.fresh}`));
    if (parts.length > 0) lines.push(parts.join(" · "));
    if (s.homes > 0) lines.push(`${L("Семей", "Families")}: ${s.homes}`);
    if (s.jobs > 0) lines.push(`${L("Рабочих мест", "Jobs")}: ${s.jobs}`);
    if (s.total > 0) lines.push(costText(s.labor, s.materials));
    if (st) {
      const short: string[] = [];
      if (s.materials.logs > st.stock.logs) short.push(L(`брёвна ${n1(st.stock.logs)} из ${n1(s.materials.logs)} м³`, `logs ${n1(st.stock.logs)} of ${n1(s.materials.logs)} m³`));
      if (s.materials.planks > st.stock.planks) short.push(L(`доски ${n1(st.stock.planks)} из ${n1(s.materials.planks)} м³`, `planks ${n1(st.stock.planks)} of ${n1(s.materials.planks)} m³`));
      if (s.materials.stone > st.stock.stone) short.push(L(`камень ${n1(st.stock.stone)} из ${n1(s.materials.stone)} т`, `stone ${n1(st.stock.stone)} of ${n1(s.materials.stone)} t`));
      if (short.length > 0) lines.push(`${L("На складе сейчас", "In store now")}: ${short.join(", ")}`);
    }
    if (s.skipped > 0) {
      const word = plural(s.skipped, "фундамент", "фундамента", "фундаментов", "foundation");
      lines.push(L(`Пропущено ${s.skipped} ${word}: наведите, чтобы узнать почему`, `${s.skipped} ${word} left alone: point at one to see why`));
    }
    return lines;
  };

  // ----- drawing -----

  const draw = (plan: StrokePlan | null, dropped: ReadonlySet<string> = new Set()) => {
    const f = frame.value;
    if (!f || !plan) {
      view.overlay("stroke-plan").setData(empty());
      view.overlay("stroke-skip").setData(empty());
      return;
    }
    const ring = (pts: readonly Pt[]): [number, number][] => {
      const r = pts.map(([x, y]) => f.toLngLat(x, y));
      return [...r, r[0]];
    };
    view.overlay("stroke-plan").setData({
      type: "FeatureCollection",
      features: plan.items.map((it) => ({
        type: "Feature",
        properties: { kind: itemLook(it), dropped: dropped.has(it.key), hover: hover === it.key },
        geometry: { type: "Polygon", coordinates: [ring(it.building.footprint)] },
      })),
    });
    const skips: GeoJSON.Feature[] = [];
    for (const k of plan.skipped) {
      const fd = foundationOf(k.foundationId);
      if (fd) skips.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(lotRing(fd))] } });
    }
    view.overlay("stroke-skip").setData({ type: "FeatureCollection", features: skips });
  };

  // The item or skipped foundation under a point of the plan.
  const hit = (plan: StrokePlan, x: number, y: number): { item?: StrokeItem; skip?: StrokePlan["skipped"][number] } | null => {
    for (const it of plan.items) if (pointInRing(x, y, it.building.footprint)) return { item: it };
    for (const k of plan.skipped) {
      const fd = foundationOf(k.foundationId);
      if (fd && pointInRing(x, y, fd.ring)) return { skip: k };
    }
    return null;
  };

  // ----- planning -----

  const plan = (template: string, pts: readonly Pt[]): { template: string; spans: StrokeSpan[]; plan: StrokePlan } | null => {
    const st = town();
    const t = strokeTemplate(template);
    if (!st || !t) return null;
    const spans = spansAlong(st.roads, pts, strokePad(template), shift);
    return { template, spans, plan: planStroke(st, t, spans, onlyFoundations.peek()) };
  };

  const clearAll = () => {
    cancelAnimationFrame(frameReq);
    frameReq = 0;
    path = null;
    pointer = null;
    live = null;
    held = null;
    hover = null;
    card.hidden = true;
    draw(null);
    setLabel(null);
  };

  // Hover or drag: plan again and draw (once a frame at most).
  function refresh(): void {
    frameReq = 0;
    const id = active();
    if (!id || held) return;
    if (!local || view.metersPerPixel() > ZONE_MAX_MPP) {
      draw(null);
      setLabel(local ? L("Приблизьте карту", "Zoom in on the map") : null);
      return;
    }
    live = plan(placeTemplate(id), path ?? [local]);
    const p = live?.plan ?? null;
    hover = null;
    if (p && !path) {
      const h = hit(p, local[0], local[1]);
      hover = h?.item?.key ?? (h?.skip ? `skip:${h.skip.foundationId}` : null);
    }
    draw(p);
    const ok = !!p && p.items.length > 0;
    view.canvas.style.cursor = placementCursor(true, ok ? "ok" : "bad");
    if (!p || (p.items.length === 0 && p.skipped.length === 0)) setLabel(L("Здесь нет места вдоль построенной дороги", "No room along a built road here"));
    else if (path) setLabel(summaryLines(p, new Set()).join("\n"));
    else if (p.items.length === 1 && p.skipped.length === 0) setLabel(itemText(p.items[0], false));
    else if (p.items.length === 0) setLabel(p.skipped[0].reason);
    else setLabel(summaryLines(p, new Set()).join("\n"));
  }
  const schedule = () => {
    if (!frameReq) frameReq = requestAnimationFrame(refresh);
  };

  // Hover over a held plan: the building or foundation under the cursor tells about itself.
  const hoverHeld = () => {
    if (!held || !local) return;
    const h = hit(held.plan, local[0], local[1]);
    const key = h?.item?.key ?? (h?.skip ? `skip:${h.skip.foundationId}` : null);
    if (key !== hover) {
      hover = key;
      draw(held.plan, held.dropped);
    }
    setLabel(h?.item ? itemText(h.item, held.dropped.has(h.item.key)) : h?.skip ? h.skip.reason : null);
  };

  // ----- placing -----

  const send = (template: string, spans: StrokeSpan[], dropped: ReadonlySet<string>) => {
    busy = true;
    sendCmd({ type: "placeStroke", template, spans, onlyFoundations: onlyFoundations.peek(), drop: [...dropped] })
      .then((r) => {
        if (!r.ok) flash(r.reason ?? L("Не удалось поставить", "Could not place"));
        else {
          play("place");
          lastIds = r.ids ?? [];
        }
      })
      .catch(() => flash(L("Не удалось поставить", "Could not place")))
      .then(() => {
        busy = false;
        schedule();
      });
  };

  const showCard = () => {
    if (!held) return;
    const n = held.plan.items.length - held.dropped.size;
    card.replaceChildren();
    const text = document.createElement("div");
    text.className = "stroke-card-text";
    text.textContent = summaryLines(held.plan, held.dropped).join("\n");
    const row = document.createElement("div");
    row.className = "stroke-card-actions";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn-primary";
    ok.textContent = L(`Построить ${n}`, `Build ${n}`);
    ok.disabled = n === 0;
    ok.title = "Enter";
    ok.addEventListener("click", confirm);
    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn";
    no.textContent = L("Отмена", "Cancel");
    no.title = "Esc";
    no.addEventListener("click", cancel);
    row.append(ok, no);
    card.append(text, row);
    card.hidden = false;
  };

  const placeCard = (at: { x: number; y: number }) => {
    const box = view.container.getBoundingClientRect();
    const w = card.offsetWidth || 280;
    const h = card.offsetHeight || 160;
    // above the build bar and its hint lines, which sit over the map's lower edge
    const bar = document.querySelector(".build-bar")?.getBoundingClientRect();
    const floor = bar ? bar.top - box.top : box.height;
    const x = Math.max(8, Math.min(at.x + 16, box.width - w - 8));
    const y = Math.max(8, Math.min(at.y + 16, floor - h - 8));
    card.style.transform = `translate(${x}px, ${y}px)`;
  };

  function confirm(): void {
    if (!held || busy) return;
    const { template, spans, dropped, plan: p } = held;
    if (p.items.length - dropped.size <= 0) return;
    held = null;
    card.hidden = true;
    draw(null);
    send(template, spans, dropped);
  }

  function cancel(): void {
    held = null;
    card.hidden = true;
    hover = null;
    draw(null);
    schedule();
  }

  const finishDrag = (e: { pointerType: string | null }) => {
    const id = active();
    const done = path;
    path = null;
    pointer = null;
    if (!id || !done || !local) return;
    const r = plan(placeTemplate(id), done);
    if (!r || r.plan.items.length === 0) {
      flash(r?.plan.skipped[0]?.reason ?? L("Здесь нет места вдоль построенной дороги", "No room along a built road here"));
      schedule();
      return;
    }
    // One building with a mouse goes down at once; a row, or anything by touch, is held for the player to confirm.
    if (r.plan.items.length === 1 && e.pointerType !== "touch") {
      draw(null);
      send(r.template, r.spans, new Set());
      return;
    }
    held = { ...r, dropped: new Set() };
    hover = null;
    setLabel(null);
    draw(held.plan, held.dropped);
    showCard();
    if (cursor) placeCard(cursor);
  };

  const undo = () => {
    if (lastIds.length === 0 || busy) {
      flash(L("Отменять нечего", "Nothing to undo"));
      return;
    }
    const ids = lastIds;
    lastIds = [];
    busy = true;
    sendCmd({ type: "cancelStroke", ids })
      .then((r) => {
        if (!r.ok) flash(r.reason ?? L("Не удалось отменить", "Could not undo"));
        else play("click");
      })
      .catch(() => flash(L("Не удалось отменить", "Could not undo")))
      .then(() => {
        busy = false;
        schedule();
      });
  };

  // ----- events -----

  const onMove = (e: ViewPointer) => {
    cursor = { x: e.point[0], y: e.point[1] };
    if (!active()) return;
    const f = frame.value;
    if (!f) return;
    local = f.toLocal(e.lngLat[0], e.lngLat[1]);
    if (held) {
      hoverHeld();
      return;
    }
    if (path) {
      const last = path[path.length - 1];
      if (Math.hypot(local[0] - last[0], local[1] - last[1]) < MIN_STEP) return;
      path.push(local);
    }
    schedule();
  };

  const onDown = (e: ViewPointer) => {
    const id = active();
    const f = frame.value;
    if (!id || !f || held || busy || spaceDown || e.original.button !== 0 || !e.isPrimary) return;
    if (view.metersPerPixel() > ZONE_MAX_MPP) {
      flash(L("Приблизьте карту", "Zoom in on the map"));
      return;
    }
    cursor = { x: e.point[0], y: e.point[1] };
    local = f.toLocal(e.lngLat[0], e.lngLat[1]);
    path = [local];
    pointer = e.pointerId;
    schedule();
  };

  const onUp = (e: PointerEvent) => {
    if (path === null || (pointer !== null && e.pointerId !== pointer)) return;
    finishDrag({ pointerType: e.pointerType });
  };

  // A click on a held plan drops or returns the building under it.
  const onClick = (e: ViewPointer) => {
    if (!active() || !held) return;
    const f = frame.value;
    if (!f) return;
    const [x, y] = f.toLocal(e.lngLat[0], e.lngLat[1]);
    const h = hit(held.plan, x, y);
    if (!h?.item) return;
    if (held.dropped.has(h.item.key)) held.dropped.delete(h.item.key);
    else held.dropped.add(h.item.key);
    play("click");
    draw(held.plan, held.dropped);
    showCard();
    hoverHeld();
  };

  const onContext = (e: ViewPointer) => {
    if (!active()) return;
    e.original.preventDefault();
    if (held || path) {
      path = null;
      cancel();
    } else tool.value = null;
  };

  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!active() || typing(e)) return;
    if (e.key === "Shift" && !shift) {
      shift = true;
      schedule();
      return;
    }
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
      e.preventDefault();
      if (held || path) {
        path = null;
        cancel();
      } else tool.value = null;
      return;
    }
    if (e.key === "Enter" && held) {
      e.preventDefault();
      confirm();
      return;
    }
    if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if (e.code === "KeyG" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      e.preventDefault();
      setOnlyFoundations(!onlyFoundations.peek());
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift" && shift) {
      shift = false;
      if (active()) schedule();
    }
    if (e.key !== " " || !spaceDown) return;
    spaceDown = false;
    setSpacePan(false);
    syncPan(view);
  };

  const onBlur = () => {
    shift = false;
    if (path) {
      path = null;
      schedule();
    }
    if (!spaceDown) return;
    spaceDown = false;
    setSpacePan(false);
    syncPan(view);
  };

  view.on("pointermove", onMove);
  view.on("pointerdown", onDown);
  view.on("click", onClick);
  view.on("contextmenu", onContext);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", () => {
    if (path) {
      path = null;
      schedule();
    }
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  view.canvas.addEventListener("pointerleave", () => {
    if (path || held) return;
    cursor = null;
    local = null;
    draw(null);
    setLabel(null);
  });

  // The foundations-only switch re-plans a held row (keeping what the player dropped) or the hover.
  effect(() => {
    const only = onlyFoundations.value;
    untracked(() => {
      if (!active()) return;
      if (held) {
        const st = town();
        const t = strokeTemplate(held.template);
        if (!st || !t) return;
        held = { ...held, plan: planStroke(st, t, held.spans, only) };
        draw(held.plan, held.dropped);
        showCard();
      } else schedule();
    });
  });

  // Tool or variant switched: start over. The town changed under a hover: plan the hover again (a held row stays as
  // it was shown; the worker plans it again on confirm).
  effect(() => {
    void tool.value;
    void placeTemplate(tool.value && isStrokeTool(tool.value) ? tool.value : "house");
    untracked(() => {
      clearAll();
      const id = active();
      if (!id && spaceDown) {
        spaceDown = false;
        setSpacePan(false);
      }
      syncPan(view);
      if (id) view.canvas.style.cursor = placementCursor(true, "pending");
    });
  });
  effect(() => {
    void state.value?.buildings;
    void state.value?.zones;
    untracked(() => {
      if (active() && !held && !path && local) schedule();
    });
  });
}
