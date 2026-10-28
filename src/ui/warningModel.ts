export interface WarningLike {
  id: string;
  text: string;
}

export function freshWarnings(previous: ReadonlySet<string>, current: readonly WarningLike[]): WarningLike[] {
  return current.filter((w) => !previous.has(w.id));
}

export function warningAction(id: string): "town" | null {
  return id === "famine" || id === "lowfood" || id === "outlook" || id === "nohands" || id === "nologs" ? "town" : null;
}
