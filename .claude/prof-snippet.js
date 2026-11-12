// Paste into the DevTools console of the running game (dev server), zoom to the planet and back, then run __prof().
(() => {
  const { engine: e } = window.__engine;
  const peak = {};
  const slow = [];
  let cur = {};
  const note = (name, ms) => {
    peak[name] = Math.max(peak[name] || 0, ms);
    cur[name] = (cur[name] || 0) + ms;
  };
  const wrap = (obj, key, name) => {
    const f = obj[key];
    obj[key] = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally { note(name, performance.now() - t); }
    };
  };
  const label = (f) => f.toString().split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ").slice(0, 70);
  wrap(e.terrain, "update", "terrain.update");
  wrap(e.overlay, "update", "overlay.update");
  e.drawables.forEach((d, i) => d.update && wrap(d, "update", `drawable ${i} ${d.constructor?.name}`));
  for (const set of [e.beforeFrameListeners, e.frameListeners]) {
    const kind = set === e.beforeFrameListeners ? "before" : "after";
    const fs = [...set];
    set.clear();
    fs.forEach((f, i) => {
      const name = `${kind} ${i}: ${label(f)}`;
      set.add((...a) => { const t = performance.now(); f(...a); note(name, performance.now() - t); });
    });
  }
  // A frame's interval is measured at the next frame's start, so slow frames are told by what they spent themselves;
  // a long gap the previous frame did not spend on itself was spent outside the engine's JS (GPU, GC, other tasks).
  const gaps = [];
  let prevTotal = 0;
  e.onFrame(({ interval }) => {
    const total = Object.values(cur).reduce((a, b) => a + b, 0);
    if (total > 50) slow.push({ ms: Math.round(total), dist: Math.round(e.state.distance), top: Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${Math.round(v)} ${k}`).join(" | ") });
    if (interval > 60 && interval - prevTotal > 50) gaps.push({ interval: Math.round(interval), engineJs: Math.round(prevTotal), gpu: e.timer ? +e.timer.last.toFixed(1) : null, dist: Math.round(e.state.distance), pages: e.terrain.stats.pages, drape: e.terrain.stats.drapePages });
    prevTotal = total;
    cur = {};
  });
  const tasks = [];
  try {
    new PerformanceObserver((l) => { for (const t of l.getEntries()) tasks.push({ at: Math.round(t.startTime), ms: Math.round(t.duration), by: t.attribution?.map((a) => a.containerSrc || a.name).join(",") }); }).observe({ type: "longtask" });
  } catch {}
  window.__prof = () => {
    console.table(Object.entries(peak).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ phase: k, peakMs: Math.round(v) })));
    console.table(slow.slice(-20));
    console.table(gaps.slice(-20));
    console.table(tasks.slice(-20));
  };
  console.log("profiling on: zoom to the planet and back, then run __prof()");
})();
