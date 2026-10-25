import type { ComponentChildren } from "preact";

export interface TabItem<T extends string> {
  id: T;
  label: ComponentChildren;
}

// Tab strip (role=tablist). The caller renders the active panel. Roving focus: Tab reaches the active tab,
// the arrow keys, Home and End move between tabs.
export function Tabs<T extends string>({ tabs, active, onChange, label, class: cls }: { tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; label?: string; class?: string }) {
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    ((e.currentTarget as HTMLElement).querySelectorAll('[role="tab"]')[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div class={cls ? `tabs ${cls}` : "tabs"} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1} class={active === t.id ? "tab on" : "tab"} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
