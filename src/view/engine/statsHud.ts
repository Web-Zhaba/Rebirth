import type { Engine } from "../../engine/engine";
import type { Forest } from "../../engine/scene/forest";

// Engine stats over the map (docs/PLAN-engine.md N6), for development: frame times, the terrain's nodes and pages and
// what the forest's GPU culling did (candidates, drawn, taken by the frustum and by the occluders). `?stats=1` shows it
// and is remembered, `?stats=0` hides it again.

const EVERY_MS = 250;

function wanted(): boolean {
  let v = new URLSearchParams(location.search).get("stats");
  try {
    if (v === "1" || v === "0") localStorage.setItem("engineStats", v);
    else v = localStorage.getItem("engineStats");
  } catch {
    // storage blocked: the URL alone decides
  }
  return v === "1";
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));

export function attachStatsHud(engine: Engine, container: HTMLElement, forest: Forest): void {
  if (!wanted()) return;
  const hud = document.createElement("pre");
  hud.className = "engine-stats";
  hud.setAttribute("aria-hidden", "true");
  container.append(hud);
  let cpu = 0;
  let at = 0;
  let scatter = 0;
  if (forest.timer) forest.timer.onSample = (ms) => (scatter = scatter * 0.9 + ms * 0.1);
  engine.onFrame(({ now, cpu: c, interval }) => {
    cpu = cpu * 0.95 + c * 0.05;
    if (now - at < EVERY_MS) return;
    at = now;
    const t = engine.terrain.stats;
    const fs = forest.stats;
    const fc = forest.culling;
    const gpu = engine.timer ? `${engine.timer.last.toFixed(2)} ms` : "n/a";
    hud.textContent = [
      `frame ${interval.toFixed(1)} ms  cpu ${cpu.toFixed(2)} ms  gpu ${gpu}`,
      `terrain ${t.nodes} nodes  pages ${t.pages}/${t.pageLayers}  drape ${t.drapePages}`,
      fs.jobs
        ? `forest ${k(fc.drawn)} drawn of ${k(fs.candidates)} candidates (${fs.jobs} tiles)\n  culled: frustum ${k(fc.frustum)}, occluded ${k(fc.occluded)}${forest.occlusion ? "" : " (test off)"}\n  scatter ${forest.timer ? scatter.toFixed(2) + " ms" : "n/a"}  reach ${Number.isFinite(fs.reach) ? Math.round(fs.reach) + " m" : "all"}`
        : "forest: none in view",
    ].join("\n");
  });
}
