import { advanceTo } from "./clock";
import type { FromWorker, ToWorker } from "./protocol";
import { migrateLegacy, parseSaveV3 } from "./save";
import type { SaveV3 } from "./types";

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
          const save: SaveV3 = { version: 3, city: msg.city, sim: { realTime: msg.now, gameMinutes: 0 } };
          this.save = save;
          await this.storage.put(save);
          this.post({ t: "loaded", save, migrated: false, away: null });
          return;
        }
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
