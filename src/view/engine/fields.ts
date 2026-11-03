import { effect, type ReadonlySignal } from "@preact/signals";
import type { Engine } from "../../engine/engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../../engine/geo/ellipsoid";
import { FIELD_VERTEX_FLOATS, FIELD_WORK_OFFSET, Fields } from "../../engine/scene/fields";
import { calendar, DAYS_PER_SEASON } from "../../sim/clock";
import { assignFields } from "../../sim/fields";
import { buildings, frame, state, zones } from "../../simClient";
import { FIELD_COLORS } from "../../ui/palette";
import type { Frame } from "../../world/frame";
import { buildFieldMesh } from "../../map/fieldMesh";
import { fields3dOn } from "../../map/graphicsSettings";
import { rgb, type XY } from "../../map/modelGeometry";
import { mppAtZoom, zoomAtMpp } from "../view";
import { GroundSeat } from "./groundSeat";
import { townLight } from "./townLight";

// The town's farm fields up close on the engine (scene/fields.ts), from the same fields and rules as the old 3D field
// layer: every field polygon cut into 4 m cells (map/fieldMesh.ts) draped on the engine's ground a
// few centimetres up, in one mesh, rebuilt when the fields, the farms that work them or the frame change; the farms'
// real work (state.fieldProgress) is rewritten into it when it moves.

const FIELD_MPP = mppAtZoom(14.5); // the old FIELD_FROM_ZOOM: closer than this the fields are 3D
const FIELD_FULL_ZOOM = 15.2; // from here it no longer fades into the flat fill
const FAR = 2500; // m: the fields fade out toward here
const LIFT = 0.03; // m above the ground
const RETRY_FRAMES = 20; // while the ground under the fields is still streaming, look again this often

const shapeKey = (f: { id: number; pts: readonly (readonly number[])[] }) => `${f.id}:${f.pts.map((p) => `${p[0]},${p[1]}`).join(";")}`;

