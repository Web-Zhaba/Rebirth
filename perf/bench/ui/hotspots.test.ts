// Where the two slowest view models spend their time, part by part, so a fix can be checked against the same probes.
// Run: npx vitest run perf/bench/ui/hotspots.test.ts --reporter=verbose
import { it } from "vitest";
import { loadFixture, time } from "./fixture";
import * as heritage from "../../../src/ui/heritageModel";
import * as places from "../../../src/ui/placesModel";
import { streetFoundations, streetProgress } from "../../../src/sim/streets";
import { digBlocker, streetDigs, streetOf } from "../../../src/sim/digging";
import type { ClientState } from "../../../src/sim/types";

const ms = (name: string, fn: () => unknown, samples = 15): string => `${name.padEnd(42)} ${time(name, fn, { samples }).median.toFixed(3)} ms`;

it("placesView: which input drives the cost", async () => {
  const f = await loadFixture();
  const st = f.state;
  const variant = (name: string, finds: Partial<ClientState["finds"]>): void => {
    const s = { ...st, finds: { ...st.finds, ...finds } };
    console.log(ms(name, () => places.placesView(s)));
  };
  variant("full", {});
  variant("without the features", { features: [] });
  variant("without the foundations", { foundations: [] });
  variant("without places", { pois: [] });
  variant("streets only", { foundations: [], features: [], pois: [] });
  console.log(`counts: ${st.finds.streets.length} old streets, ${st.finds.features.length} features, ${st.finds.foundations.length} foundations, ${st.finds.pois.length} places`);
}, 300000);

it("buildOutlineView: what it walks", async () => {
  const f = await loadFixture();
  const st = f.state;
  const ghost = st.finds.foundations[0];
  const own = streetFoundations(st.finds.streets, st.finds.foundations);
  console.log(ms("buildOutlineView", () => heritage.buildOutlineView(ghost, st)));
  console.log(ms("streetFoundations (foundations × streets)", () => streetFoundations(st.finds.streets, st.finds.foundations)));
  console.log(ms("streetOf → streetFoundations again", () => streetOf(st, ghost.id)));
  console.log(ms("streetDigs → streetFoundations again", () => streetDigs(st, st.finds.streets[0].id)));
  console.log(ms("digBlocker × every foundation (× buildings)", () => { for (const g of st.finds.foundations) digBlocker(st, g); }));
  console.log(ms("streetProgress × every street (Set of 481 each)", () => { for (const s of st.finds.streets) streetProgress(st, s, own.get(s.id) ?? []); }));
}, 300000);
