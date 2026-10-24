import { calendar } from "./time";
import type { ChronicleEntry, SimState, TownEvent } from "./types";

export const CHRONICLE_CAP = 1000;
export const POP_MILESTONES = [25, 50, 100, 250, 500, 1000];

// "Построена первая ..." for the first finished building of each template (the first house has its own entry).
const FIRST_BUILT: Record<string, string> = {
  izba5: "Построен первый пятистенок",
  smithy: "Построена первая кузница",
  carpentry: "Построена первая столярная мастерская",
  pottery: "Построена первая гончарня",
  shop: "Построена первая лавка",
  tavern: "Построен первый постоялый двор",
  gumno: "Построено первое гумно",
  woodcutter: "Построена первая делянка лесоруба",
  sawpit: "Построена первая пильня",
  quarry: "Построена первая каменоломня",
  fisher: "Построена первая избушка рыбака",
  barn: "Построен первый амбар",
  well: "Построен первый колодец",
  market: "Построен первый рынок",
  chapel: "Построена первая часовня",
  school: "Построена первая школа",
  healer: "Построена первая лечебница",
  dig: "Заложен первый раскоп",
};

// Appends an entry (oldest dropped beyond the cap). E1 adds excavation finds through this.
export function addChronicle(list: ChronicleEntry[], at: number, kind: string, text: string): ChronicleEntry[] {
  return [...list, { at, kind, text }].slice(-CHRONICLE_CAP);
}

export const withChronicle = (s: SimState, kind: string, text: string): SimState => ({ ...s, chronicle: addChronicle(s.chronicle, s.gameMinutes, kind, text) });

const has = (list: ChronicleEntry[], kind: string): boolean => list.some((e) => e.kind === kind);

// Events that `next` has and `prev` did not (the feed is a ring buffer whose entries keep their identity).
export function newEvents(prev: TownEvent[], next: TownEvent[]): TownEvent[] {
  if (prev === next) return [];
  const last = prev[prev.length - 1];
  const i = last ? next.lastIndexOf(last) : -1;
  return next.slice(i + 1);
}

const count = (o: object): number => Object.keys(o).length;

// Looks at one simulation step and writes the notable changes into the chronicle. Returns `next` itself when
// nothing happened, so unchanged chronicles keep their identity.
export function recordChronicle(prev: SimState, next: SimState): SimState {
  const at = next.gameMinutes;
  let list = next.chronicle;
  const add = (kind: string, text: string) => {
    list = addChronicle(list, at, kind, text);
  };
  const once = (kind: string, text: string) => {
    if (!has(list, kind)) add(kind, text);
  };

  if (next.residents !== prev.residents) {
    const a = count(prev.residents);
    const b = count(next.residents);
    if (b > a) for (const m of POP_MILESTONES) if (a < m && b >= m) once(`pop:${m}`, `Население достигло ${m} человек`);
    if (!Object.values(prev.residents).some((r) => r.literate) && Object.values(next.residents).some((r) => r.literate)) {
      once("literate", "В поселении появился первый грамотный");
    }
  }

  if (next.buildings !== prev.buildings) {
    for (const b of Object.values(next.buildings)) {
      const was = prev.buildings[b.id];
      if (b.state === "active" && was && was.state !== "active") {
        if (b.zone === "res") once("house", "Построен первый дом");
        const text = FIRST_BUILT[b.template];
        if (text) once(`built:${b.template}`, text);
      }
      if (b.level >= 2 && was && was.level < 2) once("level2", "Первый дом улучшен до второго уровня");
    }
  }

  if (next.events !== prev.events) {
    for (const e of newEvents(prev.events, next.events)) if (e.kind === "farm" && e.text.startsWith("Урожай собран")) add("harvest", e.text);
  }

  if (next.prod.flags.hungry !== prev.prod.flags.hungry) {
    if (next.prod.flags.hungry) add("famine", "Провизия закончилась: в поселении голод");
    else add("famineEnd", "Голод закончился");
  }

  const year = calendar(at).year;
  if (year > calendar(prev.gameMinutes).year) add("year", `Наступил ${year}-й год`);

  return list === next.chronicle ? next : { ...next, chronicle: list };
}
