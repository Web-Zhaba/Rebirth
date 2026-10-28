export function duplicateTemplate(template: string, siteId: string | undefined, placeTools: readonly string[]): string | null {
  return !siteId && placeTools.includes(template) ? template : null;
}

export function needsRoadDemolishConfirm(kind: string, done: number, labor: number): boolean {
  if (labor <= 0 || done < labor) return false;
  return kind === "footbridge" || kind === "bridge" || kind === "stone" || kind === "stonebridge";
}