export function attachFields(engine: Engine, o: { clock?: ReadonlySignal<number> }): void {
  const v3 = (hex: string) =>
    rgb(hex)
      .map((x) => x.toFixed(4))
      .join(", ");
  const fields = new Fields(engine.device, engine.target, engine.frameU.layout, {
    ROW: "0.70",
    JITTER: "2.4",
    SEASON: DAYS_PER_SEASON.toFixed(1),
    SOIL: v3(FIELD_COLORS.soil),
    SOIL_DRY: v3(FIELD_COLORS.soilDry),
    SHOOT: v3(FIELD_COLORS.shoot),
    CROP: v3(FIELD_COLORS.crop),
    RIPE: v3(FIELD_COLORS.ripe),
    STRAW: v3(FIELD_COLORS.straw),
    STUBBLE: v3(FIELD_COLORS.stubbleRow),
    GRASS: v3(FIELD_COLORS.grass),
    FALLOW: v3(FIELD_COLORS.fallow),
    FALLOW_DRY: v3(FIELD_COLORS.fallowDry),
  });
  engine.drawables.push(fields);
  const shapes = new Map<string, ReturnType<typeof buildFieldMesh>>(); // by field id and outline
  let working = new Set<number>();
  let want = ""; // what the mesh should show: the fields' revision, the farms and the frame
  let have = "";
  let wait = 0;
  let vertices = new Float32Array(0);
  let ranges: { id: number; at: number; cnt: number }[] = []; // each field's vertices in the mesh
  let progress: Record<number, { sown: number; harv: number }> = {}; // the sim's real work, by field id
  const fake = new Map<number, { sown: number; harv: number }>(); // devtools: overrides of the real work
  let progKey = ""; // what the work in the mesh shows
  let originKey = "";
  const seat = new GroundSeat(engine);

  effect(() => {
    const z = zones.value;
    const fs = z?.fields ?? [];
    const assign = assignFields(fs, buildings.value ?? {});
    working = new Set(assign.keys());
    want = `${frame.value ? 1 : 0}|${z?.rev ?? 0}|${fs.length}|${[...assign].join(",")}`;
  });
  effect(() => {
    progress = state.value?.fieldProgress ?? {};
  });
  effect(() => {
    void frame.value;
    shapes.clear();
    have = "";
  });

  // Builds the one mesh of all the fields; false while the ground under them streams.
  const build = (tf: Frame): boolean => {
    const list = zones.peek()?.fields ?? [];
    const parts = list.map((f) => {
      const key = shapeKey(f);
      let m = shapes.get(key);
      if (!m) shapes.set(key, (m = buildFieldMesh(f.pts as XY[])));
      return { f, m };
    });
    if (shapes.size > list.length * 2 + 8) {
      const live = new Set(list.map(shapeKey));
      for (const key of shapes.keys()) if (!live.has(key)) shapes.delete(key);
    }
    let n = 0;
    for (const { m } of parts) n += m.xy.length / 2;
    const at: [number, number][] = [];
    for (const { m } of parts) for (let v = 0; v < m.xy.length / 2; v++) at.push(tf.toLngLat(m.xy[v * 2], m.xy[v * 2 + 1]));
    const ground = at.map(([lng, lat]) => engine.groundAt(lat, lng));
    if (ground.some((h) => h === null)) return false;
    seat.cover(at.map(([lng, lat]) => [lat, lng] as const));
    seat.seated();
    const [lng0, lat0] = tf.toLngLat(0, 0);
    const or = geodeticToEcef(lat0, lng0, 0);
    const { east, north, up } = enuAt(lat0, lng0);
    const out = new Float32Array(n * FIELD_VERTEX_FLOATS);
    const index: number[] = [];
    const rs: typeof ranges = [];
    const p: Vec3 = [0, 0, 0];
    let k = 0;
    for (const { f, m } of parts) {
      const cnt = m.xy.length / 2;
      if (!cnt) continue;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of f.pts) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
      const cx = Math.round((x0 + x1) / 2);
      const cy = Math.round((y0 + y1) / 2); // the origin of the field's own coordinates
      const shift = cx * m.dir[0] + cy * m.dir[1];
      const hsh = ((Math.imul(f.id + 1, 2654435761) >>> 0) % 100000) / 100000;
      const worked = working.has(f.id) ? 1 : 0;
      rs.push({ id: f.id, at: k, cnt });
      for (let v = 0; v < cnt; v++, k++) {
        const [lng, lat] = at[k];
        geodeticToEcef(lat, lng, ground[k]! + LIFT, p);
        const d: Vec3 = [p[0] - or[0], p[1] - or[1], p[2] - or[2]];
        const x = m.xy[v * 2];
        const y = m.xy[v * 2 + 1];
        out.set([dot(d, east), dot(d, north), dot(d, up), x - cx, y - cy, m.dir[0], m.dir[1], worked, hsh, m.along[0] - shift, m.along[1] - shift, m.edge[v], 0, 0], k * FIELD_VERTEX_FLOATS);
      }
      for (const i of m.index) index.push(i + k - cnt);
    }
    vertices = out;
    ranges = rs;
    progKey = "";
    fields.setOrigin(lat0, lng0);
    fields.setMesh(vertices, Uint32Array.from(index));
    return true;
  };

  const workOf = (id: number) => fake.get(id) ?? progress[id] ?? { sown: 0, harv: 0 };
  // Writes the real progress into the vertices; only when it has changed (the sim sends it in steps of 2%).
  const syncWork = () => {
    const key = ranges
      .map((r) => {
        const w = workOf(r.id);
        return `${w.sown},${w.harv}`;
      })
      .join("|");
    if (key === progKey) return;
    progKey = key;
    for (const r of ranges) {
      const w = workOf(r.id);
      for (let v = r.at; v < r.at + r.cnt; v++) {
        vertices[v * FIELD_VERTEX_FLOATS + FIELD_WORK_OFFSET] = w.sown;
        vertices[v * FIELD_VERTEX_FLOATS + FIELD_WORK_OFFSET + 1] = Math.min(w.harv, w.sown);
      }
    }
    fields.rewrite(vertices);
  };

  engine.onBeforeFrame(() => {
    const tf = frame.peek();
    const mpp = engine.metersPerPixel();
    if (!tf || !fields3dOn.peek() || mpp > FIELD_MPP) {
      fields.look = null;
      return;
    }
    const [lng0, lat0] = tf.toLngLat(0, 0);
    const okey = `${lng0},${lat0}`;
    if (okey !== originKey) {
      originKey = okey;
      have = "";
    }
    if (want === have && wait-- <= 0) {
      wait = RETRY_FRAMES;
      if (seat.finer()) (have = ""), (wait = 0); // finer ground than the fields were draped on: drape them again
    }
    if (want !== have && wait-- <= 0) {
      if (build(tf)) have = want;
      else wait = RETRY_FRAMES;
    }
    syncWork();
    const cal = calendar(o.clock?.peek() ?? 0);
    const lit = townLight(fields.toLocal(engine.light(engine.state).sun));
    const t = Math.min(1, Math.max(0, (zoomAtMpp(mpp) - zoomAtMpp(FIELD_MPP)) / (FIELD_FULL_ZOOM - zoomAtMpp(FIELD_MPP))));
    fields.look = {
      light: lit.light,
      sunStrength: lit.strength,
      daylight: lit.daylight,
      day: cal.dayOfYear - 1 + (cal.hour * 60 + cal.minute) / 1440,
      fadeIn: t * t * (3 - 2 * t),
      far: FAR,
    };
  });

  // devtools: engineFields.fake(id | "all", sown, harv) overrides a field's work (0..1 of its area; harv <= sown),
  // engineFields.fake() clears it. Set the stage with the admin season preview (calendar) or wait for the real date.
  if (import.meta.env.DEV)
    Object.assign(window, {
      engineFields: {
        stats: () => ({ fields: ranges.length, worked: working.size, verts: vertices.length / FIELD_VERTEX_FLOATS, drawn: !!fields.look, progress, fake: Object.fromEntries(fake) }),
        fake: (id?: number | "all", sown = 1, harv = 0) => {
          if (id === undefined) fake.clear();
          else for (const r of id === "all" ? ranges : ranges.filter((q) => q.id === id)) fake.set(r.id, { sown, harv });
        },
      },
    });
}
