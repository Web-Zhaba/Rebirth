import { newEvents } from "./chronicle";
import type { ChronicleEntry, SimState, Stock } from "./types";

// What happened while the player was away; counted step by step during the catch-up.
export interface Away {
  realMs: number;
  gameMinutes: number;
  popBefore: number;
  popAfter: number;
  births: number;
  deaths: number;
  arrivals: number; // people
  departures: number; // people
  built: number; // buildings finished
  produced: Stock; // goods made (food from fields and fishing)
  chronicle: ChronicleEntry[];
}

export interface Tally {
  births: number;
  deaths: number;
  arrivals: number;
  departures: number;
  built: number;
  produced: Stock;
}

export const newTally = (): Tally => ({ births: 0, deaths: 0, arrivals: 0, departures: 0, built: 0, produced: { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 } });

const GOOD: Record<string, keyof Stock> = { woodcutter: "logs", sawpit: "planks", quarry: "stone", fisher: "food", gumno: "food", pottery: "wares", smithy: "wares", carpentry: "wares" };

// "(5 чел.)" in the family events; one person when the text has no count.
const people = (text: string): number => Number(/\((\d+) чел\./.exec(text)?.[1] ?? 1);

// Adds what one step changed to the tally. Called with consecutive states.
export function observe(t: Tally, prev: SimState, next: SimState): void {
  for (const e of newEvents(prev.events, next.events)) {
    if (e.kind === "birth") t.births++;
    else if (e.kind === "death") t.deaths++;
    else if (e.kind === "arrival") t.arrivals += people(e.text);
    else if (e.kind === "departure") t.departures += people(e.text);
  }
  if (next.buildings !== prev.buildings) {
    for (const b of Object.values(next.buildings)) {
      const was = prev.buildings[b.id];
      if (b.state === "active" && was && was.state !== "active") t.built++;
    }
  }
  if (next.prod.today !== prev.prod.today) {
    for (const [id, n] of Object.entries(next.prod.today)) {
      const b = next.buildings[Number(id)];
      const good = b && GOOD[b.template];
      const d = n - (prev.prod.today[Number(id)] ?? 0);
      if (good && d > 0) t.produced[good] += d;
    }
  }
}

export function summarize(t: Tally, start: SimState, end: SimState, realMs: number): Away {
  return {
    realMs,
    gameMinutes: end.gameMinutes - start.gameMinutes,
    popBefore: Object.keys(start.residents).length,
    popAfter: Object.keys(end.residents).length,
    births: t.births,
    deaths: t.deaths,
    arrivals: t.arrivals,
    departures: t.departures,
    built: t.built,
    produced: t.produced,
    chronicle: end.chronicle.filter((e) => e.at > start.gameMinutes),
  };
}
