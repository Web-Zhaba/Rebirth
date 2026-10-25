import { useEffect, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import { selectedBuilding } from "../map/buildingLayer";
import { flyOrJump } from "../map/motion";
import { etaRealMs, formatReal } from "../sim/buildEta";
import { BUILDINGS } from "../sim/buildings";
import { isCleared } from "../sim/clearing";
import { ROAD_KINDS, workableEdges } from "../sim/roads";
import { frame, gameClock, speed, state } from "../simClient";
import { plural } from "./InspectorParts";
import { Panel, ProgressBar } from "./kit";

const MAX_SHOWN = 6;
const KEY = "rebirth.builders.collapsed";
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

interface Task {
  key: string;
  title: string;
  value: number; // 0..1
  left: number; // person-hours still to do
  at?: [number, number]; // local meters: the title flies the map there, hover rings it
  building?: number; // building id: the title also opens its card
  prio: boolean; // the player put this site first
}

// Construction work the builders are on now: houses and workshops going up (or being rebuilt), roads they can reach,
// land being cleared. Bottom-right of the HUD, on the build bar's line. Collapsible (remembered). Sites are listed in the
// order the builders take them: the priority site first, then the rest. Each row shows when it is expected to finish.
export function BuilderTasks({ map }: { map: maplibregl.Map }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const s = state.value;
  const fl = frame.value;

  // Ring over the hovered site, so the row and its place on the map point at each other. An HTML marker, so it does
  // not depend on the map style being ready.
  useEffect(() => {
    if (!hover || !fl) return;
    const el = document.createElement("div");
    el.className = "builder-focus-ring";
    const ring = new maplibregl.Marker({ element: el }).setLngLat(fl.toLngLat(hover[0], hover[1])).addTo(map);
    return () => {
      ring.remove();
    };
  }, [hover, fl, map]);

  if (!s) return null;
  const priority = s.levers?.priority ?? null;
  const tasks: Task[] = [];
  for (const b of Object.values(s.buildings)) {
    const name = BUILDINGS[b.template]?.name ?? b.template;
    const at: [number, number] = [b.lot.cx, b.lot.cy];
    if (b.state === "building") tasks.push({ key: `b${b.id}`, title: name, value: b.labor > 0 ? b.done / b.labor : 0, left: Math.max(0, b.labor - b.done), at, building: b.id, prio: priority === b.id });
    if (b.upgrade) tasks.push({ key: `u${b.id}`, title: `${name}: перестройка`, value: b.upgrade.labor > 0 ? b.upgrade.done / b.upgrade.labor : 0, left: Math.max(0, b.upgrade.labor - b.upgrade.done), at, building: b.id, prio: priority === b.id });
  }
  const reachable = new Set(workableEdges(s.roads));
  for (const e of Object.values(s.roads.edges)) {
    if (!reachable.has(e.id)) continue;
    const a = s.roads.nodes[e.a];
    const b = s.roads.nodes[e.b];
    const at: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    tasks.push({ key: `r${e.id}`, title: `${ROAD_KINDS[e.kind].name}, ${Math.round(e.length)} м`, value: e.labor > 0 ? e.done / e.labor : 0, left: Math.max(0, e.labor - e.done), at, prio: false });
  }
  for (const c of s.clearings) {
    if (isCleared(c)) continue;
    const at: [number, number] = [c.pts.reduce((t, p) => t + p[0], 0) / c.pts.length, c.pts.reduce((t, p) => t + p[1], 0) / c.pts.length];
    tasks.push({ key: `c${c.id}`, title: "Вырубка", value: c.labor > 0 ? c.done / c.labor : 0, left: Math.max(0, c.labor - c.done), at, prio: priority === -c.id });
  }
  // The priority site first; the rest keep their order.
  tasks.sort((p, q) => Number(q.prio) - Number(p.prio));

  const builders = s.people?.builders ?? 0;
  const gm = gameClock.value;
  let ahead = 0;
  const etaText = (personHours: number): string => {
    if (builders <= 0) return "некому строить";
    const ms = etaRealMs(personHours, builders, gm, speed.value, s.levers);
    if (Number.isFinite(ms)) return formatReal(ms);
    return speed.value === 0 ? "пауза" : "нет срока";
  };
  const rows = tasks.slice(0, MAX_SHOWN).map((t) => {
    ahead += t.left;
    return { ...t, eta: etaText(ahead) };
  });
  const rest = tasks.length - rows.length;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  return (
    <Panel class="builder-tasks" aria-label="Задачи строителей">
      <button type="button" class="builder-tasks-head" aria-expanded={!collapsed} aria-controls="builder-tasks-body" onClick={toggle}>
        <span>Строители: {builders}</span>
        <span class="builder-tasks-count">{tasks.length > 0 ? `${tasks.length} ${plural(tasks.length, "работа", "работы", "работ")}` : "работы нет"}</span>
      </button>
      {tasks.length > 0 && (
        <ul class="builder-tasks-list" id="builder-tasks-body" hidden={collapsed}>
          {rows.map((t) => (
            <li key={t.key} class="builder-task" onMouseEnter={() => setHover(t.at ?? null)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(t.at ?? null)} onBlur={() => setHover(null)}>
              <div class="builder-task-line">
                {t.at && fl ? (
                  <button
                    type="button"
                    class="link builder-task-title"
                    title="Показать на карте"
                    onClick={() => {
                      flyOrJump(map, { center: fl.toLngLat(t.at![0], t.at![1]), zoom: Math.max(map.getZoom(), 17) });
                      if (t.building !== undefined) selectedBuilding.value = t.building;
                    }}
                  >
                    {t.title}
                  </button>
                ) : (
                  <span class="builder-task-title">{t.title}</span>
                )}
                {t.prio && <span class="builder-task-first">первым</span>}
                <span class="builder-task-eta">{t.eta}</span>
              </div>
              <ProgressBar value={t.value} label={t.title} />
            </li>
          ))}
          {rest > 0 && <li class="builder-tasks-more">и ещё {rest}</li>}
        </ul>
      )}
    </Panel>
  );
}
