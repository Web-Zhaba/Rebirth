import { useEffect, useState } from "preact/hooks";
import { formatCoordinates } from "./coordsModel";
import { mppAtZoom, type View, type ViewPointer } from "../view/view";
import { landAt, nearRiver, type Land } from "../world/landcover";
import { terrainAt } from "../world/terrain";
import { L } from "../i18n";

const LAND_RU: Record<Land, string> = {
  water: L("Вода", "Water"),
  forest: L("Лес", "Forest"),
  meadow: L("Луг", "Meadow"),
  wetland: L("Болото", "Marsh"),
  sand: L("Песок", "Sand"),
  rock: L("Скалы", "Rock"),
  ice: L("Лёд", "Ice"),
};

interface Info {
  land: Land;
  elevation: number;
  slope: number;
  river: boolean;
  lat: number;
  lng: number;
}

const MAX_MPP = mppAtZoom(13); // inspect only closer than old zoom 13
const THROTTLE_MS = 150;

export function TerrainInspector({ view }: { view: View }) {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let last = 0;
    let seq = 0;
    const onMove = (e: ViewPointer) => {
      const now = Date.now();
      if (view.metersPerPixel() > MAX_MPP) {
        seq++;
        setInfo(null);
        return;
      }
      if (now - last < THROTTLE_MS) return;
      last = now;
      const mine = ++seq;
      const [lng, lat] = e.lngLat;
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
    const off = view.on("pointermove", onMove);
    view.canvas.addEventListener("pointerleave", onOut);
    return () => {
      off();
      view.canvas.removeEventListener("pointerleave", onOut);
    };
  }, [view]);

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
    <aside class="cell-panel panel" aria-label={L("Участок под курсором", "Ground under the cursor")}>
      <div class="cell-land">{LAND_RU[info.land]}</div>
      <div>{L("Высота:", "Elevation:")} {Math.round(info.elevation)} {L("м", "m")}</div>
      <div>{L("Уклон:", "Slope:")} {Math.round(info.slope)}°</div>
      {info.river && <div>{L("Река рядом", "River nearby")}</div>}
      <button class="cell-coords" type="button" title={L("Скопировать координаты", "Copy coordinates")} onClick={copy}>
        {copied ? L("Скопировано", "Copied") : coords}
      </button>
    </aside>
  );
}
