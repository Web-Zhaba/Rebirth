export interface ResearchStatusView {
  title: string;
  next: string | null;
  progress: number | null;
  idle: boolean;
}

export function researchStatusView(activeName: string | null, share: number | null, queuedNames: readonly string[]): ResearchStatusView {
  const next = queuedNames[0] ?? null;
  if (!activeName || share === null) {
    return { title: "Наука простаивает — выберите технологию", next: next ? `В очереди: ${next}` : null, progress: null, idle: true };
  }
  const pct = Math.max(0, Math.min(100, Math.floor(share * 100)));
  return {
    title: `Исследуется: ${activeName}, ${pct} %`,
    next: next ? `Далее: ${next}` : null,
    progress: Math.max(0, Math.min(1, share)),
    idle: false,
  };
}
