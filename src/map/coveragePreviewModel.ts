export interface CoveragePreview {
  houses: number;
  residents: number;
  newHouses: number;
  newResidents: number;
}

export function coveragePreviewText(p: CoveragePreview): string {
  const base = `Охват: ${p.houses} домов · ${p.residents} жителей`;
  return p.newHouses > 0 ? `${base} · новых: ${p.newHouses} домов, ${p.newResidents} жителей` : `${base} · новых нет`;
}

export function relationRadius(template: string, currentDigRadius: number | undefined): number | null {
  if (template === "gumno") return 400;
  if (template === "woodcutter" || template === "forager") return 150;
  if (template === "fisher") return 100;
  if (template === "dig") return currentDigRadius ?? 25;
  return null;
}
