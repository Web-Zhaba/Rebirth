// Publishes the measured height of the top bar and of the build bar as CSS custom properties (--topbar-h, --bb-h):
// the bar wraps on narrow screens and the build bar changes with its category, and the panels around them
// (left column, centre column, right slot) are positioned from these.
function track(selector: string, prop: string, root: HTMLElement, observers: ResizeObserver[]): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const set = () => root.style.setProperty(prop, `${Math.ceil(el.getBoundingClientRect().height)}px`);
  set();
  const ro = new ResizeObserver(set);
  ro.observe(el);
  observers.push(ro);
}

export function trackLayout(): () => void {
  const root = document.documentElement;
  const observers: ResizeObserver[] = [];
  if (typeof ResizeObserver === "undefined") return () => {};
  track(".topbar", "--topbar-h", root, observers);
  track(".bb-panel", "--bb-h", root, observers);
  return () => observers.forEach((o) => o.disconnect());
}
