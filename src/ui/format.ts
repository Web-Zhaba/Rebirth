import type { Resource } from "../game/defs";

export const RES_ICON: Record<Resource, string> = { food: "🍞", wood: "🪵", stone: "🪨" };

export function fmtRate(n: number, digits = 1): string {
  const v = Math.abs(n) < 0.5 * Math.pow(10, -digits) ? 0 : n;
  return `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(digits)}/с`;
}

export function fmtDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} ч ${min % 60} мин` : `${min} мин`;
}
