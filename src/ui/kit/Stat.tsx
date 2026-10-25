import { Icon } from "../Icon";
import type { IconName } from "../icons";

// Icon + tabular number + optional daily delta. A delta is signed text, never color alone.
export function Stat({ icon, value, caption, delta, tone }: { icon: IconName; value: string; caption?: string; delta?: number | string; tone?: "ok" | "warn" | "bad" }) {
  const d = typeof delta === "number" ? (delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "0") : delta;
  const dir = typeof delta === "number" ? (delta > 0 ? "up" : delta < 0 ? "down" : "") : "";
  return (
    <span class={`stat${tone ? ` stat-${tone}` : ""}`}>
      <Icon name={icon} size={20} />
      <span class="stat-num">{value}</span>
      {d !== undefined && <span class={`stat-delta ${dir}`}>{d}</span>}
      {caption && <span class="stat-cap">{caption}</span>}
    </span>
  );
}
