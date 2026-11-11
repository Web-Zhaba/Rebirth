import { effect, type ReadonlySignal } from "@preact/signals";
import { START_MINUTE_OF_DAY } from "../../sim/clock";
import type { Engine } from "../../engine/engine";
import { packColor } from "../../engine/overlay/geometry";
import { colourBits, DOT_FLOATS, Dots, writeDot } from "../../engine/scene/dots";
import { FIGURE_VERTEX_FLOATS, FOOT_VERTEX_FLOATS, type TownMesh } from "../../engine/scene/townMesh";
import { lightOpacity, placeAt, standAt, type Light, type Rest, type Trip } from "../../map/life";
import { tool } from "../../map/tools";
import { buildRig, orient, poseOf, villagerLook, writeVillager, type Action, type Rig } from "../../map/villagerModel";
import { MAP_ONLY, PALETTE } from "../../ui/palette";
import type { Frame } from "../../world/frame";
import { mppAtZoom, type View } from "../view";

// Visible life on the engine (the old map's life layer): walkers and carts moving along their trips, the residents
// out of doors (in the camp, at open-air work) where they stay, the evening glows of lit buildings, a click
// on a resident to follow them. Positions are recomputed ~20 times a second from the cosmetic trips and rests of the sim
// worker, extrapolating the game clock between snapshots. A resident who would stand tall enough on screen is a figure
// (map/villagerModel.ts) instead of a dot, the nearest first within a vertex budget, redrawn every frame so their
// steps are smooth.

const FRAME_MS = 50;
const MAX_EXTRAP = 15; // game minutes the clock may run ahead of the last snapshot
const DAY_MIN = 1440;
const HALO = 0.3;
const GLOW_M = { house: 5, work: 8, tavern: 12 } as const;
const DOTS_MPP = mppAtZoom(13); // the old dots' minzoom
const GLOWS_MPP = mppAtZoom(14);
const HIT_PX = 10;
const TOUCH_HIT_PX = 24; // a fingertip
const FIGURE_TALL = 1.7; // m
const FIGURE_MIN_PX = 5; // a figure this tall on screen reads better than a dot
const FIGURE_SLACK = 2.5; // the foreground of a tilted view is this much nearer the eye than the target, at most
const FIGURE_VERTICES = 120_000; // figures are rewritten on the CPU every frame: 4 MB of vertices at most
const FIGURE_MARGIN_PX = 40; // a figure this far off the screen's edge is not drawn
const FOOT_R = 0.3; // m: a figure's contact shadow, a soft ellipse under it
const FOOT_REACH = 2.4; // m it stretches away from a low sun, at most
const FOOT_LIFT = 0.06; // m over the ground
const FOOT_DARK = 0.5;
const FOOT_QUAD = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
const RIGS_KEPT = 1500; // looks remembered before the cache starts over
const EQUATOR = 2 * Math.PI * 6378137;

export interface LifeOptions {
  trips: ReadonlySignal<Trip[]>;
  rests: ReadonlySignal<Rest[]>;
  lights: ReadonlySignal<Light[]>;
  gameMinutes: ReadonlySignal<number>;
  gameMinPerSec: () => number;
  frame: ReadonlySignal<Frame | null>;
  onWalker?: (residentId: number) => void;
}

