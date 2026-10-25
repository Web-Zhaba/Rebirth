import { describe, expect, it } from "vitest";
import { parseSearch, searchUrl } from "./geocode";

describe("geocode", () => {
  it("builds a place-only search URL biased to the centre", () => {
    const u = new URL(searchUrl("  Верхние Луги ", { lng: 37.6, lat: 55.75 }));
    expect(u.origin + u.pathname).toBe("https://photon.komoot.io/api/");
    expect(u.searchParams.get("q")).toBe("Верхние Луги");
    expect(u.searchParams.get("osm_tag")).toBe("place");
    expect(u.searchParams.get("lat")).toBe("55.750");
    expect(u.searchParams.get("lon")).toBe("37.600");
    expect(new URL(searchUrl("x")).searchParams.has("lat")).toBe(false);
  });

  it("parses hits with kind, region and a normalised bbox", () => {
    const hits = parseSearch({
      features: [
        {
          properties: {
            osm_value: "hamlet",
            name: "Верхние Луги",
            county: "Демидовский муниципальный округ",
            state: "Смоленская область",
            country: "Россия",
            extent: [31.47, 55.449, 31.487, 55.442],
          },
          geometry: { coordinates: [31.48, 55.446] },
        },
        { properties: { name: "Россия", osm_value: "country", country: "Россия" }, geometry: { coordinates: [100, 60] } },
        { properties: { osm_value: "village" }, geometry: { coordinates: [1, 2] } },
      ],
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      name: "Верхние Луги",
      kind: "деревня",
      where: "Демидовский муниципальный округ, Смоленская область, Россия",
      lng: 31.48,
      lat: 55.446,
      bbox: [31.47, 55.442, 31.487, 55.449],
    });
    expect(hits[1].where).toBe("");
    expect(parseSearch(null)).toEqual([]);
  });
});
