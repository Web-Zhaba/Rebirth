import { describe, expect, it } from "vitest";
import { ARTICLE_CAP, addArticles, parseArticles } from "./articles";
import { emptyGrowth } from "./growth";
import { Handler, type Storage } from "./handler";
import type { ArticleInput, FromWorker } from "./protocol";
import { emptyRoads } from "./roads";
import { parseSave } from "./save";
import type { City, SaveV4, SimState } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Череповец", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
const town = (gm = 500): SimState => ({ realTime: NOW, gameMinutes: gm, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(3, gm) });
const art = (n: number, o: Partial<ArticleInput> = {}): ArticleInput => ({
  id: `ru:${n}`,
  title: `Статья ${n}`,
  extract: "Текст статьи.",
  url: `https://ru.wikipedia.org/?curid=${n}`,
  lang: "ru",
  lat: 59.12,
  lng: 37.9,
  ...o,
});
const ok = (s: SimState, articles: ArticleInput[]): SimState => {
  const r = addArticles(s, { articles });
  if (!r.ok) throw new Error(r.reason);
  return r.sim;
};

describe("addArticles", () => {
  it("stores articles with the game time and writes a chronicle line each", () => {
    const s = ok(town(), [art(1, { title: "Дом И. А. Милютина" }), art(2)]);
    expect(s.articles.map((a) => [a.id, a.at])).toEqual([["ru:1", 500], ["ru:2", 500]]);
    expect(s.chronicle.map((e) => e.text)).toEqual(["В записной книжке: «Дом И. А. Милютина»", "В записной книжке: «Статья 2»"]);
  });
  it("dedupes by id, also inside one command, and returns the same state when nothing is new", () => {
    const s = ok(town(), [art(1), art(1), art(2)]);
    expect(s.articles).toHaveLength(2);
    const r = addArticles(s, { articles: [art(1), art(2)] });
    expect(r.ok && r.sim === s).toBe(true);
    expect(ok(s, [art(3), art(1)]).articles.map((a) => a.id)).toEqual(["ru:1", "ru:2", "ru:3"]);
  });
  it("trims the extract to 800 characters", () => {
    expect(ok(town(), [art(1, { extract: "я".repeat(2000) })]).articles[0].extract).toHaveLength(800);
  });
  it("rejects malformed input without changing anything", () => {
    const bad: unknown[] = [
      art(1, { id: "x:1" }),
      art(1, { id: "en:1" }), // id language differs from lang
      art(1, { lang: "de" as "ru" }),
      art(1, { title: "" }),
      art(1, { extract: "" }),
      art(1, { url: "https://evil.example/?curid=1" }),
      art(1, { lat: 99 }),
      art(1, { lng: Number.NaN }),
      null,
      "x",
    ];
    for (const b of bad) expect(addArticles(town(), { articles: [art(5), b as ArticleInput] }).ok).toBe(false);
    expect(addArticles(town(), { articles: "x" as unknown as ArticleInput[] }).ok).toBe(false);
    expect(addArticles(town(), { articles: Array.from({ length: 101 }, (_, i) => art(i + 1)) }).ok).toBe(false);
  });
  it("caps the list at 500, keeping the first ones", () => {
    let s = town();
    for (let i = 0; i < 6; i++) s = ok(s, Array.from({ length: 100 }, (_, k) => art(i * 100 + k + 1)));
    expect(s.articles).toHaveLength(ARTICLE_CAP);
    expect(s.articles[ARTICLE_CAP - 1].id).toBe("ru:500");
    expect(ok(s, [art(9999)])).toBe(s);
  });
});

describe("articles in saves", () => {
  const save = (sim: SimState): unknown => JSON.parse(JSON.stringify({ version: 4, city, sim } satisfies SaveV4));
  it("survive a round trip; a new town and an older save get an empty list", () => {
    expect(emptyGrowth(1).articles).toEqual([]);
    const s = ok(town(), [art(1), art(2, { lang: "en", id: "en:2", url: "https://en.wikipedia.org/?curid=2" })]);
    expect(parseSave(save(s), NOW)!.sim.articles).toEqual(s.articles);
    const raw = save(s) as { sim: Record<string, unknown> };
    delete raw.sim.articles;
    expect(parseSave(raw, NOW)!.sim.articles).toEqual([]);
  });
  it("a malformed record never loses the town; broken entries are dropped", () => {
    for (const junk of [7, "x", {}, null]) {
      const raw = save(town()) as { sim: Record<string, unknown> };
      raw.sim.articles = junk;
      const p = parseSave(raw, NOW);
      expect(p).not.toBeNull();
      expect(p!.sim.articles).toEqual([]);
    }
    const good = { ...art(1), at: 3 };
    expect(parseArticles([good, { ...good, id: "ru:2", at: "x" }, { ...good, title: 5 }, good, 7]).map((a) => a.id)).toEqual(["ru:1"]);
  });
});

describe("addArticles through the worker", () => {
  it("is acknowledged, persisted, posted once and a repeat changes nothing", async () => {
    let stored: unknown = JSON.parse(JSON.stringify({ version: 4, city, sim: town() }));
    const storage: Storage = { get: async () => stored, put: async (x) => void (stored = JSON.parse(JSON.stringify(x))), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    await h.handle({ t: "cmd", id: 1, cmd: { type: "addArticles", articles: [art(1, { title: "Дом Милютина" })] } });
    expect(out.filter((m) => m.t === "cmdResult")).toEqual([{ t: "cmdResult", id: 1, ok: true }]);
    const snaps = out.filter((m): m is Extract<FromWorker, { t: "snapshot" }> => m.t === "snapshot");
    const snap = snaps[snaps.length - 1];
    expect(snap.articles?.map((a) => a.id)).toEqual(["ru:1"]);
    expect(snap.chronicle?.some((e) => e.text.includes("Милютина"))).toBe(true);
    expect((stored as SaveV4).sim.articles).toHaveLength(1);
    const before = out.length;
    await h.handle({ t: "cmd", id: 2, cmd: { type: "addArticles", articles: [art(1)] } });
    expect(out.slice(before)).toEqual([{ t: "cmdResult", id: 2, ok: true }]);
    await h.handle({ t: "cmd", id: 3, cmd: { type: "addArticles", articles: [{ nope: 1 } as unknown as ArticleInput] } });
    expect(out.filter((m) => m.t === "cmdResult").pop()).toMatchObject({ id: 3, ok: false });
  });
});
