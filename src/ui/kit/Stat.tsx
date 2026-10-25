import { Icon } from "../Icon";
import type { IconName } from "../icons";

// Icon + tabular number + optional daily delta + caption. A delta is signed text, never color alone.
// `delta` is a number (formatted here) or ready text; for text, `dir` says whether it is up or down.
export function Stat({
  icon,
  value,
  caption,
  delta,
  dir,
  tone,
}: {
  icon: IconName;
  value: string;
  caption?: string;
  delta?: number | string | null;
  dir?: "up" | "down" | "";
  tone?: "ok" | "warn" | "bad";
}) {
  const d = typeof delta === "number" ? (delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "0") : (delta ?? undefined);
  const direction = dir ?? (typeof delta === "number" ? (delta > 0 ? "up" : delta < 0 ? "down" : "") : "");
  return (
    <span class={`stat${tone ? ` stat-${tone}` : ""}`}>
      <Icon name={icon} size={22} />
      <span class="stat-num">{value}</span>
      {d !== undefined && <span class={`stat-delta ${direction}`}>{d}</span>}
      {caption && <span class="stat-cap">{caption}</span>}
    </span>
  );
}
