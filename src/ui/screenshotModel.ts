export function screenshotKey(active: boolean, key: string): boolean | null {
  if (key === "F10") return !active;
  if (key === "Escape" && active) return false;
  return null;
}
