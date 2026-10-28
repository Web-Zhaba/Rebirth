export const DAY_SUMMARY_MS = 3000;

export function daySummaryRemaining(elapsedMs: number): number {
  return Math.max(0, Math.min(1, 1 - elapsedMs / DAY_SUMMARY_MS));
}
