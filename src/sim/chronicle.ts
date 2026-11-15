import { BUILDINGS } from "./buildings";
import { calendar } from "./time";
import type { ChronicleEntry, SimState, TownEvent } from "./types";
import { L } from "../i18n";

export const CHRONICLE_CAP = 1000;
export const POP_MILESTONES = [25, 50, 100, 250, 500, 1000];

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
    if (b > a) for (const m of POP_MILESTONES) if (a < m && b >= m) once(`pop:${m}`, L(`Население достигло ${m} человек`, `The population reached ${m}`));
    if (!Object.values(prev.residents).some((r) => r.literate) && Object.values(next.residents).some((r) => r.literate)) {
      once("literate", L("В поселении появился первый грамотный", "The settlement has its first literate resident"));
    }
  }

  if (next.buildings !== prev.buildings) {
    for (const b of Object.values(next.buildings)) {
      const was = prev.buildings[b.id];
      if (b.state === "active" && was && was.state !== "active") {
        if (b.zone === "res") once("house", L("Построен первый дом", "The first house is built"));
        const text = BUILDINGS[b.template]?.firstBuilt; // "Построена первая ..." (the first house has its own entry)
        if (text) once(`built:${b.template}`, text);
      }
      if (b.level >= 2 && was && was.level < 2) once("level2", L("Первый дом улучшен до второго уровня", "The first house is upgraded to level two"));
    }
  }

  if (next.clearings !== prev.clearings && next.clearings.some((c) => c.done >= c.labor) && !prev.clearings.some((c) => c.done >= c.labor)) {
    once("clearing", L("Вырублен первый участок леса", "The first patch of forest is cleared"));
  }

  if (next.events !== prev.events) {
    for (const e of newEvents(prev.events, next.events)) if (e.kind === "farm" && e.text.startsWith(L("Урожай собран", "Harvest gathered"))) add("harvest", e.text);
  }

  if (next.prod.flags.hungry !== prev.prod.flags.hungry) {
    if (next.prod.flags.hungry) add("famine", L("Еда закончилась: в поселении голод", "Food has run out: famine in the settlement"));
    else add("famineEnd", L("Голод закончился", "The famine is over"));
  }
  if (!!next.prod.flags.starving !== !!prev.prod.flags.starving) {
    if (next.prod.flags.starving) add("starving", L("Люди истощены: голод подрывает силы", "People are exhausted: hunger saps their strength"));
    else add("starvingEnd", L("Люди больше не истощены голодом", "People are no longer exhausted by hunger"));
  }

  const year = calendar(at).year;
  if (year > calendar(prev.gameMinutes).year) add("year", L(`Наступил ${year}-й год`, `Year ${year} has begun`));

  return list === next.chronicle ? next : { ...next, chronicle: list };
}
