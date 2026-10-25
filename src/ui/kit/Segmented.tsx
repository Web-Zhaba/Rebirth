export interface SegmentOption<T extends string | number> {
  id: T;
  label: string; // short text on the button
  title: string; // full word: tooltip and accessible name
}

// A row of mutually exclusive buttons (role=radiogroup). The caller owns the value.
export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: SegmentOption<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div class="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-label={`${label}: ${o.title.toLowerCase()}`} title={o.title} class={value === o.id ? "seg-btn on" : "seg-btn"} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
