import { trackpadCameraDelta, wheelIntent } from "./trackpad";
import type { Engine } from "../engine";
import { buildView, clampState, rayDir, MAX_DISTANCE, MAX_PITCH, MIN_DISTANCE, type CameraState } from "./camera";
import type { CameraControl, CameraEvents, CameraTarget } from "./cameraControl";
import { easeFly, easeOutCubic } from "./ease";
import { fitBounds as fitBoundsDistance } from "./fit";
import { angleDelta, flyDuration, flyPath, groundDistance, slerpLatLng } from "./fly";
import { panAboutCentre, panByPixels, rotateByPixels, solveGrab, zoomAbout, type PickFn } from "./grab";
import { inertiaStart, inertiaStep, PAN_INERTIA, ROTATE_INERTIA, VelocityTracker } from "./inertia";
import { pickGround } from "./pick";
import { wheelSmoothStep, wheelZoomOctaves } from "./wheel";

// Camera input for the engine: mouse, wheel, trackpad, touch and keyboard with the feel of the MapLibre map the game
// has today, plus inertia and flights. All of it edits Engine.state from a pre-frame hook, once per frame; the pure
// maths lives next to this file (grab.ts, fly.ts, fit.ts, inertia.ts, wheel.ts, ease.ts).

const RAD = Math.PI / 180;
const DRAG_TOLERANCE = 3; // px before a press becomes a drag (MapLibre's clickTolerance is 3)
const KEY_PAN_PX = 100;
const KEY_ROTATE_DEG = 15;
const KEY_PITCH_DEG = 10;
const KEY_EASE_MS = 300;
const DBLCLICK_MS = 300;

type Grab = { lat: number; lng: number } | null;

interface Drag {
  id: number;
  mode: "pan" | "rotate";
  touch: boolean;
  sx: number; // press position
  sy: number;
  x: number; // latest pointer position
  y: number;
  px: number; // position the camera has caught up to
  py: number;
  started: boolean;
  dirty: boolean;
}

interface Multi {
  grab: Grab;
  cx: number;
  cy: number;
  dist: number;
  angle: number; // rad, screen space (y down)
}

type Inertia = { kind: "pan"; v: number[] } | { kind: "rotate"; v: number[] };

interface Anim {
  t0: number | null;
  dur: number;
  update(k: number): void;
  goal?: Required<CameraTarget>;
  long?: boolean; // covers a lot of ground: keep the target's height glued to the terrain
}

