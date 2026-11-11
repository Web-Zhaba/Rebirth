import { ADULT_MIN } from "../sim/people";
import { rgb, rng, type RGB } from "./modelGeometry";

// Residents of the town (sim/people.ts) as low-poly figures: a faceted head with hair and sometimes a hat on a short
// neck, a body that narrows from the shoulders to a belted waist, sleeves ending in ball hands, two peg legs and two
// elongated ball feet. The look (sex, age, stature, hair, clothes) comes from a seed, so one resident keeps the same
// look as they grow. A pose is a rigid motion of each part, so the preview (engine/debug/villagers.ts) only uploads
// what writeVillager() writes. Pure maths. Units: metres of the figure, feet on y = 0, facing +z.

export type Vec3 = [number, number, number];
export type Action = "idle" | "walk" | "work" | "carry" | "sleep";
export const ACTIONS: readonly Action[] = ["idle", "walk", "work", "carry", "sleep"];
export type Sex = "m" | "f";
export type HairStyle = "bald" | "cap" | "long" | "bun";
export type Hat = "none" | "brim" | "cloth" | "scarf"; // a brimmed straw hat, a cloth cap, a headscarf

export interface Look {
  sex: Sex;
  age: number; // years
  stature: number; // m
  scale: number; // figure metres -> the villager's stature
  childness: number; // 0 for a grown-up .. 1 for a newborn: a big head and short limbs
  skin: RGB;
  hair: RGB;
  hairStyle: HairStyle;
  beard: boolean;
  shirt: RGB;
  trousers: RGB;
  skirt: RGB | null;
  shoes: RGB;
  hat: Hat;
  hatColour: RGB;
  belt: RGB;
}

export const PART = { head: 0, torso: 1, armL: 2, armR: 3, footL: 4, footR: 5, legL: 6, legR: 7 } as const;

export interface Rig {
  look: Look;
  data: Float32Array; // 9 floats per vertex: position, normal, colour (figure metres, display colour like the town's)
  vertices: number;
  parts: { start: number; count: number }[]; // indexed by PART, in vertices
  top: number; // highest point, figure metres
  minZ: number; // rearmost point: where the figure touches the ground once it lies down
}

export type Mat = number[]; // row-major 3x3 rotation
export interface Affine {
  m: Mat;
  t: Vec3; // v -> m v + t
}

const REF_STATURE = 1.74; // m, the figure's standing height at scale 1
const BODY_R = 0.215; // half the width across the shoulders: chunky, so a figure a few pixels tall still reads
const BODY_DEPTH = 0.74; // front-to-back depth relative to the width
const HIP_Y = 0.72; // where the legs turn; the body closes a little below
const WAIST = 0.8; // trousers below, shirt above: a straight belt line
const SHOULDER_Y = 1.3;
const SHOULDER_X = BODY_R + 0.035;
const NECK_TOP = 1.5;
const HEAD_Y = 1.6;
const ARM_LEN = 0.36; // shoulder to the hand's centre
const HIP_X = 0.1;
const ANKLE_Y = 0.07;
const WALK_HZ = 0.9; // full strides per second
const SWING = 0.5; // arm swing, rad
const STRIDE = 0.17; // foot travel, m
const LIFT = 0.05; // foot lift, m

const SKIN = ["#f1d2b3", "#e0b48c", "#c68e5e", "#9c6a43", "#6e4a2e"].map(rgb);
const HAIR = ["#2b1d14", "#4a3424", "#7a5635", "#b8925a", "#d9c28a"].map(rgb);
const GREY = ["#8d8d8a", "#c9c5bd", "#e5e2da"].map(rgb);
const SHIRT = ["#8c6e4a", "#5f7a5a", "#7b5a6e", "#a7a08f", "#6d7f8f", "#9a5b3e", "#c2b48f", "#4f5d6b"].map(rgb);
const TROUSERS = ["#4e4439", "#3d4a58", "#6a5a3e", "#5b4a3a", "#2f3a33"].map(rgb);
const SKIRT = ["#7a4b35", "#4f5d6b", "#8a6a3d", "#6e5a6e", "#5a6a4a"].map(rgb);
const SHOES = ["#3b2b20", "#2d2a26", "#5a4632"].map(rgb);
const STRAW = ["#d8c27a", "#c9ad63", "#e0cf98"].map(rgb);
const BELT = ["#3a2a1c", "#5b4630", "#2b2622"].map(rgb);
const MALE_HAIR: HairStyle[] = ["cap", "cap", "bald"];
const FEMALE_HAIR: HairStyle[] = ["long", "bun", "cap"];

