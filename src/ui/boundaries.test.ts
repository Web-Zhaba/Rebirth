import { describe, expect, it } from "vitest";

// The UI talks to the sim, the shared buildings rules and the view's root modules (view/view.ts, scale, selection...).
// It never reaches the renderer (engine/) or the view's implementation folders (view/engine, view/layers): that is
// what the view's root modules are for. map/ tools and world/ data are open to it.

const sources = import.meta.glob("/src/ui/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const imports = (text: string) => [...text.matchAll(/^import\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)";/gms)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));

describe("ui boundaries", () => {
  it("import no engine module", () => {
    const bad: string[] = [];
    for (const [p, text] of Object.entries(sources))
      for (const { from } of imports(text)) if (/^(?:\.\.\/)+engine(\/|$)/.test(from)) bad.push(`${p}: ${from}`);
    expect(bad).toEqual([]);
  });

  it("import no view implementation folder", () => {
    const bad: string[] = [];
    for (const [p, text] of Object.entries(sources))
      for (const { from } of imports(text)) if (/^(?:\.\.\/)+view\/(engine|layers)(\/|$)/.test(from)) bad.push(`${p}: ${from}`);
    expect(bad).toEqual([]);
  });
});
