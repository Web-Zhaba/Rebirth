import type maplibregl from "maplibre-gl";
import { city } from "../game/state";
import { CellPanel } from "./CellPanel";
import { FoundCity } from "./FoundCity";
import { Hud } from "./Hud";
import { OfflineReport } from "./OfflineReport";
import { ResourceBar } from "./ResourceBar";

export function App({ map }: { map: maplibregl.Map }) {
  const c = city.value;
  return (
    <>
      {c ? <Hud map={map} city={c} /> : <FoundCity map={map} />}
      {c && <ResourceBar />}
      <CellPanel />
      <OfflineReport />
    </>
  );
}
