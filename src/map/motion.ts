export const prefersReducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Below the medium breakpoint (layout.css): collapsible panels start collapsed unless the player chose otherwise.
export const compactScreen = (): boolean => typeof matchMedia === "function" && matchMedia("(max-width: 1099px)").matches;