// The look of the resident with this seed at this age (and sex, when it is known: the preview draws one at random).
// Every draw happens in the same order whatever the age, so a growing child keeps their colours and hair.
export function villagerLook(seed: number, age: number, known?: Sex): Look {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const drawn: Sex = rand() < 0.5 ? "m" : "f";
  const sex = known ?? drawn;
  const build = 0.94 + 0.12 * rand();
  const skin = pick(SKIN);
  const brown = pick(HAIR);
  const silver = pick(GREY);
  const greying = rand() < 0.6;
  const hairStyle = pick(sex === "f" ? FEMALE_HAIR : MALE_HAIR);
  const beardRoll = rand();
  const shirt = pick(SHIRT);
  const trousers = pick(TROUSERS);
  const skirtRoll = rand();
  const skirt = pick(SKIRT);
  const shoes = pick(SHOES);
  // Later draws go last, so the looks drawn before them stay as they were.
  const hatRoll = rand();
  const straw = pick(STRAW);
  const cloth = pick(SKIRT);
  const belt = pick(BELT);
  const hat: Hat = age < 8 ? "none" : sex === "m" ? (hatRoll < 0.25 ? "brim" : hatRoll < 0.42 ? "cloth" : "none") : hatRoll < 0.32 ? "scarf" : hatRoll < 0.44 ? "brim" : "none";

  const grown = Math.min(1, age / ADULT_MIN);
  const elder = age > 60 ? Math.max(0.9, 1 - 0.005 * (age - 60)) : 1;
  const stature = (sex === "m" ? 1.74 : 1.62) * build * (0.35 + 0.65 * grown) * elder;
  return {
    sex,
    age,
    stature,
    scale: stature / REF_STATURE,
    childness: 1 - grown,
    skin,
    hair: age > 55 && greying ? silver : brown,
    hairStyle,
    beard: sex === "m" && age >= ADULT_MIN && beardRoll < 0.55,
    shirt,
    trousers,
    skirt: sex === "f" && age >= 6 && skirtRoll < 0.7 ? skirt : null,
    shoes,
    hat,
    hatColour: hat === "brim" ? straw : cloth,
    belt,
  };
}

// ---- geometry: flat-shaded triangles, built once per look ----

type Tri = [Vec3, Vec3, Vec3];
type Colour = RGB | ((centroid: Vec3) => RGB);
interface Piece {
  tris: Tri[];
  colour: Colour;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const centroid = (t: Tri): Vec3 => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];

// Points of a circle of radius r centred at height cy, from angle `from` to `to`: the profile of lathe().
const arc = (r: number, cy: number, from: number, to: number, steps: number): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [r * Math.cos(a), cy + r * Math.sin(a)];
  });

// A surface of revolution around the y axis: profile = [radius, height] pairs, sampled on `seg` sides. Low `seg`
// gives the angular look.
function lathe(profile: readonly [number, number][], seg = 7): Tri[] {
  const at = (r: number, y: number, k: number): Vec3 => {
    const a = (2 * Math.PI * k) / seg;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  const tris: Tri[] = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    for (let k = 0; k < seg; k++) {
      const a = at(r0, y0, k), b = at(r1, y1, k), c = at(r1, y1, k + 1), d = at(r0, y0, k + 1);
      tris.push([a, b, c], [a, c, d]);
    }
  }
  return tris;
}

const scaled = (tris: Tri[], s: Vec3, o: Vec3): Tri[] => {
  const at = (v: Vec3): Vec3 => [v[0] * s[0] + o[0], v[1] * s[1] + o[1], v[2] * s[2] + o[2]];
  return tris.map(([a, b, c]) => [at(a), at(b), at(c)]);
};

// Winding so that every face looks away from the piece's centre (the faces are convex). Degenerate faces go.
function outward(tris: Tri[], centre: Vec3): Tri[] {
  const out: Tri[] = [];
  for (const t of tris) {
    const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) continue;
    out.push(dot(n, sub(centroid(t), centre)) < 0 ? [t[0], t[2], t[1]] : t);
  }
  return out;
}

const piece = (tris: Tri[], centre: Vec3, colour: Colour): Piece => ({ tris: outward(tris, centre), colour });

// The profile of a body cut at height y: the points below and above, both holding the ring at y where it crosses.
function cutAt(profile: [number, number][], y: number): [[number, number][], [number, number][]] {
  const below: [number, number][] = [];
  const above: [number, number][] = [];
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i];
    if (p[1] <= y) below.push(p);
    if (p[1] >= y) above.push(p);
    const q = profile[i + 1];
    if (q && (p[1] - y) * (q[1] - y) < 0) {
      const t = (y - p[1]) / (q[1] - p[1]);
      const ring: [number, number] = [p[0] + t * (q[0] - p[0]), y];
      below.push(ring);
      above.push(ring);
    }
  }
  return [below, above];
}

