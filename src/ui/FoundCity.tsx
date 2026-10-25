import { useEffect, useRef, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import { found as foundCity } from "../simClient";
import { sampleSite } from "../world/site";
import { landAt, nearRiver, type Land } from "../world/landcover";
import { terrainAt } from "../world/terrain";
import type { Site } from "../sim/types";
import { Icon } from "./Icon";
import { Button, Panel } from "./kit";
import { siteNotes, suggestNames } from "./foundModel";
import "./journal.css";

interface Point {
  lat: number;
  lng: number;
}

interface Info {
  land: Land;
  site: Site;
  elevation: number;
  slope: number;
  river: boolean;
}

const LAND_RU: Record<Land, string> = {
  water: "вода",
  forest: "лес",
  meadow: "луг",
  wetland: "болото",
  sand: "песок",
  rock: "скалы",
  ice: "лёд",
};

const SITE_RADIUS = 150; // m around the clicked spot
const M_PER_DEG = 111320;
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Land around a spot: the sampler turns local metre offsets into lng/lat.
async function survey({ lat, lng }: Point): Promise<Info> {
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const sampler = (x: number, y: number) => landAt(lng + x / kx, lat + y / M_PER_DEG);
  const [land, t, river, site] = await Promise.all([landAt(lng, lat), terrainAt(lng, lat), nearRiver(lng, lat), sampleSite(0, 0, SITE_RADIUS, sampler)]);
  return { land, site, elevation: t.elevation, slope: t.slope, river };
}

export function FoundCity({ map }: { map: maplibregl.Map }) {
  const [point, setPoint] = useState<Point | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const marker = useRef<maplibregl.Marker | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["water"] }).length > 0) {
        setMsg("Здесь вода — выберите сушу");
        return;
      }
      setMsg("");
      const { lat, lng } = e.lngLat;
      if (marker.current) marker.current.setLngLat(e.lngLat);
      else marker.current = new maplibregl.Marker({ color: "#e0a050" }).setLngLat(e.lngLat).addTo(map);
      map.flyTo({ center: e.lngLat, zoom: 14 });
      setPoint({ lat, lng });
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      marker.current?.remove();
      marker.current = null;
    };
  }, [map]);

  // Survey the land under the marker; a newer click drops the older answer.
  useEffect(() => {
    if (!point) return;
    let stale = false;
    setInfo(null);
    setFailed(false);
    survey(point).then(
      (i) => !stale && setInfo(i),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [point]);

  const hasPoint = point !== null;
  useEffect(() => {
    if (hasPoint) input.current?.focus();
  }, [hasPoint]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 40;
  const names = point ? suggestNames(point.lat, point.lng) : [];
  const notes = info ? siteNotes(info.site, info.slope, info.river) : [];

  const found = () => {
    if (!point || !valid) return;
    marker.current?.remove();
    marker.current = null;
    foundCity({ name: trimmed, lat: point.lat, lng: point.lng, foundedAt: Date.now() });
  };

  return (
    <>
      <Panel class="hint">{msg || "Выберите место для нового поселения"}</Panel>
      {point && (
        <Panel class="found" role="group" aria-label="Основание поселения">
          <form
            class="found-form"
            onSubmit={(e) => {
              e.preventDefault();
              found();
            }}
          >
            <div class="found-head">
              <Icon name="tent" size={20} />
              <h2>Основать поселение</h2>
            </div>
            <div class="coords">
              {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
            </div>
            <div class="found-land" aria-live="polite">
              {failed && <div class="found-note">Не удалось осмотреть землю: карта ещё грузится.</div>}
              {!info && !failed && <div class="found-note">Осматриваем землю…</div>}
              {info && (
                <>
                  <dl class="found-facts">
                    <dt>Под лагерем</dt>
                    <dd>{LAND_RU[info.land]}</dd>
                    <dt>Высота</dt>
                    <dd>{Math.round(info.elevation)} м</dd>
                    <dt>Уклон</dt>
                    <dd>{Math.round(info.slope)}°</dd>
                    <dt>Лес вокруг</dt>
                    <dd>{pct(info.site.forest)}</dd>
                    <dt>Вода вокруг</dt>
                    <dd>{pct(info.site.water)}</dd>
                    <dt>Камень, песок</dt>
                    <dd>{pct(info.site.rock)}</dd>
                  </dl>
                  {notes.length > 0 && (
                    <ul class="found-notes">
                      {notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div class="found-names" role="group" aria-label="Подходящие названия">
              {names.map((n) => (
                <button
                  key={n}
                  type="button"
                  class="chip-btn"
                  aria-pressed={trimmed === n}
                  onClick={() => {
                    setName(n);
                    input.current?.focus();
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              ref={input}
              type="text"
              maxLength={40}
              aria-label="Название поселения"
              placeholder="Название поселения"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <Button type="submit" variant="primary" disabled={!valid}>
              Основать
            </Button>
          </form>
        </Panel>
      )}
    </>
  );
}
