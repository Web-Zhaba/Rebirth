import { toolOfTemplate } from "../map/tools";

// «Построить ещё»: the tool and kind that put another of this building down; none for a site restored as it was.
export function duplicateTool(template: string, siteId: string | undefined): ReturnType<typeof toolOfTemplate> {
  return siteId ? null : toolOfTemplate(template);
}

export function needsRoadDemolishConfirm(kind: string, done: number, labor: number): boolean {
  if (labor <= 0 || done < labor) return false;
  return kind === "footbridge" || kind === "bridge" || kind === "stone" || kind === "stonebridge";
}
