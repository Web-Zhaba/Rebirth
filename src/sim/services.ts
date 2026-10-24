import type { ServiceId } from "./types";

// Service tuning (design: PLAN.md section 9). Reach is road distance in metres.
export interface ServiceInfo {
  id: ServiceId;
  name: string;
  reach: number;
  mood: number; // added to the mood target of covered households
  color: string;
}

export const SERVICE_LIST: ServiceInfo[] = [
  { id: "well", name: "Вода", reach: 150, mood: 8, color: "#4f86a8" },
  { id: "market", name: "Рынок", reach: 800, mood: 5, color: "#c9803a" },
  { id: "chapel", name: "Часовня", reach: 1000, mood: 7, color: "#8e6bb0" },
  { id: "school", name: "Школа", reach: 800, mood: 3, color: "#3f9a76" },
  { id: "healer", name: "Лекарь", reach: 1000, mood: 2, color: "#c4504a" },
];
export const SERVICES = Object.fromEntries(SERVICE_LIST.map((s) => [s.id, s])) as Record<ServiceId, ServiceInfo>;
export const SERVICE_IDS: ServiceId[] = SERVICE_LIST.map((s) => s.id);
export const isService = (template: string): template is ServiceId => Object.hasOwn(SERVICES, template);

export const SERVICE = {
  marketHouseholds: 20, // households a market worker hands wares to in a day
  healerDeathFactor: 0.6,
  schoolFrom: 7, // age of the children who attend
  schoolTo: 15,
  literateDays: 720, // days of school (2 years) for a child to become literate at 15
  literateBoost: 0.2, // a literate worker is this much more productive
  landBase: 20,
  landPerService: 8,
  landMoodWeight: 0.3,
  landRadius: 100, // m: households whose mood counts
  upgradeLand: 70,
  upgradeMood: 75,
  upgradeDays: 20,
};

const bit = (id: ServiceId): number => 1 << SERVICE_IDS.indexOf(id);
export const covers = (mask: number | undefined, id: ServiceId): boolean => ((mask ?? 0) & bit(id)) !== 0;
export const withService = (mask: number, id: ServiceId): number => mask | bit(id);
export const servicesIn = (mask: number | undefined): ServiceId[] => SERVICE_IDS.filter((id) => covers(mask, id));
export const countServices = (mask: number | undefined): number => servicesIn(mask).length;

// Mood target terms of the services a household is covered by (school: only families with school-age children).
export function serviceMood(mask: number | undefined, schoolKids: boolean): number {
  let m = 0;
  for (const id of servicesIn(mask)) if (id !== "school" || schoolKids) m += SERVICES[id].mood;
  return m;
}
