// Immigration by attractiveness (docs/PLAN-balance.md B6). Families come at a town-wide rate, not one per vacant house:
// the score (food outlook, mood, jobs, services) times the families a town of its size draws at best a day, which
// grows with the town and saturates, so a big town grows by births and a steady inflow. Each family takes a free home;
// the fewer free homes, the slower they come. The score is set at 00:00 (people.ts dailyStep); the free homes are
// counted live.

export interface Attraction {
  food: number; // 0..1, can the food last to the end of the next harvest (people.ts foodOutlook); it multiplies the rest
  mood: number; // 0..1, the average mood of the households
  jobs: number; // 0..1, 1 while the adults have work (or construction), 0 at half of them jobless
  services: number; // 0..1, share of the services that reach the houses, on average
  score: number; // 0..1, food x the weighted mood, jobs and services
  cap: number; // families a day a town of this size draws at a full score with homes ready
}

// Weights of the score; they add up to 1.
export const ATTRACT = { mood: 0.4, jobs: 0.3, services: 0.3 };
// Families a day at a full score: `base` for a hamlet, up to `max` for a big town, half way at `half` residents.
export const INFLOW = { base: 2, max: 5, half: 500 };
// Free homes at which the inflow is no longer held back by housing.
export const HOMES_FULL = 2;

export const NO_ATTRACTION: Attraction = { food: 0, mood: 0, jobs: 0, services: 0, score: 0, cap: 0 };

export const inflowCap = (pop: number): number => INFLOW.base + ((INFLOW.max - INFLOW.base) * pop) / (pop + INFLOW.half);

const unit = (v: number): number => Math.min(1, Math.max(0, v));

export function attractionOf(p: { food: number; mood: number; unemployment: number; services: number; pop: number; museum?: number }): Attraction {
  const food = unit(p.food);
  const mood = unit(p.mood / 100);
  const jobs = unit(1 - 2 * p.unemployment);
  const services = unit(p.services);
  // complete museum exhibitions (sim/museum.ts) make the town more attractive by a share
  const score = Math.min(1, food * (ATTRACT.mood * mood + ATTRACT.jobs * jobs + ATTRACT.services * services) * (1 + (p.museum ?? 0)));
  return { food, mood, jobs, services, score, cap: inflowCap(p.pop) };
}

// Families a day the town draws now, with `free` homes ready for them.
export const inflowPerDay = (a: Attraction, free: number): number => a.score * a.cap * Math.min(1, free / HOMES_FULL);
