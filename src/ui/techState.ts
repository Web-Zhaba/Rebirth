import { computed, effect, signal } from "@preact/signals";
import { flash } from "../map/tools";
import { sendCmd, state } from "../simClient";
import { rightPanel } from "./panels";
import { buildTechView, techBadge } from "./techModel";

// UI state of the science panel: the selected node and the number of researched techs the player has seen.

export const selectedTech = signal<string | null>(null);

// Researched techs the player had seen the last time the panel was open; null until a town is loaded.
const seenTechs = signal<number | null>(null);

effect(() => {
  const s = state.value;
  if (!s) seenTechs.value = null;
  else if (seenTechs.peek() === null || rightPanel.value === "tech") seenTechs.value = s.progress.techs.length;
});

export const techView = computed(() => {
  const s = state.value;
  return s ? buildTechView({ progress: s.progress, research: s.research, pop: s.people.pop }) : null;
});

export const badge = computed(() => {
  const v = techView.value;
  return v ? techBadge(seenTechs.value, v.techsDone, v.idle) : null;
});

async function run(cmd: "startResearch" | "queueResearch" | "cancelResearch", techId: string): Promise<void> {
  const r = await sendCmd({ type: cmd, techId });
  if (!r.ok) flash(r.reason ?? "Не вышло");
}
export const startTech = (id: string) => run("startResearch", id);
export const queueTech = (id: string) => run("queueResearch", id);
export const cancelTech = (id: string) => run("cancelResearch", id);
