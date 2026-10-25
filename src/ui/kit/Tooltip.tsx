import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

// Pure-CSS tooltip, shown on hover and keyboard focus of the wrapped control. The text is linked by aria-describedby.
export function Tooltip({ text, children }: { text: ComponentChildren; children: ComponentChildren }) {
  const id = useId();
  return (
    <span class="tooltip-wrap" aria-describedby={id}>
      {children}
      <span class="tooltip" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
