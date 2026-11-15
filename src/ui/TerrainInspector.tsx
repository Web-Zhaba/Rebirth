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

// The card shows the ground the player clicked; panning the camera or pressing Escape dismisses it.
export function TerrainInspector({ view }: { view: View }) {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let seq = 0;
    const dismiss = () => {
      seq++;
      setInfo(null);
    };
    const onClick = (e: ViewPointer) => {
      if (view.metersPerPixel() > MAX_MPP) return dismiss();
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const offClick = view.on("click", onClick);
    const offDrag = view.on("dragstart", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      offClick();
      offDrag();
      window.removeEventListener("keydown", onKey);
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
    <aside class="cell-panel panel" aria-label={L("Выбранный участок", "Ground you clicked")}>
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
