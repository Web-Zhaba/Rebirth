import type { Site } from "../sim/types";
import { L } from "../i18n";

// Neutral descriptive settlement names offered when founding a town.
export const SETTLEMENT_NAMES = [
  L("Речной", "Riverside"),
  L("Лесной", "Woodland"),
  L("Луговой", "Meadowbrook"),
  L("Холмистый", "Hillcrest"),
  L("Озёрный", "Lakeside"),
  L("Каменный", "Stonefield"),
  L("Новый Берег", "New Shore"),
  L("Тихая Долина", "Quiet Valley"),
  L("Северный", "Northfield"),
  L("Южный", "Southfield"),
  L("Зелёный Мыс", "Green Cape"),
  L("Ясная Поляна", "Clear Glade"),
  L("Светлый", "Brightwater"),
  L("Солнечный", "Sunnyside"),
  L("Ключевой", "Springwell"),
  L("Новая Гавань", "New Haven"),
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
  if (river) out.push(L("Река рядом: вода и рыба под рукой", "River nearby: water and fish at hand"));
  if (site.water >= 0.3) out.push(L("Много воды вокруг, застраивать тесно", "Lots of water around, little room to build"));
  if (site.forest >= 0.6) out.push(L("Густой лес: брёвна рядом, но поля придётся расчищать", "Dense forest: logs are close, but fields will need clearing"));
  else if (site.forest < 0.05 && site.water < 0.3) out.push(L("Открытая земля: удобно под поля, леса поблизости мало", "Open land: good for fields, little forest nearby"));
  if (site.rock >= 0.2) out.push(L("Камень или песок рядом", "Stone or sand nearby"));
  if (slope !== null && slope >= 10) out.push(L("Крутой склон: строить будет трудно", "Steep slope: building will be hard"));
  return out;
}
