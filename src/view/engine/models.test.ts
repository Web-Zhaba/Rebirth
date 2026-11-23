import type { Signal } from "@preact/signals";
import { expect, it, vi } from "vitest";
import type { Engine } from "../../engine/engine";
import type { ModelItem } from "../../map/modelItems";
import { DEFAULT_FLAG } from "../../sim/heraldry";
import { frame } from "../../simClient";
import { makeFrame, type Frame } from "../../world/frame";
import { buildingItems } from "../layers/buildings";
import { roadItems } from "../layers/roads";
import { attachModels } from "./models";

vi.mock("../../simClient", async () => ({ frame: (await import("@preact/signals")).signal(null) }));
vi.mock("../layers/buildings", async () => ({ buildingItems: (await import("@preact/signals")).signal([]) }));
vi.mock("../layers/roads", async () => ({ roadItems: (await import("@preact/signals")).signal([]) }));
vi.mock("../layers/ruins", async () => ({ ruinWallPieces: (await import("@preact/signals")).signal([]) }));
vi.mock("../../engine/scene/townMesh", () => ({
  TOWN_VERTEX_FLOATS: 15,
  TownMesh: class {
    setOrigin() {}
    setRoads = vi.fn();
    setBuildings = vi.fn();
    toLocal = () => [0, 0, 1];
  },
}));
vi.hoisted(() => vi.stubGlobal("window", {}));

it("uploads only the changed model group and rebuilds both after the origin changes", () => {
  let draw!: (now: number) => void;
  const engine = {
    frameU: {},
    drawables: [],
    terrain: { pages: { hold() {}, release() {}, has: () => true } },
    groundAt: () => 0,
    groundZoomAt: () => 11,
    metersPerPixel: () => 1000,
    light: () => ({ sun: [0, 0, 1] }),
    onBeforeFrame: (callback: typeof draw) => (draw = callback),
  } as unknown as Engine;
  const origin = frame as Signal<Frame | null>;
  const buildings = buildingItems as Signal<ModelItem[]>;
  const roads = roadItems as Signal<ModelItem[]>;
  const house: ModelItem = { id: 1, ring: [[0, 4], [8, 4], [8, 12], [0, 12]], height: 4, kind: "izba", style: "town", progress: 0.25 };
  origin.value = makeFrame(50, 30);
  buildings.value = [house];
  roads.value = [{ id: 2, ring: [[0, 0], [20, 0]], height: 0, kind: "path", style: "road", progress: 1 }];
  const mesh = attachModels(engine, {});
  draw(0);
  expect(mesh.setRoads).toHaveBeenCalledTimes(1);
  expect(mesh.setBuildings).toHaveBeenCalledTimes(1);

  buildings.value = [{ ...house, progress: 0.5 }];
  draw(1);
  expect(mesh.setRoads).toHaveBeenCalledTimes(1);
  expect(mesh.setBuildings).toHaveBeenCalledTimes(2);

  origin.value = makeFrame(51, 31);
  draw(2);
  expect(mesh.setRoads).toHaveBeenCalledTimes(2);
  expect(mesh.setBuildings).toHaveBeenCalledTimes(3);

  const hall: ModelItem = { ...house, kind: "townhall", progress: 1, flag: DEFAULT_FLAG };
  buildings.value = [hall];
  draw(3);
  buildings.value = [{ ...hall, flag: { ...DEFAULT_FLAG, field: "#884422" } }];
  draw(4);
  expect(mesh.setBuildings).toHaveBeenCalledTimes(5);
  expect(mesh.setRoads).toHaveBeenCalledTimes(2);
  buildings.value = [structuredClone(buildings.value[0])];
  draw(5);
  expect(mesh.setBuildings).toHaveBeenCalledTimes(5);
});
