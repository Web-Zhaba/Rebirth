import { BUILDINGS } from "../sim/buildings";
import { DIG } from "../sim/excavation";
import { L } from "../i18n";
export interface CoveragePreview {
  houses: number;
  residents: number;
  newHouses: number;
  newResidents: number;
}

export function coveragePreviewText(p: CoveragePreview): string {
  const base = L(`Охват: ${p.houses} домов · ${p.residents} жителей`, `Reach: ${p.houses} houses · ${p.residents} residents`);
  return p.newHouses > 0 ? `${base} · ${L(`новых: ${p.newHouses} домов, ${p.newResidents} жителей`, `new: ${p.newHouses} houses, ${p.newResidents} residents`)}` : `${base} · ${L("новых нет", "none new")}`;
}

export function relationRadius(template: string, currentDigRadius: number | undefined): number | null {
  if (template === DIG.template) return currentDigRadius ?? 25;
  return BUILDINGS[template]?.reach ?? null;
}
