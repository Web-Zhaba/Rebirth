import { h, render } from "preact";
import { effect } from "@preact/signals";
import { BUILDINGS } from "../../sim/buildings";
import type { Building, BuildingQuery } from "../../sim/types";
import { buildings, frame, queryBuilding, state } from "../../simClient";
import { Icon } from "../../ui/Icon";
import { badgeFor, type BadgeSpec } from "../../map/badgeModel";
import { mppAtZoom, type View, type ViewMarker } from "../view";
import { selectedBuilding } from "./buildings";
import { L } from "../../i18n";

// Small paper tags over buildings that need a look: construction progress, no workers, no input. HTML markers styled
// with the UI tokens (.map-badge in feedback.css). Only for buildings in view, only when a badge applies, at most MAX.
const MAX = 24;
export const BADGE_MAX_MPP = mppAtZoom(15.5); // old MIN_ZOOM 15.5; further out map badges are hidden
const REFRESH_MS = 1000; // snapshots come several times a second; badges change slowly
const QUERY_MS = 8000; // staffing of a workplace is asked again after this long

// Whether the badge for a finished building needs the worker's staffing answer.
const isWorkplace = (b: Building): boolean => b.state === "active" && !b.upgrade && b.zone !== "res" && (BUILDINGS[b.template]?.jobs ?? 0) > 0;

interface Entry {
  marker: ViewMarker;
  el: HTMLButtonElement;
  key: string;
}

export function attachBadges(view: View): void {
  const shown = new Map<number, Entry>();
  const asked = new Map<number, { at: number; info: BuildingQuery | null; busy: boolean }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;

  const ask = (id: number) => {
    const c = asked.get(id);
    if (c && (c.busy || Date.now() - c.at < QUERY_MS)) return;
    asked.set(id, { at: c?.at ?? 0, info: c?.info ?? null, busy: true });
    void queryBuilding(id).then((info) => {
      asked.set(id, { at: Date.now(), info, busy: false });
      schedule();
    });
  };

  const drop = (id: number) => {
    shown.get(id)?.marker.remove();
    shown.delete(id);
  };

  const update = () => {
    last = Date.now();
    const all = buildings.peek();
    const fl = frame.peek();
    if (!all || !fl || view.metersPerPixel() > BADGE_MAX_MPP) {
      for (const id of [...shown.keys()]) drop(id);
      return;
    }
    const levers = state.peek()?.levers;
    const cw = view.canvas.clientWidth;
    const ch = view.canvas.clientHeight;
    const inView = (at: [number, number]) => {
      const [x, y] = view.project(at);
      return x >= 0 && y >= 0 && x <= cw && y <= ch; // NaN (behind the camera) fails too
    };
    const want = new Map<number, { b: Building; spec: BadgeSpec; at: [number, number] }>();
    for (const b of Object.values(all)) {
      if (want.size >= MAX) break;
      const at = fl.toLngLat(b.lot.cx, b.lot.cy);
      if (!inView(at)) continue;
      if (isWorkplace(b)) ask(b.id);
      const spec = badgeFor(b, asked.get(b.id)?.info, levers);
      if (spec) want.set(b.id, { b, spec, at });
    }
    for (const id of [...shown.keys()]) if (!want.has(id)) drop(id);
    for (const [id, { spec, at }] of want) {
      const key = `${spec.tone}|${spec.icon}|${spec.label}`;
      let e = shown.get(id);
      if (!e) {
        const el = document.createElement("button");
        el.type = "button";
        el.addEventListener("click", (ev) => {
          ev.stopPropagation(); // the map must not treat it as a click on the ground
          selectedBuilding.value = id;
        });
        // The renderer positions the holder; the button keeps its own classes.
        const holder = document.createElement("div");
        holder.append(el);
        e = { marker: view.addMarker({ element: holder, anchor: "bottom" }, at), el, key: "" };
        shown.set(id, e);
      }
      if (e.key !== key) {
        e.key = key;
        e.el.className = `map-badge map-badge-${spec.tone}`;
        e.el.title = `${spec.title}. ${L("Открыть здание", "Open building")}`;
        render(h("span", { class: "map-badge-in" }, h(Icon, { name: spec.icon, size: 12 }), spec.label), e.el);
      }
    }
  };

  // At most one update a second, whatever fires it.
  function schedule() {
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        update();
      },
      Math.max(0, REFRESH_MS - (Date.now() - last)),
    );
  }

  effect(() => {
    void buildings.value;
    void frame.value;
    schedule();
  });
  view.on("moveend", schedule);
}
