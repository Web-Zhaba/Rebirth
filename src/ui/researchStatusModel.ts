import { L } from "../i18n";
export interface ResearchStatusView {
  title: string;
  next: string | null;
  progress: number | null;
  idle: boolean;
}

export function researchStatusView(activeName: string | null, share: number | null, queuedNames: readonly string[]): ResearchStatusView {
  const next = queuedNames[0] ?? null;
  if (!activeName || share === null) {
    return { title: L("Наука простаивает — выберите технологию", "Research is idle — choose a technology"), next: next ? L(`В очереди: ${next}`, `Queued: ${next}`) : null, progress: null, idle: true };
  }
  const pct = Math.max(0, Math.min(100, Math.floor(share * 100)));
  return {
    title: L(`Исследуется: ${activeName}, ${pct} %`, `Researching: ${activeName}, ${pct}%`),
    next: next ? L(`Далее: ${next}`, `Next: ${next}`) : null,
    progress: Math.max(0, Math.min(1, share)),
    idle: false,
  };
}
