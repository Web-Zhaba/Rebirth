import { describe, expect, it } from "vitest";

// PLAN-ui.md U1: the interface uses SVG icons, never emoji or pictograph characters.
// Allowed in .ts/.tsx/.css sources: ASCII, Cyrillic, and this typographic set (all plain text, not pictographs):
//   U+00A0 no-break space, U+00AB/U+00BB guillemets, U+00B0 degree, U+00B2/U+00B3 superscripts,
//   U+00B7 middle dot, U+00D7 multiplication sign (speed labels "1x", dimensions), U+2013/U+2014 dashes,
//   U+2018/U+2019/U+201C/U+201D quotes, U+2026 ellipsis, U+2116 numero sign, U+2212 minus sign.
// Everything else (arrows, geometric shapes, dingbats, emoji, variation selectors, ZWJ) fails.
const ALLOWED = new Set([0xa0, 0xab, 0xbb, 0xb0, 0xb2, 0xb3, 0xb7, 0xd7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2116, 0x2212]);

const isAllowed = (cp: number) => cp < 0x80 || (cp >= 0x400 && cp <= 0x4ff) || ALLOWED.has(cp);

function offenders(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!isAllowed(cp)) out.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return out;
}

const sources = import.meta.glob("/src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("no emoji or pictographs in src", () => {
  it("scans the source tree", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it("flags pictographs and accepts ordinary typography", () => {
    expect(offenders("\u{1F4D6} ◉ ≡ ▫ ×")).toEqual(["U+1F4D6", "U+25C9", "U+2261", "U+25AB"]);
    expect(offenders("→ ☀ ️ ‍ ✓")).toHaveLength(5);
    expect(offenders("1× «тест» — № 5 · 20°")).toEqual([]);
  });

  it("has none in any .ts, .tsx or .css file", () => {
    const bad = Object.entries(sources)
      .map(([file, text]) => [file, offenders(text)] as const)
      .filter(([, o]) => o.length > 0)
      .map(([file, o]) => `${file}: ${[...new Set(o)].join(" ")}`);
    expect(bad).toEqual([]);
  });
});