export function attachLife(engine: Engine, view: View, town: TownMesh, o: LifeOptions): void {
  const dots = new Dots(engine.device, engine.target, engine.frameU.layout, 3); // glows, carts, walkers
  engine.drawables.push(dots);
  let base = { gm: o.gameMinutes.peek(), at: performance.now() };
  effect(() => {
    base = { gm: o.gameMinutes.value, at: performance.now() };
  });
  let originKey = "";
  let last = 0;
  let walkers: { who: number; lat: number; lng: number; h: number }[] = [];
  const buf = [new Float32Array(64 * DOT_FLOATS), new Float32Array(64 * DOT_FLOATS), new Float32Array(64 * DOT_FLOATS)];
  const grow = (k: number, n: number) => {
    if (buf[k].length < n * DOT_FLOATS) buf[k] = new Float32Array(2 ** Math.ceil(Math.log2(n)) * DOT_FLOATS);
    return buf[k];
  };
  const ink = colourBits(packColor(PALETTE.ink));
  let figures = new Float32Array(64 * FIGURE_VERTEX_FLOATS);
  let feet = new Float32Array(64 * 6 * FOOT_VERTEX_FLOATS);
  const rigs = new Map<string, Rig>();
  // The look of a resident follows them as they grow: their id is the seed, their age rounds down to a year.
  const rigOf = (who: number, sex: "m" | "f", age: number): Rig => {
    const key = `${who}:${sex}:${Math.floor(age)}`;
    let rig = rigs.get(key);
    if (!rig) {
      if (rigs.size >= RIGS_KEPT) rigs.clear();
      rigs.set(key, (rig = buildRig(villagerLook(who, Math.floor(age), sex))));
    }
    return rig;
  };
  // Each resident's walks of the day, for where they stand off them.
  let walksOf = new Map<number, Trip[]>();
  let walksFrom: Trip[] | null = null;
  const none: Trip[] = [];
  const cart = colourBits(packColor(MAP_ONLY.cart));
  const paper = colourBits(packColor(PALETTE.paperRaised));

  engine.onBeforeFrame((now) => {
    const f = o.frame.peek();
    if (!f) return;
    const [lng0, lat0] = f.toLngLat(0, 0);
    const key = `${lng0},${lat0}`;
    if (key !== originKey) {
      originKey = key;
      dots.setOrigin(lat0, lng0);
    }
    const mpp = engine.metersPerPixel();
    // Figures: wherever a resident is FIGURE_MIN_PX tall for the eye (last frame's: the camera has not moved yet).
    const v = engine.view;
    const figureReach = v ? (FIGURE_TALL * v.viewportH) / (2 * v.tanHalfY * FIGURE_MIN_PX) : 0;
    const close = v !== null && engine.state.distance < figureReach * FIGURE_SLACK;
    if (!close && now - last < FRAME_MS) return;
    last = now;
    const minute = (base.gm + Math.min(MAX_EXTRAP, (o.gameMinPerSec() * (performance.now() - base.at)) / 1000) + START_MINUTE_OF_DAY) % DAY_MIN;
    const hour = minute / 60;
    // The old dots grew from 1.5-2.5 px at zoom 13 to 3.5-6 px at zoom 19.
    const zoom = Math.log2((EQUATOR * Math.cos((lat0 * Math.PI) / 180)) / (512 * mpp));
    const t = Math.min(1, Math.max(0, (zoom - 13) / 6));
    const ground = (lat: number, lng: number) => engine.groundAt(lat, lng) ?? 0;

    // Glows, fading with the hour and towards the street, where the windows themselves carry the light.
    const lights = mpp <= GLOWS_MPP ? o.lights.peek() : [];
    const near = Math.min(1, Math.max(0, (zoom - 15.5) / 2));
    let n = 0;
    const g = grow(0, lights.length);
    for (const l of lights) {
      const a = lightOpacity(l.kind, hour) * (1 - near * (1 - HALO));
      if (a < 0.01) continue;
      const [lng, lat] = f.toLngLat(l.x, l.y);
      const p = dots.local(lat, lng, ground(lat, lng) + 0.3);
      writeDot(g, n++, p[0], p[1], p[2], GLOW_M[l.kind], colourBits(packColor(MAP_ONLY.lamp, a)), 0, 0, 0.9);
    }
    dots.set(0, g, n);

    // Walkers and carts on their trips, then those standing out of doors; the residents near the camera as figures.
    const trips = mpp <= DOTS_MPP ? o.trips.peek() : [];
    const rests = mpp <= DOTS_MPP ? o.rests.peek() : [];
    if (trips !== walksFrom) {
      walksFrom = trips;
      walksOf = new Map();
      for (const trip of trips) if (trip.kind === "walk" && trip.who !== undefined) walksOf.set(trip.who, [...(walksOf.get(trip.who) ?? []), trip]);
    }
    const cb = grow(1, trips.length);
    const wb = grow(2, trips.length + rests.length);
    let nc = 0;
    let nw = 0;
    walkers = [];
    const eye = close ? dots.toLocal(v!.eye) : null;
    const width = engine.canvas.clientWidth;
    const height = engine.canvas.clientHeight;
    const moving = o.gameMinPerSec() > 0;
    const seconds = now / 1000;
    const tall: { d: number; who: number; sex: "m" | "f"; age: number; p: [number, number, number]; at: [number, number]; g: number; dir: [number, number]; action: Action }[] = [];
    const person = (who: number | undefined, sex: "m" | "f" | undefined, age: number | undefined, at: [number, number], dir: [number, number], action: Action) => {
      const [lng, lat] = f.toLngLat(at[0], at[1]);
      const g = ground(lat, lng);
      const p = dots.local(lat, lng, g + 1);
      if (who !== undefined) walkers.push({ who, lat, lng, h: g + 1 });
      if (eye && who !== undefined && sex && age !== undefined) {
        const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
        const s = d < figureReach ? engine.project(lat, lng, g + 1) : null;
        if (s && s[0] > -FIGURE_MARGIN_PX && s[0] < width + FIGURE_MARGIN_PX && s[1] > -FIGURE_MARGIN_PX && s[1] < height + FIGURE_MARGIN_PX) {
          tall.push({ d, who, sex, age, p, at, g, dir, action });
          return;
        }
      }
      writeDot(wb, nw++, p[0], p[1], p[2], 1.5 + 2 * t, ink, paper, 0.8, null);
    };
    const walking = new Set<number>();
    for (const trip of trips) {
      const placed = placeAt(trip, minute);
      if (!placed) continue;
      if (trip.kind === "cart") {
        const [lng, lat] = f.toLngLat(placed.at[0], placed.at[1]);
        const p = dots.local(lat, lng, ground(lat, lng) + 1);
        writeDot(cb, nc++, p[0], p[1], p[2], 2.5 + 3.5 * t, cart, paper, 0.8, null);
      } else {
        if (trip.who !== undefined) walking.add(trip.who);
        person(trip.who, trip.sex, trip.age, placed.at, placed.dir, "walk");
      }
    }
    for (const r of rests) {
      if (walking.has(r.who)) continue;
      const s = standAt(r, walksOf.get(r.who) ?? none, minute);
      if (s) person(r.who, r.sex, r.age, s.at, s.dir, s.working ? "work" : "idle");
    }
    // The nearest as figures while the vertex budget lasts, the others as dots.
    tall.sort((a, b) => a.d - b.d);
    // Contact shadows point away from the sun and grow as it sinks (the town's light, in the same east/north/up frame).
    const sun = town.look.light;
    const flat = Math.hypot(sun[0], sun[1]);
    const away: [number, number] = flat > 1e-3 ? [-sun[0] / flat, -sun[1] / flat] : [0, 0];
    const stretch = (town.look.sunStrength * flat) / Math.max(sun[2], 0.05);
    let nv = 0;
    let nf = 0;
    for (const m of tall) {
      const rig = rigOf(m.who, m.sex, m.age);
      if (nv + rig.vertices > FIGURE_VERTICES) {
        writeDot(wb, nw++, m.p[0], m.p[1], m.p[2], 1.5 + 2 * t, ink, paper, 0.8, null);
        continue;
      }
      if ((nv + rig.vertices) * FIGURE_VERTEX_FLOATS > figures.length) {
        const bigger = new Float32Array(2 * Math.max(figures.length, (nv + rig.vertices) * FIGURE_VERTEX_FLOATS));
        bigger.set(figures);
        figures = bigger;
      }
      // The steps follow the wall clock, not the walker: at game speed the town crosses in seconds.
      const pose = orient(poseOf(rig, moving ? m.action : "idle", seconds + m.who * 0.37), m.dir[0], m.dir[1]);
      nv = writeVillager(rig, pose, [m.p[0], m.p[1], m.p[2] - 1], figures, nv * FIGURE_VERTEX_FLOATS) / FIGURE_VERTEX_FLOATS;

      // Its shadow: from under the feet to `len` away, following the ground's slope that way.
      const r = FOOT_R * rig.look.scale;
      const len = Math.min(FOOT_REACH, rig.look.stature * stretch);
      const [lng, lat] = f.toLngLat(m.at[0] + away[0] * (len + r), m.at[1] + away[1] * (len + r));
      const slope = len > 0.05 ? (ground(lat, lng) - m.g) / (len + r) : 0;
      if ((nf + 6) * FOOT_VERTEX_FLOATS > feet.length) {
        const bigger = new Float32Array(2 * feet.length);
        bigger.set(feet);
        feet = bigger;
      }
      for (let k = 0; k < 6; k++) {
        const u = FOOT_QUAD[k * 2];
        const w = FOOT_QUAD[k * 2 + 1];
        const along = len / 2 + u * (r + len / 2);
        feet.set([m.p[0] + away[0] * along - away[1] * w * r, m.p[1] + away[1] * along + away[0] * w * r, m.p[2] - 1 + FOOT_LIFT + slope * along, u, w, FOOT_DARK], nf++ * FOOT_VERTEX_FLOATS);
      }
    }
    dots.set(1, cb, nc);
    dots.set(2, wb, nw);
    town.setFigures(figures, nv);
    town.setFootShadows(feet, nf);
  });

  // A click on a resident follows them (a larger hit target than the dot, as before). It takes the click: this handler
  // is attached before the map picks, which leave a prevented click alone, so the building under them is not selected.
  if (o.onWalker)
    view.on("click", (e) => {
      if (tool.value) return;
      let best: number | null = null;
      let bestD = e.pointerType === "touch" ? TOUCH_HIT_PX : HIT_PX;
      for (const w of walkers) {
        const s = engine.project(w.lat, w.lng, w.h);
        if (!s) continue;
        const d = Math.hypot(s[0] - e.point[0], s[1] - e.point[1]);
        if (d < bestD) (bestD = d), (best = w.who);
      }
      if (best === null) return;
      e.original.preventDefault();
      o.onWalker!(best);
    });
}
