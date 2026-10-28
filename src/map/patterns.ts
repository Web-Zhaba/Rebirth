import type * as maplibregl from "maplibre-gl";
import { PALETTE } from "../ui/palette";

// Hatch patterns for the zone and field fills, so zone kinds differ by texture and not by color alone:
// residential = dots, craft = diagonal hatch, trade = cross-hatch, field = furrows.
export const PATTERNS = { res: "pat-res", craft: "pat-craft", trade: "pat-trade", field: "pat-field" } as const;

const SIZE = 12;

function draw(paint: (c: CanvasRenderingContext2D) => void): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.strokeStyle = c.fillStyle = PALETTE.ink;
  c.globalAlpha = 0.55;
  c.lineWidth = 1;
  paint(c);
  return c.getImageData(0, 0, SIZE, SIZE);
}

const makers: Record<string, (c: CanvasRenderingContext2D) => void> = {
  [PATTERNS.res]: (c) => {
    for (const [x, y] of [[3, 3], [9, 9]]) c.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
  },
  [PATTERNS.craft]: (c) => {
    c.beginPath();
    c.moveTo(0, SIZE);
    c.lineTo(SIZE, 0);
    c.moveTo(-2, 2);
    c.lineTo(2, -2);
    c.moveTo(SIZE - 2, SIZE + 2);
    c.lineTo(SIZE + 2, SIZE - 2);
    c.stroke();
  },
  [PATTERNS.trade]: (c) => {
    c.beginPath();
    c.moveTo(0, 6.5);
    c.lineTo(SIZE, 6.5);
    c.moveTo(6.5, 0);
    c.lineTo(6.5, SIZE);
    c.stroke();
  },
  [PATTERNS.field]: (c) => {
    c.beginPath();
    for (const y of [2.5, 8.5]) {
      c.moveTo(0, y);
      c.lineTo(SIZE, y);
    }
    c.stroke();
  },
};

export function addPatterns(map: maplibregl.Map): void {
  for (const [id, paint] of Object.entries(makers)) {
    if (map.hasImage(id)) continue;
    const img = draw(paint);
    if (img) map.addImage(id, img);
  }
}