// How finely a figure is cut: sides around an axis and steps along a ball's arc. The coarse one is for figures a
// dozen pixels tall, where the silhouette is all that shows.
export type Detail = 0 | 1;
interface Cut {
  seg: number;
  steps: number;
}
const CUTS: Record<Detail, Cut> = { 0: { seg: 4, steps: 2 }, 1: { seg: 6, steps: 3 } };

// A solid of revolution around the body's axis, flattened front to back, in one colour.
function solidOfRevolution(profile: [number, number][], colour: RGB, q: Cut): Piece {
  const ys = profile.map((p) => p[1]);
  const centre: Vec3 = [0, (Math.min(...ys) + Math.max(...ys)) / 2, 0];
  return piece(scaled(lathe(profile, q.seg), [1, 1, BODY_DEPTH], [0, 0, 0]), centre, colour);
}

// An ellipsoid (or, with `dome`, its upper half) at c with radii r.
const ellipsoid = (c: Vec3, r: Vec3, colour: Colour, q: Cut, dome = false): Piece => {
  const profile = dome ? arc(1, 0, 0, Math.PI / 2, q.steps) : arc(1, 0, -Math.PI / 2, Math.PI / 2, q.steps);
  return piece(scaled(lathe(profile, q.seg), r, c), c, colour);
};

// A closed upright peg around the vertical through (x, z): radius r0 at height y0, r1 at y1.
const peg = (x: number, z: number, y0: number, r0: number, y1: number, r1: number, colour: Colour, q: Cut): Piece =>
  piece(scaled(lathe([[0, y0], [r0, y0], [r1, y1], [0, y1]], q.seg - 1), [1, 1, 1], [x, 0, z]), [x, (y0 + y1) / 2, z], colour);

// Packs the pieces of each part into the rig's vertex buffer, in figure metres.
function flatten(parts: Piece[][]): Pick<Rig, "data" | "vertices" | "parts" | "top" | "minZ"> {
  let vertices = 0;
  for (const list of parts) for (const p of list) vertices += 3 * p.tris.length;
  const data = new Float32Array(vertices * 9);
  const ranges: Rig["parts"] = [];
  let v = 0;
  let top = -Infinity;
  let minZ = Infinity;
  for (const list of parts) {
    const start = v;
    for (const p of list)
      for (const t of p.tris) {
        const n = unit(cross(sub(t[1], t[0]), sub(t[2], t[0])));
        const c = typeof p.colour === "function" ? p.colour(centroid(t)) : p.colour;
        for (const q of t) {
          data.set([q[0], q[1], q[2], n[0], n[1], n[2], c[0], c[1], c[2]], v * 9);
          top = Math.max(top, q[1]);
          minZ = Math.min(minZ, q[2]);
          v++;
        }
      }
    ranges.push({ start, count: v - start });
  }
  return { data, vertices, parts: ranges, top, minZ };
}

