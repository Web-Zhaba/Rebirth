import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

// Pure-CSS tooltip, shown on hover and keyboard focus of the wrapped control. The text is linked by aria-describedby.
// `align="end"` anchors it to the right edge of the control (near the right side of the screen).
export function Tooltip({ text, children, align = "start" }: { text: ComponentChildren; children: ComponentChildren; align?: "start" | "end" }) {
  const id = useId();
  return (
    <span class="tooltip-wrap" aria-describedby={id}>
      {children}
      <span class={align === "end" ? "tooltip tooltip-end" : "tooltip"} role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
