export interface NatureObstacle {
  x: number;
  y: number;
  base: number;
  height: number;
  radius: number;
}

const treeChunks = new Map<string, readonly NatureObstacle[]>();

const keyOf = (i: number, j: number) => `${i},${j}`;

export function setTreeCollisionChunk(
  i: number,
  j: number,
  obstacles: readonly NatureObstacle[],
): void {
  treeChunks.set(keyOf(i, j), obstacles);
}

export function removeTreeCollisionChunk(i: number, j: number): void {
  treeChunks.delete(keyOf(i, j));
}

export function clearTreeCollisionChunks(): void {
  treeChunks.clear();
}

/** Highest obstacle intersecting the camera's horizontal footprint and vertical column. */
export function treeObstacleTopAt(
  x: number,
  y: number,
  altitude: number,
): number | null {
  let top: number | null = null;

  // Each collision chunk is 200m wide. Only inspect the chunks which can
  // overlap a 4m camera footprint; avoid scanning all visible forest instances.
  const ci = Math.floor(x / 200);
  const cj = Math.floor(y / 200);

  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const obstacles = treeChunks.get(keyOf(i, j));
      if (!obstacles) continue;

      for (const obstacle of obstacles) {
        const dx = obstacle.x - x;
        const dy = obstacle.y - y;
        const radius = obstacle.radius + 2.5;
        if (dx * dx + dy * dy > radius * radius) continue;

        const obstacleTop = obstacle.base + obstacle.height + 4;
        if (
          altitude >= obstacle.base - 1 &&
          altitude < obstacleTop &&
          (top === null || obstacleTop > top)
        ) {
          top = obstacleTop;
        }
      }
    }
  }

  return top;
}
