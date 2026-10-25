import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { IconButton } from "./Button";

// Modal dialog on the native <dialog> element: focus trap, Esc and inert background come from the browser.
export function Dialog({ title, onClose, children, class: cls }: { title: string; onClose: () => void; children: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} class={cls ? `dialog ${cls}` : "dialog"} aria-label={title} onCancel={onClose}>
      <div class="dialog-head">
        <h2>{title}</h2>
        <IconButton icon="close" label="Закрыть" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
