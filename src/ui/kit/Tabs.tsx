import type { ComponentChildren } from "preact";

export interface TabItem<T extends string> {
  id: T;
  label: ComponentChildren;
}

// Tab strip (role=tablist). The caller renders the active panel.
export function Tabs<T extends string>({ tabs, active, onChange, label, class: cls }: { tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; label?: string; class?: string }) {
  return (
    <div class={cls ? `tabs ${cls}` : "tabs"} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} class={active === t.id ? "tab on" : "tab"} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
