import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../Icon";
import type { IconName } from "../icons";

type Variant = "default" | "primary" | "danger" | "ghost";

export function Button({
  variant = "default",
  icon,
  children,
  class: cls,
  ...rest
}: { variant?: Variant; icon?: IconName; children?: ComponentChildren } & JSX.IntrinsicElements["button"]) {
  return (
    <button type="button" {...rest} class={`btn btn-${variant}${cls ? ` ${cls}` : ""}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

// Icon-only button: the accessible name is mandatory and doubles as the native tooltip.
export function IconButton({
  icon,
  label,
  size = 18,
  class: cls,
  ...rest
}: { icon: IconName; label: string; size?: number } & Omit<JSX.IntrinsicElements["button"], "aria-label" | "children">) {
  return (
    <button type="button" title={label} {...rest} aria-label={label} class={`icon-btn${cls ? ` ${cls}` : ""}`}>
      <Icon name={icon} size={size} />
    </button>
  );
}
