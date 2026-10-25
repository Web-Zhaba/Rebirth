import { ICONS, type IconName } from "./icons";

// Inline SVG icon in `currentColor`. Decorative unless `label` is given.
export function Icon({ name, size = 18, label, class: cls }: { name: IconName; size?: number; label?: string; class?: string }) {
  const Svg = ICONS[name];
  return (
    <Svg
      class={cls ? `icon ${cls}` : "icon"}
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
    />
  );
}
