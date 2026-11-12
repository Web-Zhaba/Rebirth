// Dev benchmark harness for the running game: eval in the page (dev server), then use window.__bench.
// (await (await fetch('/.claude/bench.js')).text()) |> eval
(() => {
  if (window.__bench) return "already";
  const { engine: e, view } = window.__engine;
  history.replaceState = function () {}; // the dev camera hash is rewritten on every moveend: not part of the game
  const q = (a, p) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
  };
  const [lng, lat] = [41.86946, 56.26193];
  // A fixed sun (south-east, 35 deg up over the town), so runs at different game hours compare.
  {
    const r = Math.PI / 180, az = 120 * r, el = 35 * r, la = lat * r, lo = lng * r;
    const east = [-Math.sin(lo), Math.cos(lo), 0];
    const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const sun = [0, 1, 2].map((i) => east[i] * Math.sin(az) * Math.cos(el) + north[i] * Math.cos(az) * Math.cos(el) + up[i] * Math.sin(el));
    e.light = () => ({ sun, intensity: 2.2 });
  }
  const B = (window.__bench = {
    home: view.camera(),
    q,
    async run(at, { warm = 2000, ms = 3000 } = {}) {
      const cpu = [], gpu = [], iv = [];
      let f = 0, on = false, t0 = performance.now();
      const offB = e.onBeforeFrame(() => {
        const g = at(on ? (performance.now() - t0) / ms : 0);
        if (g) view.jumpTo(g);
      });
      const off = e.onFrame((s) => {
        if (on) (cpu.push(s.cpu), iv.push(s.interval), f++);
      });
      const offG = e.onGpu((g) => {
        if (on) gpu.push(g);
      });
      await new Promise((r) => setTimeout(r, warm));
      on = true;
      t0 = performance.now();
      await new Promise((r) => setTimeout(r, ms));
      off(), offB(), offG();
      const mean = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(3);
      return { frames: f, cpu: [q(cpu, 0.5), q(cpu, 0.95), q(cpu, 1)], cpuMean: mean(cpu), gpu: [q(gpu, 0.5), q(gpu, 0.95)], gpuMean: mean(gpu), iv: [q(iv, 0.5), q(iv, 0.95), q(iv, 1)] };
    },
    scenes: {
      tilt: () => ({ center: [lng, lat], distance: 600, heading: 30, pitch: 75 }),
      orbit: (t) => ({ center: [lng, lat], distance: 600, heading: 30 + 180 * t, pitch: 75 }),
      close: (t) => ({ center: [lng, lat], distance: 120, heading: 30 + 90 * t, pitch: 65 }),
      top: () => ({ center: [lng, lat], distance: 2200, heading: 0, pitch: 0 }),
      fly: (t) => ({ center: [lng + 0.05 * t, lat], distance: 1500, heading: 90, pitch: 75 }),
      region: () => ({ center: [lng, lat], distance: 60000, heading: 0, pitch: 40 }),
      globe: (t) => ({ center: [lng + 30 * t, lat], distance: 12000000, heading: 0, pitch: 0 }),
      alps: () => ({ center: [11.4041, 47.2692], distance: 9000, heading: 200, pitch: 75 }),
      alpsOrbit: (t) => ({ center: [11.4041, 47.2692], distance: 9000, heading: 200 + 120 * t, pitch: 75 }),
    },
    // Everything but the terrain stops drawing; returns the undo.
    terrainOnly() {
      const objs = [...e.drawables, e.sky];
      const saved = objs.map((o) => [o.draw, o.compute]);
      objs.forEach((o) => {
        o.draw = () => {};
        if (o.compute) o.compute = () => {};
      });
      return () =>
        objs.forEach((o, i) => {
          o.draw = saved[i][0];
          if (saved[i][1]) o.compute = saved[i][1];
        });
    },
    // Pins the game clock and the weather to the ones first seen (kept in localStorage), paused: frames of different
    // page loads then show the same world.
    pin() {
      const sc = window.simClient;
      sc.setSpeed(0);
      const s = sc.state.value;
      let pin = JSON.parse(localStorage.getItem("bench.pin") || "null");
      if (!pin) localStorage.setItem("bench.pin", JSON.stringify((pin = { gameMinutes: s.gameMinutes, weather: s.weather })));
      const apply = () => {
        const now = sc.state.value;
        if (!now || (now.gameMinutes === pin.gameMinutes && now.weather === pin.weather)) return;
        sc.state.value = { ...now, gameMinutes: pin.gameMinutes, realTime: Date.now(), weather: pin.weather };
        sc.gameClock.value = pin.gameMinutes;
      };
      apply();
      if (!B.pinned) B.pinned = e.onBeforeFrame(apply); // a late snapshot of the worker (its catch-up) would undo it
      return pin.gameMinutes;
    },
    // One frame of a scene as a PNG blob, with every clock held still.
    async shot(name) {
      const at = B.scenes[name];
      const off = e.onBeforeFrame(() => view.jumpTo(at(0.5)));
      // Streaming, the cloud cubes, the shadow map: at least 6 s, then until the terrain has asked for nothing for a
      // second (25 s at most).
      await new Promise((r) => setTimeout(r, 6000));
      for (let quiet = 0, t0 = performance.now(); quiet < 10 && performance.now() - t0 < 19000; ) {
        const st = e.terrain.stats;
        quiet = st.pending + st.inFlight + st.drapePending + st.missing + st.deferredUploads === 0 ? quiet + 1 : 0;
        await new Promise((r) => setTimeout(r, 100));
      }
      const real = performance.now;
      performance.now = () => 5_000_000;
      let n = 0;
      const url = await new Promise((res) => {
        const offF = e.onFrame(() => {
          if (++n < 6) return;
          offF();
          res(e.canvas.toDataURL("image/png"));
        });
      });
      performance.now = real;
      off();
      return await (await fetch(url)).blob();
    },
    // Shots of the scenes into the Cache API under a tag ("before", "after"), progress in window.__shots.
    shots(tag, names = ["tilt", "close", "top", "alps", "region", "globe"]) {
      const S = (window.__shots = { done: false });
      (async () => {
        try {
          B.pin();
          const cache = await caches.open("bench");
          for (const k of names) {
            const blob = await B.shot(k);
            await cache.put(`/shot/${tag}/${k}`, new Response(blob));
            S[k] = blob.size;
          }
          view.jumpTo(B.home);
        } catch (err) {
          S.error = String(err);
        }
        S.done = true;
      })();
      return "started";
    },
    // Pixel difference of two tags' shots of a scene.
    async diff(a, b, name) {
      const cache = await caches.open("bench");
      const px = async (tag) => {
        const r = await cache.match(`/shot/${tag}/${name}`);
        if (!r) return null;
        const bmp = await createImageBitmap(await r.blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [p, r] = [await px(a), await px(b)];
      if (!p || !r) return { missing: true };
      if (p.width !== r.width || p.height !== r.height) return { size: [p.width, p.height, r.width, r.height] };
      let max = 0, sum = 0, n1 = 0, n4 = 0, n16 = 0;
      const box = [1e9, 1e9, -1, -1];
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.max(Math.abs(p.data[i] - r.data[i]), Math.abs(p.data[i + 1] - r.data[i + 1]), Math.abs(p.data[i + 2] - r.data[i + 2]));
        if (!d) continue;
        sum += d;
        if (d > max) max = d;
        n1++;
        if (d > 4) n4++;
        if (d > 16) {
          n16++;
          const x = (i / 4) % p.width, y = Math.floor(i / 4 / p.width);
          box[0] = Math.min(box[0], x), box[1] = Math.min(box[1], y), box[2] = Math.max(box[2], x), box[3] = Math.max(box[3], y);
        }
      }
      const total = p.width * p.height;
      return { max, differing: +(n1 / total * 100).toFixed(3) + "%", over4: n4, over16: n16, box16: n16 ? box : null, meanOfDiffering: n1 ? +(sum / n1).toFixed(2) : 0 };
    },
    // Several runs of one scene with only the terrain drawn, into window.__exp[name].
    exp(name, scenes = ["tilt", "alps"]) {
      const X = (window.__exp ??= {});
      X[name] = { done: false };
      (async () => {
        const undo = B.terrainOnly();
        for (const k of scenes) {
          const r = await B.run(B.scenes[k], { warm: 2500, ms: 2000 });
          X[name][k] = { gpu: r.gpuMean, nodes: e.terrain.stats.nodes };
        }
        undo();
        X[name].done = true;
      })();
      return "started";
    },
    // The whole suite into window.__suite (poll it: a call must return quickly).
    suite(names = ["tilt", "orbit", "close", "top", "fly", "alps", "alpsOrbit", "region", "globe"], opt = { warm: 2500, ms: 3000 }) {
      const S = (window.__suite = { done: false });
      (async () => {
        for (const k of names) {
          S[k] = await B.run(B.scenes[k], opt);
          S[k].nodes = e.terrain.stats.nodes;
        }
        view.jumpTo(B.home);
        S.done = true;
      })();
      return "started";
    },
  });
  return "ready";
})();
