import { advanceTo } from "./clock";
import type { Cmd, FromWorker, ToWorker } from "./protocol";
import { addRoad, emptyRoads, removeEdge, ROAD_KINDS } from "./roads";
import { migrateLegacy, parseSaveV3 } from "./save";
import type { RoadGraph, SaveV3 } from "./types";

export interface Storage {
  get(): Promise<unknown>;
  put(save: SaveV3): Promise<void>;
  clear(): Promise<void>;
}

const AWAY_MIN_MS = 60_000;

export class Handler {
  private save: SaveV3 | null = null;

  constructor(
    private storage: Storage,
    private post: (msg: FromWorker) => void,
  ) {}

  async handle(msg: ToWorker): Promise<void> {
    try {
      switch (msg.t) {
        case "load":
          return await this.load(msg.legacy, msg.now);
        case "found": {
          const save: SaveV3 = { version: 3, city: msg.city, sim: { realTime: msg.now, gameMinutes: 0, roads: emptyRoads() } };
          this.save = save;
          await this.storage.put(save);
          this.post({ t: "loaded", save, migrated: false, away: null });
          return;
        }
        case "cmd":
          return await this.command(msg.id, msg.cmd);
        case "flush":
          if (this.save) await this.storage.put(this.save);
          return;
        case "reset":
          this.save = null;
          await this.storage.clear();
          this.post({ t: "resetDone" });
          return;
      }
    } catch (e) {
      this.post({ t: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private async load(legacy: string | null, now: number): Promise<void> {
    let save = parseSaveV3(await this.storage.get(), now);
    let migrated = false;
    if (!save && legacy) {
      save = migrateLegacy(legacy, now);
      if (save) {
        await this.storage.put(save);
        migrated = true;
      }
    }
    if (!save) {
      this.post({ t: "loaded", save: null, migrated: false, away: null });
      return;
    }
    const realMs = now - save.sim.realTime;
    const sim = advanceTo(save.sim, now);
    const gameMinutes = sim.gameMinutes - save.sim.gameMinutes;
    save = { ...save, sim };
    this.save = save;
    await this.storage.put(save);
    const away = realMs > AWAY_MIN_MS ? { realMs, gameMinutes } : null;
    this.post({ t: "loaded", save, migrated, away });
  }

  private async command(id: number, cmd: Cmd): Promise<void> {
    const reject = (reason: string) => this.post({ t: "cmdResult", id, ok: false, reason });
    try {
      if (!this.save) return reject("Нет поселения");
      const roads = this.save.sim.roads;
      let next: RoadGraph;
      if (cmd.type === "addRoad") {
        const bad = validateAddRoad(cmd);
        if (bad) return reject(bad);
        const r = addRoad(roads, cmd.pts, cmd.kind, cmd.snapTol, cmd.labor);
        if (!r.ok) return reject(r.reason);
        next = r.graph;
      } else if (cmd.type === "removeRoad") {
        if (!Object.hasOwn(roads.edges, cmd.edgeId)) return reject("Участок уже убран");
        next = removeEdge(roads, cmd.edgeId);
      } else {
        return reject("Неизвестная команда");
      }
      this.save = { ...this.save, sim: { ...this.save.sim, roads: next } };
      this.post({ t: "snapshot", sim: this.save.sim });
      try {
        await this.storage.put(this.save);
      } catch (e) {
        this.post({ t: "error", message: String(e) });
      }
      this.post({ t: "cmdResult", id, ok: true });
    } catch (e) {
      reject(e instanceof Error ? e.message : String(e));
    }
  }

  // Called by the worker timer every second.
  tick(now: number): void {
    if (!this.save) return;
    const sim = advanceTo(this.save.sim, now);
    if (sim.gameMinutes === this.save.sim.gameMinutes) return;
    this.save = { ...this.save, sim };
    this.post({ t: "snapshot", sim });
    this.storage.put(this.save).catch((e) => this.post({ t: "error", message: String(e) }));
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// The message crossed a thread boundary, so check the shape at runtime.
function validateAddRoad(cmd: Extract<Cmd, { type: "addRoad" }>): string | null {
  const { pts, labor, kind, snapTol } = cmd;
  if (typeof kind !== "string" || !Object.hasOwn(ROAD_KINDS, kind)) return "Неизвестный вид дороги";
  if (!finite(snapTol) || snapTol <= 0 || snapTol > 1000) return "Некорректный допуск";
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 64) return "Некорректная линия";
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6)) {
    return "Некорректная линия";
  }
  if (!Array.isArray(labor) || labor.length !== pts.length - 1 || !labor.every((l) => finite(l) && l >= 0)) return "Некорректная стоимость";
  return null;
}
