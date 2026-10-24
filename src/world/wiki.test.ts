import { afterEach, describe, expect, it, vi } from "vitest";
import { articlesNear, extracts, extractsUrl, geoUrl, parseExtracts, parseGeo } from "./wiki";

describe("wiki urls", () => {
  it("builds geosearch URL with clamped radius", () => {
    const u = new URL(geoUrl(59.1244, 37.9189, 999999, "ru"));
    expect(u.host).toBe("ru.wikipedia.org");
    expect(u.searchParams.get("list")).toBe("geosearch");
    expect(u.searchParams.get("gscoord")).toBe("59.1244|37.9189");
    expect(u.searchParams.get("gsradius")).toBe("10000");
    expect(u.searchParams.get("gslimit")).toBe("50");
    expect(u.searchParams.get("origin")).toBe("*");
    expect(new URL(geoUrl(1, 2, 1, "en")).searchParams.get("gsradius")).toBe("10");
  });
  it("builds extracts URL", () => {
    const u = new URL(extractsUrl([1, 2, 3], "en"));
    expect(u.host).toBe("en.wikipedia.org");
    expect(u.searchParams.get("pageids")).toBe("1|2|3");
    expect(u.searchParams.get("exchars")).toBe("800");
    expect(u.searchParams.get("explaintext")).toBe("1");
  });
});

describe("wiki parsing", () => {
  it("parses geosearch", () => {
    const hits = parseGeo({
      query: { geosearch: [{ pageid: 5, ns: 0, title: "Собор", lat: 59.12, lon: 37.9, dist: 120.5 }, { bad: 1 }] },
    });
    expect(hits).toEqual([{ pageid: 5, title: "Собор", lat: 59.12, lng: 37.9, dist: 120.5 }]);
    expect(parseGeo({})).toEqual([]);
  });
  it("parses extracts and skips empty ones", () => {
    const m = parseExtracts(
      { query: { pages: { "5": { pageid: 5, title: "Собор", extract: "Текст" }, "6": { pageid: 6, title: "X" } } } },
      "ru",
    );
    expect([...m.keys()]).toEqual([5]);
    expect(m.get(5)).toEqual({ title: "Собор", extract: "Текст", url: "https://ru.wikipedia.org/?curid=5" });
  });
});

describe("wiki client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: unknown) => ({ ok: true, json: async () => body });

  it("falls back to en and sorts by distance", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("ru.wikipedia")) return reply({ query: { geosearch: [] } });
      return reply({
        query: {
          geosearch: [
            { pageid: 2, title: "B", lat: 1, lon: 1, dist: 50 },
            { pageid: 1, title: "A", lat: 1, lon: 1, dist: 10 },
            { pageid: 1, title: "A", lat: 1, lon: 1, dist: 10 },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await articlesNear(11.111, 22.222, 500);
    expect(out.map((a) => a.pageid)).toEqual([1, 2]);
    expect(out[0].lang).toBe("en");
  });

  it("batches extracts by 20", async () => {
    const fetchMock = vi.fn(async () => reply({ query: { pages: {} } }));
    vi.stubGlobal("fetch", fetchMock);
    await extracts(Array.from({ length: 45 }, (_, i) => i + 100), "ru");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (n++ === 0 ? { ok: false, status: 500, json: async () => ({}) } : reply({ query: { geosearch: [] } }))),
    );
    await expect(articlesNear(33.3, 44.4, 100)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    await expect(articlesNear(33.3, 44.4, 100)).resolves.toEqual([]);
  });
});
