import { calendar } from "./time";
import type { ChronicleEntry, SimState, TownEvent } from "./types";
import { L } from "../i18n";

export const CHRONICLE_CAP = 1000;
export const POP_MILESTONES = [25, 50, 100, 250, 500, 1000];

// "Построена первая ..." for the first finished building of each template (the first house has its own entry).
const FIRST_BUILT: Record<string, string> = {
  izba5: L("Построен первый большой дом", "The first large house is built"),
  smithy: L("Построена первая кузница", "The first smithy is built"),
  carpentry: L("Построена первая столярная мастерская", "The first carpentry workshop is built"),
  pottery: L("Построена первая гончарня", "The first pottery is built"),
  weaver: L("Построена первая ткацкая мастерская", "The first weaving workshop is built"),
  shop: L("Построен первый магазин", "The first shop is built"),
  tavern: L("Построена первая таверна", "The first tavern is built"),
  gumno: L("Построена первая ферма", "The first farm is built"),
  woodcutter: L("Построена первая лесозаготовка", "The first woodcutter is set up"),
  sawpit: L("Построена первая лесопилка", "The first sawmill is built"),
  quarry: L("Построен первый карьер", "The first quarry is opened"),
  fisher: L("Построен первый рыболовный причал", "The first fishing pier is built"),
  garden: L("Разбит первый огород", "The first vegetable garden is laid out"),
  hunter: L("Поставлен первый охотничий пост", "The first hunting post is set up"),
  forager: L("Начат первый сбор в лесу", "Foraging in the forest begins"),
  orchard: L("Заложен первый сад", "The first orchard is planted"),
  apiary: L("Поставлена первая пасека", "The first apiary is set up"),
  cellar: L("Вырыт первый погреб", "The first cellar is dug"),
  barn: L("Построен первый склад", "The first storehouse is built"),
  well: L("Построен первый колодец", "The first well is built"),
  market: L("Построен первый рынок", "The first market is built"),
  chapel: L("Построен первый храм", "The first temple is built"),
  school: L("Построена первая школа", "The first school is built"),
  healer: L("Построена первая лечебница", "The first infirmary is built"),
  dig: L("Заложен первый раскоп", "The first dig is opened"),
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
        const text = FIRST_BUILT[b.template];
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
