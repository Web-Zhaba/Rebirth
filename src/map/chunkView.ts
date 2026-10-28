import { sphereInside, type Vec3 } from "./three/frame";

const BLOCK = 8;

export interface ChunkView {
  planes: Float64Array;
  eye: Vec3;
  at: readonly [number, number];
  far: number;
  size: number;
  rise: number;
  slope: number;
  // Заполняет переданный буфер [mx, my, mz] без создания новых объектов
  centre(x: number, y: number, out: [number, number, number]): void;
}

const tempVec: [number, number, number] = [0, 0, 0];

export function chunksInView(v: ChunkView): { i: number; j: number; d: number }[] {
  const { planes, eye, far, size, rise, slope } = v;
  const [ex, ey] = v.at;
  const half = size * Math.SQRT1_2, bs = BLOCK * size, bhalf = bs * Math.SQRT1_2;
  const seen: { i: number; j: number; d: number }[] = [];

  for (let bi = Math.floor((ex - far) / bs); bi <= Math.floor((ex + far) / bs); bi++) {
    for (let bj = Math.floor((ey - far) / bs); bj <= Math.floor((ey + far) / bs); bj++) {
      const bx = (bi + 0.5) * bs, by = (bj + 0.5) * bs;
      if (Math.hypot(bx - ex, by - ey) - bhalf > far) continue;

      v.centre(bx, by, tempVec);
      if (!sphereInside(planes, tempVec[0], tempVec[1], tempVec[2] + rise, bhalf + slope + rise)) continue;

      for (let i = bi * BLOCK; i < (bi + 1) * BLOCK; i++) {
        for (let j = bj * BLOCK; j < (bj + 1) * BLOCK; j++) {
          const cx = (i + 0.5) * size, cy = (j + 0.5) * size;
          if (Math.hypot(cx - ex, cy - ey) - half > far) continue;

          v.centre(cx, cy, tempVec);
          const mx = tempVec[0], my = tempVec[1], mz = tempVec[2];

          if (!sphereInside(planes, mx, my, mz + rise, half + slope + rise)) continue;

          seen.push({
            i,
            j,
            d: Math.max(1, Math.hypot(mx - eye[0], my - eye[1], mz - eye[2])),
          });
        }
      }
    }
  }
  return seen;
}