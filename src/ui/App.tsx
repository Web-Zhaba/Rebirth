import type maplibregl from "maplibre-gl";
import { city } from "../simClient";
import { AwayNotice } from "./AwayNotice";
import { BuildBar } from "./BuildBar";
import { BuildingPanel } from "./BuildingPanel";
import { DaySummary } from "./DaySummary";
import { FoundCity } from "./FoundCity";
import { Hud } from "./Hud";
import { NightTint } from "./NightTint";
import { NotebookHost } from "./NotebookHost";
import { TerrainInspector } from "./TerrainInspector";

export function App({ map }: { map: maplibregl.Map }) {
  const c = city.value;
  return (
    <>
      {c ? <Hud city={c} map={map} /> : <FoundCity map={map} />}
      {c && <NightTint />}
      {c && <TerrainInspector map={map} />}
      {c && <BuildBar />}
      {c && <BuildingPanel />}
      {c && <DaySummary map={map} />}
      {c && <NotebookHost />}
      <AwayNotice />
    </>
  );
}
