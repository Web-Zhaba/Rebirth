import type { ComponentChildren, JSX } from "preact";

// Opaque paper surface with an ink rule and a hard offset shadow.
export function Panel({ class: cls, children, ...rest }: { class?: string; children?: ComponentChildren } & JSX.IntrinsicElements["div"]) {
  return (
    <div {...rest} class={cls ? `panel ${cls}` : "panel"}>
      {children}
    </div>
  );
}
