import { sphereInside, type Vec3 } from "./three/frame";

// The square chunks of the plane the camera sees, for the 3D layers that build their content chunk by chunk (trees,
// water). Tested against the camera's frustum (three/frame.ts frustumPlanes), which holds on the relief too, where the
// sky has no ground point; coarse blocks of BLOCK x BLOCK chunks first.

const BLOCK = 8;

export interface ChunkView {
  planes: Float64Array;
  eye: Vec3; // mercator frame of the models (metres)
  at: readonly [number, number]; // the eye in town metres
  far: number; // m: no chunk beyond
  size: number; // m, side of a chunk in town metres
  rise: number; // m: what stands on the ground (a tree's height), 0 for the ground itself
  slope: number; // m: how much the ground may rise or fall within a chunk, or under one whose ground is unknown
  // town metres -> the mercator frame, on the ground
  centre(x: number, y: number): [number, number, number];
}

// The chunks in view, each with its distance from the eye (m, at least 1), in no particular order.
export function chunksInView(v: ChunkView): { i: number; j: number; d: number }[] {
  const { planes, eye, far, size, rise, slope } = v;
  const [ex, ey] = v.at;
  const half = size * Math.SQRT1_2, bs = BLOCK * size, bhalf = bs * Math.SQRT1_2;
  const seen: { i: number; j: number; d: number }[] = [];
  for (let bi = Math.floor((ex - far) / bs); bi <= Math.floor((ex + far) / bs); bi++)
    for (let bj = Math.floor((ey - far) / bs); bj <= Math.floor((ey + far) / bs); bj++) {
      const bx = (bi + 0.5) * bs, by = (bj + 0.5) * bs;
      if (Math.hypot(bx - ex, by - ey) - bhalf > far) continue;
      const [x, y, z] = v.centre(bx, by);
      if (!sphereInside(planes, x, y, z + rise, bhalf + slope + rise)) continue;
      for (let i = bi * BLOCK; i < (bi + 1) * BLOCK; i++)
        for (let j = bj * BLOCK; j < (bj + 1) * BLOCK; j++) {
          const cx = (i + 0.5) * size, cy = (j + 0.5) * size;
          if (Math.hypot(cx - ex, cy - ey) - half > far) continue;
          const [mx, my, mz] = v.centre(cx, cy);
          if (!sphereInside(planes, mx, my, mz + rise, half + slope + rise)) continue;
          seen.push({ i, j, d: Math.max(1, Math.hypot(mx - eye[0], my - eye[1], mz - eye[2])) });
        }
    }
  return seen;
}
