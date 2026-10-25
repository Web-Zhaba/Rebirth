// Thin ink-ruled bar. `value` is 0..1; `label` gives the accessible name.
export function ProgressBar({ value, label, big, tone }: { value: number; label: string; big?: boolean; tone?: "ok" | "bad" }) {
  const v = Math.min(1, Math.max(0, value));
  return (
    <div class={`bar${big ? " big" : ""}${tone ? ` bar-${tone}` : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  );
}