export function buildRig(look: Look, detail: Detail = 1): Rig {
  const q = CUTS[detail];
  const c = look.childness;
  const head = 1 + 0.25 * c; // a child's head is big for the body
  const limb = 1 - 0.1 * c;
  const body = BODY_R * (1 - 0.12 * c);
  const skin = look.skin;
  const hair = look.hair;
  const woman = look.sex === "f" && c < 0.4;

  const covered = look.hat === "cloth" || look.hat === "scarf"; // cloth over the hair
  const top = covered ? look.hatColour : hair;
  const headParts: Piece[] = [ellipsoid([0, HEAD_Y, 0], [0.12 * head, 0.135 * head, 0.12 * head], skin, q)];
  if (look.hairStyle !== "bald" || covered) headParts.push(ellipsoid([0, HEAD_Y + 0.012 * head, -0.004 * head], [0.128 * head, 0.14 * head, 0.136 * head], top, q, true));
  if (look.hairStyle === "long" || look.hat === "scarf") headParts.push(ellipsoid([0, HEAD_Y - 0.1 * head, -0.085 * head], [0.12 * head, 0.17 * head, 0.05 * head], look.hat === "scarf" ? top : hair, q));
  if (look.hairStyle === "bun" && look.hat === "none") headParts.push(ellipsoid([0, HEAD_Y + 0.14 * head, -0.075 * head], [0.065 * head, 0.065 * head, 0.065 * head], hair, q));
  if (look.beard) headParts.push(ellipsoid([0, HEAD_Y - 0.1 * head, 0.08 * head], [0.085 * head, 0.085 * head, 0.075 * head], hair, q));
  if (look.hat === "brim") {
    const y = HEAD_Y + 0.07 * head;
    headParts.push(peg(0, 0, y, 0.24 * head, y + 0.02, 0.23 * head, look.hatColour, q));
    headParts.push(ellipsoid([0, y + 0.01, 0], [0.135 * head, 0.11 * head, 0.135 * head], look.hatColour, q, true));
  }

  // The body: closed under the hips, widest at the shoulders, drawn in to a neck. It is cut at the waist into two
  // pieces that share the ring there, so the belt line is straight: trousers below, shirt above.
  const hips = body * (woman ? 0.95 : 0.86);
  const waist = body * (woman ? 0.76 : 0.84);
  const profile: [number, number][] = [
    [0, HIP_Y - 0.1],
    [hips, HIP_Y - 0.04],
    [waist, WAIST + 0.06],
    [body * 0.96, 1.14],
    [body, SHOULDER_Y],
    [body * 0.62, SHOULDER_Y + 0.1],
    [0.062 * head, SHOULDER_Y + 0.14],
    [0.058 * head, NECK_TOP],
  ];
  const [pelvis, upper] = cutAt(profile, WAIST);
  const [shirt, neck] = cutAt(upper, SHOULDER_Y + 0.14);
  const torso: Piece[] = [solidOfRevolution(pelvis, look.trousers, q), solidOfRevolution(shirt, look.shirt, q), solidOfRevolution(neck, skin, q)];
  if (look.skirt) torso.push(piece(lathe([[body * 1.3, 0.3], [body * 1.08, 0.56], [waist * 1.04, WAIST + 0.02]], q.seg), [0, 0.5, 0], look.skirt));
  else if (detail) torso.push(piece(scaled(lathe([[waist * 1.05, WAIST - 0.035], [waist * 1.05, WAIST + 0.035]], q.seg), [1, 1, BODY_DEPTH], [0, 0, 0]), [0, WAIST, 0], look.belt));

  // Sleeves from the shoulder down to a ball hand; legs from the hip down into the shoes.
  const hand = SHOULDER_Y - ARM_LEN * limb;
  const arm = (x: number) => [peg(x, 0, hand + 0.03, 0.05 * limb, SHOULDER_Y + 0.03, 0.066 * limb, look.shirt, q), ellipsoid([x, hand, 0], [0.058 * limb, 0.066 * limb, 0.058 * limb], skin, q)];
  const leg = (x: number) => [peg(x, 0, ANKLE_Y, 0.062 * limb, HIP_Y + 0.02, 0.092 * limb, look.trousers, q)];
  const foot = (x: number) => [ellipsoid([x, 0.05, 0.03], [0.06 * limb, 0.05 * limb, 0.105 * limb], look.shoes, q)];

  return {
    look,
    ...flatten([headParts, torso, arm(-SHOULDER_X), arm(SHOULDER_X), foot(-HIP_X), foot(HIP_X), leg(-HIP_X), leg(HIP_X)]),
  };
}

// ---- poses ----

const I3: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO: Vec3 = [0, 0, 0];
const HEAD_PIVOT: Vec3 = [0, 1.45, 0];
const HIP_PIVOT: [Vec3, Vec3] = [
  [-HIP_X, HIP_Y, 0],
  [HIP_X, HIP_Y, 0],
];
const ARM_PIVOT: [Vec3, Vec3] = [
  [-SHOULDER_X, SHOULDER_Y, 0],
  [SHOULDER_X, SHOULDER_Y, 0],
];