export function createCameraControl(engine: Engine): CameraControl {
  const canvas = engine.canvas;
  const s: CameraState = engine.state;
  const listeners: { [K in keyof CameraEvents]: Set<(e: CameraEvents[K]) => void> } = { dragstart: new Set(), move: new Set(), moveend: new Set() };
  const emit = <K extends keyof CameraEvents>(type: K): void => {
    for (const f of [...listeners[type]]) (f as (e: void) => void)();
  };

  let panEnabled = true;
  let dblEnabled = true;
  let drag: Drag | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let multi: Multi | null = null;
  let inertia: Inertia | null = null;
  let anim: Anim | null = null;
  let wheel: { pending: number; x: number; y: number; grab: Grab } | null = null;
  const tracker = new VelocityTracker();
  let rotAcc = { h: 0, p: 0 }; // unwrapped heading/pitch the user has dialled in this drag, for inertia
  let handSeq = false; // dragstart already sent for this run of input
  let owned = false; // the control moved the camera since the last moveend
  let lastNow = 0;
  let snap = { lat: s.lat, lng: s.lng, distance: s.distance, heading: s.heading, pitch: s.pitch };

  const prevTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";

  const size = (): [number, number] => [Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight)];
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Ground under a pixel for a hypothetical camera state, built fresh (engine.view is the previous frame's). The target
  // rides on the ground there, as the engine keeps it: held at its old height while it slides over a slope, a pitched
  // view sees the ground under a pixel run several times further than the target moved, and the grab solve diverges.
  const pickAt: PickFn = (st, px, py) => {
    const [w, h] = size();
    const g = engine.groundAt(st.lat, st.lng);
    const v = buildView(g === null ? st : { ...st, h: g }, w, h, engine.groundAt);
    return pickGround(v.eye, rayDir(v, (px / w) * 2 - 1, 1 - (py / h) * 2), engine.groundAt);
  };
  // Ground under a pixel of what is on screen now.
  const grabAt = (x: number, y: number): Grab => {
    const g = engine.pick(x, y);
    return g ? { lat: g.lat, lng: g.lng } : null;
  };

  const beginHand = (): void => {
    owned = true;
    inertia = null;
    anim = null;
    if (!handSeq) {
      handSeq = true;
      emit("dragstart");
    }
  };
  const cancelMotion = (): void => {
    inertia = null;
    anim = null;
    wheel = null;
  };

  // ---- programmatic moves ----

  const resolve = (t: CameraTarget): Required<CameraTarget> => ({
    lat: t.lat ?? s.lat,
    lng: t.lng ?? s.lng,
    distance: Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, t.distance ?? s.distance)),
    heading: t.heading ?? s.heading,
    pitch: Math.max(0, Math.min(MAX_PITCH, t.pitch ?? s.pitch)),
  });

  const jumpTo = (t: CameraTarget): void => {
    cancelMotion();
    owned = true;
    const g = resolve(t);
    Object.assign(s, g);
    clampState(s);
    if (t.lat !== undefined || t.lng !== undefined) engine.snapToGround();
  };

  const flyTo = (t: CameraTarget, opts?: { duration?: number }): void => {
    cancelMotion();
    owned = true;
    const from = { lat: s.lat, lng: s.lng, distance: s.distance, heading: s.heading, pitch: s.pitch };
    const to = resolve(t);
    const dh = angleDelta(from.heading, to.heading);
    const [w, h] = size();
    const kW = 2 * Math.tan((s.fovY * RAD) / 2) * (w / h); // visible ground width per metre of distance
    const u1 = groundDistance(from.lat, from.lng, to.lat, to.lng);
    const path = flyPath(from.distance * kW, to.distance * kW, u1);
    const dur = opts?.duration ?? flyDuration(path.S);
    if (!(dur > 0) || !Number.isFinite(path.S)) {
      jumpTo(to);
      return;
    }
    anim = {
      t0: null,
      dur,
      goal: to,
      long: u1 > 20_000,
      update(k) {
        const e = easeFly(k);
        if (k >= 1) {
          Object.assign(s, to);
        } else {
          const p = path.at(e);
          const ll = slerpLatLng(from.lat, from.lng, to.lat, to.lng, p.frac);
          s.lat = ll.lat;
          s.lng = ll.lng;
          s.distance = p.w / kW;
          s.heading = from.heading + dh * e;
          s.pitch = from.pitch + (to.pitch - from.pitch) * e;
        }
        clampState(s);
      },
    };
  };

  // Straight ease (keys, double click): linear in lat/lng and angles, exponential in distance.
  const easeTo = (to: Required<CameraTarget>, dur: number, pivot?: { grab: Grab; x: number; y: number }): void => {
    const from = { lat: s.lat, lng: s.lng, distance: s.distance, heading: s.heading, pitch: s.pitch };
    const dh = angleDelta(from.heading, to.heading);
    anim = {
      t0: null,
      dur,
      goal: to,
      update(k) {
        const e = easeOutCubic(k);
        const d = from.distance * Math.pow(to.distance / from.distance, e);
        if (pivot?.grab) {
          zoomAbout(s, d / s.distance, pivot.grab, pivot.x, pivot.y, pickAt);
        } else {
          s.lat = from.lat + (to.lat - from.lat) * e;
          s.lng = from.lng + (angleDelta(from.lng, to.lng)) * e;
          s.distance = d;
        }
        s.heading = from.heading + dh * e;
        s.pitch = from.pitch + (to.pitch - from.pitch) * e;
        clampState(s);
      },
    };
  };

  const fitBounds: CameraControl["fitBounds"] = (bounds, o) => {
    const [w, h] = size();
    const r = fitBoundsDistance(bounds, w, h, s.fovY, o.padding, o.minDistance);
    const target = { lat: r.lat, lng: r.lng, distance: r.distance };
    if (o.animate) flyTo(target);
    else jumpTo(target);
  };

  // ---- per-frame work ----

  const applyDrag = (d: Drag): void => {
    if (!d.dirty) return;
    d.dirty = false;
    if (d.mode === "pan") {
      panAboutCentre(s, d.x - d.px, d.y - d.py, ...size(), pickAt);
      d.px = d.x;
      d.py = d.y;
    } else {
      const dx = d.x - d.px;
      const dy = d.y - d.py;
      rotateByPixels(s, dx, dy);
      rotAcc = { h: rotAcc.h + dx * 0.8, p: rotAcc.p - dy * 0.5 };
      d.px = d.x;
      d.py = d.y;
    }
  };

  const stepMulti = (m: Multi): void => {
    const pts = [...touches.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let dAngle = angle - m.angle;
    if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
    if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    const dLog = Math.log(m.dist / dist);
    const dcx = cx - m.cx;
    const dcy = cy - m.cy;
    if (Math.abs(dLog) < 1e-4 && Math.abs(dAngle) < 1e-4 && Math.abs(dcx) < 0.01 && Math.abs(dcy) < 0.01) return;
    // Two fingers sliding up or down together, without pinching or twisting, tilt the camera (MapLibre's touch pitch).
    const pitchOnly = Math.abs(dLog) < 0.012 && Math.abs(dAngle) < 0.02 && Math.abs(dcy) > 1.5 * Math.abs(dcx);
    if (pitchOnly) {
      s.pitch -= dcy * 0.5;
      clampState(s);
      m.grab = grabFromState(cx, cy);
    } else {
      s.distance *= Math.exp(dLog);
      s.heading -= dAngle / RAD;
      clampState(s);
      // Pinch and twist about the fingers, the slide at the centre's scale (panAboutCentre), then hold on afresh.
      if (m.grab) solveGrab(s, m.grab, m.cx, m.cy, pickAt);
      panAboutCentre(s, dcx, dcy, ...size(), pickAt);
      m.grab = grabFromState(cx, cy);
    }
    m.cx = cx;
    m.cy = cy;
    m.dist = dist;
    m.angle = angle;
  };
  const grabFromState = (x: number, y: number): Grab => {
    const g = pickAt(s, x, y);
    return g ? { lat: g.lat, lng: g.lng } : null;
  };

  const frame = (now: number): void => {
    const dt = lastNow ? Math.min(100, Math.max(0, now - lastNow)) : 16;
    lastNow = now;
    // Moves solved with pickAt put the target on the ground: draw it there too, not easing in from the old height.
    const solved = (drag?.started && drag.mode === "pan") || !!multi || !!wheel || inertia?.kind === "pan";

    if (drag?.started) {
      applyDrag(drag);
      if (drag.mode === "pan") tracker.push(now, drag.x, drag.y);
      else tracker.push(now, rotAcc.h, rotAcc.p);
    }
    if (multi) stepMulti(multi);

    if (wheel && wheel.pending !== 0) {
      const part = wheelSmoothStep(wheel.pending, dt);
      wheel.pending -= part;
      zoomAbout(s, Math.pow(2, -part), wheel.grab, wheel.x, wheel.y, pickAt);
      if ((part > 0 && s.distance <= MIN_DISTANCE) || (part < 0 && s.distance >= MAX_DISTANCE)) wheel.pending = 0;
      if (wheel.pending === 0) wheel = null;
    }

    if (anim) {
      if (anim.t0 === null) anim.t0 = now;
      const k = Math.min(1, (now - anim.t0) / anim.dur);
      anim.update(k);
      if (anim.long) engine.snapToGround();
      if (k >= 1) anim = null;
    }

    if (inertia) {
      const spec = inertia.kind === "pan" ? PAN_INERTIA : ROTATE_INERTIA;
      const st = inertiaStep(inertia.v, dt, spec.deceleration);
      if (inertia.kind === "pan") {
        panAboutCentre(s, st.delta[0], st.delta[1], ...size(), pickAt);
      } else {
        s.heading += st.delta[0];
        s.pitch += st.delta[1];
        clampState(s);
        if (s.pitch <= 0 || s.pitch >= MAX_PITCH) st.v[1] = 0;
      }
      inertia.v = st.v;
      if (st.done) inertia = null;
    }
    if (solved) engine.snapToGround();
  };

  const idle = (): boolean => !drag?.started && !multi && !inertia && !anim && !wheel;

  // After the frame is drawn: events carry the view the player sees.
  const afterFrame = (): void => {
    const changed = snap.lat !== s.lat || snap.lng !== s.lng || snap.distance !== s.distance || snap.heading !== s.heading || snap.pitch !== s.pitch;
    if (changed) {
      snap = { lat: s.lat, lng: s.lng, distance: s.distance, heading: s.heading, pitch: s.pitch };
      emit("move");
    }
    if (owned && idle() && !drag) {
      owned = false;
      handSeq = false;
      emit("moveend");
    }
  };

  const offBefore = engine.onBeforeFrame(frame);
  const offAfter = engine.onFrame(afterFrame);

  // ---- pointer ----

  const endDrag = (withInertia: boolean): void => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.started) {
      return;
    }
    d.dirty = true;
    applyDrag(d);
    if (withInertia) {
      const now = performance.now();
      if (d.mode === "pan") {
        const v = inertiaStart(tracker.velocity(now, 2), PAN_INERTIA);
        if (v) inertia = { kind: "pan", v };
      } else {
        const v = inertiaStart(tracker.velocity(now, 2), ROTATE_INERTIA);
        if (v) inertia = { kind: "rotate", v };
      }
    }
    tracker.reset();
  };

  const startDrag = (id: number, mode: "pan" | "rotate", x: number, y: number, touch: boolean): void => {
    cancelMotion();
    tracker.reset();
    rotAcc = { h: 0, p: 0 };
    drag = { id, mode, touch, sx: x, sy: y, x, y, px: x, py: y, started: false, dirty: false };
  };

  // The gesture follows the first two fingers down; whenever that pair changes it holds on afresh, or it would jump.
  const startMulti = (): void => {
    const [a, b] = [...touches.values()];
    multi = { grab: null, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    multi.grab = grabAt(multi.cx, multi.cy);
  };

  const onDown = (e: PointerEvent): void => {
    const [x, y] = local(e);
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x, y });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      if (touches.size === 1) {
        if (panEnabled) startDrag(e.pointerId, "pan", x, y, true);
      } else if (touches.size === 2) {
        endDrag(false);
        cancelMotion();
        beginHand();
        startMulti();
      }
      e.preventDefault();
      return;
    }
    if (drag) return;
    const rotate = e.button === 2 || e.button === 1 || (e.button === 0 && e.ctrlKey);
    const pan = e.button === 0 && !e.ctrlKey && panEnabled;
    if (!rotate && !pan) return;
    startDrag(e.pointerId, rotate ? "rotate" : "pan", x, y, false);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    const [x, y] = local(e);
    if (e.pointerType === "touch") {
      const t = touches.get(e.pointerId);
      if (!t) return;
      t.x = x;
      t.y = y;
    }
    if (drag && drag.id === e.pointerId) {
      drag.x = x;
      drag.y = y;
      if (!drag.started && Math.hypot(x - drag.sx, y - drag.sy) >= DRAG_TOLERANCE) {
        drag.started = true;
        beginHand();
      }
      drag.dirty = drag.started;
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.delete(e.pointerId);
      if (multi && touches.size >= 2) {
        startMulti();
        return;
      }
      if (multi && touches.size < 2) {
        multi = null;
        const rest = [...touches.entries()][0];
        if (rest && panEnabled) {
          startDrag(rest[0], "pan", rest[1].x, rest[1].y, true);
          drag!.started = true; // the second finger lifted: carry on panning without a new tolerance
        }
        return;
      }
    }
    if (drag && drag.id === e.pointerId) {
      const [x, y] = local(e);
      drag.x = x;
      drag.y = y;
      endDrag(e.type === "pointerup");
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (wheelIntent(e) === "camera") {
      // Two-finger trackpad movement: turn and tilt, as the game does today.
      const d = trackpadCameraDelta(e);
      beginHand();
      wheel = null;
      s.heading += d.bearing;
      s.pitch += d.pitch;
      clampState(s);
      return;
    }
    const oct = wheelZoomOctaves(e);
    if (oct === 0) return;
    const [x, y] = local(e);
    beginHand();
    if (!wheel || Math.hypot(x - wheel.x, y - wheel.y) > 3) wheel = { pending: wheel?.pending ?? 0, x, y, grab: grabAt(x, y) };
    wheel.pending += oct;
  };

  const onDblClick = (e: MouseEvent): void => {
    if (!dblEnabled) return;
    e.preventDefault();
    const [x, y] = local(e);
    beginHand();
    wheel = null;
    const goal = resolve({ distance: s.distance * (e.shiftKey ? 2 : 0.5) });
    easeTo(goal, DBLCLICK_MS, { grab: grabAt(x, y), x, y });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t !== document.body && t !== canvas && t !== document.documentElement) return;
    const base: Required<CameraTarget> = anim?.goal ?? { lat: s.lat, lng: s.lng, distance: s.distance, heading: s.heading, pitch: s.pitch };
    const goal = { ...base };
    switch (e.code) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        const dir = e.code === "ArrowLeft" || e.code === "ArrowUp" ? 1 : -1;
        if (e.shiftKey) {
          if (e.code === "ArrowLeft") goal.heading -= KEY_ROTATE_DEG;
          else if (e.code === "ArrowRight") goal.heading += KEY_ROTATE_DEG;
          else if (e.code === "ArrowUp") goal.pitch += KEY_PITCH_DEG;
          else goal.pitch -= KEY_PITCH_DEG;
        } else {
          const tmp: CameraState = { ...s, ...base };
          const horizontal = e.code === "ArrowLeft" || e.code === "ArrowRight";
          panByPixels(tmp, horizontal ? dir * KEY_PAN_PX : 0, horizontal ? 0 : dir * KEY_PAN_PX, size()[1]);
          goal.lat = tmp.lat;
          goal.lng = tmp.lng;
        }
        break;
      }
      case "Equal":
      case "NumpadAdd":
        goal.distance *= Math.pow(2, e.shiftKey ? -2 : -1);
        break;
      case "Minus":
      case "NumpadSubtract":
        goal.distance *= Math.pow(2, e.shiftKey ? 2 : 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    beginHand();
    easeTo(resolve(goal), KEY_EASE_MS);
  };

  const onContext = (e: Event): void => e.preventDefault();

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKey);

  return {
    jumpTo,
    flyTo,
    fitBounds,
    setPanEnabled(on) {
      panEnabled = on;
      if (!on && drag?.mode === "pan") {
        endDrag(false);
      }
    },
    setDoubleClickZoomEnabled(on) {
      dblEnabled = on;
    },
    on(type, fn) {
      (listeners[type] as Set<typeof fn>).add(fn);
      return () => (listeners[type] as Set<typeof fn>).delete(fn);
    },
    dispose() {
      offBefore();
      offAfter();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
      canvas.style.touchAction = prevTouchAction;
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
