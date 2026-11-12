// Loads a portal's SDK script; rejects when it cannot be fetched (no network, or not on the portal's host).
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} did not load`));
    document.head.append(s);
  });
}
