import type { Site } from "../sim/types";

// Old Russian settlement names offered when founding a town.
export const SETTLEMENT_NAMES = [
  "Заречье",
  "Озёрки",
  "Сосновка",
  "Берёзовка",
  "Подгорное",
  "Луговое",
  "Ключи",
  "Займище",
  "Починок",
  "Выселки",
  "Слобода",
  "Борки",
  "Дубрава",
  "Горки",
  "Лукоморье",
  "Ольховка",
];

export const NAME_CHOICES = 5;

// A stable set of suggestions for a spot: the same place always offers the same names.
export function suggestNames(lat: number, lng: number, count = NAME_CHOICES): string[] {
  let h = (Math.round(lat * 1000) * 73856093) ^ (Math.round(lng * 1000) * 19349663);
  h = Math.abs(h) % SETTLEMENT_NAMES.length;
  const step = 7; // coprime with the list length, so the picks never repeat
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(SETTLEMENT_NAMES[(h + i * step) % SETTLEMENT_NAMES.length]);
  return out;
}


// Short remarks on a spot from the land shares around it and the slope; empty for an unremarkable place.
export function siteNotes(site: Site, slope: number | null, river: boolean): string[] {
  const out: string[] = [];
  if (river) out.push("Река рядом: вода и рыба под рукой");
  if (site.water >= 0.3) out.push("Много воды вокруг, застраивать тесно");
  if (site.forest >= 0.6) out.push("Густой лес: брёвна рядом, но пашню придётся расчищать");
  else if (site.forest < 0.05 && site.water < 0.3) out.push("Открытая земля: удобно под пашню, леса поблизости мало");
  if (site.rock >= 0.2) out.push("Камень или песок рядом");
  if (slope !== null && slope >= 10) out.push("Крутой склон: строить будет трудно");
  return out;
}
