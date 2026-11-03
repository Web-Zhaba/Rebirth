import { decimal, L } from "../i18n";
export function signedDaily(v: number, unit: string): string {
  if (Math.abs(v) < 0.05) return `0 ${unit}${L("/дн", "/day")}`;
  const n = decimal((Math.round(Math.abs(v) * 10) / 10).toString());
  return `${v > 0 ? "+" : "−"}${n} ${unit}${L("/дн", "/day")}`;
}
