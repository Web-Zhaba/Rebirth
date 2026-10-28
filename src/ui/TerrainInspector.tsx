import { useEffect, useState } from "preact/hooks";
import { formatCoordinates } from "./coordsModel";
import type * as maplibregl from "maplibre-gl";
import { landAt, nearRiver, type Land } from "../world/landcover";
import { terrainAt } from "../world/terrain";

const LAND_RU: Record<Land, string> = {
  water: "Вода",
  forest: "Лес",
  meadow: "Луг",
  wetland: "Болото",
  sand: "Песок",
  rock: "Скалы",
  ice: "Лёд",
};

interface Info {
  land: Land;
  elevation: number;
  slope: number;
  river: boolean;
  lat: number;
  lng: number;
}

const MIN_ZOOM = 13;
const THROTTLE_MS = 150;

export function TerrainInspector({ map }: { map: maplibregl.Map }) {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let last = 0;
    let seq = 0;
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const now = Date.now();
      if (map.getZoom() < MIN_ZOOM) {
        seq++;
        setInfo(null);
        return;
      }
      if (now - last < THROTTLE_MS) return;
      last = now;
      const mine = ++seq;
      const { lng, lat } = e.lngLat;
      Promise.all([landAt(lng, lat), terrainAt(lng, lat), nearRiver(lng, lat)])
        .then(([land, t, river]) => {
          if (mine === seq) setInfo({ land, elevation: t.elevation, slope: t.slope, river, lat, lng });
        })
        .catch(() => {
          if (mine === seq) setInfo(null);
        });
    };
    const onOut = () => {
      seq++;
      setInfo(null);
    };
    map.on("mousemove", onMove);
    map.getCanvas().addEventListener("mouseout", onOut);
    return () => {
      map.off("mousemove", onMove);
      map.getCanvas().removeEventListener("mouseout", onOut);
    };
  }, [map]);

  const coords = info ? formatCoordinates(info.lat, info.lng) : "";
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!info || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(coords).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => setCopied(false),
    );
  };

  if (!info) return null;
  return (
    <div class="cell-panel panel">
      <div class="cell-land">{LAND_RU[info.land]}</div>
      <div>Высота: {Math.round(info.elevation)} м</div>
      <div>Уклон: {Math.round(info.slope)}°</div>
      {info.river && <div>Река рядом</div>}
      <button class="cell-coords" type="button" title="Скопировать координаты" onClick={copy}>
        {copied ? "Скопировано" : coords}
      </button>
    </div>
  );
}