export const rotX = (a: number): Mat => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
export const rotY = (a: number): Mat => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
export const rotZ = (a: number): Mat => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
export function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
const apply = (m: Mat, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// A part turned by r about its pivot (rest position), then moved by t.
const turned = (r: Mat, pivot: Vec3, t: Vec3): Affine => {
  const rp = apply(r, pivot);
  return { m: r, t: [pivot[0] + t[0] - rp[0], pivot[1] + t[1] - rp[1], pivot[2] + t[2] - rp[2]] };
};

const compose = (outer: Affine, inner: Affine): Affine => {
  const t = apply(outer.m, inner.t);
  return { m: mul(outer.m, inner.m), t: [t[0] + outer.t[0], t[1] + outer.t[1], t[2] + outer.t[2]] };
};

// The parts (PART order) of the figure doing `action` at `time` seconds.
export function poseOf(rig: Rig, action: Action, time: number): Affine[] {
  const w = 2 * Math.PI * WALK_HZ * time;
  const stride = (ph: number): Vec3 => [0, LIFT * Math.max(0, Math.cos(ph)), STRIDE * Math.sin(ph)];
  const walkBob = (0.012 * (1 - Math.cos(2 * w))) / 2;
  const breath = 0.005 * Math.sin((2 * Math.PI * time) / 3);

  let head = I3;
  let arms: [Mat, Mat] = [I3, I3];
  let feet: [Vec3, Vec3] = [ZERO, ZERO];
  let bob = breath;
  let lying = false;
  switch (action) {
    case "idle": {
      const sway = 0.04 * Math.sin(1.1 * time);
      head = rotY(0.3 * Math.sin(0.5 * time));
      arms = [rotZ(sway), rotZ(-sway)];
      break;
    }
    case "walk":
      feet = [stride(w), stride(w + Math.PI)];
      arms = [rotX(SWING * Math.sin(w)), rotX(-SWING * Math.sin(w))];
      bob += walkBob;
      break;
    case "carry":
      // Both hands hold something in front of the waist, arms in; the legs still walk.
      feet = [stride(w), stride(w + Math.PI)];
      arms = [mul(rotZ(0.25), rotX(-1.2)), mul(rotZ(-0.25), rotX(-1.2))];
      bob += walkBob;
      break;
    case "work": {
      // Hands rise slowly over the head, then chop down fast.
      const p = (time * 0.6) % 1;
      const a = p < 0.7 ? 0.3 - 2.9 * (p / 0.7) : -2.6 + 2.9 * ((p - 0.7) / 0.3);
      head = rotX(0.15);
      arms = [rotX(a), rotX(a)];
      bob = 0;
      break;
    }
    case "sleep":
      bob = 0;
      lying = true;
      break;
  }

  const b: Vec3 = [0, bob, 0];
  const parts: Affine[] = [
    turned(head, HEAD_PIVOT, b),
    turned(I3, ZERO, b),
    turned(arms[0], ARM_PIVOT[0], b),
    turned(arms[1], ARM_PIVOT[1], b),
    turned(I3, ZERO, feet[0]),
    turned(I3, ZERO, feet[1]),
    // a leg turns about the hip to where its foot stands
    turned(rotX(-Math.asin(feet[0][2] / (HIP_Y - ANKLE_Y))), HIP_PIVOT[0], b),
    turned(rotX(-Math.asin(feet[1][2] / (HIP_Y - ANKLE_Y))), HIP_PIVOT[1], b),
  ];
  if (!lying) return parts;
  // Lying on the back: the figure turns about x so the head points to -z, and it is lifted so its back touches y = 0.
  const down = { m: rotX(-Math.PI / 2), t: [0, -rig.minZ, rig.top / 2] as Vec3 };
  return parts.map((p) => compose(down, p));
}

// The pose turned into the town's east/north/up frame: the figure stands up along z and faces the horizontal direction
// (dx, dy), a unit vector. Poses, and so their vertices, are in the figure's own frame (y up, facing +z) otherwise.
export function orient(pose: Affine[], dx: number, dy: number): Affine[] {
  const basis: Affine = { m: [-dy, 0, dx, dx, 0, dy, 0, 1, 0], t: ZERO };
  return pose.map((p) => compose(basis, p));
}

// Writes the figure's vertices at `origin` (metres) into `out` from float index `at`. Returns the next index.
export function writeVillager(rig: Rig, pose: Affine[], origin: Vec3, out: Float32Array, at: number): number {
  const s = rig.look.scale;
  const d = rig.data;
  let o = at;
  for (let k = 0; k < rig.parts.length; k++) {
    const { m, t } = pose[k];
    const { start, count } = rig.parts[k];
    for (let i = start * 9, end = (start + count) * 9; i < end; i += 9) {
      const x = d[i], y = d[i + 1], z = d[i + 2];
      out[o] = s * (m[0] * x + m[1] * y + m[2] * z + t[0]) + origin[0];
      out[o + 1] = s * (m[3] * x + m[4] * y + m[5] * z + t[1]) + origin[1];
      out[o + 2] = s * (m[6] * x + m[7] * y + m[8] * z + t[2]) + origin[2];
      const nx = d[i + 3], ny = d[i + 4], nz = d[i + 5];
      out[o + 3] = m[0] * nx + m[1] * ny + m[2] * nz;
      out[o + 4] = m[3] * nx + m[4] * ny + m[5] * nz;
      out[o + 5] = m[6] * nx + m[7] * ny + m[8] * nz;
      out[o + 6] = d[i + 6];
      out[o + 7] = d[i + 7];
      out[o + 8] = d[i + 8];
      o += 9;
    }
  }
  return o;
}
