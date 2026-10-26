import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import type { WeatherState } from "../sim/weather";
import { PALETTE } from "../ui/palette";
import { precipDensity, precipSlant, precipVisibility } from "./weatherMath";
import { weatherMapOn } from "./weatherSettings";

interface Drop {
  x: number;
  y: number;
  vy: number;
  len: number;
  size: number;
  sway: number;
  phase: number;
}

const withAlpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Rain and snow over the town: a 2D canvas above the map, alive only at town zoom while something actually falls.
export function attachPrecipitation(map: maplibregl.Map, opts: { weather: ReadonlySignal<WeatherState | null> }): () => void {
  const container = map.getContainer();
  const canvas = document.createElement("canvas");
  canvas.className = "precip-canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return () => {};
  }

  let w = 1;
  let h = 1;
  let raf = 0;
  let running = false;
  let lastTs = 0;
  const drops: Drop[] = [];

  const spawn = (): Drop => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vy: 220 + Math.random() * 280,
    len: 6 + Math.random() * 10,
    size: 0.8 + Math.random() * 1.4,
    sway: 10 + Math.random() * 18,
    phase: Math.random() * Math.PI * 2,
  });

  const fit = (n: number) => {
    while (drops.length < n) drops.push(spawn());
    if (drops.length > n) drops.length = n;
  };

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, container.clientWidth);
    h = Math.max(1, container.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops.length = 0;
  };

  const stopLoop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, w, h);
  };

  const frame = (ts: number) => {
    if (!running) return;
    const ws = opts.weather.peek();
    const vis = precipVisibility(map.getZoom());
    const density = ws && weatherMapOn.peek() && !reducedMotion ? precipDensity(ws.now.precip) : 0;
    if (!ws || vis <= 0 || density <= 0.02 || document.hidden) {
      stopLoop();
      return;
    }
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = vis * (0.35 + 0.65 * density);
    const cap = w < 640 ? 180 : 500;
    const max = Math.min(cap, Math.round((w * h) / 2600));
    fit(Math.max(1, Math.round(max * density)));

    if (ws.now.snow) {
      ctx.fillStyle = withAlpha(PALETTE.paperRaised, 0.7);
      for (const p of drops) {
        p.y += p.vy * 0.22 * dt;
        p.x += Math.sin(p.phase + ts * 0.0012) * p.sway * dt;
        if (p.y > h + 4) {
          p.y = -4;
          p.x = Math.random() * w;
        }
        if (p.x < -4) p.x = w + 4;
        else if (p.x > w + 4) p.x = -4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const slant = precipSlant(ws.now.wind);
      ctx.strokeStyle = withAlpha(PALETTE.info, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of drops) {
        p.y += p.vy * dt;
        p.x += slant * p.vy * dt;
        if (p.y > h + 20 || p.x < -20 || p.x > w + 20) {
          p.y = -20;
          p.x = Math.random() * w;
        }
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - slant * p.len, p.y - p.len);
      }
      ctx.stroke();
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running) return;
    try {
      const ws = opts.weather.peek();
      const density = ws && weatherMapOn.peek() && !reducedMotion ? precipDensity(ws.now.precip) : 0;
      if (!ws || document.hidden || precipVisibility(map.getZoom()) <= 0 || density <= 0.02) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      running = true;
      lastTs = 0;
      raf = requestAnimationFrame(frame);
    } catch {
      stopLoop();
    }
  };

  const onVisibility = () => {
    if (document.hidden) stopLoop();
    else {
      resize();
      start();
    }
  };

  const observer = new ResizeObserver(() => {
    resize();
    start();
  });
  observer.observe(container);

  map.on("resize", resize);
  map.on("zoom", start);
  map.on("moveend", start);
  document.addEventListener("visibilitychange", onVisibility);

  const stopWeather = effect(() => {
    opts.weather.value;
    void weatherMapOn.value;
    if (!weatherMapOn.value) stopLoop();
    else start();
  });

  resize();
  start();

  return () => {
    stopLoop();
    stopWeather();
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    try {
      map.off("resize", resize);
      map.off("zoom", start);
      map.off("moveend", start);
    } catch {
      // The map may already be removed.
    }
    canvas.remove();
  };
}
