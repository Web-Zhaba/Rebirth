export function signedDaily(v: number, unit: string): string {
  if (Math.abs(v) < 0.05) return `0 ${unit}/дн`;
  const n = (Math.round(Math.abs(v) * 10) / 10).toString().replace(".", ",");
  return `${v > 0 ? "+" : "−"}${n} ${unit}/дн`;
}
