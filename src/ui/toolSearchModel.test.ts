import { describe, expect, it } from "vitest";
import { searchEntries, searchTools } from "./toolSearchModel";

describe("tool search", () => {
  const entries = searchEntries();
  it("lists every tool and the kinds of a tool that differ from it", () => {
    expect(entries.some((e) => e.tool === "house" && !e.kind)).toBe(true);
    expect(entries.some((e) => e.tool === "house" && e.kind === "izba")).toBe(false); // «Дом» is the tool itself
    expect(entries.find((e) => e.kind === "izba5")).toMatchObject({ tool: "house", label: "Большой дом", sub: "Дом" });
    expect(entries.find((e) => e.kind === "stone")).toMatchObject({ tool: "dirt", label: "Каменная дорога" });
    expect(entries.find((e) => e.kind === "logyard")).toMatchObject({ tool: "barn" });
  });
  it("finds a kind by its name, start of the name first, ё as е", () => {
    expect(searchTools("кузн")[0]).toMatchObject({ tool: "workshop", kind: "smithy" });
    expect(searchTools("таверн")[0]).toMatchObject({ tool: "shop", kind: "tavern" });
    expect(searchTools("дом")[0]).toMatchObject({ tool: "house" });
    expect(searchTools("каменн").map((h) => h.kind)).toEqual(expect.arrayContaining(["stone", "stonebridge"]));
    expect(searchTools("пасек")[0]).toMatchObject({ tool: "apiary" });
    expect(searchTools("")).toEqual([]);
    expect(searchTools("ыыы")).toEqual([]);
    expect(searchTools("а").length).toBeLessThanOrEqual(8);
  });
  it("finds the tools of a category by its name after those named so", () => {
    const food = searchTools("еда", entries, 20);
    expect(food.map((h) => h.tool)).toEqual(expect.arrayContaining(["field", "gumno", "apiary"]));
  });
});
